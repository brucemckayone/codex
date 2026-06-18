/**
 * Integration tests for creator-scoped /connect/me/* routes (Codex-69t7c.3 / WP3).
 *
 * These run against the REAL `procedure()` resolver (NOT mocked). The routes are
 * mounted on a Hono app and driven via `app.fetch()` with a real
 * `ExecutionContext` (so `procedure`'s `waitUntil` cleanup works). Only two
 * seams are stubbed:
 *
 *  1. The session: a test middleware sets `c.set('user', …)` BEFORE the route, so
 *     the real `authenticateSession()` early-returns (`if (c.get('user')) return`,
 *     helpers.ts) and the rest of `enforcePolicyInline` runs for real —
 *     rate-limit → `enforceRole([])` → `needsOrg === false` → handler. The
 *     unauthenticated path injects no user, so the real session middleware runs
 *     and returns 401.
 *  2. `@codex/subscription`'s `ConnectAccountService` is replaced with spies so no
 *     real Stripe/DB call fires (the established ecom-api mocking pattern).
 *
 * This deliberately AVOIDS mocking `procedure()` (memory:
 * procedure_mock_hides_resolver_bugs) — doing so would skip the very resolver
 * branch that decides whether an org-less `auth:'required'` route is reachable.
 * Here we prove, through the real resolver, that a plain member (no org role)
 * reaches the route and that an unauthenticated request is rejected.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Spies for the userId-centric ConnectAccountService methods (WP2) --------
const connectSpies = {
  createAccountForUser: vi.fn(),
  getStatusForUser: vi.fn(),
  syncAccountStatusForUser: vi.fn(),
  createDashboardLinkForUser: vi.fn(),
  // The registry calls setCache() when CACHE_KV is bound (it is, in env=test).
  setCache: vi.fn(),
};

vi.mock('@codex/subscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/subscription')>();
  return {
    ...actual,
    ConnectAccountService: vi.fn(() => connectSpies),
  };
});

// Import AFTER the mock so the real service registry resolves the mocked class.
import connect from '../connect';

const CREATOR_USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};

// A "plain member": a role with NO org-management capability. Reaching the
// route proves it is gated by `auth:'required'` alone, not requireOrgManagement.
const PLAIN_MEMBER = {
  id: '9c2e1a3f-4d5b-4e6a-9071-223344556677',
  email: 'member@test.com',
  role: 'member',
};

const STATUS_PAYLOAD = {
  isConnected: true,
  accountId: 'acct_test_123',
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active' as const,
  requirements: null,
};

const VALID_ONBOARD = {
  returnUrl: 'http://localhost:3000/creators/studio/earnings?connect=success',
  refreshUrl: 'http://localhost:3000/creators/studio/earnings?connect=refresh',
};

/**
 * Mount the real /connect routes behind a middleware that injects `user`
 * (or none, to exercise the real session middleware's 401 path).
 */
function buildApp(user: Record<string, unknown> | null) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (user) {
      c.set('user', user);
      c.set('session', { id: 'sess_test', userId: user.id });
    }
    await next();
  });
  app.route('/connect', connect);
  return app;
}

/**
 * Drive a request through the real worker pipeline with a genuine
 * ExecutionContext (procedure() needs `ctx.executionCtx.waitUntil` for cleanup).
 */
async function dispatch(
  app: ReturnType<typeof buildApp>,
  req: Request
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await app.fetch(req, env, ec);
  await waitOnExecutionContext(ec);
  return res;
}

function postReq(path: string, body?: unknown) {
  return new Request(`http://ecom-api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(path: string) {
  return new Request(`http://ecom-api.test${path}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  connectSpies.createAccountForUser.mockResolvedValue({
    accountId: 'acct_test_123',
    onboardingUrl: 'https://connect.stripe.com/setup/acct_test_123',
  });
  connectSpies.getStatusForUser.mockResolvedValue(STATUS_PAYLOAD);
  connectSpies.syncAccountStatusForUser.mockResolvedValue({
    stripeAccountId: 'acct_test_123',
    chargesEnabled: true,
    payoutsEnabled: true,
    status: 'active',
  });
  connectSpies.createDashboardLinkForUser.mockResolvedValue({
    url: 'https://connect.stripe.com/express/acct_test_123',
  });
});

describe('POST /connect/me/onboard — real resolver', () => {
  it('authenticated creator → 201, service called with the SESSION user id', async () => {
    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/onboard', VALID_ONBOARD)
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      data: {
        accountId: 'acct_test_123',
        onboardingUrl: 'https://connect.stripe.com/setup/acct_test_123',
      },
    });
    expect(connectSpies.createAccountForUser).toHaveBeenCalledWith(
      CREATOR_USER.id,
      VALID_ONBOARD.returnUrl,
      VALID_ONBOARD.refreshUrl
    );
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      postReq('/connect/me/onboard', VALID_ONBOARD)
    );

    expect(res.status).toBe(401);
    expect(connectSpies.createAccountForUser).not.toHaveBeenCalled();
  });

  it('IDOR: a body-smuggled userId/organizationId is ignored — the session id wins', async () => {
    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/onboard', {
        ...VALID_ONBOARD,
        userId: PLAIN_MEMBER.id,
        organizationId: '11111111-1111-4111-8111-111111111111',
      })
    );

    expect(res.status).toBe(201);
    expect(connectSpies.createAccountForUser).toHaveBeenCalledWith(
      CREATOR_USER.id,
      VALID_ONBOARD.returnUrl,
      VALID_ONBOARD.refreshUrl
    );
    // The forged id never reaches the service.
    expect(connectSpies.createAccountForUser).not.toHaveBeenCalledWith(
      PLAIN_MEMBER.id,
      expect.anything(),
      expect.anything()
    );
  });

  it('invalid returnUrl (javascript:) → 400 via the real validation step, service NOT called', async () => {
    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/onboard', {
        returnUrl: 'javascript:alert(1)',
        refreshUrl: VALID_ONBOARD.refreshUrl,
      })
    );

    expect(res.status).toBe(400);
    expect(connectSpies.createAccountForUser).not.toHaveBeenCalled();
  });

  it('a service failure propagates as an error, not a masked success', async () => {
    connectSpies.createAccountForUser.mockRejectedValue(
      new Error('stripe down')
    );

    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/onboard', VALID_ONBOARD)
    );

    // The rejection surfaces via mapErrorToResponse (500) — never a 201.
    expect(res.status).toBe(500);
  });
});

describe('GET /connect/me/status — real resolver', () => {
  it('plain member (no org-management role) reaches the route → 200', async () => {
    const res = await dispatch(
      buildApp(PLAIN_MEMBER),
      getReq('/connect/me/status')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: STATUS_PAYLOAD });
    expect(connectSpies.getStatusForUser).toHaveBeenCalledWith(PLAIN_MEMBER.id);
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(buildApp(null), getReq('/connect/me/status'));

    expect(res.status).toBe(401);
    expect(connectSpies.getStatusForUser).not.toHaveBeenCalled();
  });
});

describe('POST /connect/me/sync — real resolver', () => {
  it('syncs THEN returns the refreshed status payload (shape parity with /status)', async () => {
    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/sync')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: STATUS_PAYLOAD });
    expect(connectSpies.syncAccountStatusForUser).toHaveBeenCalledWith(
      CREATOR_USER.id
    );
    expect(connectSpies.getStatusForUser).toHaveBeenCalledWith(CREATOR_USER.id);
    // sync must run before the status read. invocationCallOrder is 1-based,
    // so `?? 0` keeps the "never called" case below any real order (caught by
    // the toBeGreaterThan guards) while satisfying the number-only matcher.
    const syncOrder =
      connectSpies.syncAccountStatusForUser.mock.invocationCallOrder[0] ?? 0;
    const statusOrder =
      connectSpies.getStatusForUser.mock.invocationCallOrder[0] ?? 0;
    expect(syncOrder).toBeGreaterThan(0);
    expect(statusOrder).toBeGreaterThan(0);
    expect(syncOrder).toBeLessThan(statusOrder);
  });

  it('a sync failure propagates as an error and SKIPS the status read (no masking)', async () => {
    connectSpies.syncAccountStatusForUser.mockRejectedValue(
      new Error('stripe unreachable')
    );

    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/sync')
    );

    // The rejection must surface (mapErrorToResponse → 500), NOT be masked by a
    // subsequent getStatus read returning a stale-but-200 payload. This pins the
    // sync-then-status sequence against a future "resilience" refactor.
    expect(res.status).toBe(500);
    expect(connectSpies.getStatusForUser).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, neither sync nor status called', async () => {
    const res = await dispatch(buildApp(null), postReq('/connect/me/sync'));

    expect(res.status).toBe(401);
    expect(connectSpies.syncAccountStatusForUser).not.toHaveBeenCalled();
    expect(connectSpies.getStatusForUser).not.toHaveBeenCalled();
  });
});

describe('POST /connect/me/dashboard — real resolver', () => {
  it('authenticated creator → 200 with dashboard url, service called with session id', async () => {
    const res = await dispatch(
      buildApp(CREATOR_USER),
      postReq('/connect/me/dashboard')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { url: 'https://connect.stripe.com/express/acct_test_123' },
    });
    expect(connectSpies.createDashboardLinkForUser).toHaveBeenCalledWith(
      CREATOR_USER.id
    );
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      postReq('/connect/me/dashboard')
    );

    expect(res.status).toBe(401);
    expect(connectSpies.createDashboardLinkForUser).not.toHaveBeenCalled();
  });
});
