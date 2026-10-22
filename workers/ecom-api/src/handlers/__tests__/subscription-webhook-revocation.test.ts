/**
 * Subscription + Payment webhook access-revocation tests.
 *
 * Complements `subscription-webhook-invalidation.test.ts` (which proves the
 * cache-invalidation contract) by focusing on the **KV revocation contract**
 * introduced in bead Codex-usgf7 — every Stripe event that REDUCES a user's
 * access must write `revoked:user:{userId}:{orgId}` via `AccessRevocation`
 * so `ContentAccessService.getStreamingUrl()` can reject already-minted
 * presigned R2 URLs within the revocation TTL window.
 *
 * Coverage (rules: docs/payments/access.md, "Streaming revocation"):
 *
 * | Event                              | Positive | Negative | Fire-and-forget |
 * | ---------------------------------- | -------- | -------- | --------------- |
 * | customer.subscription.deleted      |   yes    |   yes    |       yes       |
 * | invoice.payment_failed (PAST_DUE)  |   no — access continues while Stripe retries (P-3) |
 * | charge.refunded (full, current-period tier payment) | yes | yes | yes |
 * | customer.subscription.updated *NOT* (cancel_at_period_end etc.)   |
 *
 * The "must-not-happen" paths are mandatory per `feedback_security_deep_test`:
 * the product decision "revoke at period end not on cancel" hinges on
 * `customer.subscription.updated` (with `cancel_at_period_end=true` or a
 * benign tier/status transition) NEVER writing a revocation key.
 *
 * Strategy: mock `@codex/access` and spy on `AccessRevocation#revoke`. This
 * keeps the test focused on the webhook handler contract; actual KV writes
 * are covered by `@codex/access` unit tests.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports.
vi.mock('@codex/database', () => ({
  createPerRequestDbClient: vi.fn(),
}));

vi.mock('@codex/subscription', () => ({
  SubscriptionService: vi.fn(),
  // Dashboard sync-back path (Codex-s7h0y) instantiates TierService even
  // on unrelated events. Provide a default stub so `new TierService(...)`
  // doesn't throw; revocation tests don't care about sync-back behaviour.
  TierService: vi.fn().mockImplementation(() => ({
    applyStripeProductUpdate: vi.fn().mockResolvedValue(null),
    recordStripePriceDrift: vi.fn().mockResolvedValue(undefined),
  })),
  // The renewal-time price swap (Codex-2hxff.3) — nothing pending here.
  applyDuePendingPriceChange: vi.fn().mockResolvedValue(false),
  PENDING_PRICE_ID_KEY: 'codex_pending_price_id',
  // invalidateForUser is exercised in the sibling invalidation test; here we
  // only care that it doesn't throw synchronously in revocation scenarios.
  invalidateForUser: vi.fn(),
  // Codex-4y8pt: the handler constructs CourseSubscriptionService for EVERY
  // subscription event (course subs are mode=subscription on this same webhook,
  // discriminated later by `type: 'course_subscription'` metadata). A vi.mock
  // factory is a CLOSED namespace, so omitting this export made vitest throw on
  // the ACCESS at subscription-webhook.ts:277 — before any test assertion ran.
  // Stubbed rather than left bare so a future course-sub test gets a mock method
  // instead of a TypeError; no test here routes through that branch.
  // The handler ALSO calls the STATIC `isCourseSubscription` to discriminate
  // (three sites), so the mock needs both halves: a constructor for the
  // instance and the static on the mock function itself.
  CourseSubscriptionService: Object.assign(
    vi.fn().mockImplementation(() => ({
      handleCourseSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
      handleCourseSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
      handleCourseSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
      handleCourseInvoicePaymentSucceeded: vi.fn().mockResolvedValue(undefined),
    })),
    {
      // MIRRORS the real predicate rather than hardcoding `false`
      // (course-subscription-service.ts:677 — metadata.type ===
      // COURSE_SUBSCRIPTION_METADATA_TYPE). A constant `false` would pass today,
      // because every fixture here is an ORG subscription, and would then
      // silently mis-route the first test that does add course metadata. The
      // literal is inlined because a vi.mock factory is hoisted above imports
      // and so cannot reference the exported constant.
      isCourseSubscription: vi.fn(
        (sub: { metadata?: Record<string, string> | null }) =>
          (sub?.metadata?.type ?? null) === 'course_subscription'
      ),
    }
  ),
}));

vi.mock('@codex/purchase', () => ({
  PurchaseService: vi.fn(),
  // Codex-4y8pt (second half): CourseSubscriptionService is constructed with
  // `feeConfig: new FeeConfigService(...)`. JS evaluates a `new` expression's
  // CALLEE before its ARGUMENTS, so the CourseSubscriptionService access threw
  // first and hid this identical gap entirely — the CI log named one missing
  // export while the code was missing two. Only constructed and passed through,
  // so a bare mock constructor is sufficient.
  FeeConfigService: vi.fn(),
}));

// `createWebhookServices` must stay real: it builds the registry on the
// (mocked) database client, so use importOriginal + spread.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    sendEmailToWorker: vi.fn(),
  };
});

// Spy on AccessRevocation.revoke AND .clear — both webhook handlers
// instantiate the class inline. Revoke is covered by the original
// Codex-usgf7 suite; clear is the counterpart for Codex-13ml3. A single
// mocked instance is returned from the mocked constructor so we can assert
// on both methods in separate tests.
const mockRevoke = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn().mockResolvedValue(undefined);
const mockIsRevoked = vi.fn().mockResolvedValue(null);
vi.mock('@codex/access', () => ({
  AccessRevocation: vi.fn().mockImplementation(() => ({
    revoke: mockRevoke,
    isRevoked: mockIsRevoked,
    clear: mockClear,
  })),
}));

import { AccessRevocation } from '@codex/access';
import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import {
  CourseSubscriptionService,
  SubscriptionService,
} from '@codex/subscription';
import { sendEmailToWorker } from '@codex/worker-utils';
import { handlePaymentWebhook } from '../payment-webhook';
import { handleSubscriptionWebhook } from '../subscription-webhook';

type KVMock = {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

function createKVStub(): KVMock {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  };
}

interface ContextBundle {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
  waitUntil: ReturnType<typeof vi.fn>;
  waitUntilPromises: Array<Promise<unknown>>;
  kv: KVMock;
}

/**
 * Build a handler context with CACHE_KV present + a spied `executionCtx.waitUntil`
 * that captures every promise passed to it. Tests can await these promises to
 * drive fire-and-forget error handling.
 */
function buildContext(
  envOverrides: Partial<StripeWebhookEnv['Bindings']> = {}
): ContextBundle {
  const kv = createKVStub();
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    env: {
      CACHE_KV: kv as unknown as StripeWebhookEnv['Bindings']['CACHE_KV'],
      ...envOverrides,
    },
  });

  const waitUntilPromises: Array<Promise<unknown>> = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  });
  (mock as unknown as Record<string, unknown>).executionCtx = {
    waitUntil,
    passThroughOnException: vi.fn(),
  };

  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
    waitUntil,
    waitUntilPromises,
    kv,
  };
}

/**
 * Drain queued waitUntil promises — allows assertions on fire-and-forget
 * error handling. The handler's `.catch()` swallows the revocation-side
 * error, so `Promise.allSettled` is sufficient (but we use it for safety).
 */
async function drainWaitUntil(bundle: ContextBundle): Promise<void> {
  await Promise.allSettled(bundle.waitUntilPromises);
}

// ────────────────────────────────────────────────────────────────────────────
// Subscription webhook — access-reducing events
// ────────────────────────────────────────────────────────────────────────────

describe('handleSubscriptionWebhook — access revocation', () => {
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockHandleUpdated: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceFailed: ReturnType<typeof vi.fn>;
  let mockHandleDeleted: ReturnType<typeof vi.fn>;
  let mockHandleCreated: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceSuccess: ReturnType<typeof vi.fn>;
  let mockHandlePaused: ReturnType<typeof vi.fn>;
  let mockHandleResumed: ReturnType<typeof vi.fn>;
  let mockHandleTrialWillEnd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the shared `mockRevoke` / `mockClear` spies so a test-level
    // rejection (e.g. "fire-and-forget failure") does NOT leak into the
    // next test.
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);
    mockIsRevoked.mockReset();
    mockIsRevoked.mockResolvedValue(null);

    mockHandleCreated = vi.fn().mockResolvedValue(undefined);
    mockHandleUpdated = vi.fn().mockResolvedValue(undefined);
    mockHandleDeleted = vi.fn().mockResolvedValue(undefined);
    mockHandlePaused = vi.fn().mockResolvedValue(undefined);
    mockHandleResumed = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceFailed = vi.fn().mockResolvedValue(undefined);
    mockHandleTrialWillEnd = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();

    mockStripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'sub_test',
          metadata: {
            codex_user_id: 'user_1',
            codex_organization_id: 'org_1',
          },
        }),
      },
    } as unknown as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'database' },
      cleanup: mockCleanup,
    });

    (
      SubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      handleSubscriptionCreated: mockHandleCreated,
      handleSubscriptionUpdated: mockHandleUpdated,
      handleSubscriptionDeleted: mockHandleDeleted,
      handleSubscriptionPaused: mockHandlePaused,
      handleSubscriptionResumed: mockHandleResumed,
      handleInvoicePaymentSucceeded: mockHandleInvoiceSuccess,
      handleInvoicePaymentFailed: mockHandleInvoiceFailed,
      handleTrialWillEnd: mockHandleTrialWillEnd,
      // charge.refunded clawback (Codex-13v21) — handlePaymentWebhook calls this.
      reverseSubscriptionPayoutsForCharge: vi.fn(),
      // The paid checkout's reservation (Codex-2hxff.15).
      markCheckoutSessionCompleted: vi.fn().mockResolvedValue(undefined),
    }));
  });

  function createEvent(
    type: string,
    data: Record<string, unknown> = {}
  ): Stripe.Event {
    return {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type,
      data: {
        object: {
          id: 'sub_test_revocation',
          ...data,
        },
      },
    } as unknown as Stripe.Event;
  }

  // ─── customer.subscription.deleted ──────────────────────────────────────────

  describe('customer.subscription.deleted', () => {
    it('positive: writes revocation with reason="subscription_deleted"', async () => {
      mockHandleDeleted.mockResolvedValueOnce({
        userId: 'user_del',
        orgId: 'org_del',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        'user_del',
        'org_del',
        'subscription_deleted'
      );
    });

    it('negative: no userId → revocation NOT called, no crash', async () => {
      mockHandleDeleted.mockResolvedValueOnce({ orgId: 'org_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: no orgId → revocation NOT called (revocation is org-scoped)', async () => {
      mockHandleDeleted.mockResolvedValueOnce({ userId: 'user_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: service returns undefined → revocation NOT called', async () => {
      mockHandleDeleted.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: no CACHE_KV binding → revocation NOT called, no crash', async () => {
      mockHandleDeleted.mockResolvedValueOnce({
        userId: 'user_nokv',
        orgId: 'org_nokv',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      // Without CACHE_KV we never instantiate AccessRevocation.
      expect(AccessRevocation).not.toHaveBeenCalled();
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('fire-and-forget: KV write failure does NOT surface, handler resolves', async () => {
      mockHandleDeleted.mockResolvedValueOnce({
        userId: 'user_fail',
        orgId: 'org_fail',
      });
      mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));

      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      // The webhook handler hands a single wrapped promise to waitUntil; that
      // wrapper has a `.catch()` so draining it should NOT reject.
      await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
      expect(mockRevoke).toHaveBeenCalledTimes(1);
    });
  });

  // ─── customer.subscription.paused (Codex-a0vk2) ────────────────────────────
  //
  // Pause is access-reducing like `subscription.deleted` but non-terminal —
  // reactivated by `customer.subscription.resumed` (sibling Codex-rh0on).
  // Revocation write reuses `reason: 'subscription_deleted'` because
  // `RevocationReason` in @codex/access is observability-only (never used
  // for branching) and the keyspace is binary (present or not).

  describe('customer.subscription.paused', () => {
    it('positive: writes revocation with reason="subscription_deleted"', async () => {
      mockHandlePaused.mockResolvedValueOnce({
        userId: 'user_pause',
        orgId: 'org_pause',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockHandlePaused).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        'user_pause',
        'org_pause',
        'subscription_deleted'
      );
      // Paused is access-reducing — the CLEAR helper must NOT fire.
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: service returns undefined → revocation NOT called', async () => {
      mockHandlePaused.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: missing userId → revocation NOT called', async () => {
      mockHandlePaused.mockResolvedValueOnce({ orgId: 'org_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: missing orgId → revocation NOT called (revocation is org-scoped)', async () => {
      mockHandlePaused.mockResolvedValueOnce({ userId: 'user_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: no CACHE_KV binding → revocation NOT called, no crash', async () => {
      mockHandlePaused.mockResolvedValueOnce({
        userId: 'user_nokv_pause',
        orgId: 'org_nokv_pause',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(AccessRevocation).not.toHaveBeenCalled();
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('fire-and-forget: KV write failure does NOT surface', async () => {
      mockHandlePaused.mockResolvedValueOnce({
        userId: 'user_pause_fail',
        orgId: 'org_pause_fail',
      });
      mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();
      await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
      expect(mockRevoke).toHaveBeenCalledTimes(1);
    });
  });

  // ─── customer.subscription.resumed (Codex-rh0on) ───────────────────────────
  //
  // Resume is access-RESTORING and the direct counterpart to
  // `customer.subscription.paused`. The webhook calls `clearAccess` to
  // remove the revocation key written at pause time. The service method
  // `handleSubscriptionResumed` owns the DB flip (paused → active) and the
  // cache invalidation (reason='subscription_resumed').

  describe('customer.subscription.resumed', () => {
    it('positive: clearAccess called with (userId, orgId)', async () => {
      mockHandleResumed.mockResolvedValueOnce({
        userId: 'user_resume',
        orgId: 'org_resume',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockHandleResumed).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith('user_resume', 'org_resume');
      // Resume is access-RESTORING — revoke must NOT fire.
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: service returns undefined (no matching sub) → clearAccess NOT called, no crash', async () => {
      mockHandleResumed.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockClear).not.toHaveBeenCalled();
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('negative: missing userId → clearAccess NOT called (org-scoped key needs both)', async () => {
      mockHandleResumed.mockResolvedValueOnce({ orgId: 'org_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: missing orgId → clearAccess NOT called', async () => {
      mockHandleResumed.mockResolvedValueOnce({ userId: 'user_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: no CACHE_KV binding → clearAccess NOT called, no crash', async () => {
      mockHandleResumed.mockResolvedValueOnce({
        userId: 'user_nokv_resume',
        orgId: 'org_nokv_resume',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(AccessRevocation).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('fire-and-forget: KV clear failure does NOT surface', async () => {
      mockHandleResumed.mockResolvedValueOnce({
        userId: 'user_resume_fail',
        orgId: 'org_resume_fail',
      });
      mockClear.mockRejectedValueOnce(new Error('KV unreachable'));
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();
      await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
      expect(mockClear).toHaveBeenCalledTimes(1);
    });
  });

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    // Owner decision P-3 (Codex-2hxff.10): a failed renewal KEEPS access while
    // Stripe retries the card. Access ends when Stripe gives up, on
    // customer.subscription.deleted or `unpaid` — covered elsewhere here.
    it('never writes a revocation, even for a known subscriber', async () => {
      mockHandleInvoiceFailed.mockResolvedValueOnce({
        userId: 'user_pf',
        orgId: 'org_pf',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
        id: 'in_failed',
        amount_due: 999,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockHandleInvoiceFailed).toHaveBeenCalledTimes(1);
      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('service returns void (no subscription found) → no revocation', async () => {
      mockHandleInvoiceFailed.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
        id: 'in_failed_void',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockRevoke).not.toHaveBeenCalled();
    });
  });

  // ─── customer.subscription.updated — MUST NOT WRITE REVOCATION ─────────────

  describe('customer.subscription.updated (explicit non-write path)', () => {
    // Product decision: `cancel_at_period_end=true` keeps paid access until
    // `currentPeriodEnd`, so the revocation keyspace must remain UNTOUCHED.
    // If this test fails, the product contract is broken — cancelled users
    // would lose access instantly instead of at period end.
    it('cancel_at_period_end=true → revocation NOT written', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_cape',
        orgId: 'org_cape',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: true,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('mid-subscription tier change (status=active) → revocation NOT written', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_tier',
        orgId: 'org_tier',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('status=past_due on update → revocation NOT written (access continues while Stripe retries)', async () => {
      // Owner decision P-3: past_due keeps access. No handler writes the
      // block for it; Stripe giving up (deleted / unpaid) does.
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_pd',
        orgId: 'org_pd',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'past_due',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('status=unpaid (rare reduced-access transition) → revocation WRITTEN', async () => {
      // The one update flavour that IS access-reducing and not covered by
      // another event. Guard ensures we still close the presigned-URL window.
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_unpaid',
        orgId: 'org_unpaid',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'unpaid',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        'user_unpaid',
        'org_unpaid',
        'payment_failed'
      );
    });
  });

  // ─── Non-reducing events — sanity check ─────────────────────────────────────

  describe('access-neutral events (sanity)', () => {
    it('invoice.payment_succeeded → revocation NOT written', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_paid',
        orgId: 'org_paid',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_paid',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockRevoke).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Access-RESTORING events — Codex-13ml3 (clear counterpart to usgf7 writes)
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Coverage matrix (task brief):
  //
  // | Event                                                       | Positive | Idempotent | No revocation present | Negative          |
  // | ----------------------------------------------------------- | :------: | :--------: | :-------------------: | :---------------: |
  // | customer.subscription.updated (status=active)               |   yes    |    yes     |         yes           | canceled/past_due |
  // | invoice.payment_succeeded                                   |   yes    |    yes     |         yes           | no userId / orgId |
  //
  // Every clear path must (a) actually call `AccessRevocation.clear`,
  // (b) tolerate KV delete being a no-op (idempotency / no-prior-key),
  // (c) NOT fire on access-reducing variants of the same event type.

  describe('customer.subscription.updated — access clearing', () => {
    it('positive: status=active → clear called with (userId, orgId)', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_restore',
        orgId: 'org_restore',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith('user_restore', 'org_restore');
    });

    it('positive: cancel_at_period_end=true still reports status=active → clear called (idempotent safe)', async () => {
      // Stripe reports status=active for `cancel_at_period_end=true`. The
      // conservative always-clear approach is safe: no revocation key was
      // ever written for this state (see the usgf7 non-write contract), so
      // the clear is a KV no-op.
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_cape_clear',
        orgId: 'org_cape_clear',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: true,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith(
        'user_cape_clear',
        'org_cape_clear'
      );
    });

    it('idempotent: two status=active events for the same user → clear called twice, no error', async () => {
      mockHandleUpdated.mockResolvedValue({
        userId: 'user_idem',
        orgId: 'org_idem',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(2);
    });

    it('no prior revocation: clear still called, still succeeds (KV delete is idempotent)', async () => {
      // Simulate the KV layer returning "no key" — our mock.clear() resolves
      // undefined regardless, which matches Cloudflare KV.delete semantics.
      mockClear.mockResolvedValueOnce(undefined);
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_no_key',
        orgId: 'org_no_key',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    it('negative: status=canceled → clear NOT called', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_cxl',
        orgId: 'org_cxl',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'canceled',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: status=past_due → clear NOT called (past_due writes no block to clear)', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_pd_clear',
        orgId: 'org_pd_clear',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'past_due',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: status=unpaid → clear NOT called (unpaid is access-reducing, writes revocation)', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_unpaid_clear',
        orgId: 'org_unpaid_clear',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'unpaid',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
      expect(mockRevoke).toHaveBeenCalledTimes(1);
    });

    it('negative: missing userId/orgId → clear NOT called', async () => {
      mockHandleUpdated.mockResolvedValueOnce({ userId: 'user_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: no CACHE_KV binding → clear NOT called, no crash', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_nokv_clear',
        orgId: 'org_nokv_clear',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('fire-and-forget: KV clear failure does NOT surface', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_clear_fail',
        orgId: 'org_clear_fail',
      });
      mockClear.mockRejectedValueOnce(new Error('KV unreachable'));
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();
      await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
      expect(mockClear).toHaveBeenCalledTimes(1);
    });
  });

  describe('invoice.payment_succeeded — access clearing', () => {
    it('positive: service returns userId+orgId → clear called', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_paid_clear',
        orgId: 'org_paid_clear',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_paid_clear',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith(
        'user_paid_clear',
        'org_paid_clear'
      );
    });

    it('idempotent: two payment_succeeded events → clear called twice, no error', async () => {
      mockHandleInvoiceSuccess.mockResolvedValue({
        userId: 'user_paid_idem',
        orgId: 'org_paid_idem',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_paid_idem',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(2);
    });

    it('no prior revocation: non-past_due renewal → clear still called (idempotent no-op)', async () => {
      // Even first-payment renewal (subscription never was PAST_DUE) triggers
      // the clear. This is by design: the over-clear is free, and matches
      // the conservative policy in the clearAccess helper.
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_first_paid',
        orgId: 'org_first_paid',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_first_paid',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    it('negative: service returns void (no matching sub) → clear NOT called', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_void',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: userId missing → clear NOT called (org-scoped key needs both)', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({ orgId: 'org_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_no_user',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: orgId missing → clear NOT called', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({ userId: 'user_only' });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_no_org',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('negative: no CACHE_KV binding → clear NOT called, no crash', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_nokv_paid',
        orgId: 'org_nokv_paid',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_no_kv',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('fire-and-forget: KV clear failure does NOT surface', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_paid_fail',
        orgId: 'org_paid_fail',
      });
      mockClear.mockRejectedValueOnce(new Error('KV timeout'));
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_paid_fail',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();
      await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Roundtrip — usgf7 write + 13ml3 clear cross-check
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Cross-bead contract: `customer.subscription.deleted` writes a revocation
  // key, `customer.subscription.updated(active)` clears it. This test drives
  // both events through a single shared mock instance and asserts the expected
  // sequence of (revoke, clear) calls — the authoritative KV-level roundtrip
  // is covered in the `@codex/access` unit tests; here we prove the webhook
  // layer wires the two beads together correctly.

  describe('roundtrip: subscription.deleted → subscription.updated(active)', () => {
    it('writes revocation, then clears it on reactivation into ACTIVE', async () => {
      const USER = 'user_roundtrip';
      const ORG = 'org_roundtrip';

      mockHandleDeleted.mockResolvedValueOnce({ userId: USER, orgId: ORG });
      mockHandleUpdated.mockResolvedValueOnce({ userId: USER, orgId: ORG });

      const bundle = buildContext();

      // 1. deleted → revoke written
      const deletedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED);
      await handleSubscriptionWebhook(deletedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        USER,
        ORG,
        'subscription_deleted'
      );
      expect(mockClear).not.toHaveBeenCalled();

      // 2. updated(active) → clear
      const updatedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });
      await handleSubscriptionWebhook(updatedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith(USER, ORG);

      // Post-clear, the access-check layer would see `isRevoked → null`;
      // simulate that contract here so the roundtrip matches reality.
      mockIsRevoked.mockResolvedValueOnce(null);
      const { AccessRevocation: AR } = await import('@codex/access');
      const instance = new AR(
        bundle.kv as unknown as import('@cloudflare/workers-types').KVNamespace
      );
      await expect(instance.isRevoked(USER, ORG)).resolves.toBeNull();
    });

    // Codex-a0vk2: paused → revoke → resumed (via subscription.updated
    // status=active, owned by Codex-13ml3) → clear. Mirrors the
    // deleted→updated(active) roundtrip; the sibling Codex-rh0on bead will
    // introduce a dedicated `customer.subscription.resumed` handler but the
    // access-RESTORING effect of status=active already covers the clear
    // edge today.
    it('paused → revoke → updated(active) → clear (roundtrip)', async () => {
      const USER = 'user_pause_rt';
      const ORG = 'org_pause_rt';

      mockHandlePaused.mockResolvedValueOnce({ userId: USER, orgId: ORG });
      mockHandleUpdated.mockResolvedValueOnce({ userId: USER, orgId: ORG });

      const bundle = buildContext();

      // 1. paused → revoke written
      const pausedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);
      await handleSubscriptionWebhook(pausedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        USER,
        ORG,
        'subscription_deleted'
      );
      expect(mockClear).not.toHaveBeenCalled();

      // 2. updated(active) → clear (simulates resume flow)
      const resumedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });
      await handleSubscriptionWebhook(resumedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith(USER, ORG);
    });

    // Codex-rh0on: the dedicated customer.subscription.resumed event — the
    // gold-standard assertion asked for in the task brief. Drives the full
    // lifecycle through a single shared mock instance:
    //   active → paused → resumed
    // asserting the revocation key is written at pause time and cleared at
    // resume time, and that no spurious revoke/clear calls fire on the
    // happy-path baseline.
    it('active → paused (revoke written) → resumed (revoke cleared) — full lifecycle', async () => {
      const USER = 'user_full_rt';
      const ORG = 'org_full_rt';

      // Happy-path baseline: an `updated(active)` event BEFORE pause — should
      // clear (idempotent no-op — no key yet) and must NEVER revoke.
      mockHandleUpdated.mockResolvedValueOnce({ userId: USER, orgId: ORG });
      mockHandlePaused.mockResolvedValueOnce({ userId: USER, orgId: ORG });
      mockHandleResumed.mockResolvedValueOnce({ userId: USER, orgId: ORG });

      const bundle = buildContext();

      // 1. active baseline → conservative always-clear fires (idempotent
      //    no-op because no revocation key exists yet). No revoke.
      const activeEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        status: 'active',
        cancel_at_period_end: false,
      });
      await handleSubscriptionWebhook(activeEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).not.toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledWith(USER, ORG);

      // 2. paused → revoke written (reason='subscription_deleted' tag —
      //    RevocationReason is observability-only, binary keyspace).
      const pausedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_PAUSED);
      await handleSubscriptionWebhook(pausedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).toHaveBeenCalledTimes(1);
      expect(mockRevoke).toHaveBeenCalledWith(
        USER,
        ORG,
        'subscription_deleted'
      );
      // No additional clear yet — the pause event must not clear.
      expect(mockClear).toHaveBeenCalledTimes(1);

      // 3. resumed → clear fires, revoke does NOT fire again.
      const resumedEvent = createEvent(STRIPE_EVENTS.SUBSCRIPTION_RESUMED);
      await handleSubscriptionWebhook(resumedEvent, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockHandleResumed).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledTimes(2);
      expect(mockClear).toHaveBeenLastCalledWith(USER, ORG);
      // Revoke count unchanged — resume must never revoke.
      expect(mockRevoke).toHaveBeenCalledTimes(1);
    });
  });

  // ─── a duplicate subscription, or a tombstoned row (Codex-2hxff.15) ────────
  //
  // The service returns a result that names no user, org or email for a
  // second subscription the user already had, and for a row Stripe has ended.
  // The webhook decides every side effect from those fields, so such a result
  // writes no streaming block, clears none, and sends no email: the
  // subscription the user keeps is never touched. Pinned per event.

  describe('a result naming no user, org or email', () => {
    const inert = {};

    it.each([
      ['checkout.session.completed', STRIPE_EVENTS.CHECKOUT_COMPLETED],
      ['customer.subscription.deleted', STRIPE_EVENTS.SUBSCRIPTION_DELETED],
      ['customer.subscription.paused', STRIPE_EVENTS.SUBSCRIPTION_PAUSED],
      ['customer.subscription.resumed', STRIPE_EVENTS.SUBSCRIPTION_RESUMED],
      ['invoice.payment_succeeded', STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED],
      ['invoice.payment_failed', STRIPE_EVENTS.INVOICE_PAYMENT_FAILED],
      [
        'customer.subscription.trial_will_end',
        STRIPE_EVENTS.SUBSCRIPTION_TRIAL_WILL_END,
      ],
    ])('%s: no block written or cleared, no email', async (_name, type) => {
      for (const handler of [
        mockHandleCreated,
        mockHandleDeleted,
        mockHandlePaused,
        mockHandleResumed,
        mockHandleInvoiceSuccess,
        mockHandleInvoiceFailed,
        mockHandleTrialWillEnd,
      ]) {
        handler.mockResolvedValue(inert);
      }
      const bundle = buildContext();
      const event = createEvent(type, {
        mode: 'subscription',
        subscription: 'sub_duplicate',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockRevoke).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
      expect(sendEmailToWorker).not.toHaveBeenCalled();
    });

    it.each([
      ['unpaid', 'unpaid'],
      ['active', 'active'],
    ])('customer.subscription.updated (%s): no block written or cleared', async (_name, status) => {
      mockHandleUpdated.mockResolvedValue(inert);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, { status });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);
      await drainWaitUntil(bundle);

      expect(mockHandleUpdated).toHaveBeenCalledOnce();
      expect(mockRevoke).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Payment webhook — charge.refunded
// ────────────────────────────────────────────────────────────────────────────

describe('handlePaymentWebhook — access revocation on charge.refunded', () => {
  // Owner decision P-4 (Codex-2hxff.10): a FULL refund of the LATEST
  // subscription payment cancels the subscription and writes the block. The
  // decision (full? latest? still live?) is SubscriptionService's
  // `cancelForFullRefund`, mocked here; the handler applies the cancellation
  // as `customer.subscription.deleted` would and writes the block.
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockProcessRefund: ReturnType<typeof vi.fn>;
  let mockCancelForFullRefund: ReturnType<typeof vi.fn>;
  let mockTierDeleted: ReturnType<typeof vi.fn>;

  const cancelledSub = { id: 'sub_refunded', status: 'canceled' };
  const tierEnded = {
    subscription: {
      kind: 'tier' as const,
      id: 'local_sub',
      stripeSubscriptionId: 'sub_refunded',
      userId: 'user_refund',
      organizationId: 'org_refund',
      status: 'active',
    },
    cancelled: cancelledSub,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);
    mockIsRevoked.mockReset();
    mockIsRevoked.mockResolvedValue(null);

    mockProcessRefund = vi.fn().mockResolvedValue({ userId: 'user_refund' });
    mockCancelForFullRefund = vi.fn().mockResolvedValue(undefined);
    mockTierDeleted = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();
    mockStripe = {} as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'database' },
      cleanup: mockCleanup,
    });

    (PurchaseService as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        processRefund: mockProcessRefund,
        // Codex-2hxff.8: charge.refunded records each refund and claims its
        // email; these suites only check revocation and cache invalidation.
        recordChargeRefunds: vi.fn().mockResolvedValue([]),
        claimRefundEmails: vi.fn().mockResolvedValue([]),
      })
    );
    (
      SubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      reverseSubscriptionPayoutsForCharge: vi.fn(),
      cancelForFullRefund: mockCancelForFullRefund,
      handleSubscriptionDeleted: mockTierDeleted,
    }));
  });

  function createRefundEvent(
    overrides: Record<string, unknown> = {}
  ): Stripe.Event {
    return {
      id: `evt_refund_${Math.random().toString(36).slice(2)}`,
      type: STRIPE_EVENTS.CHARGE_REFUNDED,
      data: {
        object: {
          id: 'ch_revocation',
          payment_intent: 'pi_test',
          amount: 1999,
          amount_refunded: 1999,
          billing_details: { email: null, name: null },
          refunds: {
            data: [{ id: 're_test', reason: 'requested_by_customer' }],
          },
          ...overrides,
        },
      },
    } as unknown as Stripe.Event;
  }

  function courseServiceInstance(): {
    handleCourseSubscriptionDeleted: ReturnType<typeof vi.fn>;
  } {
    const results = (
      CourseSubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mock.results;
    return results[results.length - 1]?.value;
  }

  it('asks the service with the charge: id, payment intent, amount and cumulative refunded', async () => {
    const bundle = buildContext();
    await handlePaymentWebhook(
      createRefundEvent({ amount_refunded: 500 }),
      mockStripe,
      bundle.context
    );

    expect(mockCancelForFullRefund).toHaveBeenCalledWith({
      chargeId: 'ch_revocation',
      paymentIntentId: 'pi_test',
      amountCents: 1999,
      amountRefundedCents: 500,
    });
  });

  it('positive: a tier subscription cancelled for a full refund → ended here + revocation reason="refund"', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce(tierEnded);
    const bundle = buildContext();

    await handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(mockTierDeleted).toHaveBeenCalledWith(
      cancelledSub,
      expect.any(String)
    );
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith(
      'user_refund',
      'org_refund',
      'refund'
    );
  });

  // Codex-2hxff.15: the refund path's own ending is the subscription's FIRST
  // end, so it sends the cancellation email. Stripe's later
  // customer.subscription.deleted finds it ended (a result of {}) and sends
  // nothing, so the email goes once.
  it('a full refund sends the cancellation email once; the later customer.subscription.deleted sends nothing', async () => {
    const cancelledEmail = {
      to: 'subscriber@example.com',
      templateName: 'subscription-cancelled',
      category: 'transactional',
      data: { planName: 'Gold' },
    };
    mockCancelForFullRefund.mockResolvedValueOnce(tierEnded);
    mockTierDeleted
      .mockResolvedValueOnce({
        userId: 'user_refund',
        orgId: 'org_refund',
        email: cancelledEmail,
      })
      .mockResolvedValueOnce({});
    const bundle = buildContext({ WEB_APP_URL: 'https://revelations.studio' });

    await handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context);
    await handleSubscriptionWebhook(
      {
        id: 'evt_deleted_after_refund',
        type: STRIPE_EVENTS.SUBSCRIPTION_DELETED,
        data: { object: cancelledSub },
      } as unknown as Stripe.Event,
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(mockTierDeleted).toHaveBeenCalledTimes(2);
    expect(mockTierDeleted).toHaveBeenNthCalledWith(
      1,
      cancelledSub,
      'https://revelations.studio'
    );
    expect(sendEmailToWorker).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      cancelledEmail
    );
    // One block, the refund's: the later event writes none.
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  // Owner decision 2026-10-20: a course plan's grant is revoked (as on
  // deletion), and the org-wide block — which would also stop the subscriber's
  // purchases and tier content — is NOT written.
  it('a course plan cancelled for a full refund → ended by the course service, NO org-wide revocation', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce({
      ...tierEnded,
      subscription: { ...tierEnded.subscription, kind: 'course' },
    });
    const bundle = buildContext();

    await handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(
      courseServiceInstance().handleCourseSubscriptionDeleted
    ).toHaveBeenCalledWith(cancelledSub);
    expect(mockTierDeleted).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('negative: nothing cancelled (partial refund, purchase, another payment) → revocation NOT written', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce(undefined);
    const bundle = buildContext();

    await handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(mockTierDeleted).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('negative: an orgless subscription is ended but no org-scoped revocation is written', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce({
      ...tierEnded,
      subscription: { ...tierEnded.subscription, organizationId: null },
    });
    const bundle = buildContext();

    await handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context);

    expect(mockTierDeleted).toHaveBeenCalledWith(
      cancelledSub,
      expect.any(String)
    );
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('negative: no CACHE_KV binding → revocation NOT written, no crash', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce(tierEnded);
    const bundle = buildContext({ CACHE_KV: undefined });

    await expect(
      handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('fire-and-forget: KV write failure does NOT surface', async () => {
    mockCancelForFullRefund.mockResolvedValueOnce(tierEnded);
    mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));
    const bundle = buildContext();

    await expect(
      handlePaymentWebhook(createRefundEvent(), mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });
});
