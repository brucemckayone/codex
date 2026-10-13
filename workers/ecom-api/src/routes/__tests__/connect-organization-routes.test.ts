/**
 * The payout dashboard IDOR (Codex-2hxff.1, ledger SEC-01) and the read-only
 * organisation payout status that replaced the org-level Connect routes.
 *
 * WHAT WAS WRONG. `POST /connect/dashboard` let `procedure()` authorise the org
 * named in the QUERY string, then called `createDashboardLink` with the org in
 * the BODY. Any org owner/admin could send `?organizationId=<their org>` with
 * `{ organizationId: <victim org> }` and get a logged-in Express Dashboard for
 * the victim's payout account. The web app always sent query == body, which is
 * why nothing in normal use ever showed it.
 *
 * WHAT A FALSE GREEN LOOKS LIKE. A test that only calls `/connect/me/dashboard`
 * proves nothing about this bug. So every case below either sends the exploit
 * request itself or asks for an org the caller is not a member of — and they
 * run through the REAL `procedure()` resolver (memory
 * procedure_mock_hides_resolver_bugs): a mocked procedure would skip the very
 * org-resolution step the bug lived in.
 *
 * Seams (the same two as connect-me-routes.test.ts, plus membership):
 *  1. A middleware pre-sets `user`/`session`, so the real session middleware
 *     early-returns and the rest of the policy runs for real.
 *  2. `ConnectAccountService` is a spy object — no Stripe or Neon call fires.
 *  3. Membership comes from the real `checkOrganizationMembership`, which reads
 *     KV first. We seed the KV entry for MEMBER_ORG only, under the key the
 *     reader builds (`membershipCacheKey`). Any other org misses KV and falls
 *     through to a DB read that cannot succeed in this pool (no
 *     DATABASE_URL), which the reader turns into "not a member" → 403.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { membershipCacheKey } from '@codex/worker-utils';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectSpies = {
  getOrganizationPayoutStatus: vi.fn(),
  createDashboardLinkForUser: vi.fn(),
  getStatusForUser: vi.fn(),
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

const ADMIN_USER = {
  id: '3f6c1b2a-5d4e-4f7a-8b90-aabbccddeeff',
  email: 'admin@test.com',
  role: 'creator',
};

/** The org ADMIN_USER manages. */
const MEMBER_ORG = '4a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
/** Someone else's org — ADMIN_USER has no membership here. */
const VICTIM_ORG = '5b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

const ORG_STATUS = {
  isConnected: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  status: 'active' as const,
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
  app.route('/connect', connect);
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

function request(method: 'GET' | 'POST', path: string, body?: unknown) {
  return new Request(`http://ecom-api.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The membership reader is KV-first. Without the binding every request would
 * fall through to the DB read and 403 — the member cases would then fail for
 * the wrong reason — so a missing binding fails loudly instead.
 */
function cacheKv() {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV is not bound in the ecom-api test pool');
  return kv;
}

async function seedMembership(orgId: string, userId: string, role: string) {
  await cacheKv().put(
    membershipCacheKey(orgId, userId),
    JSON.stringify({
      role,
      status: 'active',
      joinedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    })
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  connectSpies.getOrganizationPayoutStatus.mockResolvedValue(ORG_STATUS);
  connectSpies.createDashboardLinkForUser.mockResolvedValue({
    url: 'https://connect.stripe.com/express/acct_victim',
  });
  await cacheKv().delete(membershipCacheKey(VICTIM_ORG, ADMIN_USER.id));
  await seedMembership(MEMBER_ORG, ADMIN_USER.id, 'admin');
});

describe('the org-level Connect routes are retired', () => {
  it('SEC-01 exploit request (query = own org, body = victim org) → 404, no login link', async () => {
    const res = await dispatch(
      buildApp(ADMIN_USER),
      request('POST', `/connect/dashboard?organizationId=${MEMBER_ORG}`, {
        organizationId: VICTIM_ORG,
      })
    );

    expect(res.status).toBe(404);
    expect(connectSpies.createDashboardLinkForUser).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/connect/onboard'],
    ['GET', '/connect/status'],
    ['POST', '/connect/sync'],
    ['POST', '/connect/dashboard'],
  ] as const)('%s %s → 404 for an org manager', async (method, path) => {
    const res = await dispatch(
      buildApp(ADMIN_USER),
      request(
        method,
        `${path}?organizationId=${MEMBER_ORG}`,
        method === 'POST'
          ? {
              organizationId: MEMBER_ORG,
              returnUrl: 'http://localhost:3000/studio/monetisation',
              refreshUrl: 'http://localhost:3000/studio/monetisation',
            }
          : undefined
      )
    );

    expect(res.status).toBe(404);
  });
});

describe('GET /connect/organization-status — real resolver', () => {
  it('a member of the org → 200, status only, service called with the RESOLVED org', async () => {
    const res = await dispatch(
      buildApp(ADMIN_USER),
      request(
        'GET',
        `/connect/organization-status?organizationId=${MEMBER_ORG}`
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ORG_STATUS });
    expect(connectSpies.getOrganizationPayoutStatus).toHaveBeenCalledWith(
      MEMBER_ORG
    );
  });

  it('IDOR: an org the caller is not a member of → 403, service NOT called', async () => {
    const res = await dispatch(
      buildApp(ADMIN_USER),
      request(
        'GET',
        `/connect/organization-status?organizationId=${VICTIM_ORG}`
      )
    );

    expect(res.status).toBe(403);
    expect(connectSpies.getOrganizationPayoutStatus).not.toHaveBeenCalled();
  });

  it('any member, not only managers, may read it → 200', async () => {
    await seedMembership(MEMBER_ORG, ADMIN_USER.id, 'member');

    const res = await dispatch(
      buildApp(ADMIN_USER),
      request(
        'GET',
        `/connect/organization-status?organizationId=${MEMBER_ORG}`
      )
    );

    expect(res.status).toBe(200);
    expect(connectSpies.getOrganizationPayoutStatus).toHaveBeenCalledWith(
      MEMBER_ORG
    );
  });

  it('no organisation in the request → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(ADMIN_USER),
      request('GET', '/connect/organization-status')
    );

    expect(res.status).toBe(400);
    expect(connectSpies.getOrganizationPayoutStatus).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      request(
        'GET',
        `/connect/organization-status?organizationId=${MEMBER_ORG}`
      )
    );

    expect(res.status).toBe(401);
    expect(connectSpies.getOrganizationPayoutStatus).not.toHaveBeenCalled();
  });
});
