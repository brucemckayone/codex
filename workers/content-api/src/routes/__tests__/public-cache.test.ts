/**
 * Public Content Cache Helper — Unit Tests
 *
 * Tests the cache wiring for `GET /api/content/public`. This helper is
 * extracted from the route handler so the id/type semantics can be
 * asserted directly rather than through a full worker request.
 *
 * Core contract (the bug this fixes):
 * - `cache.get` must use `CacheType.COLLECTION_ORG_CONTENT(orgId)` as `id`
 *   so every filter combo for an org shares one version key. Publish-side
 *   `cache.invalidate(COLLECTION_ORG_CONTENT(orgId))` then stales ALL
 *   combos in one atomic write.
 * - Prior bug: `id` was set to the filter-combo string, fragmenting the
 *   version namespace so publish's invalidate never reached the reader.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPublicContentCacheType,
  getCachedPublicContent,
  shouldCachePublicContentQuery,
} from '../public-cache';

// ─────────────────────────────────────────────────────────────────────────────
// Mock KV (mirrors the helper in packages/cache/src/__tests__/versioned-cache.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function createMockKV(): KVNamespace & {
  _data: Map<string, string>;
  _reset: () => void;
} {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = data.get(key);
      if (value === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    }),
    put: vi.fn(async (key: string, value: string | ArrayBuffer) => {
      data.set(key, typeof value === 'string' ? value : '');
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    _data: data,
    _reset: () => data.clear(),
  } as unknown as KVNamespace & {
    _data: Map<string, string>;
    _reset: () => void;
  };
}

describe('buildPublicContentCacheType', () => {
  it('produces a deterministic string including every filter param', () => {
    expect(
      buildPublicContentCacheType({
        sort: 'newest',
        limit: 20,
        page: 1,
        contentType: 'video',
      })
    ).toBe('content:public:newest:20:1:video');
  });

  it('uses sensible defaults for missing params', () => {
    expect(buildPublicContentCacheType({})).toBe(
      'content:public:newest:20:1:all'
    );
  });

  it('distinguishes different sort + contentType combos', () => {
    const a = buildPublicContentCacheType({
      sort: 'newest',
      contentType: 'video',
    });
    const b = buildPublicContentCacheType({
      sort: 'newest',
      contentType: 'audio',
    });
    const c = buildPublicContentCacheType({
      sort: 'oldest',
      contentType: 'video',
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('distinguishes different pages', () => {
    expect(buildPublicContentCacheType({ sort: 'newest', page: 1 })).not.toBe(
      buildPublicContentCacheType({ sort: 'newest', page: 2 })
    );
  });

  it('folds slug into the key so distinct slugs get distinct data slots', () => {
    const withSlug = buildPublicContentCacheType({
      sort: 'newest',
      slug: 'liberty',
    });
    const otherSlug = buildPublicContentCacheType({
      sort: 'newest',
      slug: 'freedom',
    });
    const noSlug = buildPublicContentCacheType({ sort: 'newest' });
    expect(withSlug).toContain(':slug:liberty');
    expect(withSlug).not.toBe(otherSlug);
    expect(withSlug).not.toBe(noSlug);
  });

  it('folds category into the key so distinct topics get distinct data slots', () => {
    const fiction = buildPublicContentCacheType({
      sort: 'newest',
      category: 'fiction',
    });
    const poetry = buildPublicContentCacheType({
      sort: 'newest',
      category: 'poetry',
    });
    const noCategory = buildPublicContentCacheType({ sort: 'newest' });
    expect(fiction).toContain(':cat:fiction');
    // Two different topics MUST NOT share a slot (would serve wrong content).
    expect(fiction).not.toBe(poetry);
    // A filtered read MUST NOT collide with the unfiltered list.
    expect(fiction).not.toBe(noCategory);
  });

  it('folds featured into the key so featured/unfiltered do not collide (regression: featured was omitted)', () => {
    const onlyFeatured = buildPublicContentCacheType({
      sort: 'newest',
      featured: true,
    });
    const excludeFeatured = buildPublicContentCacheType({
      sort: 'newest',
      featured: false,
    });
    const unset = buildPublicContentCacheType({ sort: 'newest' });
    expect(onlyFeatured).toContain(':feat:true');
    // The latent bug: `featured` was a live query param but absent from the
    // key, so Editor's-picks and the all-content list shared one slot.
    expect(onlyFeatured).not.toBe(unset);
    expect(excludeFeatured).not.toBe(unset);
    expect(onlyFeatured).not.toBe(excludeFeatured);
  });

  it('composes category + featured deterministically without disturbing unrelated queries', () => {
    // Full compose is stable + distinct...
    expect(
      buildPublicContentCacheType({
        sort: 'newest',
        category: 'fiction',
        featured: true,
      })
    ).toBe('content:public:newest:20:1:all:cat:fiction:feat:true');
    // ...and a query with neither new dimension keeps its exact prior shape,
    // so existing cache entries stay hit-compatible.
    expect(
      buildPublicContentCacheType({
        sort: 'newest',
        limit: 20,
        page: 1,
        contentType: 'video',
      })
    ).toBe('content:public:newest:20:1:video');
  });
});

describe('shouldCachePublicContentQuery', () => {
  it('caches queries with no search, slug, or creator filter', () => {
    expect(
      shouldCachePublicContentQuery({ orgId: 'org-1', sort: 'newest' })
    ).toBe(true);
  });

  it('bypasses cache when search is present (variant explosion)', () => {
    expect(
      shouldCachePublicContentQuery({ orgId: 'org-1', search: 'hello' })
    ).toBe(false);
  });

  it('caches slug lookups (content-detail path; slug folds into the data-slot key)', () => {
    expect(
      shouldCachePublicContentQuery({ orgId: 'org-1', slug: 'my-content' })
    ).toBe(true);
  });

  it('bypasses cache when creatorId filter is present (lower-volume)', () => {
    expect(
      shouldCachePublicContentQuery({ orgId: 'org-1', creatorId: 'abc123' })
    ).toBe(false);
  });
});

describe('getCachedPublicContent', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let cache: VersionedCache;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let nowCounter: number;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new VersionedCache({ kv: mockKV });
    nowCounter = 1_000_000;
    // Ensure each version bump produces a distinct timestamp. In production
    // network latency guarantees this; tests are too fast otherwise.
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => ++nowCounter);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    mockKV._reset();
  });

  it('uses COLLECTION_ORG_CONTENT(orgId) as the cache id (regression guard for id/type swap)', async () => {
    const orgId = 'org-1';
    const fetcher = vi.fn().mockResolvedValue({ items: [], pagination: {} });

    await getCachedPublicContent(
      cache,
      orgId,
      { orgId, sort: 'newest', limit: 20, page: 1, contentType: 'all' },
      fetcher
    );

    // The version key MUST be derived from COLLECTION_ORG_CONTENT(orgId).
    // A regression that reverts to passing the filter-combo as `id` would
    // produce `cache:version:org-1:newest:20:1:all` and fail this test.
    const versionKey = `cache:version:${CacheType.COLLECTION_ORG_CONTENT(orgId)}`;
    expect(mockKV._data.has(versionKey)).toBe(true);

    // No other version keys should exist for this org's reads.
    const versionKeys = [...mockKV._data.keys()].filter((k) =>
      k.startsWith('cache:version:')
    );
    expect(versionKeys).toEqual([versionKey]);
  });

  it('returns cached result on repeat call with same filter combo', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ items: [{ id: '1' }], pagination: { total: 1 } });

    await getCachedPublicContent(
      cache,
      'org-1',
      { orgId: 'org-1', sort: 'newest' },
      fetcher
    );
    await getCachedPublicContent(
      cache,
      'org-1',
      { orgId: 'org-1', sort: 'newest' },
      fetcher
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('different filter combos for the same org share one version key', async () => {
    const fA = vi.fn().mockResolvedValue({ items: ['A'] });
    const fB = vi.fn().mockResolvedValue({ items: ['B'] });
    const fC = vi.fn().mockResolvedValue({ items: ['C'] });

    await getCachedPublicContent(
      cache,
      'org-1',
      { orgId: 'org-1', sort: 'newest' },
      fA
    );
    await getCachedPublicContent(
      cache,
      'org-1',
      { orgId: 'org-1', sort: 'oldest' },
      fB
    );
    await getCachedPublicContent(
      cache,
      'org-1',
      { orgId: 'org-1', sort: 'newest', contentType: 'video' },
      fC
    );

    const versionKeys = [...mockKV._data.keys()].filter((k) =>
      k.startsWith('cache:version:')
    );
    // Every filter combo reads the SAME version key for org-1.
    expect(versionKeys).toEqual([
      `cache:version:${CacheType.COLLECTION_ORG_CONTENT('org-1')}`,
    ]);
  });

  it('CHAIN LOCK: invalidate(COLLECTION_ORG_CONTENT(orgId)) stales every cached filter combo', async () => {
    const orgId = 'org-1';
    const fA = vi.fn().mockResolvedValue({ items: ['A1'] });
    const fB = vi.fn().mockResolvedValue({ items: ['B1'] });

    // Prime two combos
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'newest' }, fA);
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'oldest' }, fB);
    expect(fA).toHaveBeenCalledTimes(1);
    expect(fB).toHaveBeenCalledTimes(1);

    // Both should hit cache on repeat
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'newest' }, fA);
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'oldest' }, fB);
    expect(fA).toHaveBeenCalledTimes(1);
    expect(fB).toHaveBeenCalledTimes(1);

    // The publish-side invalidation (as content.ts:75 performs it)
    await cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(orgId));

    // Both combos must now re-fetch
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'newest' }, fA);
    await getCachedPublicContent(cache, orgId, { orgId, sort: 'oldest' }, fB);
    expect(fA).toHaveBeenCalledTimes(2);
    expect(fB).toHaveBeenCalledTimes(2);
  });

  it('ORG ISOLATION: invalidate for one org does not stale another', async () => {
    const fA = vi.fn().mockResolvedValue({ items: ['A'] });
    const fB = vi.fn().mockResolvedValue({ items: ['B'] });

    await getCachedPublicContent(cache, 'org-1', { orgId: 'org-1' }, fA);
    await getCachedPublicContent(cache, 'org-2', { orgId: 'org-2' }, fB);
    expect(fA).toHaveBeenCalledTimes(1);
    expect(fB).toHaveBeenCalledTimes(1);

    await cache.invalidate(CacheType.COLLECTION_ORG_CONTENT('org-1'));

    // org-1 re-fetches, org-2 still hits cache
    await getCachedPublicContent(cache, 'org-1', { orgId: 'org-1' }, fA);
    await getCachedPublicContent(cache, 'org-2', { orgId: 'org-2' }, fB);
    expect(fA).toHaveBeenCalledTimes(2);
    expect(fB).toHaveBeenCalledTimes(1);
  });

  it('SLUG PATH: caches a slug lookup and re-fetches after org invalidate', async () => {
    // Content-detail SSR fetches by slug. This proves the slug slot both
    // caches AND is invalidated by the same org version bump that
    // publish/update/unpublish/delete/thumbnail fire — so a cached detail
    // page never outlives a content mutation (the invalidation contract).
    const orgId = 'org-1';
    const fetcher = vi
      .fn()
      .mockResolvedValue({ items: [{ id: '1' }], pagination: { total: 1 } });
    const slugQuery = { orgId, slug: 'liberty', limit: 1 };

    await getCachedPublicContent(cache, orgId, slugQuery, fetcher);
    await getCachedPublicContent(cache, orgId, slugQuery, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); // second call served from cache

    await cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(orgId));

    await getCachedPublicContent(cache, orgId, slugQuery, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // org bump reached the slug slot
  });

  it('uses the 300s default TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: [] });
    await getCachedPublicContent(cache, 'org-1', { orgId: 'org-1' }, fetcher);

    const dataPut = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as string).startsWith('cache:content:public:')
    );
    expect(dataPut?.[2]).toMatchObject({ expirationTtl: 300 });
  });

  it('accepts a custom ttl override', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: [] });
    await getCachedPublicContent(cache, 'org-1', { orgId: 'org-1' }, fetcher, {
      ttl: 60,
    });

    const dataPut = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as string).startsWith('cache:content:public:')
    );
    expect(dataPut?.[2]).toMatchObject({ expirationTtl: 60 });
  });
});
