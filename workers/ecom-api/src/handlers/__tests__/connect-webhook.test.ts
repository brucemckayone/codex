/**
 * Connect Webhook Handler Tests (Codex-qigid)
 *
 * Tests the handleConnectWebhook function which processes Stripe Connect
 * account.updated events.
 *
 * Key test scenarios (Codex-qigid — re-check from data.object):
 * - Active transition is detected from data.object regardless of
 *   `previous_attributes` content (empty diff, partial diff, ricochet).
 * - Idempotency: the payee-wide drain fires ONLY on the persisted
 *   transition (DB row chargesEnabled/payoutsEnabled flip false → true).
 * - Ricochet (active → restricted → active) drains on each
 *   first-transition-to-active hop.
 * - The drain is keyed by the account alone: a per-user account carries only
 *   `codex_user_id` metadata, and that is enough (Codex-2hxff.13).
 * - The payout drain runs through the composition root's `background`, on
 *   the shared pool — no second DB client (Codex-2hxff.54).
 * - account.application.deauthorized still routes correctly.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { WebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock the module under test's dependencies BEFORE importing.
// The handler gets its services from `createWebhookServices`; mock that seam
// so each test hands over its own stubs, and the drain tests can prove the
// whole event runs on the one set it returns.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    createWebhookServices: vi.fn(),
  };
});

import { createWebhookServices } from '@codex/worker-utils';
import { handleConnectWebhook } from '../connect-webhook';

type StripeConnectRow = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

function createContext(): {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
  waitUntilSpy: ReturnType<typeof vi.fn>;
} {
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({});
  // The handler only hands executionCtx to `createWebhookServices` (whose
  // `release` is mocked), so any call here is the handler's own.
  const waitUntilSpy = vi.fn();
  (mock as unknown as Record<string, unknown>).executionCtx = {
    waitUntil: waitUntilSpy,
    passThroughOnException: vi.fn(),
  };
  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
    waitUntilSpy,
  };
}

function createAccountUpdatedEvent(opts: {
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  previousAttributes?: Partial<Stripe.Account>;
}): Stripe.Event {
  // What accounts.create sets on a per-user account: no organisation.
  const account: Partial<Stripe.Account> = {
    id: opts.accountId ?? 'acct_test_123',
    object: 'account',
    charges_enabled: opts.chargesEnabled,
    payouts_enabled: opts.payoutsEnabled,
    metadata: { codex_user_id: 'user_test_123', codex_env: 'test' },
  };
  return {
    id: `evt_${Date.now()}_${Math.random()}`,
    type: STRIPE_EVENTS.ACCOUNT_UPDATED,
    data: {
      object: account,
      previous_attributes: opts.previousAttributes ?? {},
    },
  } as unknown as Stripe.Event;
}

describe('handleConnectWebhook (Codex-qigid: re-check active from data.object)', () => {
  let mockStripe: Stripe;
  let mockHandleAccountUpdated: ReturnType<typeof vi.fn>;
  let mockHandleAccountDeauthorized: ReturnType<typeof vi.fn>;
  let mockGetAccountByStripeId: ReturnType<typeof vi.fn>;
  let mockDrainPayee: ReturnType<typeof vi.fn>;
  let mockBackground: ReturnType<typeof vi.fn>;
  let mockRelease: ReturnType<typeof vi.fn>;
  let dbState: StripeConnectRow | null;

  beforeEach(() => {
    vi.clearAllMocks();
    dbState = null;

    mockHandleAccountUpdated = vi.fn(async (account: Stripe.Account) => {
      // Mirror the production handleAccountUpdated side-effect on dbState
      // so subsequent reads in a single test see the updated state.
      dbState = {
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
      };
    });
    mockHandleAccountDeauthorized = vi.fn().mockResolvedValue(undefined);
    mockGetAccountByStripeId = vi.fn(async () =>
      dbState ? { ...dbState } : null
    );
    mockDrainPayee = vi.fn().mockResolvedValue({ resolved: 0, failed: 0 });
    // Pass-through, like the real tracker: returns the task it registers.
    mockBackground = vi.fn((promise: Promise<unknown>) => promise);
    mockRelease = vi.fn();

    mockStripe = {} as Stripe;

    // The registry's services, as the composition root hands them over.
    vi.mocked(createWebhookServices).mockResolvedValue({
      services: {
        connect: {
          handleAccountUpdated: mockHandleAccountUpdated,
          handleAccountDeauthorized: mockHandleAccountDeauthorized,
          getAccountByStripeId: mockGetAccountByStripeId,
        },
        subscription: {
          resolvePendingPayoutsForAccount: mockDrainPayee,
        },
      } as unknown as WebhookServices['services'],
      background: mockBackground as unknown as WebhookServices['background'],
      release: mockRelease,
    });
  });

  /** The drain the handler registered on `background`, settled. */
  async function settleDrain(): Promise<void> {
    await mockBackground.mock.results[0]?.value;
  }

  // ─── transition detection from data.object ──────────────────────────────

  it('detects activation transition with EMPTY previous_attributes (DB row was inactive)', async () => {
    // Empty diff is the headline bug: Stripe may fire account.updated with
    // previous_attributes={} when an unrelated capability/requirement field
    // changed, but charges/payouts have flipped on at the same time.
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      previousAttributes: {},
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockHandleAccountUpdated).toHaveBeenCalledOnce();
    expect(mockDrainPayee).toHaveBeenCalledOnce();
    expect(mockDrainPayee).toHaveBeenCalledWith('acct_test_123');
  });

  it('detects activation with PARTIAL previous_attributes (only one field in diff)', async () => {
    // Real Stripe behaviour: previous_attributes may include only the
    // capability that flipped. The old code keyed on
    // previous_attributes.charges_enabled being defined; if `charges_enabled`
    // was already true in the previous state and only `payouts_enabled`
    // flipped on, wasActive was incorrectly computed using the now-true
    // `account.charges_enabled` fallback for the missing field.
    dbState = { chargesEnabled: true, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      previousAttributes: { payouts_enabled: false },
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockDrainPayee).toHaveBeenCalledOnce();
  });

  // ─── idempotency: DB-backed debounce ────────────────────────────────────

  it('does NOT drain when the DB row is already active (a duplicate event)', async () => {
    // Duplicate active-state event after the account is already active.
    dbState = { chargesEnabled: true, payoutsEnabled: true };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      previousAttributes: {},
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockHandleAccountUpdated).toHaveBeenCalledOnce();
    expect(mockDrainPayee).not.toHaveBeenCalled();
  });

  it('drains only on the FIRST transition across two consecutive active events', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event1 = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const event2 = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context } = createContext();

    await handleConnectWebhook(event1, mockStripe, context);
    await handleConnectWebhook(event2, mockStripe, context);

    expect(mockHandleAccountUpdated).toHaveBeenCalledTimes(2);
    expect(mockDrainPayee).toHaveBeenCalledOnce();
  });

  // ─── ricochet: restricted → active → restricted → active ────────────────

  it('drains again on EACH re-activation in a ricochet sequence (restricted → active)', async () => {
    // 1) restricted (initial DB state)
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const { context } = createContext();

    // 2) restricted → active
    await handleConnectWebhook(
      createAccountUpdatedEvent({
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
      mockStripe,
      context
    );
    expect(mockDrainPayee).toHaveBeenCalledTimes(1);

    // 3) active → restricted (charges flipped off — payouts already off in
    //    Stripe's view of "restricted"; either field flipping clears active)
    await handleConnectWebhook(
      createAccountUpdatedEvent({
        chargesEnabled: false,
        payoutsEnabled: false,
      }),
      mockStripe,
      context
    );
    expect(mockDrainPayee).toHaveBeenCalledTimes(1);

    // 4) restricted → active (second activation)
    await handleConnectWebhook(
      createAccountUpdatedEvent({
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
      mockStripe,
      context
    );
    expect(mockDrainPayee).toHaveBeenCalledTimes(2);
  });

  // ─── guard rails ────────────────────────────────────────────────────────

  // Codex-2hxff.13 (SUB-05): accounts are per user and carry only
  // `codex_user_id`. The handler used to require `codex_organization_id`, so
  // every real account warned and skipped the drain.
  it('drains a per-user account that carries only codex_user_id metadata', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      accountId: 'acct_per_user_1',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context, mock } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockDrainPayee).toHaveBeenCalledOnce();
    expect(mockDrainPayee).toHaveBeenCalledWith('acct_per_user_1');
    expect(mock._obs.warn).not.toHaveBeenCalled();
  });

  it('does NOT fire payouts on inactive update (charges on, payouts off)', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockDrainPayee).not.toHaveBeenCalled();
  });

  // ─── deauthorize path ───────────────────────────────────────────────────

  it('routes account.application.deauthorized to handleAccountDeauthorized', async () => {
    const event = {
      id: 'evt_deauth_1',
      type: STRIPE_EVENTS.ACCOUNT_DEAUTHORIZED,
      account: 'acct_deauth_1',
      data: { object: { id: 'ca_app_1', object: 'application' } },
    } as unknown as Stripe.Event;
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockHandleAccountDeauthorized).toHaveBeenCalledWith('acct_deauth_1');
  });

  it('logs a warning when deauthorize event has no account id', async () => {
    const event = {
      id: 'evt_deauth_2',
      type: STRIPE_EVENTS.ACCOUNT_DEAUTHORIZED,
      data: { object: { id: 'ca_app_2', object: 'application' } },
    } as unknown as Stripe.Event;
    const { context, mock } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockHandleAccountDeauthorized).not.toHaveBeenCalled();
    expect(mock._obs.warn).toHaveBeenCalledWith(
      'Connect deauthorized event missing account ID',
      expect.objectContaining({ type: STRIPE_EVENTS.ACCOUNT_DEAUTHORIZED })
    );
  });

  // ─── payout drain (Codex-2hxff.54) ──────────────────────────────────────
  //
  // The drain used to open a second DB client and ride a bare
  // `executionCtx.waitUntil`. It now runs on the registry's
  // SubscriptionService, registered on `background`, so `release` holds the
  // shared pool open until it settles.

  it('drains pending payouts through background on the shared pool, logging the result', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    mockDrainPayee.mockResolvedValueOnce({ resolved: 2, failed: 1 });
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context, mock, waitUntilSpy } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockBackground).toHaveBeenCalledOnce();
    expect(mockDrainPayee).toHaveBeenCalledWith('acct_test_123');
    // Registered BEFORE release, so release waits for it.
    const registeredAt = mockBackground.mock.invocationCallOrder[0] ?? 0;
    const releasedAt = mockRelease.mock.invocationCallOrder[0] ?? 0;
    expect(registeredAt).toBeGreaterThan(0);
    expect(releasedAt).toBeGreaterThan(registeredAt);
    // One pool for the whole event: no second DB client, no bare waitUntil.
    expect(createWebhookServices).toHaveBeenCalledOnce();
    expect(waitUntilSpy).not.toHaveBeenCalled();

    await settleDrain();

    expect(mock._obs.info).toHaveBeenCalledWith(
      'Pending payouts resolved on account activation',
      expect.objectContaining({
        accountId: 'acct_test_123',
        resolved: 2,
        failed: 1,
      })
    );
  });

  it('logs a failed drain at error level without failing the webhook', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    mockDrainPayee.mockRejectedValueOnce(new Error('Transfer create failed'));
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context, mock } = createContext();

    await expect(
      handleConnectWebhook(event, mockStripe, context)
    ).resolves.toBeUndefined();
    // The task handed to background swallows its own failure.
    await expect(settleDrain()).resolves.toBeUndefined();

    expect(mock._obs.error).toHaveBeenCalledWith(
      'Failed to resolve pending payouts',
      expect.objectContaining({
        errorId: expect.any(String),
        accountId: 'acct_test_123',
        error: 'Transfer create failed',
      })
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ─── cleanup contract ───────────────────────────────────────────────────

  it('always runs cleanup in the finally block', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('runs cleanup when the service throws', async () => {
    mockHandleAccountUpdated.mockRejectedValueOnce(new Error('DB error'));
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context } = createContext();

    await expect(
      handleConnectWebhook(event, mockStripe, context)
    ).rejects.toThrow('DB error');

    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
