/**
 * `GET /api/organizations/:orgId/membership/:userId` hands its KV
 * write-through to THIS REQUEST'S `executionCtx.waitUntil` (Codex-345hg).
 *
 * WHY THIS FILE EXISTS. On a miss, `checkOrganizationMembership` writes its
 * `membership:{orgId}:{userId}` KV entry as the last thing it does, and a Worker
 * cancels every unawaited promise the moment the response is returned.
 * The helper therefore takes a `cacheWrite` handle — and this route called it
 * with four arguments, so the handle was `undefined` and the `kv.put` was fired
 * bare. `helpers.ts` was fixed for the `procedure()` policy path; this route is
 * the other caller, and the one where a miss is genuinely a miss: it resolves
 * an ARBITRARY `userId` on a worker-to-worker hop, not the caller's own, so
 * nothing upstream has already warmed the entry.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. `expect(kv.put).toHaveBeenCalledWith(...)`
 * proves NOTHING here and would have passed on the broken tree: a mock records
 * its call synchronously, and cancellation is something only the real runtime
 * does at end-of-response. The observable difference between a registered write
 * and a cancelled one is whether the promise reached `waitUntil`, so that is
 * what is asserted — by VALUE, not by identity, because both `org-helpers` and
 * `ctx.cacheWrite` attach a `.catch()` and so hand a DERIVED promise onward. A
 * promise that settles to `PUT_SENTINEL` can only have come from this test's
 * `kv.put`.
 *
 * The `kv.put` is deliberately left PENDING until after the response is
 * returned. That is the exact state workerd kills, and it also means a bare
 * call cannot accidentally pass by finishing early.
 *
 * SCOPE. The write-through itself is REAL: only `createDbClient` (to make the
 * lookup a miss with a row behind it) and the KV binding are substituted, so the
 * chain under test is route -> procedure -> ctx.cacheWrite -> org-helpers'
 * `kv.put`. The helper's own key/value semantics are pinned by
 * `packages/worker-utils/src/procedure/__tests__/org-slug-cache.test.ts`.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { Bindings, HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';
const JOINED_AT = '2026-01-01T00:00:00.000Z';

/** Unique fulfilment value of the deferred `kv.put`, tracked through `.catch()`. */
const PUT_SENTINEL = 'membership-kv-put-settled';

// ─── The row the write-through caches ────────────────────────────────────────
// `fetchMembershipFromDB` swallows every DB error and returns null, and a null
// membership writes nothing — so without a working client there is no `kv.put`
// to observe at all.
const { dbFindFirst } = vi.hoisted(() => ({ dbFindFirst: vi.fn() }));

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: () => ({
      query: { organizationMemberships: { findFirst: dbFindFirst } },
    }),
  };
});

// A DELEGATING spy: the real helper runs (real key, real value, real write
// -through), and the recorded call lets the argument itself be asserted.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    checkOrganizationMembership: vi.fn(actual.checkOrganizationMembership),
  };
});

// Imported AFTER the mocks so the route resolves the spy, not the original.
import { checkOrganizationMembership } from '@codex/worker-utils';
import membershipRoutes from '../membership';

/** Mirrors `generateWorkerSignature` from @codex/security — see membership.test.ts. */
async function workerAuthHeaders(): Promise<Record<string, string>> {
  const secret = env.WORKER_SHARED_SECRET || 'test-worker-secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}:`)
  );
  return {
    'X-Worker-Signature': btoa(
      String.fromCharCode(...new Uint8Array(signature))
    ),
    'X-Worker-Timestamp': timestamp.toString(),
  };
}

/**
 * A KV binding whose `put` never settles on its own. `settled()` reports
 * whether it has — the state workerd cancels is "still pending when the
 * response was returned".
 */
function makeKv(cached?: unknown) {
  let hasSettled = false;
  let release: () => void = () => {};
  const putPromise = new Promise<string>((resolve) => {
    release = () => resolve(PUT_SENTINEL);
  });
  void putPromise.then(() => {
    hasSettled = true;
  });

  const get = vi.fn(async () => cached ?? null);
  const put = vi.fn(() => putPromise);

  return {
    binding: { get, put } as unknown as KVNamespace,
    get,
    put,
    release,
    settled: () => hasSettled,
  };
}

interface Dispatched {
  res: Response;
  /** Every promise this request handed to `executionCtx.waitUntil`, in order. */
  registered: Promise<unknown>[];
  drain: () => Promise<void>;
}

async function dispatch(kv: KVNamespace): Promise<Dispatched> {
  const ec = createExecutionContext();
  const registered: Promise<unknown>[] = [];
  const spyCtx = {
    // Forwarded to the real context as well, so `drain()` still works and a
    // rejection cannot escape as an unhandled one.
    waitUntil: (promise: Promise<unknown>) => {
      registered.push(promise);
      ec.waitUntil(promise);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  const app = new Hono<HonoEnv>();
  app.route('/api/organizations', membershipRoutes);

  const res = await app.fetch(
    new Request(
      `http://identity-api.test/api/organizations/${ORG_ID}/membership/${USER_ID}`,
      { headers: await workerAuthHeaders() }
    ),
    { ...env, CACHE_KV: kv } as unknown as Bindings,
    spyCtx
  );

  return {
    res,
    registered,
    drain: () => waitOnExecutionContext(ec),
  };
}

/** Settle every registered promise to a value (or its rejection reason). */
async function settleAll(promises: Promise<unknown>[]): Promise<unknown[]> {
  return Promise.all(
    promises.map((promise) =>
      Promise.resolve(promise).then(
        (value) => value,
        (reason) => reason
      )
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbFindFirst.mockResolvedValue({
    role: 'owner',
    status: 'active',
    createdAt: new Date(JOINED_AT),
  });
});

describe('membership lookup · the KV write-through survives the response', () => {
  it('hands the pending kv.put to this request executionCtx.waitUntil', async () => {
    const kv = makeKv();
    const { res, registered, drain } = await dispatch(kv.binding);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { role: 'owner', joinedAt: JOINED_AT },
    });

    // The write was issued...
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(
      `membership:${ORG_ID}:${USER_ID}`,
      JSON.stringify({
        role: 'owner',
        status: 'active',
        joinedAt: JOINED_AT,
      })
    );

    // ...and was STILL IN FLIGHT when the response was returned. This is the
    // moment workerd cancels an unregistered promise, so the two assertions
    // above are true on the broken tree as well — everything below is not.
    expect(kv.settled()).toBe(false);

    kv.release();
    await drain();

    // THE ASSERTION THIS FILE EXISTS FOR: one of the promises this request
    // registered on `waitUntil` IS that write. Omit `ctx.cacheWrite` at the
    // call site and only `procedure()`'s own cleanup promise is registered,
    // which settles to `undefined`.
    expect(await settleAll(registered)).toContain(PUT_SENTINEL);
  });

  it('registers exactly one promise MORE than a request that writes nothing', async () => {
    // The differential, so the assertion above cannot be satisfied by whatever
    // else a request happens to register (today: `procedure()`'s cleanup).
    // A cache HIT returns before the write-through, so it is the same request
    // minus the write.
    const hitKv = makeKv({
      role: 'owner',
      status: 'active',
      joinedAt: JOINED_AT,
    });
    const hit = await dispatch(hitKv.binding);
    await hit.drain();

    expect(hit.res.status).toBe(200);
    expect(hitKv.put).not.toHaveBeenCalled();
    expect(await settleAll(hit.registered)).not.toContain(PUT_SENTINEL);

    const missKv = makeKv();
    const miss = await dispatch(missKv.binding);
    missKv.release();
    await miss.drain();

    expect(missKv.put).toHaveBeenCalledTimes(1);
    expect(miss.registered).toHaveLength(hit.registered.length + 1);
  });

  it('passes a cacheWrite FUNCTION in argument 5, not nothing', async () => {
    // Stated separately from the behaviour above because the failure modes
    // differ: an arity change to the helper would leave the behavioural
    // assertions passing while this one names the slot that moved.
    const kv = makeKv();
    const { drain } = await dispatch(kv.binding);
    kv.release();
    await drain();

    const call = vi.mocked(checkOrganizationMembership).mock.calls[0];
    expect(call).toBeDefined();
    expect(call).toHaveLength(5);
    expect(typeof call?.[4]).toBe('function');
  });
});
