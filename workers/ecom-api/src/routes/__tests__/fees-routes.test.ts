/**
 * GET /fees/upcoming (Codex-2hxff.33; batch C1 Part B data design §1.8),
 * through the REAL `procedure()` resolver, as connect-me-routes.test.ts:
 * a middleware injects the session user (or none, for the real 401), and
 * `@codex/purchase`'s FeeConfigService is replaced with a spy.
 *
 * Pins: a session is all it needs (a creator who owns nothing reaches it,
 * Q3); the read is always the SESSION user's, whatever the query says; the
 * filter is a uuid; the answer is the list envelope; the cache is private.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feeSpies = {
  listUpcomingForUser: vi.fn(),
};

vi.mock('@codex/purchase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/purchase')>();
  return { ...actual, FeeConfigService: vi.fn(() => feeSpies) };
});

// Import AFTER the mock so the real service registry resolves the mocked class.
import fees from '../fees';

const CREATOR = {
  id: 'user-maya',
  email: 'maya@test.com',
  role: 'creator',
};
const ORG = '11111111-1111-4111-8111-111111111111';
const UPCOMING = {
  changeId: '823e4567-e89b-12d3-a456-426614174007',
  kind: 'announce',
  scope: 'platform',
  effectiveFrom: null,
  earliestFrom: '2026-12-04T00:00:00.000Z',
  announcedAt: '2026-11-03T08:00:00.000Z',
  lines: [],
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
  app.route('/fees', fees);
  return app;
}

async function get(user: Record<string, unknown> | null, path: string) {
  const ec = createExecutionContext();
  const res = await buildApp(user).fetch(
    new Request(`http://ecom-api.test${path}`, { method: 'GET' }),
    env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  feeSpies.listUpcomingForUser.mockResolvedValue([UPCOMING]);
});

describe('GET /fees/upcoming', () => {
  it('a creator who owns nothing reads their own rows (Earnings, Q3), in the list envelope, privately cached', async () => {
    const res = await get(CREATOR, '/fees/upcoming');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [UPCOMING],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
    expect(feeSpies.listUpcomingForUser).toHaveBeenCalledWith(
      CREATOR.id,
      undefined
    );
    expect(res.headers.get('cache-control')).toMatch(/private/);
  });

  it("an organisation filter is passed on, and the read is still the session user's", async () => {
    const res = await get(
      CREATOR,
      `/fees/upcoming?organizationId=${ORG}&userId=someone-else`
    );
    expect(res.status).toBe(200);
    expect(feeSpies.listUpcomingForUser).toHaveBeenCalledWith(CREATOR.id, ORG);
  });

  it('nothing upcoming is an empty list, not an error', async () => {
    feeSpies.listUpcomingForUser.mockResolvedValueOnce([]);
    const res = await get(CREATOR, '/fees/upcoming');
    expect(await res.json()).toEqual({
      items: [],
      pagination: { page: 1, limit: 0, total: 0, totalPages: 1 },
    });
  });

  it('refuses an organisation id that is not one, and anyone without a session', async () => {
    expect((await get(CREATOR, '/fees/upcoming?organizationId=x')).status).toBe(
      400
    );
    expect((await get(null, '/fees/upcoming')).status).toBe(401);
    expect(feeSpies.listUpcomingForUser).not.toHaveBeenCalled();
  });
});
