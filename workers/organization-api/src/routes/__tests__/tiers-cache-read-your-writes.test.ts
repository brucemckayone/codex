/**
 * Tier mutations write the new list into the ORG_TIERS slot BEFORE they
 * respond (Codex-elg0b).
 *
 * WHY THIS FILE EXISTS. The Studio re-reads the tier list the moment a tier
 * mutation resolves, and `GET /tiers` serves that re-read from KV. The
 * write-through used to run fire-and-forget on `executionCtx.waitUntil`, after
 * the response, so the re-read could hit the OLD slot. Nothing reads again
 * until a reload: the studio tier E2E (02-studio-tier-crud 2.a) saw three
 * POSTs return 201, every following GET a cache hit, and a list without the
 * third tier.
 *
 * THE ASSERTION is about time: once the mutation's response has RETURNED, and
 * BEFORE its ExecutionContext's `waitUntil` work is drained, the slot already
 * holds the new list. So no case below drains before asserting; the drain
 * comes last, only so no work leaks into the next case.
 *
 * WHY `listTiers` WAITS A TIMER. An in-memory double resolves in microtasks,
 * so a fire-and-forget write could finish inside the same microtask drain that
 * resolves `app.fetch()` and pass a test that cannot see the race. The timer
 * stands for the DB round trip: real I/O that a response only waits for when
 * the handler awaits it. Put the fire-and-forget back and the slot assertion
 * goes red.
 *
 * TEST SHAPE mirrors `members-cache-invalidation.test.ts`: the REAL
 * `procedure()`, policy enforcement and cache plumbing run, the router is
 * mounted at the path `src/index.ts` uses, and these seams are stubbed:
 *
 *   - a middleware pre-sets `c.set('user' | 'session', …)`, and the caller's
 *     owner membership sits warm in KV, so management passes without Neon;
 *   - `TierService` and `PlanAccessService` are spy objects;
 *   - `createDbClient` and `createPerRequestDbClient` return stubs: the real
 *     ones THROW without a database URL, and the spies never touch them.
 *
 * The slot key is never re-typed here: the seeding GET runs the REAL reader
 * (`cachedRead`) and the key it writes is the one every later assertion uses.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Seam 1: the service registry's TierService and PlanAccessService ───────

const tierSpies = {
  createTier: vi.fn(),
  listTiers: vi.fn(),
  updateTier: vi.fn(),
  deleteTier: vi.fn(),
  reorderTiers: vi.fn(),
};

vi.mock('@codex/subscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/subscription')>();
  return {
    ...actual,
    TierService: vi.fn(() => tierSpies),
  };
});

const planAccessSpies = {
  // Called by the delete, and by a create that copies another tier's items.
  afterTierAccessChange: vi.fn(async () => undefined),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    PlanAccessService: vi.fn(() => planAccessSpies),
  };
});

// ─── Seam 2: the DB clients ─────────────────────────────────────────────────

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
    // The tier and plan-access getters build on the shared per-request client.
    createPerRequestDbClient: vi.fn(() => ({
      db: {},
      cleanup: vi.fn(async () => undefined),
    })),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import { membershipCacheKey } from '@codex/worker-utils';
import tiers from '../tiers';

// ─── The KV double ───────────────────────────────────────────────────────────

/** Records every put's key; `get` honours `'json'` and `'text'`. */
function makeKv() {
  const store = new Map<string, string>();
  const puts: string[] = [];

  return {
    store,
    puts,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = '7e666666-6666-4666-8666-666666666666';

const ADMIN = {
  id: 'tieradmin0001',
  email: 'tier-admin@test.com',
  role: 'creator',
};

/** Stands for the DB round trip `listTiers` makes. See the file docblock. */
const DB_LATENCY_MS = 20;

function tierRow(id: string, name: string, sortOrder: number) {
  return {
    id,
    organizationId: ORG_ID,
    name,
    priceMonthly: 500 * (sortOrder + 1),
    priceAnnual: 5000 * (sortOrder + 1),
    sortOrder,
  };
}

const BRONZE = tierRow('7e000001-0000-4000-8000-000000000001', 'Bronze', 0);
const SILVER = tierRow('7e000002-0000-4000-8000-000000000002', 'Silver', 1);
const GOLD = tierRow('7e000003-0000-4000-8000-000000000003', 'Gold', 2);

let kv: ReturnType<typeof makeKv>;
let testEnv: typeof env;

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', ADMIN);
    // A session id unique to this file, so the `api` rate-limit preset counts
    // these requests in their own bucket (`singleWorker: true` shares one
    // limiter namespace across every test file).
    c.set('session', {
      id: 'sess_tiers_cache_read_your_writes',
      userId: ADMIN.id,
    });
    await next();
  });
  // The same mount point as `src/index.ts`, so `:id` resolves as in production.
  app.route('/api/organizations/:id/tiers', tiers);
  return app;
}

/**
 * Dispatch WITHOUT draining. The caller asserts first, then drains: that order
 * is the whole test.
 */
async function dispatch(
  path: string,
  init: RequestInit & { method: string }
): Promise<{ res: Response; ec: ExecutionContext }> {
  const ec = createExecutionContext();
  const res = await buildApp().fetch(
    new Request(`http://organization-api.test${path}`, init),
    testEnv,
    ec
  );
  return { res, ec };
}

const jsonBody = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const TIERS_PATH = `/api/organizations/${ORG_ID}/tiers`;

/**
 * Warm the slot with `list` through the REAL reader, and return the key it
 * wrote. This is the state CI was in: every GET after a create was a hit.
 */
async function seedSlot(list: unknown[]): Promise<string> {
  tierSpies.listTiers.mockResolvedValueOnce(list);
  const { res, ec } = await dispatch(TIERS_PATH, { method: 'GET' });
  expect(res.status).toBe(200);
  // The read path parks its slot write on waitUntil, so drain THIS one.
  await waitOnExecutionContext(ec);
  expect(kv.puts).toHaveLength(1);
  const slotKey = kv.puts[0] as string;
  expect(slotKey).toContain(`org:tiers:${ORG_ID}`);
  kv.puts.length = 0;
  tierSpies.listTiers.mockClear();
  return slotKey;
}

const slotValue = (key: string) =>
  JSON.parse(kv.store.get(key) ?? 'null') as unknown;

beforeEach(() => {
  vi.clearAllMocks();

  kv = makeKv();
  testEnv = {
    ...env,
    ENVIRONMENT: 'test',
    CACHE_KV: kv,
  } as unknown as typeof env;

  kv.store.set(
    membershipCacheKey(ORG_ID, ADMIN.id),
    JSON.stringify({
      role: 'owner',
      status: 'active',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })
  );

  tierSpies.createTier.mockResolvedValue(GOLD);
  tierSpies.updateTier.mockResolvedValue({ ...SILVER, name: 'Silver Plus' });
  tierSpies.deleteTier.mockResolvedValue(undefined);
  tierSpies.reorderTiers.mockResolvedValue(undefined);
});

// ─── Every mutation that writes the slot through ─────────────────────────────

describe('tier mutations: the slot holds the new list when the response returns', () => {
  it.each([
    {
      name: 'POST / (create)',
      before: [BRONZE, SILVER],
      after: [BRONZE, SILVER, GOLD],
      status: 201,
      request: (): [string, RequestInit & { method: string }] => [
        TIERS_PATH,
        {
          method: 'POST',
          ...jsonBody({
            name: GOLD.name,
            priceMonthly: GOLD.priceMonthly,
            priceAnnual: GOLD.priceAnnual,
            submissionId: '7e0000ff-0000-4000-8000-0000000000ff',
            // "Nothing": the Bronze case of the E2E, no plan-access copy.
            copyAccessFromTierId: null,
          }),
        },
      ],
    },
    {
      name: 'PATCH /:tierId (update)',
      before: [BRONZE, SILVER],
      after: [BRONZE, { ...SILVER, name: 'Silver Plus' }],
      status: 200,
      request: (): [string, RequestInit & { method: string }] => [
        `${TIERS_PATH}/${SILVER.id}`,
        { method: 'PATCH', ...jsonBody({ name: 'Silver Plus' }) },
      ],
    },
    {
      name: 'DELETE /:tierId',
      before: [BRONZE, SILVER, GOLD],
      after: [BRONZE, SILVER],
      status: 204,
      request: (): [string, RequestInit & { method: string }] => [
        `${TIERS_PATH}/${GOLD.id}`,
        { method: 'DELETE' },
      ],
    },
    {
      name: 'POST /reorder',
      before: [BRONZE, SILVER],
      after: [
        { ...SILVER, sortOrder: 0 },
        { ...BRONZE, sortOrder: 1 },
      ],
      status: 204,
      request: (): [string, RequestInit & { method: string }] => [
        `${TIERS_PATH}/reorder`,
        { method: 'POST', ...jsonBody({ tierIds: [SILVER.id, BRONZE.id] }) },
      ],
    },
  ])('$name', async ({ before, after, status, request }) => {
    const slotKey = await seedSlot(before);
    expect(slotValue(slotKey)).toEqual(before);

    // The post-mutation list arrives only after a DB-sized wait.
    tierSpies.listTiers.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(after), DB_LATENCY_MS)
        )
    );

    const mutation = await dispatch(...request());
    expect(mutation.res.status).toBe(status);

    // THE ASSERTION. The response has returned and its waitUntil work has NOT
    // been drained, yet the slot already holds the new list.
    expect(slotValue(slotKey)).toEqual(after);

    // The write-through's cost is unchanged: one list, one put, into the slot
    // the reader reads, and no version bump (Codex-kgrdp.8).
    expect(tierSpies.listTiers).toHaveBeenCalledTimes(1);
    expect(tierSpies.listTiers).toHaveBeenCalledWith(ORG_ID);
    expect(kv.puts).toEqual([slotKey]);

    // The Studio's re-read, before anything is drained: served from the slot
    // (no second `listTiers`), and carrying the new list.
    const reread = await dispatch(TIERS_PATH, { method: 'GET' });
    expect(reread.res.status).toBe(200);
    expect(await reread.res.json()).toEqual({ data: after });
    expect(tierSpies.listTiers).toHaveBeenCalledTimes(1);

    await waitOnExecutionContext(mutation.ec);
    await waitOnExecutionContext(reread.ec);
  });
});

// ─── A failed refresh never fails the committed mutation ─────────────────────

describe('a failed refresh', () => {
  it('still returns the created tier, and leaves the slot as it was', async () => {
    const slotKey = await seedSlot([BRONZE, SILVER]);
    tierSpies.listTiers.mockRejectedValueOnce(new Error('Failed query'));

    const { res, ec } = await dispatch(TIERS_PATH, {
      method: 'POST',
      ...jsonBody({
        name: GOLD.name,
        priceMonthly: GOLD.priceMonthly,
        priceAnnual: GOLD.priceAnnual,
        submissionId: '7e0000fe-0000-4000-8000-0000000000fe',
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: GOLD });
    expect(kv.puts).toEqual([]);
    expect(slotValue(slotKey)).toEqual([BRONZE, SILVER]);

    await waitOnExecutionContext(ec);
  });
});
