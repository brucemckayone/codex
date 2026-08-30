/**
 * Membership-cache invalidation on the three member mutations
 * (invite / role-change / removal).
 *
 * WHY THIS FILE EXISTS. Commit 2d1c065a replaced `kv.delete(...)` in
 * `invalidateMembershipCache` with `VersionedCache.invalidate(...)`. Those are
 * not interchangeable. `invalidate(id)` performs exactly one
 * `kv.put(buildVersionKey(id), Date.now())` — it writes
 * `cache:version:membership:{orgId}:{userId}` — while the reader,
 * `checkOrganizationMembership()` in
 * `packages/worker-utils/src/procedure/org-helpers.ts`, does a bare
 * `kv.get('membership:{orgId}:{userId}', 'json')` with NO TTL and NO version
 * lookup. So the mutation wrote a key nobody reads and left the key everybody
 * reads in place: a removed member kept a readable `role` and kept their
 * access, and a demoted admin kept management rights.
 *
 * WHY THE OLD TESTS DID NOT CATCH IT. `src/__tests__/members.test.ts` builds a
 * hand-rolled `ctx` and calls service spies; it never runs `procedure()`, never
 * touches a KV binding, and passed unchanged across 2d1c065a in both
 * directions. A test that asserts "invalidateMembershipCache was called" would
 * have passed too — the function WAS called, it just wrote the wrong key. The
 * only assertion that can fail here is one about THE KEY, so that is what every
 * case below asserts, and it asserts it twice over:
 *
 *   1. against the literal `membership:{orgId}:{userId}`, so the test still
 *      fails if the reader and the writer drift together, and
 *   2. against the key THE REAL READER ASKED FOR at runtime — captured from a
 *      live `checkOrganizationMembership()` call's `kv.get` — so the test still
 *      fails if the format changes in one place only.
 *
 * Plus a dead-write guard: no `cache:version:membership:*` may be written by
 * any of the three routes. Swapping the delete back for a bump therefore goes
 * red from two independent directions rather than silently passing.
 *
 * TEST SHAPE mirrors the sibling `organizations-cache-headers.test.ts`: the
 * REAL `procedure()` resolver, policy enforcement and cache plumbing run
 * (memory procedure_mock_hides_resolver_bugs — a mocked procedure cannot tell
 * you which KV key reached the binding), the router is mounted on a Hono app at
 * the same path `src/index.ts` uses and driven through `app.fetch()` with a
 * real `ExecutionContext` so the fire-and-forget `waitUntil` work drains.
 * Exactly three seams are stubbed:
 *
 *   - a middleware pre-sets `c.set('user' | 'session', …)`, so the real session
 *     middleware early-returns;
 *   - `OrganizationService` is a spy object, so no Neon call fires from the
 *     handlers;
 *   - `createDbClient` returns a stub, because `dispatchOrgSlugInvalidation`
 *     constructs a client eagerly and the real one THROWS without
 *     `DATABASE_URL_LOCAL_PROXY`. The stub also makes the post-mutation
 *     `checkOrganizationMembership()` fall through to a deterministic "not a
 *     member", which is what lets the DELETE case assert the access outcome and
 *     not merely the KV op.
 *
 * CACHE_KV is replaced with an in-memory double rather than the Miniflare
 * namespace: the point of the file is the exact key string handed to
 * `delete()`, and a real binding records nothing.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Seam 1: the service registry's OrganizationService ──────────────────────

const orgSpies = {
  listMembers: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  getMyMembership: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

// ─── Seam 2: createDbClient ──────────────────────────────────────────────────
//
// `importOriginal` is spread so `schema`, `eq` and `and` stay real — both
// `org-helpers.fetchMembershipFromDB` and `cache-fanout.invalidateOrgSlugCache`
// build Drizzle predicates against them.

const dbStub = {
  query: {
    // Read by `fetchMembershipFromDB` — `undefined` means "not a member".
    organizationMemberships: { findFirst: vi.fn(async () => undefined) },
    // Read by `invalidateOrgSlugCache` — `undefined` means "no slug to bump".
    organizations: { findFirst: vi.fn(async () => undefined) },
  },
};

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => dbStub),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import {
  checkOrganizationMembership,
  membershipCacheKey,
} from '@codex/worker-utils';
import members from '../members';

// ─── The KV double ───────────────────────────────────────────────────────────

/**
 * Records every operation AND the key it was given. `get` honours the `'json'`
 * and `'text'` type arguments because `checkOrganizationMembership` uses the
 * former and `VersionedCache` the latter.
 */
function makeKv() {
  const store = new Map<string, string>();
  const gets: string[] = [];
  const puts: string[] = [];
  const deletes: string[] = [];

  return {
    store,
    gets,
    puts,
    deletes,
    get: vi.fn(async (key: string, type?: string) => {
      gets.push(key);
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      deletes.push(key);
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = '5d222222-2222-4222-8222-222222222222';

/** The caller. Owner, so `requireOrgManagement` is satisfied. */
const ADMIN = {
  id: 'adminuser0001',
  email: 'admin@test.com',
  role: 'creator',
};

/**
 * The mutation TARGET — a different user from the caller, which is the whole
 * hazard: the caller's own membership entry must survive untouched while the
 * target's is removed. `userIdSchema` is `[a-zA-Z0-9]+`, so no dashes.
 */
const TARGET_ID = 'targetuser001';

/** The id `inviteMember` resolves the invited email to. */
const INVITEE_ID = 'inviteeuser01';

const JOINED_AT = '2026-01-01T00:00:00.000Z';

function membershipRow(role: string) {
  return JSON.stringify({ role, status: 'active', joinedAt: JOINED_AT });
}

let kv: ReturnType<typeof makeKv>;
let testEnv: typeof env;

/**
 * `cacheWrite` for the direct `checkOrganizationMembership` calls below.
 *
 * The parameter is REQUIRED, not optional, precisely so a caller cannot silently
 * opt out of `waitUntil` — that optionality is what let two production call sites
 * keep the cancelled-write behaviour. So this file has to supply one, and it
 * awaits rather than discards: these tests assert on the KV entry the write
 * produces, and a discarded promise would make them race.
 */
const pendingWrites: Promise<unknown>[] = [];
const collectWrite = (promise: Promise<unknown>): void => {
  pendingWrites.push(promise);
};
const settleWrites = async (): Promise<void> => {
  await Promise.all(pendingWrites.splice(0));
};

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', ADMIN);
    // A session id unique to this file so the `api` rate-limit preset counts
    // this file's requests in their own bucket — `singleWorker: true` shares
    // one workerd (and one limiter namespace) across every test file.
    c.set('session', {
      id: 'sess_members_cache_invalidation',
      userId: ADMIN.id,
    });
    await next();
  });
  // The same mount point as `src/index.ts:90`, so `:id` resolves the way it
  // does in production — `resolveOrganizationId` reads `params.id`.
  app.route('/api/organizations/:id/members', members);
  return app;
}

async function dispatch(
  path: string,
  init: RequestInit & { method: string }
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp().fetch(
    new Request(`http://organization-api.test${path}`, init),
    testEnv,
    ec
  );
  // Drains the fire-and-forget invalidation. Without this the delete may not
  // have run when the assertions execute.
  await waitOnExecutionContext(ec);
  return res;
}

const jsonBody = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Ask the REAL reader for the target's membership and return the KV key it
 * asked for. This is the load-bearing helper: nothing in this file re-types the
 * `membership:{orgId}:{userId}` format, so a divergence between reader and
 * invalidator cannot hide.
 */
async function readerKeyFor(userId: string): Promise<string> {
  const before = kv.gets.length;
  const membership = await checkOrganizationMembership(
    ORG_ID,
    userId,
    testEnv as unknown as Parameters<typeof checkOrganizationMembership>[2],
    undefined,
    collectWrite
  );
  await settleWrites();
  // The premise, asserted rather than assumed: this read was SERVED FROM KV.
  // If the seeded entry were missing the reader would fall through to the DB
  // stub, return null, and still have issued exactly one `get` — the captured
  // key would look right while proving nothing about a warm cache.
  expect(membership?.role).toBeDefined();
  const asked = kv.gets.slice(before);
  // One read per call. If the reader ever grows a version lookup, this fails
  // here rather than silently letting a two-key reader through.
  expect(asked).toHaveLength(1);
  return asked[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();

  kv = makeKv();
  testEnv = {
    ...env,
    ENVIRONMENT: 'test',
    CACHE_KV: kv,
  } as unknown as typeof env;

  // Warm cache: the caller is an owner (so management passes without Neon),
  // and the target is a plain member.
  kv.store.set(membershipCacheKey(ORG_ID, ADMIN.id), membershipRow('owner'));
  kv.store.set(membershipCacheKey(ORG_ID, TARGET_ID), membershipRow('member'));
  kv.store.set(membershipCacheKey(ORG_ID, INVITEE_ID), membershipRow('member'));

  dbStub.query.organizationMemberships.findFirst.mockResolvedValue(undefined);
  dbStub.query.organizations.findFirst.mockResolvedValue(undefined);

  orgSpies.inviteMember.mockResolvedValue({
    id: 'membership-new',
    userId: INVITEE_ID,
    role: 'member',
    status: 'active',
    joinedAt: new Date(JOINED_AT),
  });
  orgSpies.updateMemberRole.mockResolvedValue({
    id: 'membership-1',
    userId: TARGET_ID,
    role: 'admin',
    status: 'active',
    joinedAt: new Date(JOINED_AT),
  });
  orgSpies.removeMember.mockResolvedValue(undefined);
});

// ─── DELETE — the case whose comment was false ───────────────────────────────

describe('DELETE /:userId', () => {
  it('deletes the exact key the reader reads, and the removed user is then denied', async () => {
    // Captured from the real reader BEFORE the mutation, while the entry is
    // still warm — so this is the key production would serve `role` from.
    const readerKey = await readerKeyFor(TARGET_ID);
    expect(readerKey).toBe(`membership:${ORG_ID}:${TARGET_ID}`);

    const res = await dispatch(
      `/api/organizations/${ORG_ID}/members/${TARGET_ID}`,
      { method: 'DELETE' }
    );
    expect(res.status).toBe(204);

    // THE ASSERTION. Not "invalidation was called" — the key it was called
    // with, matched against the reader's own.
    expect(kv.deletes).toEqual([readerKey]);
    expect(kv.store.has(readerKey)).toBe(false);

    // And the outcome the route's comment claims: the next membership check
    // refetches and sees null, so access is denied.
    dbStub.query.organizationMemberships.findFirst.mockResolvedValue(undefined);
    const after = await checkOrganizationMembership(
      ORG_ID,
      TARGET_ID,
      testEnv as unknown as Parameters<typeof checkOrganizationMembership>[2],
      undefined,
      collectWrite
    );
    await settleWrites();
    expect(after).toBeNull();
    expect(
      dbStub.query.organizationMemberships.findFirst
    ).toHaveBeenCalledTimes(1);
  });

  it('leaves the CALLER own membership entry intact', async () => {
    // A `delete` built from the wrong id — the acting user rather than the
    // target — would sign the caller out of their own org and leave the removed
    // member's access in place. Both halves are asserted.
    const callerKey = membershipCacheKey(ORG_ID, ADMIN.id);

    await dispatch(`/api/organizations/${ORG_ID}/members/${TARGET_ID}`, {
      method: 'DELETE',
    });

    // The positive half FIRST. On its own the negative below is vacuous — it
    // passes just as well when nothing is deleted at all, which is exactly the
    // state this file exists to catch.
    expect(kv.deletes).toEqual([membershipCacheKey(ORG_ID, TARGET_ID)]);
    expect(kv.store.has(callerKey)).toBe(true);
    expect(kv.deletes).not.toContain(callerKey);
  });
});

// ─── PATCH ──────────────────────────────────────────────────────────────────

describe('PATCH /:userId', () => {
  it('deletes the exact key the reader reads for the role-change target', async () => {
    const readerKey = await readerKeyFor(TARGET_ID);
    expect(readerKey).toBe(`membership:${ORG_ID}:${TARGET_ID}`);

    const res = await dispatch(
      `/api/organizations/${ORG_ID}/members/${TARGET_ID}`,
      { method: 'PATCH', ...jsonBody({ role: 'admin' }) }
    );
    expect(res.status).toBe(200);

    expect(kv.deletes).toEqual([readerKey]);
    expect(kv.store.has(readerKey)).toBe(false);
  });
});

// ─── POST /invite ───────────────────────────────────────────────────────────

describe('POST /invite', () => {
  it('deletes the exact key the reader reads for the INVITED user, not the inviter', async () => {
    const readerKey = await readerKeyFor(INVITEE_ID);
    expect(readerKey).toBe(`membership:${ORG_ID}:${INVITEE_ID}`);

    const res = await dispatch(`/api/organizations/${ORG_ID}/members/invite`, {
      method: 'POST',
      ...jsonBody({ email: 'invitee@test.com', role: 'member' }),
    });
    expect(res.status).toBe(201);

    // The id comes from the service result, not from the request — asserting
    // the key proves the plumbing carries `result.userId` through.
    expect(orgSpies.inviteMember).toHaveBeenCalledTimes(1);
    expect(kv.deletes).toEqual([readerKey]);
    expect(kv.store.has(readerKey)).toBe(false);
    expect(kv.store.has(membershipCacheKey(ORG_ID, ADMIN.id))).toBe(true);
  });
});

// ─── The dead-write guard ───────────────────────────────────────────────────

describe('DEAD-WRITE GUARD: no membership version key is ever written', () => {
  // `cache:version:membership:*` is what `VersionedCache.invalidate()` wrote
  // between 2d1c065a and the fix. Nothing reads it: there is no membership
  // `CacheType`, and `checkOrganizationMembership` is not version-aware. Such a
  // write is a KV quota cost plus a false signal that invalidation happened, so
  // it is forbidden outright rather than merely "not required".
  //
  // NOTE the sibling writes that are LEGITIMATE and deliberately not caught by
  // this guard: `invalidateUserLibrary` bumps
  // `cache:version:collection:user-library:{userId}` and that version IS read
  // by a version-aware reader.
  const versionKeyFor = (userId: string) =>
    `cache:version:${membershipCacheKey(ORG_ID, userId)}`;

  it.each([
    [
      'DELETE',
      () =>
        dispatch(`/api/organizations/${ORG_ID}/members/${TARGET_ID}`, {
          method: 'DELETE',
        }),
      TARGET_ID,
    ],
    [
      'PATCH',
      () =>
        dispatch(`/api/organizations/${ORG_ID}/members/${TARGET_ID}`, {
          method: 'PATCH',
          ...jsonBody({ role: 'admin' }),
        }),
      TARGET_ID,
    ],
    [
      'POST /invite',
      () =>
        dispatch(`/api/organizations/${ORG_ID}/members/invite`, {
          method: 'POST',
          ...jsonBody({ email: 'invitee@test.com', role: 'member' }),
        }),
      INVITEE_ID,
    ],
  ])('%s bumps no membership version key', async (_name, run, userId) => {
    await run();

    expect(kv.puts).not.toContain(versionKeyFor(userId as string));
    expect(
      kv.puts.filter((k) => k.startsWith('cache:version:membership:'))
    ).toEqual([]);
    expect(
      [...kv.store.keys()].filter((k) =>
        k.startsWith('cache:version:membership:')
      )
    ).toEqual([]);

    // Positive counterpart, so the block above cannot pass by the routes doing
    // nothing at all: the data key really was deleted.
    expect(kv.deletes).toEqual([membershipCacheKey(ORG_ID, userId as string)]);
  });
});
