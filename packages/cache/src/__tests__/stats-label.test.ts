/**
 * Bounded cache-stats labels.
 *
 * `type` is both the KV data-slot key suffix (must be high-cardinality) and the
 * `statsByType` key, which `logCacheStats` turns into a Cloudflare log FIELD
 * (must be low-cardinality). Fixing the second must not touch the first, so
 * these tests pin the label — never the cache key.
 *
 * THE CORPUS IS REAL. Every string in `PRODUCTION_TYPES` was read out of the
 * production observability key index on 2026-09-06, hours after the stats gauge
 * first deployed on `main` @ c21b60e1. Hand-invented inputs would have let a
 * label rule that misses the actual composers look correct — the slug variants
 * in particular are produced by `buildPublicContentCacheType` in
 * `workers/content-api/src/routes/public-cache.ts`, whose `content:public`
 * prefix is NOT a `CacheType` value and so is invisible to any registry-based
 * normalisation.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { cacheStatsLabel, UNLABELLED_CACHE_TYPE } from '../helpers/stats-label';
import { VersionedCache } from '../versioned-cache';

/** Verbatim from `metadata.byType.*` in production, 2026-09-06. */
const PRODUCTION_TYPES = [
  'public:topics',
  'org:tiers',
  'org:config',
  'org:stats:v2',
  'org:creators:1:12',
  'user:profile',
  'user:preferences',
  'connect:status',
  'journeys:courses:published',
  'journeys:published:all:12',
  'content:public:newest:5:1:all',
  'content:public:newest:12:1:all',
  'content:public:newest:18:1:all',
  'content:public:newest:50:1:all',
  'content:public:newest:1:1:all:slug:embodiement-meditation',
  'content:public:newest:1:1:all:slug:some-data',
  'content:public:newest:1:1:all:slug:hail-mary-prayer-in-aramaic',
] as const;

/** Always-miss KV: every get returns null, so every `get` records a type. */
function createAlwaysMissKV() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace;
}

describe('cacheStatsLabel', () => {
  it('collapses the whole production corpus onto bounded labels', () => {
    const labels = PRODUCTION_TYPES.map(cacheStatsLabel);

    // Exact expectations, not a shape match: a rule that truncated one segment
    // too many (`content:public`) or too few (`content:public:newest:5`) passes
    // any "is shorter" assertion and fails here.
    expect(labels).toEqual([
      'public:topics',
      'org:tiers',
      'org:config',
      'org:stats:v2',
      'org:creators',
      'user:profile',
      'user:preferences',
      'connect:status',
      'journeys:courses:published',
      'journeys:published:all',
      'content:public:newest',
      'content:public:newest',
      'content:public:newest',
      'content:public:newest',
      'content:public:newest',
      'content:public:newest',
      'content:public:newest',
    ]);

    // 17 types -> 11 labels. The arithmetic IS the fix: the seven
    // `content:public` variants (four page sizes, three slugs) are one field.
    expect(new Set(labels).size).toBe(11);
  });

  it('leaves no digit-only or slug segment in any production label', () => {
    for (const type of PRODUCTION_TYPES) {
      const segments = cacheStatsLabel(type).split(':');
      expect(segments.some((s) => /^\d+$/.test(s))).toBe(false);
      expect(cacheStatsLabel(type)).not.toContain('slug');
    }
  });

  it('keeps a version suffix that only LOOKS numeric', () => {
    // `org:stats:v2` is the near-miss. A "strip trailing numbers" rule would
    // label it `org:stats` and silently merge two schema generations.
    expect(cacheStatsLabel('org:stats:v2')).toBe('org:stats:v2');
    expect(cacheStatsLabel('user:username-to-id')).toBe('user:username-to-id');
    expect(cacheStatsLabel('user:public-profile')).toBe('user:public-profile');
  });

  it('drops a value marker even with no numeric segment before it', () => {
    // The numeric rule alone would let this through: no digits anywhere.
    expect(cacheStatsLabel('content:detail:slug:some-post')).toBe(
      'content:detail'
    );
    expect(cacheStatsLabel('content:list:category:meditation')).toBe(
      'content:list'
    );
    expect(cacheStatsLabel('content:find:search:free+text+here')).toBe(
      'content:find'
    );
  });

  it('drops a uuid segment', () => {
    expect(
      cacheStatsLabel('org:6522de22-3923-498e-be24-5b0247bc7678:content')
    ).toBe('org');
  });

  it('is total — never throws, never returns empty', () => {
    for (const input of ['', ':', ':::', '1', '12:34', 'x'.repeat(200)]) {
      const label = cacheStatsLabel(input);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(cacheStatsLabel('')).toBe(UNLABELLED_CACHE_TYPE);
    expect(cacheStatsLabel('1')).toBe(UNLABELLED_CACHE_TYPE);
  });

  it('caps label depth', () => {
    expect(cacheStatsLabel('a:b:c:d:e:f:g')).toBe('a:b:c:d');
  });
});

describe('VersionedCache per-type stats are bounded by label', () => {
  it('records one field for many slugs instead of one per slug', async () => {
    const cache = new VersionedCache({ kv: createAlwaysMissKV() });

    for (let i = 0; i < 200; i++) {
      await cache.get(
        'org-1',
        `content:public:newest:1:1:all:slug:post-${i}`,
        async () => ({ i })
      );
    }

    const { byType, gets } = cache.getStats();
    expect(gets).toBe(200);
    expect(Object.keys(byType)).toEqual(['content:public:newest']);
    expect(byType['content:public:newest']).toEqual({
      gets: 200,
      hits: 0,
      misses: 200,
      hitRate: 0,
    });
  });

  it('cannot be blinded to a real type by slug churn', async () => {
    // THE ACTUAL DEFECT. `typeStatsFor` returns null once the map reaches
    // MAX_TRACKED_TYPES (64), so before the label an isolate that served 64
    // distinct slugs stopped tracking EVERY type that arrived afterwards. The
    // aggregate counters kept working, which is precisely what made it silent:
    // `org:config` simply vanished from the split with no error anywhere.
    const cache = new VersionedCache({ kv: createAlwaysMissKV() });

    for (let i = 0; i < 100; i++) {
      await cache.get(
        'org-1',
        `content:public:newest:1:1:all:slug:post-${i}`,
        async () => ({ i })
      );
    }
    await cache.get('of-blood-and-bones', 'org:config', async () => ({
      ok: 1,
    }));

    const { byType } = cache.getStats();
    expect(Object.keys(byType).sort()).toEqual([
      'content:public:newest',
      'org:config',
    ]);
    expect(byType['org:config']?.gets).toBe(1);
  });

  it('still reconciles the split against the aggregate', async () => {
    const cache = new VersionedCache({ kv: createAlwaysMissKV() });

    await cache.get('org-1', 'org:config', async () => ({ a: 1 }));
    await cache.get('org-1', 'org:creators:1:12', async () => ({ b: 1 }));
    await cache.get('org-1', 'org:creators:2:12', async () => ({ c: 1 }));

    const stats = cache.getStats();
    const summed = Object.values(stats.byType).reduce(
      (acc, t) => acc + t.gets,
      0
    );

    // The claim the emitted line makes: the split accounts for every get.
    // Collapsing two `org:creators` pages into one label must not lose one.
    expect(summed).toBe(stats.gets);
    expect(stats.byType['org:creators']?.gets).toBe(2);
  });
});
