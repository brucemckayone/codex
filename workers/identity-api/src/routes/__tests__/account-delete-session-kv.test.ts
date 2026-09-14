/**
 * `DELETE /api/user/account` clears the cached session of EVERY device the user
 * holds, not just the caller's own (Codex-na929).
 *
 * WHY THIS FILE EXISTS. The fix for Codex-na929 has two halves. The service
 * half — that `deleteAccount` RETURNS the user's session tokens — is pinned by
 * `packages/identity`'s suite (a multi-token case, an empty-list case for
 * anti-vacuity, and a blocked-deletion case that must never query for tokens).
 * The half that does the actual security work had NO coverage anywhere:
 * `AUTH_SESSION_KV` appeared in exactly two files — `index.ts`'s health check
 * and this route — and in no test at all. Revert the handler to its pre-fix
 * form,
 *
 *     if (kv && ctx.session?.token) await kv.delete(ctx.session.token);
 *
 * and every test in the repository stays green while a soft-deleted user's
 * other devices remain authenticated until KV reaps each entry on the session's
 * own TTL.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. `expect(kv.delete).toHaveBeenCalled()`
 * proves nothing here and would have passed on the broken tree, which DID
 * delete — exactly one key, the caller's. So what is asserted is the SET of
 * keys deleted, and specifically that the two OTHER devices' tokens are in it.
 * The pre-fix branch cannot satisfy that at any call count.
 *
 * The request authenticates through the very cache the bug lives in: a seeded
 * `AUTH_SESSION_KV` entry satisfies `isCachedSessionData` and the expiry check
 * in `optionalAuth`, so `procedure({ auth: 'required' })` resolves a real user
 * without touching the database. That is not a test convenience — it is the
 * exact path that made the DB-side `deletedAt` gate unreachable, so the request
 * under test is shaped like the requests the bug left standing.
 *
 * SCOPE. The route, `procedure()`, and the real session-auth middleware all
 * run. Two things are substituted: `IdentityService`, so the token list is a
 * fixture rather than four Drizzle chains, and the Neon client factories, so
 * registry construction opens no connection (`createPerRequestDbClient` throws
 * outright without a resolvable `DATABASE_URL`). `deleteAccount`'s own
 * behaviour is deliberately NOT re-asserted here — it belongs to the suite
 * named above.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import type { Bindings, HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

/** The device issuing the DELETE. */
const CURRENT_TOKEN = 'session-token-current-device';
/** Two devices that are NOT making the request — the ones the bug left signed in. */
const OTHER_TOKEN_A = 'session-token-other-device-a';
const OTHER_TOKEN_B = 'session-token-other-device-b';

// ─── Substitutions ───────────────────────────────────────────────────────────
// NO vi.mock ON @codex/worker-utils. Under @cloudflare/vitest-pool-workers a
// delegating spy built with `importOriginal` over that barrel deadlocks runtime
// init before a single test runs — see the note in
// `membership-cache-waituntil.test.ts`. Nothing here needs it: the service
// registry reaches `IdentityService` through the `@codex/identity` specifier,
// so mocking that package is enough to reach the construction site.
const { deleteAccount } = vi.hoisted(() => ({ deleteAccount: vi.fn() }));

vi.mock('@codex/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/identity')>();
  return {
    ...actual,
    IdentityService: class {
      deleteAccount = deleteAccount;
    },
  };
});

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createPerRequestDbClient: () => ({
      db: {},
      cleanup: async () => {},
    }),
    createDbClient: () => ({}),
  };
});

import userRoutes from '../users';

/** A cache entry `optionalAuth` will accept: truthy session + user, unexpired. */
function cachedSession(token: string) {
  return {
    session: {
      id: `sess_${token}`,
      token,
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    user: {
      id: USER_ID,
      email: 'consumer@test.invalid',
      name: 'Test Consumer',
      emailVerified: true,
    },
  };
}

/**
 * A KV double over a real Map, so `delete` is observable AND effective — a
 * later `get` of a deleted token returns null, which is what "that device is
 * signed out" actually means.
 */
function makeKv(seed: string[]) {
  const store = new Map<string, unknown>();
  for (const token of seed) store.set(token, cachedSession(token));

  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const del = vi.fn(async (key: string) => {
    store.delete(key);
  });

  return {
    binding: { get, put: vi.fn(), delete: del } as unknown as KVNamespace,
    get,
    delete: del,
    /** Keys passed to `delete`, in call order. */
    deleted: () => del.mock.calls.map(([key]) => key as string),
    has: (key: string) => store.has(key),
  };
}

/** DELETE /api/user/account as `CURRENT_TOKEN`'s device. `kv` may be absent. */
async function dispatch(kv?: KVNamespace): Promise<Response> {
  const app = new Hono<HonoEnv>();
  app.route('/api/user', userRoutes);

  const bindings = { ...env } as Record<string, unknown>;
  if (kv) bindings.AUTH_SESSION_KV = kv;
  else delete bindings.AUTH_SESSION_KV;

  return app.fetch(
    new Request('http://identity-api.test/api/user/account', {
      method: 'DELETE',
      headers: {
        Cookie: `codex-session=${CURRENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }),
    bindings as unknown as Bindings,
    createExecutionContext()
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAccount.mockResolvedValue([
    OTHER_TOKEN_A,
    OTHER_TOKEN_B,
    CURRENT_TOKEN,
  ]);
});

describe('DELETE /api/user/account · every device loses its cached session', () => {
  it('deletes the cached session of every OTHER device, not just the caller', async () => {
    const kv = makeKv([CURRENT_TOKEN, OTHER_TOKEN_A, OTHER_TOKEN_B]);
    const res = await dispatch(kv.binding);

    expect(res.status).toBe(204);
    expect(deleteAccount).toHaveBeenCalledWith(USER_ID);

    // THE ASSERTION THIS FILE EXISTS FOR. The pre-fix handler deleted exactly
    // one key — CURRENT_TOKEN — so it satisfies neither of these lines.
    expect(kv.deleted()).toContain(OTHER_TOKEN_A);
    expect(kv.deleted()).toContain(OTHER_TOKEN_B);

    // ...and the effect, stated the way the security property is stated: those
    // devices can no longer authenticate off the cache.
    expect(kv.has(OTHER_TOKEN_A)).toBe(false);
    expect(kv.has(OTHER_TOKEN_B)).toBe(false);
    expect(kv.has(CURRENT_TOKEN)).toBe(false);
  });

  it('deletes each token ONCE when the service already returns the current one', async () => {
    // The handler unions `ctx.session.token` into a Set rather than appending
    // it. Without the Set, the common case (the caller's row is one of the
    // rows) spends a duplicate KV write on every deletion.
    const kv = makeKv([CURRENT_TOKEN, OTHER_TOKEN_A, OTHER_TOKEN_B]);
    await dispatch(kv.binding);

    expect(kv.deleted()).toHaveLength(3);
    expect(new Set(kv.deleted()).size).toBe(3);
  });

  it('still clears the calling device when the service returns NO tokens', async () => {
    // Anti-vacuity for the union, and the case the comment calls out: a session
    // whose DB row was already reaped is absent from the query result, so
    // assuming the list contains it would leave the caller's own device cached.
    deleteAccount.mockResolvedValue([]);
    const kv = makeKv([CURRENT_TOKEN]);

    const res = await dispatch(kv.binding);

    expect(res.status).toBe(204);
    expect(kv.deleted()).toEqual([CURRENT_TOKEN]);
  });

  it('swallows a failing kv.delete and still attempts every token', async () => {
    // Two properties in one request. The `.catch()` on each delete is
    // deliberate: the account IS already deleted in the database by this point,
    // so a KV fault must not turn a completed deletion into a 500. And the loop
    // must not abort on the first rejection, or one unlucky key leaves a device
    // signed in.
    //
    // NOT A PURE CONTROL, measured: under the pre-fix defect the 204 half holds
    // and the call-count half fails. The two tests that DO stay green under
    // that defect are the empty-list case above and the no-binding case below —
    // they are what prove a failure here is specific to the defect rather than
    // this file collapsing for an unrelated reason.
    const kv = makeKv([CURRENT_TOKEN, OTHER_TOKEN_A, OTHER_TOKEN_B]);
    kv.delete.mockRejectedValue(new Error('KV unavailable'));

    const res = await dispatch(kv.binding);

    expect(res.status).toBe(204);
    // Every token was still attempted — one failure does not abort the loop.
    expect(kv.delete).toHaveBeenCalledTimes(3);
  });

  it('CONTROL: succeeds with no AUTH_SESSION_KV binding at all', async () => {
    // The whole block is guarded by `if (kv)`. A worker deployed without the
    // binding must still be able to delete an account — and this control is
    // what keeps the guard from being "optimised" into an unconditional
    // dereference. Authentication falls through to the DB path here, which is
    // why this case asserts only that the route does not 500 on a missing
    // binding.
    const res = await dispatch(undefined);

    expect(res.status).not.toBe(500);
  });
});
