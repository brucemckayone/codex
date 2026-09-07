/**
 * A long data TTL must never weaken invalidation.
 *
 * This is the property that makes raising a TTL a tuning decision rather than a
 * correctness one, and it is the property the 2026-09-07 raises depend on
 * (`CACHE_TTL.ORG_PUBLIC_INFO_SECONDS` 30min -> 4h, and the three public
 * content/portal/topic reads 5min -> 30min). Those numbers were chosen because
 * production read at 83.9% overall but 50% on idle overnight traffic — readers
 * arriving 12-83 min apart, past the expiry of every slot written for them.
 *
 * The fan-out half of the argument — one `invalidate(id)` stales every `type`
 * under that id — is already pinned by `versioned-cache.test.ts` ("invalidate(id)
 * stales every type sharing that id"), so it is not repeated here.
 *
 * What IS pinned here is the half with no coverage: that a bump beats an
 * arbitrarily long TTL, and that the version key carries NO expiry so it cannot
 * die before the data it stales. That second point is Codex-kgrdp.5 — the class
 * once held `DEFAULT_TTL` 600s beside `DEFAULT_VERSION_TTL` 86400s, and if a
 * data TTL ever exceeded the version TTL the version key could expire while
 * data written before the last bump was still alive, resurrecting it. Raising a
 * data TTL is exactly the direction that bug lived in, so a regression that
 * reintroduces an expiring version key must fail HERE and not in production
 * four hours after someone publishes.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { VersionedCache } from '../versioned-cache';

/** KV mock that records the OPTIONS of every put, not just the key. */
function createOptionRecordingKV() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; options?: { expirationTtl?: number } }> = [];

  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(
      async (
        key: string,
        value: string,
        options?: { expirationTtl?: number }
      ) => {
        store.set(key, value);
        puts.push({ key, options });
      }
    ),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  };

  return { kv: kv as unknown as KVNamespace, puts, store };
}

/** Four hours — the new `ORG_PUBLIC_INFO_SECONDS`. */
const LONG_TTL = 4 * 60 * 60;

describe('invalidation is independent of data TTL', () => {
  it('a bump stales a 4-hour slot immediately', async () => {
    const { kv } = createOptionRecordingKV();
    const cache = new VersionedCache({ kv, waitUntil: (p) => void p });
    const fetcher = vi.fn().mockResolvedValue({ contentCount: 7 });

    await cache.get('of-blood-and-bones', 'org:stats:v2', fetcher, {
      ttl: LONG_TTL,
    });
    await cache.get('of-blood-and-bones', 'org:stats:v2', fetcher, {
      ttl: LONG_TTL,
    });
    // Second read served from the slot — the TTL is nowhere near expiry.
    expect(fetcher).toHaveBeenCalledTimes(1);

    // What `bumpOrgContentVersion` does on publish, via invalidateOrgSlugCache.
    await cache.invalidate('of-blood-and-bones');

    await cache.get('of-blood-and-bones', 'org:stats:v2', fetcher, {
      ttl: LONG_TTL,
    });
    // Refetched with 4h still on the clock. If this ever reports 2, a long TTL
    // has become a staleness window and every raise above must be reverted.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('writes the version key with NO expiry, so it outlives the data it stales', async () => {
    const { kv, puts } = createOptionRecordingKV();
    const cache = new VersionedCache({ kv, waitUntil: (p) => void p });

    await cache.get('org-1', 'org:config', async () => ({ a: 1 }), {
      ttl: LONG_TTL,
    });
    await cache.invalidate('org-1');

    const versionPuts = puts.filter((p) => p.key.includes(':version:'));
    const dataPuts = puts.filter((p) => !p.key.includes(':version:'));

    expect(versionPuts.length).toBeGreaterThan(0);
    for (const put of versionPuts) {
      // Codex-kgrdp.5: an expiring version key is the resurrection bug.
      expect(put.options?.expirationTtl).toBeUndefined();
    }

    // And the data slot DOES carry the caller's TTL — otherwise this test would
    // pass just as well against a cache that ignored `ttl` entirely.
    expect(dataPuts.length).toBeGreaterThan(0);
    expect(dataPuts[0]?.options?.expirationTtl).toBe(LONG_TTL);
  });

  it('a longer TTL costs no extra KV operations', async () => {
    // The raise must be free at the op level: same 2 reads per get, same 1
    // write per miss. If a longer TTL somehow changed the op profile, the
    // whole justification (fewer misses => fewer ops) would be circular.
    const short = createOptionRecordingKV();
    const long = createOptionRecordingKV();

    for (const [{ kv }, ttl] of [
      [short, 300],
      [long, LONG_TTL],
    ] as const) {
      const cache = new VersionedCache({ kv, waitUntil: (p) => void p });
      const fetcher = vi.fn().mockResolvedValue({ v: 1 });
      await cache.get('org-1', 'content:public', fetcher, { ttl });
      await cache.get('org-1', 'content:public', fetcher, { ttl });
    }

    const ops = (r: ReturnType<typeof createOptionRecordingKV>) => ({
      reads: (r.kv.get as unknown as { mock: { calls: unknown[] } }).mock.calls
        .length,
      writes: r.puts.length,
    });

    expect(ops(long)).toEqual(ops(short));
    // Pinned absolutely too, so a change to BOTH sides cannot hide here.
    expect(ops(long)).toEqual({ reads: 4, writes: 1 });
  });
});
