/**
 * VersionedCache KV write budget (Codex-kgrdp.4 / .5 / .8).
 *
 * WHY OP COUNTS, NOT KEY COUNTS. The free KV tier allows 100,000 reads/day but
 * only 1,000 writes/day, billed PER ACCOUNT — so any worker's waste eats
 * production's allowance. This epic has twice been misled by looking at what
 * ended up in KV instead of at what the cache SPENT getting there, so every
 * test below asserts the number of KV operations issued, and each one names the
 * defect it fails on:
 *
 *   - `.5` the read path minted and awaited a version key whenever it found
 *     none, so a first read cost a WRITE. `organizations.ts` passes the URL
 *     slug as the cache `id`, which made that a remote quota-DoS: 1,000 bogus
 *     slugs exhausted the account's daily writes.
 *   - `.5` two independent TTLs (`ttl` 600s, `versionTtl` 86400s) meant a live
 *     version key routinely pointed at a dead data key, and a version key that
 *     expired first could resurrect data it had already staled.
 *   - `.8` a write-through spent 2 writes + 2 reads (invalidate, then re-read
 *     from the DB a value the caller was already holding).
 *   - `.4` 2 reads on a HIT is inherent to version indirection and is NOT a
 *     defect; the tests pin it so a future "optimisation" that quietly drops
 *     the version read — and with it one-write invalidation — is caught.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';
import { createMockObservability } from '@codex/test-utils/mocks';
import { describe, expect, it, vi } from 'vitest';
import { VersionedCache } from '../versioned-cache';

const VERSION_PREFIX = 'cache:version:';

/**
 * KV stand-in that records every operation, so a test can assert on what the
 * cache SPENT rather than on what the store happens to contain.
 */
function createCountingKV(options: { failReads?: boolean } = {}) {
  const store = new Map<string, string>();
  const ops: Array<{ op: 'get' | 'put' | 'delete'; key: string }> = [];

  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      ops.push({ op: 'get', key });
      if (options.failReads) throw new Error('KV unavailable');
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      ops.push({ op: 'put', key });
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      ops.push({ op: 'delete', key });
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  };

  const count = (op: 'get' | 'put' | 'delete') =>
    ops.filter((o) => o.op === op).length;

  return {
    kv: kv as unknown as KVNamespace,
    store,
    ops,
    reads: () => count('get'),
    /** puts + deletes — they share ONE bucket of 1,000/day. */
    writes: () => count('put') + count('delete'),
    versionWrites: () =>
      ops.filter((o) => o.op !== 'get' && o.key.startsWith(VERSION_PREFIX))
        .length,
    reset: () => {
      ops.length = 0;
    },
  };
}

/** Drains the data-slot put that `get()` hands to waitUntil on a miss. */
function createExecutionContextSpy() {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
    drain: () => Promise.allSettled(tasks.splice(0)),
  };
}

describe('VersionedCache write budget', () => {
  describe('the read path spends no writes on bookkeeping (Codex-kgrdp.5)', () => {
    it('a MISS costs 2 reads and exactly ONE write — the data slot', async () => {
      const kv = createCountingKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: kv.kv,
        waitUntil: ec.waitUntil,
      });

      await cache.get('org-1', 'org:tiers', async () => [{ id: 't1' }]);
      await ec.drain();

      expect(kv.reads()).toBe(2);
      expect(kv.writes()).toBe(1);
      // The old code awaited a version-key put here, so this is the assertion
      // that fails the moment read-path minting comes back.
      expect(kv.versionWrites()).toBe(0);
      expect(kv.ops.filter((o) => o.op === 'put').map((o) => o.key)).toEqual([
        'cache:org:tiers:org-1:v0',
      ]);
    });

    it('a HIT costs 2 reads and ZERO writes (Codex-kgrdp.4 — inherent, pinned)', async () => {
      const kv = createCountingKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: kv.kv,
        waitUntil: ec.waitUntil,
      });
      const fetcher = vi.fn(async () => [{ id: 't1' }]);

      await cache.get('org-1', 'org:tiers', fetcher);
      await ec.drain();
      kv.reset();

      const second = await cache.get('org-1', 'org:tiers', fetcher);

      expect(second).toEqual([{ id: 't1' }]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      // Version key, then versioned data key. Reads are the abundant bucket;
      // dropping the version read would mean giving up one-write invalidation.
      expect(kv.reads()).toBe(2);
      expect(kv.writes()).toBe(0);
      expect(cache.getStats()).toMatchObject({ reads: 4, writes: 1, hits: 1 });
    });

    it('an enumeration scan of unknown ids costs ZERO writes', async () => {
      // The shape that opened this epic: `organizations.ts` caches under the
      // URL slug, so `id` is attacker-controlled. Under the old code each of
      // these 50 requests awaited a version-key put, i.e. 50 writes out of an
      // ACCOUNT budget of 1,000/day, for orgs that do not exist.
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });
      const notFound = new Error('Organization not found');
      const fetcher = vi.fn(async () => {
        throw notFound;
      });

      for (let i = 0; i < 50; i++) {
        await expect(
          cache.get(`bogus-slug-${i}`, 'org:config', fetcher)
        ).rejects.toBe(notFound);
      }

      expect(kv.writes()).toBe(0);
      expect(kv.versionWrites()).toBe(0);
      // ONE origin round trip per request, not two — see the next test.
      expect(fetcher).toHaveBeenCalledTimes(50);
    });
  });

  describe('a fetcher failure is not a cache failure', () => {
    it('propagates the fetcher error without re-invoking it', async () => {
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });
      const boom = new Error('NOT_FOUND');
      const fetcher = vi.fn(async () => {
        throw boom;
      });

      await expect(cache.get('id-1', 'type:a', fetcher)).rejects.toBe(boom);

      // The fetcher used to sit inside a try whose catch called it AGAIN, so
      // every failing read doubled the DB round trips. One call, or this fails.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(kv.writes()).toBe(0);
    });

    it('does not blame KV in the logs when only the fetcher threw', async () => {
      const kv = createCountingKV();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: kv.kv,
        obs: obs as unknown as ObservabilityClient,
      });

      await expect(
        cache.get('id-1', 'type:a', async () => {
          throw new Error('DB timeout');
        })
      ).rejects.toThrow('DB timeout');

      // The old message was 'Cache get failed, falling back to fetcher' — an
      // error emitted on a healthy cache, which is exactly the kind of signal
      // that makes a real KV outage invisible.
      expect(obs.error).not.toHaveBeenCalled();
    });

    it('still serves the fetcher once, and writes nothing, when KV reads fail', async () => {
      const kv = createCountingKV({ failReads: true });
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: kv.kv,
        obs: obs as unknown as ObservabilityClient,
      });
      const fetcher = vi.fn(async () => ({ ok: true }));

      await expect(cache.get('id-1', 'type:a', fetcher)).resolves.toEqual({
        ok: true,
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      // With no version read there is no way to name the current slot, so a
      // write here would land under a key no reader ever looks up.
      expect(kv.writes()).toBe(0);
      expect(obs.error).toHaveBeenCalledWith(
        'Cache lookup failed, serving from the fetcher',
        expect.objectContaining({ id: 'id-1' })
      );
    });
  });

  describe('version keys never expire (Codex-kgrdp.5)', () => {
    it('invalidate writes the version key with NO expiration', async () => {
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });

      await cache.invalidate('org-1');

      // Arity is the assertion. A version key that outlives every data key it
      // stales is what makes the base-version fallback safe: if it could
      // expire, reads would drop back to v0 and resurrect data written before
      // the bump. `toHaveBeenCalledWith` fails if an options object returns.
      expect(kv.kv.put).toHaveBeenCalledWith(
        'cache:version:org-1',
        expect.any(String)
      );
      expect(kv.writes()).toBe(1);
    });

    it('invalidate is the ONLY writer of version keys', async () => {
      const kv = createCountingKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: kv.kv,
        waitUntil: ec.waitUntil,
      });

      // Exercise every method that touches KV except invalidate.
      await cache.get('org-1', 'type:a', async () => ({ a: 1 }));
      await cache.getWithResult('org-1', 'type:b', async () => ({ b: 2 }));
      await cache.set('org-1', 'type:c', { c: 3 });
      await cache.getVersion('org-1');
      await cache.delete('org-1', 'type:a');
      await ec.drain();

      expect(kv.versionWrites()).toBe(0);
    });

    it('a bumped version stales every type under that id, then stays put', async () => {
      const kv = createCountingKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: kv.kv,
        waitUntil: ec.waitUntil,
      });
      const fetchA = vi.fn(async () => ({ v: 'a1' }));
      const fetchB = vi.fn(async () => ({ v: 'b1' }));

      await cache.get('org-1', 'type:a', fetchA);
      await cache.get('org-1', 'type:b', fetchB);
      await ec.drain();

      await cache.invalidate('org-1');
      const versionAfterBump = kv.store.get('cache:version:org-1');

      await cache.get('org-1', 'type:a', fetchA);
      await cache.get('org-1', 'type:b', fetchB);
      await ec.drain();

      expect(fetchA).toHaveBeenCalledTimes(2);
      expect(fetchB).toHaveBeenCalledTimes(2);
      // Re-warming after an invalidate must not churn the version key — the
      // old read path re-minted it on every expiry, which surfaced to clients
      // as a version change with no data change behind it.
      expect(kv.store.get('cache:version:org-1')).toBe(versionAfterBump);
      expect(kv.versionWrites()).toBe(1);
    });
  });

  describe('set() write-through (Codex-kgrdp.8)', () => {
    it('costs 1 read + 1 write, and the next get hits the new value', async () => {
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });
      const fetcher = vi.fn(async () => [{ id: 'from-db' }]);

      await cache.set('org-1', 'org:tiers', [{ id: 'fresh' }], { ttl: 86400 });

      // The invalidate-then-re-read pattern this replaces spent 2 writes + 2
      // reads AND a DB query, to store a value the caller already had.
      expect(kv.reads()).toBe(1);
      expect(kv.writes()).toBe(1);
      expect(kv.versionWrites()).toBe(0);

      kv.reset();
      const read = await cache.get('org-1', 'org:tiers', fetcher);

      expect(read).toEqual([{ id: 'fresh' }]);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('refreshes only the type it was given, leaving siblings cached', async () => {
      const kv = createCountingKV();
      const ec = createExecutionContextSpy();
      const cache = new VersionedCache({
        kv: kv.kv,
        waitUntil: ec.waitUntil,
      });
      const fetchMembers = vi.fn(async () => ({ members: 1 }));

      // Prime a sibling type under the same id, then write through to tiers.
      await cache.get('org-1', 'org:members', fetchMembers);
      await ec.drain();
      await cache.set('org-1', 'org:tiers', [{ id: 'fresh' }]);

      await cache.get('org-1', 'org:members', fetchMembers);

      // A version bump would have staled the sibling and forced it to spend a
      // write of its own on the next read. A write-through must not.
      expect(fetchMembers).toHaveBeenCalledTimes(1);
    });

    it('never throws when the write-through fails', async () => {
      const { obs } = createMockObservability();
      const failingKV = {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {
          throw new Error('KV write quota exceeded');
        }),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace;
      const cache = new VersionedCache({
        kv: failingKV,
        obs: obs as unknown as ObservabilityClient,
      });

      await expect(
        cache.set('org-1', 'org:tiers', [])
      ).resolves.toBeUndefined();
      expect(obs.warn).toHaveBeenCalledWith(
        'Cache set failed',
        expect.objectContaining({ id: 'org-1' })
      );
    });

    it('writes into the CURRENT version after an invalidate', async () => {
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });
      const fetcher = vi.fn(async () => [{ id: 'from-db' }]);

      await cache.invalidate('org-1');
      await cache.set('org-1', 'org:tiers', [{ id: 'fresh' }]);

      const version = kv.store.get('cache:version:org-1');
      expect(kv.store.has(`cache:org:tiers:org-1:v${version}`)).toBe(true);

      // A `set()` that ignored the version key would write to v0 and the read
      // below would miss, silently turning a write-through into a wasted write.
      await expect(cache.get('org-1', 'org:tiers', fetcher)).resolves.toEqual([
        { id: 'fresh' },
      ]);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('getStats reports the KV ops actually spent', () => {
    it('counts deletes against the write budget alongside puts', async () => {
      const kv = createCountingKV();
      const cache = new VersionedCache({ kv: kv.kv });

      await cache.set('org-1', 'type:a', { a: 1 });
      await cache.delete('org-1', 'type:a');

      // KV bills deletes out of the same 1,000/day bucket as puts, so a stats
      // surface that counted only puts would understate the scarce resource.
      expect(cache.getStats()).toMatchObject({ reads: 2, writes: 2 });
      expect(kv.writes()).toBe(2);
    });
  });
});
