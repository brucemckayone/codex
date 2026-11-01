/**
 * GET /api/organizations/:id/tiers/price-changes (Codex-2hxff.86, batch C1
 * Part B data design §2.6): the Studio note's progress read.
 *
 * TEST SHAPE mirrors `tiers-cache-read-your-writes.test.ts`: the REAL
 * `procedure()` and its policy run, the router is mounted where
 * `src/index.ts` mounts it, and these seams are stubbed:
 *
 *   - a middleware pre-sets the session user (or none, for the real 401),
 *     and the caller's membership sits in a KV double, so management is
 *     judged without Neon;
 *   - `TierService` is a spy object;
 *   - `createDbClient` and `createPerRequestDbClient` return stubs: a
 *     membership missing from KV falls through to "not a member".
 *
 * Pins: owner/admin only (a member and a stranger are refused before the
 * service runs); the org is the path's; the list envelope; private cache.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tierSpies = {
  listPriceChangeProgress: vi.fn(),
};

vi.mock('@codex/subscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/subscription')>();
  return { ...actual, TierService: vi.fn(() => tierSpies) };
});

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    // A membership missing from KV would fall through to this: "not a member".
    createDbClient: vi.fn(() => ({
      query: {
        organizationMemberships: { findFirst: vi.fn(async () => undefined) },
        organizations: { findFirst: vi.fn(async () => undefined) },
      },
    })),
    createPerRequestDbClient: vi.fn(() => ({
      db: {},
      cleanup: vi.fn(async () => undefined),
    })),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked class.
import { membershipCacheKey } from '@codex/worker-utils';
import tiers from '../tiers';

const ORG_ID = '7e777777-7777-4777-8777-777777777777';
const OTHER_ORG = '7e888888-8888-4888-8888-888888888888';
const OWNER = {
  id: 'pricechangeowner01',
  email: 'price-owner@test.com',
  role: 'creator',
};
const PROGRESS = {
  id: '7e000009-0000-4000-8000-000000000009',
  tierId: '7e000001-0000-4000-8000-000000000001',
  courseSubscriptionPlanId: null,
  interval: 'month',
  fromAmountCents: 800,
  newAmountCents: 900,
  state: 'running',
  createdAt: '2026-11-03T13:20:00.000Z',
  total: 6240,
  emailed: 4500,
  scheduled: 4497,
  held: 3,
  due: 1740,
  retrying: 0,
  lastRunAt: '2026-11-03T16:00:00.000Z',
  nextRunAt: '2026-11-03T17:00:00.000Z',
  estimatedDoneAt: '2026-11-03T18:00:00.000Z',
  doneAt: null,
  supersededById: null,
  stoppedAt: null,
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

let kv: ReturnType<typeof makeKv>;

function member(orgId: string, role: string) {
  kv.store.set(
    membershipCacheKey(orgId, OWNER.id),
    JSON.stringify({
      role,
      status: 'active',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })
  );
}

async function get(orgId: string, signedIn = true) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (signedIn) {
      c.set('user', OWNER);
      // Its own bucket for the `api` preset: one limiter namespace is shared
      // across every test file.
      c.set('session', { id: 'sess_tiers_price_changes', userId: OWNER.id });
    }
    await next();
  });
  app.route('/api/organizations/:id/tiers', tiers);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(
      `http://organization-api.test/api/organizations/${orgId}/tiers/price-changes`
    ),
    { ...env, ENVIRONMENT: 'test', CACHE_KV: kv } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  kv = makeKv();
  tierSpies.listPriceChangeProgress.mockResolvedValue([PROGRESS]);
});

describe('GET /api/organizations/:id/tiers/price-changes', () => {
  it.each([
    'owner',
    'admin',
  ])('an %s reads the org’s progress: the list envelope, privately cached', async (role) => {
    member(ORG_ID, role);

    const res = await get(ORG_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [PROGRESS],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
    expect(tierSpies.listPriceChangeProgress).toHaveBeenCalledExactlyOnceWith(
      ORG_ID
    );
    expect(res.headers.get('cache-control')).toMatch(/private/);
  });

  it('nothing to show is an empty list, not an error', async () => {
    member(ORG_ID, 'owner');
    tierSpies.listPriceChangeProgress.mockResolvedValueOnce([]);

    const res = await get(ORG_ID);

    expect(await res.json()).toEqual({
      items: [],
      pagination: { page: 1, limit: 0, total: 0, totalPages: 1 },
    });
  });

  it('a plain member, an owner of another org and anyone signed out are refused before the read', async () => {
    member(ORG_ID, 'member');
    expect((await get(ORG_ID)).status).toBe(403);

    kv.store.clear();
    member(OTHER_ORG, 'owner');
    expect((await get(ORG_ID)).status).toBe(403);

    expect((await get(ORG_ID, false)).status).toBe(401);
    expect(tierSpies.listPriceChangeProgress).not.toHaveBeenCalled();
  });
});
