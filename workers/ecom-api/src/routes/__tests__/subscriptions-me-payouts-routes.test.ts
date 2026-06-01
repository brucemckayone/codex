/**
 * Integration tests for creator-self-scoped /subscriptions/me/* routes
 * (Codex-69t7c.7 / WP7) — GET /me/payouts + GET /me/earnings-summary.
 *
 * Runs against the REAL `procedure()` resolver (memory:
 * implement/real-resolver-route-test-ecom): a test middleware injects `user`
 * BEFORE the route so the real `authenticateSession` early-returns and the
 * rest of the resolver runs (rate-limit → role([]) → needsOrg=false). Only
 * `@codex/subscription`'s service is mocked (spies), so no DB/Stripe fires.
 * Dispatched via `app.fetch(req, env, createExecutionContext())` (procedure
 * needs `ctx.executionCtx.waitUntil`).
 *
 * Proves, through the real resolver: a plain member reaches the routes (no org
 * gate), unauthenticated is rejected, and a query-smuggled userId/organizationId
 * is ignored in favour of the session id.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscriptionSpies = {
  listPayoutsForCreator: vi.fn(),
  getEarningsSummaryForCreator: vi.fn(),
};

vi.mock('@codex/subscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/subscription')>();
  return {
    ...actual,
    SubscriptionService: vi.fn(() => subscriptionSpies),
  };
});

// Import AFTER the mock so the real service registry resolves the mocked class.
import subscriptions from '../subscriptions';

const CREATOR = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};

// A "plain member": no org-management capability. Reaching the routes proves
// they are gated by `auth:'required'` alone, not requireOrgManagement.
const PLAIN_MEMBER = {
  id: '9c2e1a3f-4d5b-4e6a-9071-223344556677',
  email: 'member@test.com',
  role: 'member',
};

const PAYOUTS_PAGE = {
  items: [
    {
      id: 'p1',
      organizationId: 'org-1',
      amountCents: 1000,
      currency: 'gbp',
      reason: '',
      status: 'resolved',
      payoutType: 'creator_payout',
      sourceType: 'subscription',
      resolvedAt: null,
      stripeTransferId: 'tr_1',
      transferGroup: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      purchaseId: null,
      subscriptionId: null,
      stripeChargeId: null,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const SUMMARY = {
  earnedInPeriodCents: 1000,
  totalEarnedCents: 1500,
  inTransitCents: 200,
  needsAttentionCount: 1,
};

function buildApp(user: Record<string, unknown> | null) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (user) {
      c.set('user', user);
      c.set('session', { id: 'sess_test', userId: user.id });
    }
    await next();
  });
  app.route('/subscriptions', subscriptions);
  return app;
}

async function dispatch(
  app: ReturnType<typeof buildApp>,
  req: Request
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await app.fetch(req, env, ec);
  await waitOnExecutionContext(ec);
  return res;
}

function getReq(path: string) {
  return new Request(`http://ecom-api.test${path}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionSpies.listPayoutsForCreator.mockResolvedValue(PAYOUTS_PAGE);
  subscriptionSpies.getEarningsSummaryForCreator.mockResolvedValue(SUMMARY);
});

describe('GET /subscriptions/me/payouts — real resolver', () => {
  it('authenticated creator → 200 with {items,pagination}, service called with SESSION user id', async () => {
    const res = await dispatch(
      buildApp(CREATOR),
      getReq('/subscriptions/me/payouts')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: PAYOUTS_PAGE.items,
      pagination: PAYOUTS_PAGE.pagination,
    });
    expect(subscriptionSpies.listPayoutsForCreator).toHaveBeenCalledWith(
      CREATOR.id,
      expect.objectContaining({ status: 'all', sourceType: 'all' })
    );
  });

  it('plain member (no org-management role) reaches the route → 200', async () => {
    const res = await dispatch(
      buildApp(PLAIN_MEMBER),
      getReq('/subscriptions/me/payouts')
    );

    expect(res.status).toBe(200);
    expect(subscriptionSpies.listPayoutsForCreator).toHaveBeenCalledWith(
      PLAIN_MEMBER.id,
      expect.anything()
    );
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq('/subscriptions/me/payouts')
    );

    expect(res.status).toBe(401);
    expect(subscriptionSpies.listPayoutsForCreator).not.toHaveBeenCalled();
  });

  it('IDOR: query-smuggled userId/organizationId is ignored — session id wins', async () => {
    const res = await dispatch(
      buildApp(CREATOR),
      getReq(
        `/subscriptions/me/payouts?userId=${PLAIN_MEMBER.id}&organizationId=11111111-1111-4111-8111-111111111111`
      )
    );

    expect(res.status).toBe(200);
    expect(subscriptionSpies.listPayoutsForCreator).toHaveBeenCalledWith(
      CREATOR.id,
      expect.anything()
    );
    // The forged id never reaches the service.
    expect(subscriptionSpies.listPayoutsForCreator).not.toHaveBeenCalledWith(
      PLAIN_MEMBER.id,
      expect.anything()
    );
  });

  it('passes the status filter through to the service', async () => {
    await dispatch(
      buildApp(CREATOR),
      getReq('/subscriptions/me/payouts?status=pending')
    );

    expect(subscriptionSpies.listPayoutsForCreator).toHaveBeenCalledWith(
      CREATOR.id,
      expect.objectContaining({ status: 'pending' })
    );
  });
});

describe('GET /subscriptions/me/earnings-summary — real resolver', () => {
  it('authenticated creator → 200 with {data: summary}, service called with session id', async () => {
    const res = await dispatch(
      buildApp(CREATOR),
      getReq('/subscriptions/me/earnings-summary')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SUMMARY });
    expect(subscriptionSpies.getEarningsSummaryForCreator).toHaveBeenCalledWith(
      CREATOR.id,
      expect.any(Object)
    );
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq('/subscriptions/me/earnings-summary')
    );

    expect(res.status).toBe(401);
    expect(
      subscriptionSpies.getEarningsSummaryForCreator
    ).not.toHaveBeenCalled();
  });
});
