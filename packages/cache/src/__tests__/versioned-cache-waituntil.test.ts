/**
 * VersionedCache KV write survival — data slot (Codex-e32xz) and version key
 * (Codex-mhoaz). One defect class, both directions: a KV put that nobody awaits
 * is not "slower" in workerd, it is CANCELLED, and the cache silently does
 * nothing. The two halves are:
 *
 *   - READ path (Codex-e32xz): `get()` never awaits its data-slot put, so
 *     without a `waitUntil` the slot is never written — 0% hit rate.
 *   - WRITE path (Codex-mhoaz): production services fire `void
 *     this.cache?.invalidate(...)`, so nobody awaits `invalidate()`'s returned
 *     promise — without a `waitUntil` registration inside `invalidate()` a
 *     publish can commit to Postgres and never stale the cache.
 *
 * The Codex-e32xz analysis below applies verbatim to both.
 *
 * WHAT WENT WRONG. `get()`/`getWithResult()` write their data slot WITHOUT
 * awaiting it, so a cache write never delays a response. In workerd an
 * un-awaited promise is not "slower", it is CANCELLED: the request's IoContext
 * is torn down the moment the response is returned. A production census of
 * `CACHE_KV_PRODUCTION` found 62 version keys and ZERO data keys — the version
 * key is written with `await` three lines earlier in the same function, in the
 * same namespace, in the same request; the ONLY difference was the await. The
 * cache therefore had a literal 0% hit rate.
 *
 * WHAT THESE TESTS PIN. The fix is `waitUntil`, not `await` — awaiting inline
 * would put KV write latency on every miss response. So a test that merely
 * asserts "the data key is in the mock afterwards" proves NOTHING: the old
 * floating promise also lands in an in-process mock, because a mock has no
 * IoContext to cancel it. Each test below instead makes the put ORDER
 * observable — the data-slot put is held on a deferred that only the test can
 * release — and asserts:
 *
 *   1. `get()` resolves while the put is still in flight (still non-blocking).
 *   2. The put promise was handed to the supplied `waitUntil` (registered), and
 *      settling that promise is what lands the key (completes).
 *   3. With NO `waitUntil`, nothing is registered and behaviour is unchanged.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';
import { createMockObservability } from '@codex/test-utils/mocks';
import { describe, expect, it, vi } from 'vitest';
import { CacheType } from '../cache-keys';
import { VersionedCache } from '../versioned-cache';

/** A promise plus its resolver, so a test can decide when a put finishes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const DATA_KEY = /^cache:user:profile:user-1:v\d+$/;
const VERSION_KEY = 'cache:version:user-1';

/**
 * KV mock whose DATA-slot put hangs until the test releases it, while the
 * version-key put resolves immediately (matching the real code, which awaits
 * the version put and not the data put).
 *
 * `settled` records only writes that actually completed — a put still parked on
 * its deferred is deliberately absent, which is what makes "the response
 * returned before the write finished" assertable.
 *
 * `gateVersionKey` extends the same trick to the version key, for the
 * invalidate path (Codex-mhoaz): `invalidate()` awaits its put, so only a
 * caller who does NOT await `invalidate()` can observe it in flight — and that
 * is exactly the caller the bead is about.
 */
function createGatedKV(options: { gateVersionKey?: boolean } = {}) {
  const settled = new Map<string, string>();
  const gates: Array<{ key: string; resolve: () => void }> = [];

  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const value = settled.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      if (key === VERSION_KEY && !options.gateVersionKey) {
        settled.set(key, value);
        return;
      }
      const gate = deferred();
      gates.push({ key, resolve: gate.resolve });
      await gate.promise;
      settled.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      settled.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  };

  return {
    kv: kv as unknown as KVNamespace,
    settled,
    /** Release every parked put. */
    releaseWrites: () => {
      for (const gate of gates) gate.resolve();
      gates.length = 0;
    },
    dataKeys: () => [...settled.keys()].filter((k) => DATA_KEY.test(k)),
  };
}

/** Stand-in for `ExecutionContext.waitUntil` that keeps its tasks awaitable. */
function createExecutionContextSpy() {
  const tasks: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    tasks.push(promise);
  });
  return {
    waitUntil,
    /** What the Workers runtime does at end-of-request when tasks exist. */
    drain: () => Promise.allSettled(tasks),
    count: () => tasks.length,
  };
}

describe('VersionedCache data-slot write (Codex-e32xz)', () => {
  describe('with waitUntil supplied', () => {
    it('registers the data-slot put on waitUntil and the write completes', async () => {
      const store = createGatedKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Ada' });

      const data = await cache.get('user-1', CacheType.USER_PROFILE, fetcher);

      // Still NON-BLOCKING: get() resolved with the fetched data while the KV
      // put is parked on its gate. If the fix had awaited the put inline this
      // line would deadlock instead of asserting.
      expect(data).toEqual({ name: 'Ada' });
      expect(store.dataKeys()).toEqual([]);

      // REGISTERED: exactly one task was handed to waitUntil.
      expect(ec.count()).toBe(1);

      // COMPLETES: releasing the gate and draining the execution context — the
      // two things the runtime does — is what lands the key.
      store.releaseWrites();
      await ec.drain();

      expect(store.dataKeys()).toHaveLength(1);
      expect(store.settled.get(store.dataKeys()[0])).toBe(
        JSON.stringify({ name: 'Ada' })
      );
    });

    it('caches a value the NEXT get() reads back as a hit', async () => {
      const store = createGatedKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Ada' });

      await cache.get('user-1', CacheType.USER_PROFILE, fetcher);
      store.releaseWrites();
      await ec.drain();

      const second = await cache.get('user-1', CacheType.USER_PROFILE, fetcher);

      expect(second).toEqual({ name: 'Ada' });
      // The whole point of the bead: the second read must not hit the DB.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.getStats().hits).toBe(1);
    });

    it('registers the put from getWithResult too', async () => {
      const store = createGatedKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Grace' });

      const result = await cache.getWithResult(
        'user-1',
        CacheType.USER_PROFILE,
        fetcher
      );

      expect(result).toEqual({ data: { name: 'Grace' }, hit: false });
      expect(ec.count()).toBe(1);
      expect(store.dataKeys()).toEqual([]);

      store.releaseWrites();
      await ec.drain();

      expect(store.dataKeys()).toHaveLength(1);
    });

    it('does not register anything on a cache HIT', async () => {
      const store = createGatedKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Ada' });

      await cache.get('user-1', CacheType.USER_PROFILE, fetcher);
      store.releaseWrites();
      await ec.drain();
      ec.waitUntil.mockClear();

      await cache.get('user-1', CacheType.USER_PROFILE, fetcher);

      expect(ec.waitUntil).not.toHaveBeenCalled();
    });

    it('swallows a KV write failure without failing the read', async () => {
      const failingKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async (key: string) => {
          if (key !== VERSION_KEY) throw new Error('KV write quota exceeded');
        }),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace;
      const ec = createExecutionContextSpy();
      // A COMPLETE observability mock: `get()` calls `obs.debug` on every miss,
      // so a partial stub throws there and lands in the graceful-degradation
      // catch — masking whatever the test meant to assert.
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: failingKV,
        waitUntil: (p) => ec.waitUntil(p),
        obs: obs as unknown as ObservabilityClient,
      });

      const data = await cache.get('user-1', CacheType.USER_PROFILE, () =>
        Promise.resolve({ name: 'Ada' })
      );

      expect(data).toEqual({ name: 'Ada' });
      // The registered task must RESOLVE, not reject — a rejecting waitUntil
      // task is an unhandled rejection in the runtime.
      const outcomes = await ec.drain();
      expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
      expect(obs.warn).toHaveBeenCalledWith(
        'Cache write failed',
        expect.objectContaining({ id: 'user-1' })
      );
    });

    it('survives a waitUntil that throws, without re-running the fetcher', async () => {
      const store = createGatedKV();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: () => {
          throw new Error('Illegal invocation');
        },
        obs: obs as unknown as ObservabilityClient,
      });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Ada' });

      const data = await cache.get('user-1', CacheType.USER_PROFILE, fetcher);

      expect(data).toEqual({ name: 'Ada' });
      // If the throw escaped into get()'s outer try/catch the fallback would
      // call the fetcher a SECOND time — a duplicated DB query per request.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(obs.warn).toHaveBeenCalledWith(
        'Cache write could not be scheduled on waitUntil',
        expect.objectContaining({ id: 'user-1' })
      );

      store.releaseWrites();
    });
  });

  describe('without waitUntil (unchanged behaviour — AC3)', () => {
    it('still returns fetched data and still does not block on the put', async () => {
      const store = createGatedKV();
      const cache = new VersionedCache({ kv: store.kv });
      const fetcher = vi.fn().mockResolvedValue({ name: 'Ada' });

      const data = await cache.get('user-1', CacheType.USER_PROFILE, fetcher);

      expect(data).toEqual({ name: 'Ada' });
      expect(store.dataKeys()).toEqual([]);

      // Nothing was registered anywhere — the promise is left floating exactly
      // as before, which is why these consumers are unaffected by the change.
      store.releaseWrites();
      await Promise.resolve();
      await Promise.resolve();
      expect(store.dataKeys()).toHaveLength(1);
    });

    it('never throws when a floating put rejects', async () => {
      const failingKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async (key: string) => {
          if (key !== VERSION_KEY) throw new Error('KV down');
        }),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace;
      const cache = new VersionedCache({ kv: failingKV });

      await expect(
        cache.get('user-1', CacheType.USER_PROFILE, () =>
          Promise.resolve({ name: 'Ada' })
        )
      ).resolves.toEqual({ name: 'Ada' });
    });
  });
});

describe('VersionedCache invalidate() version-key write (Codex-mhoaz)', () => {
  describe('with waitUntil supplied', () => {
    it('lands the version key for a caller that only does `void invalidate(id)`', async () => {
      const store = createGatedKV({ gateVersionKey: true });
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });

      // EXACTLY what the production call sites in @codex/content and
      // @codex/admin do after a successful DB mutation. Nobody awaits this.
      void cache.invalidate('user-1');

      // Drain the microtasks the request handler would have run before
      // returning its response.
      await Promise.resolve();
      await Promise.resolve();

      // The put has NOT settled and no one holds the returned promise, so the
      // registration asserted on the next line is the isolate's only reason to
      // stay alive. Remove the `this.waitUntil(...)` call from
      // startVersionWrite() and the count is 0 here.
      expect(store.settled.has(VERSION_KEY)).toBe(false);
      expect(ec.count()).toBe(1);

      // COMPLETES: releasing the gate and draining the execution context — the
      // two things the runtime does at end-of-request — is what lands the key.
      store.releaseWrites();
      await ec.drain();

      expect(store.settled.get(VERSION_KEY)).toMatch(/^\d+$/);
    });

    it('still awaits the put itself, so an awaiting caller needs no drain', async () => {
      const store = createGatedKV({ gateVersionKey: true });
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: (p) => ec.waitUntil(p),
      });

      const pending = cache.invalidate('user-1');
      await Promise.resolve();
      expect(store.settled.has(VERSION_KEY)).toBe(false);

      store.releaseWrites();
      await pending;

      // Registering must not have replaced the await: `invalidateUserLibrary`
      // and every `await cache.invalidate(...)` rely on the returned promise
      // resolving AFTER the write, not before it.
      expect(store.settled.get(VERSION_KEY)).toMatch(/^\d+$/);
      expect(cache.getStats().invalidations).toBe(1);
    });

    it('registers a task that RESOLVES when the KV put rejects', async () => {
      const failingKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {
          throw new Error('KV write quota exceeded');
        }),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace;
      const ec = createExecutionContextSpy();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: failingKV,
        waitUntil: (p) => ec.waitUntil(p),
        obs: obs as unknown as ObservabilityClient,
      });

      await expect(cache.invalidate('user-1')).resolves.toBeUndefined();

      // A rejecting waitUntil task is an unhandled rejection in the runtime, so
      // the registered copy must swallow — invalidate()'s own catch logs it.
      const outcomes = await ec.drain();
      expect(outcomes).toHaveLength(1);
      expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
      expect(obs.error).toHaveBeenCalledWith(
        'Cache invalidation failed',
        expect.objectContaining({ id: 'user-1' })
      );
    });

    it('survives a waitUntil that throws, and still lands the version key', async () => {
      const store = createGatedKV();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: store.kv,
        waitUntil: () => {
          throw new Error('Illegal invocation');
        },
        obs: obs as unknown as ObservabilityClient,
      });

      await expect(cache.invalidate('user-1')).resolves.toBeUndefined();

      // If the throw escaped into invalidate()'s outer catch, the bump would be
      // reported as a FAILED invalidation — a healthy cache logging an error and
      // under-counting the only write it ever makes.
      expect(store.settled.get(VERSION_KEY)).toMatch(/^\d+$/);
      expect(cache.getStats().invalidations).toBe(1);
      expect(obs.error).not.toHaveBeenCalled();
      expect(obs.warn).toHaveBeenCalledWith(
        'Cache invalidation could not be scheduled on waitUntil',
        expect.objectContaining({ id: 'user-1' })
      );
    });
  });

  describe('without waitUntil (unchanged behaviour)', () => {
    it('attempts no registration and the returned promise still carries the put', async () => {
      const store = createGatedKV({ gateVersionKey: true });
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: store.kv,
        obs: obs as unknown as ObservabilityClient,
      });

      const pending = cache.invalidate('user-1');
      await Promise.resolve();
      expect(store.settled.has(VERSION_KEY)).toBe(false);

      store.releaseWrites();
      await pending;

      // The consumers with no ExecutionContext — unit tests, SvelteKit under
      // `vite dev`, `invalidateUserLibrary` (which parks the whole invalidate()
      // call itself) — are unaffected by the fix.
      expect(store.settled.get(VERSION_KEY)).toMatch(/^\d+$/);

      // "Attempts no registration" is the half that IS assertable with no
      // waitUntil to spy on: startVersionWrite's `if (!this.waitUntil)`
      // guard is the only thing stopping it from CALLING an undefined
      // waitUntil. Drop that guard and the TypeError lands in its own catch,
      // which warns here — a healthy invalidation reporting a plumbing
      // failure.
      expect(obs.warn).not.toHaveBeenCalled();
      expect(obs.error).not.toHaveBeenCalled();
    });
  });
});
