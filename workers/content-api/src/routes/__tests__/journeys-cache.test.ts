/**
 * Portal (journey) public-read cache wiring — unit tests (Codex-72k55).
 *
 * Mirrors `public-cache.test.ts`, and locks the two things that are easy to
 * regress silently:
 *
 * 1. THE ID/TYPE CONTRACT. `cache.get` must use
 *    `CacheType.COLLECTION_ORG_JOURNEYS(orgId)` as `id` so every read variant
 *    for an org shares ONE version key, and the per-variant differentiator rides
 *    `type`. Swapping them fragments the version namespace so the write-side
 *    invalidate never reaches the reader — a bug that shipped once already on the
 *    content side and is invisible in production (the cache looks healthy and
 *    just serves stale rows until TTL).
 *
 * 2. THE CDN ALLOW-LIST. `isPublicPortalRead` decides which paths on the
 *    journeys router may carry `public, max-age=...`. That router also serves
 *    per-user and entitlement-gated reads, and shared caches key by URL and NOT
 *    by Cookie, so a wrong answer here leaks one member's data to the next
 *    visitor. Asserted directly rather than only through the middleware.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import {
  BASE_VERSION,
  buildVersionedCacheKey,
  CacheType,
  VersionedCache,
} from '@codex/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPublishedJourneysCacheType,
  getCachedPublishedCourses,
  getCachedPublishedJourneys,
  isPublicPortalRead,
} from '../journeys-cache';

// ─────────────────────────────────────────────────────────────────────────────
// Mock KV (same helper shape as public-cache.test.ts)
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

describe('buildPublishedJourneysCacheType', () => {
  it('is deterministic and includes both variant dimensions', () => {
    expect(buildPublishedJourneysCacheType({ featured: true, limit: 4 })).toBe(
      'journeys:published:featured:4'
    );
  });

  it('names the absent case explicitly rather than emitting an empty segment', () => {
    expect(buildPublishedJourneysCacheType({})).toBe(
      'journeys:published:all:default'
    );
  });

  it('SLOT SPLIT: featured and unfiltered reads do not share a data slot', () => {
    // The landing page calls the endpoint TWICE in one render — featured picks
    // and the full rail. A key omitting `featured` would have the two serving
    // each other's rows (the exact latent bug the content key once had).
    const featured = buildPublishedJourneysCacheType({
      featured: true,
      limit: 4,
    });
    const rail = buildPublishedJourneysCacheType({ limit: 12 });
    expect(featured).not.toBe(rail);
  });

  it('SLOT SPLIT: featured:false is the same read as unfiltered, not a third slot', () => {
    // The route coerces `featured === 'true'`, so false and absent are the SAME
    // query. They must share a slot or the rail caches twice under two keys and
    // one of them never gets a hit.
    expect(
      buildPublishedJourneysCacheType({ featured: false, limit: 12 })
    ).toBe(buildPublishedJourneysCacheType({ limit: 12 }));
  });

  it('SLOT SPLIT: different limits do not share a data slot', () => {
    // A limit-4 read must never satisfy a limit-12 read — it would silently
    // truncate the rail to the featured carousel's length.
    expect(buildPublishedJourneysCacheType({ limit: 4 })).not.toBe(
      buildPublishedJourneysCacheType({ limit: 12 })
    );
  });
});

describe('isPublicPortalRead (CDN allow-list — security boundary)', () => {
  it('allows the two fully public, org-scoped portal reads', () => {
    expect(isPublicPortalRead('/api/journeys/published')).toBe(true);
    expect(isPublicPortalRead('/api/journeys/courses')).toBe(true);
  });

  it('REFUSES the per-user enrolled shelf', () => {
    // `auth: 'required'`, response varies by session. A shared cache storing
    // this would serve one member's shelf to the next visitor.
    expect(isPublicPortalRead('/api/journeys/enrolled')).toBe(false);
    expect(isPublicPortalRead('/api/journeys/user/enrollments')).toBe(false);
  });

  it('REFUSES entitlement-gated course reads that share the /courses prefix', () => {
    // This is why the allow-list is not the Hono pattern '/courses/*': the bare
    // list is public chrome, but these return curriculum data gated on
    // `canEnterCourse`.
    expect(isPublicPortalRead('/api/journeys/courses/abc-123/dashboard')).toBe(
      false
    );
    expect(
      isPublicPortalRead('/api/journeys/courses/abc-123/practices/breathing')
    ).toBe(false);
  });

  it('REFUSES studio management routes', () => {
    expect(isPublicPortalRead('/api/journeys/studio/journeys')).toBe(false);
    expect(
      isPublicPortalRead('/api/journeys/studio/journeys/abc-123/curriculum')
    ).toBe(false);
  });

  it('FAILS CLOSED for anything not named, including near-misses', () => {
    // A route added later must carry no public header until someone adds it
    // here deliberately.
    expect(isPublicPortalRead('/api/journeys/published/')).toBe(false);
    expect(isPublicPortalRead('/api/journeys/publishedx')).toBe(false);
    expect(isPublicPortalRead('/api/journeys')).toBe(false);
    expect(isPublicPortalRead('/api/journeys/some-future-route')).toBe(false);
  });
});

describe('portal discovery cache-aside', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let cache: VersionedCache;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let nowCounter: number;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new VersionedCache({ kv: mockKV });
    nowCounter = 1_000_000;
    // Each version bump needs a distinct timestamp; tests are faster than the
    // clock's resolution (same reason as public-cache.test.ts).
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => ++nowCounter);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    mockKV._reset();
  });

  it('uses COLLECTION_ORG_JOURNEYS(orgId) as the cache id (regression guard for id/type swap)', async () => {
    const orgId = 'org-1';
    const fetcher = vi.fn().mockResolvedValue([]);

    await getCachedPublishedJourneys(
      cache,
      orgId,
      { featured: true, limit: 4 },
      fetcher
    );

    // The data slot MUST carry COLLECTION_ORG_JOURNEYS(orgId) in the `id`
    // position and the variant in the `type` position. A regression passing
    // the variant as `id` swaps the two halves of this exact string.
    const dataKey = buildVersionedCacheKey(
      'cache',
      buildPublishedJourneysCacheType({ featured: true, limit: 4 }),
      CacheType.COLLECTION_ORG_JOURNEYS(orgId),
      BASE_VERSION
    );
    expect([...mockKV._data.keys()]).toEqual([dataKey]);

    // A READ mints NO version key (Codex-kgrdp.5) — `id` is derived from a
    // caller-supplied orgId on a public route, so a version write here spent
    // one account-wide KV write per novel id. Absent resolves to BASE_VERSION.
    const versionKeys = [...mockKV._data.keys()].filter((k) =>
      k.startsWith('cache:version:')
    );
    expect(versionKeys).toEqual([]);
  });

  it('serves a repeat read of the same variant from cache', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ pageId: 'p1' }]);

    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, fetcher);
    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('featured and rail reads are independent slots under ONE version key', async () => {
    const featured = vi.fn().mockResolvedValue([{ pageId: 'featured' }]);
    const rail = vi.fn().mockResolvedValue([{ pageId: 'rail' }]);

    const featuredRows = await getCachedPublishedJourneys(
      cache,
      'org-1',
      { featured: true, limit: 4 },
      featured
    );
    const railRows = await getCachedPublishedJourneys(
      cache,
      'org-1',
      { limit: 12 },
      rail
    );

    // Neither read was satisfied by the other's slot.
    expect(featuredRows).toEqual([{ pageId: 'featured' }]);
    expect(railRows).toEqual([{ pageId: 'rail' }]);
    expect(featured).toHaveBeenCalledTimes(1);
    expect(rail).toHaveBeenCalledTimes(1);

    // ...but both slots are namespaced under ONE id, so a single bump of that
    // id reaches both (proved end-to-end by the CHAIN LOCK case below). Reads
    // mint no version key (Codex-kgrdp.5), so the shared namespace is asserted
    // on the data keys: `cache:<variant>:<id>:v<BASE_VERSION>`.
    const suffix = `:${CacheType.COLLECTION_ORG_JOURNEYS('org-1')}:v${BASE_VERSION}`;
    const dataKeys = [...mockKV._data.keys()];
    expect(dataKeys).toHaveLength(2);
    for (const key of dataKeys) {
      expect(key.endsWith(suffix)).toBe(true);
    }
    expect(new Set(dataKeys).size).toBe(2);

    expect(dataKeys.filter((k) => k.startsWith('cache:version:'))).toEqual([]);
  });

  it('CHAIN LOCK: invalidate(COLLECTION_ORG_JOURNEYS) stales every variant AND the courses rail', async () => {
    const orgId = 'org-1';
    const featured = vi.fn().mockResolvedValue(['f']);
    const rail = vi.fn().mockResolvedValue(['r']);
    const courses = vi.fn().mockResolvedValue(['c']);

    // Prime all three reads the write-side bump has to reach.
    await getCachedPublishedJourneys(
      cache,
      orgId,
      { featured: true, limit: 4 },
      featured
    );
    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, rail);
    await getCachedPublishedCourses(cache, orgId, courses);

    // All three hit cache on repeat.
    await getCachedPublishedJourneys(
      cache,
      orgId,
      { featured: true, limit: 4 },
      featured
    );
    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, rail);
    await getCachedPublishedCourses(cache, orgId, courses);
    expect(featured).toHaveBeenCalledTimes(1);
    expect(rail).toHaveBeenCalledTimes(1);
    expect(courses).toHaveBeenCalledTimes(1);

    // The write-side invalidation, exactly as `bumpOrgJourneysVersion` performs
    // it (portal save / offer / featured / cover / curriculum) and as
    // `bumpOrgContentVersion` performs it on content publish.
    await cache.invalidate(CacheType.COLLECTION_ORG_JOURNEYS(orgId));

    await getCachedPublishedJourneys(
      cache,
      orgId,
      { featured: true, limit: 4 },
      featured
    );
    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, rail);
    await getCachedPublishedCourses(cache, orgId, courses);
    expect(featured).toHaveBeenCalledTimes(2);
    expect(rail).toHaveBeenCalledTimes(2);
    expect(courses).toHaveBeenCalledTimes(2);
  });

  it('ORG ISOLATION: invalidating one org does not stale another', async () => {
    const a = vi.fn().mockResolvedValue(['a']);
    const b = vi.fn().mockResolvedValue(['b']);

    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, a);
    await getCachedPublishedJourneys(cache, 'org-2', { limit: 12 }, b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    await cache.invalidate(CacheType.COLLECTION_ORG_JOURNEYS('org-1'));

    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, a);
    await getCachedPublishedJourneys(cache, 'org-2', { limit: 12 }, b);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('KEY SEPARATION: the portal key is distinct from the content key', async () => {
    // The whole reason for a separate version key: a portal publish must NOT
    // stale every cached content filter combo. This asserts the two keys are
    // independent — which is also why `bumpOrgContentVersion` has to invalidate
    // the portal key EXPLICITLY (content publish changes `practiceCount`).
    const orgId = 'org-1';
    const portals = vi.fn().mockResolvedValue(['p']);

    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, portals);
    expect(portals).toHaveBeenCalledTimes(1);

    // Bumping ONLY the content key leaves the portal slot warm...
    await cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(orgId));
    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, portals);
    expect(portals).toHaveBeenCalledTimes(1);

    // ...so reaching it requires the portal key, as content.ts now does.
    await cache.invalidate(CacheType.COLLECTION_ORG_JOURNEYS(orgId));
    await getCachedPublishedJourneys(cache, orgId, { limit: 12 }, portals);
    expect(portals).toHaveBeenCalledTimes(2);
  });

  it('uses the 300s default TTL, matching the public content reads', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, fetcher);

    const dataPut = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as string).startsWith('cache:journeys:published:')
    );
    expect(dataPut?.[2]).toMatchObject({ expirationTtl: 300 });
  });

  it('accepts a ttl override', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    await getCachedPublishedJourneys(cache, 'org-1', { limit: 12 }, fetcher, {
      ttl: 60,
    });

    const dataPut = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as string).startsWith('cache:journeys:published:')
    );
    expect(dataPut?.[2]).toMatchObject({ expirationTtl: 60 });
  });

  it('courses rail takes its own data slot (different projection, same rows)', async () => {
    const journeys = vi.fn().mockResolvedValue(['journey-shape']);
    const courses = vi.fn().mockResolvedValue(['course-shape']);

    const a = await getCachedPublishedJourneys(
      cache,
      'org-1',
      { limit: 12 },
      journeys
    );
    const b = await getCachedPublishedCourses(cache, 'org-1', courses);

    // `JourneyCardView` and `CourseCardSummary` must never satisfy each other.
    expect(a).toEqual(['journey-shape']);
    expect(b).toEqual(['course-shape']);
    expect(journeys).toHaveBeenCalledTimes(1);
    expect(courses).toHaveBeenCalledTimes(1);
  });
});
