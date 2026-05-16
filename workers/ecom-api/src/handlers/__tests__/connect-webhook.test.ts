/**
 * Connect Webhook Handler Tests (Codex-qigid)
 *
 * Tests the handleConnectWebhook function which processes Stripe Connect
 * account.updated events.
 *
 * Key test scenarios (Codex-qigid — re-check from data.object):
 * - Active transition is detected from data.object regardless of
 *   `previous_attributes` content (empty diff, partial diff, ricochet).
 * - Idempotency: resolvePendingPayouts fires ONLY on the persisted
 *   transition (DB row chargesEnabled/payoutsEnabled flip false → true).
 * - Ricochet (active → restricted → active) fires resolvePendingPayouts
 *   on each first-transition-to-active hop.
 * - account.application.deauthorized still routes correctly.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock the module under test's dependencies BEFORE importing.
vi.mock('@codex/subscription', () => ({
  ConnectAccountService: vi.fn(),
  SubscriptionService: vi.fn(),
}));

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    createWebhookDbClient: vi.fn(),
  };
});

import {
  ConnectAccountService,
  SubscriptionService,
} from '@codex/subscription';
import { createWebhookDbClient } from '@codex/worker-utils';
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
  const waitUntilSpy = vi.fn(async (p: Promise<unknown>) => {
    // Drain the promise so .finally(subCleanup) runs in-test.
    await p;
  });
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

// Default org UUID for fixtures (Codex-ohjvn: connect-webhook now
// validates metadata.codex_organization_id as a real UUID).
const DEFAULT_TEST_ORG_UUID = '00000000-0000-4000-8000-000000000001';

function createAccountUpdatedEvent(opts: {
  accountId?: string;
  orgId?: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  previousAttributes?: Partial<Stripe.Account>;
}): Stripe.Event {
  const account: Partial<Stripe.Account> = {
    id: opts.accountId ?? 'acct_test_123',
    object: 'account',
    charges_enabled: opts.chargesEnabled,
    payouts_enabled: opts.payoutsEnabled,
    metadata:
      opts.orgId === null
        ? {}
        : {
            codex_organization_id: opts.orgId ?? DEFAULT_TEST_ORG_UUID,
          },
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
  let mockResolvePendingPayouts: ReturnType<typeof vi.fn>;
  let mockCleanup: ReturnType<typeof vi.fn>;
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
    mockResolvePendingPayouts = vi
      .fn()
      .mockResolvedValue({ resolved: 0, totalCents: 0 });
    mockCleanup = vi.fn().mockResolvedValue(undefined);

    mockStripe = {} as Stripe;

    (createWebhookDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'db' },
      cleanup: mockCleanup,
    });

    (
      ConnectAccountService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      handleAccountUpdated: mockHandleAccountUpdated,
      handleAccountDeauthorized: mockHandleAccountDeauthorized,
      getAccountByStripeId: mockGetAccountByStripeId,
    }));

    (
      SubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      resolvePendingPayouts: mockResolvePendingPayouts,
    }));
  });

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
    expect(mockResolvePendingPayouts).toHaveBeenCalledOnce();
    expect(mockResolvePendingPayouts).toHaveBeenCalledWith(
      DEFAULT_TEST_ORG_UUID,
      'acct_test_123'
    );
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

    expect(mockResolvePendingPayouts).toHaveBeenCalledOnce();
  });

  // ─── idempotency: DB-backed debounce ────────────────────────────────────

  it('does NOT call resolvePendingPayouts when DB row is already active', async () => {
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
    expect(mockResolvePendingPayouts).not.toHaveBeenCalled();
  });

  it('fires resolvePendingPayouts only on FIRST transition across two consecutive active events', async () => {
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
    expect(mockResolvePendingPayouts).toHaveBeenCalledOnce();
  });

  // ─── ricochet: restricted → active → restricted → active ────────────────

  it('fires resolvePendingPayouts on EACH re-activation in a ricochet sequence', async () => {
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
    expect(mockResolvePendingPayouts).toHaveBeenCalledTimes(1);

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
    expect(mockResolvePendingPayouts).toHaveBeenCalledTimes(1);

    // 4) restricted → active (second activation)
    await handleConnectWebhook(
      createAccountUpdatedEvent({
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
      mockStripe,
      context
    );
    expect(mockResolvePendingPayouts).toHaveBeenCalledTimes(2);
  });

  // ─── guard rails ────────────────────────────────────────────────────────

  it('skips resolvePendingPayouts when metadata.codex_organization_id is missing', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      orgId: null,
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockHandleAccountUpdated).toHaveBeenCalledOnce();
    expect(mockResolvePendingPayouts).not.toHaveBeenCalled();
  });

  // Codex-ohjvn (F-57 + F-63): on an active transition with missing or
  // malformed org metadata, the handler WARNs (rather than silently
  // skipping) so operators see the drift.
  it('F-57: WARNS (not just skips) when active transition has missing org metadata', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      orgId: null,
    });
    const { context, mock } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mock._obs.warn).toHaveBeenCalledWith(
      expect.stringMatching(/missing|invalid/i),
      expect.objectContaining({ accountId: 'acct_test_123' })
    );
    expect(mockResolvePendingPayouts).not.toHaveBeenCalled();
  });

  it('F-63: rejects non-UUID metadata.codex_organization_id without querying', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
      orgId: 'not-a-valid-uuid',
    });
    const { context, mock } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mock._obs.warn).toHaveBeenCalled();
    expect(mockResolvePendingPayouts).not.toHaveBeenCalled();
  });

  it('does NOT fire payouts on inactive update (charges on, payouts off)', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockResolvePendingPayouts).not.toHaveBeenCalled();
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

  // ─── cleanup contract ───────────────────────────────────────────────────

  it('always runs cleanup in the finally block', async () => {
    dbState = { chargesEnabled: false, payoutsEnabled: false };
    const event = createAccountUpdatedEvent({
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    const { context } = createContext();

    await handleConnectWebhook(event, mockStripe, context);

    expect(mockCleanup).toHaveBeenCalled();
  });
});
