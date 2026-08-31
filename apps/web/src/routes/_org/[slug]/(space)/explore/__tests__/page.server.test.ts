/**
 * Explore page server load — cache wiring tests.
 *
 * Locks the post-fix behavior:
 * - Authenticated sort path (popular/top-selling) uses
 *   `CacheType.COLLECTION_ORG_CONTENT(orgId)` as the cache `id` so every
 *   combo shares the version key that `cache.invalidate(...)` bumps on
 *   publish.
 * - Unauthenticated sorts delegate to `getPublicContent` (no separate
 *   KV cache in this file — the worker endpoint handles it).
 * - Search or creator filters bypass the KV cache (variant explosion).
 * - ORG_CONTENT_SORTED is no longer referenced anywhere.
 */

import { CacheType } from '@codex/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// vi.hoisted lets the factory below reference these before module init.
const {
  browseMock,
  getPublicContentMock,
  getPublicCreatorsMock,
  getPublicCategoriesMock,
  listPublishedCoursesMock,
  cacheGetMock,
  VersionedCacheMock,
} = vi.hoisted(() => {
  const cacheGetMock = vi.fn();
  // Declared as a real class so `new VersionedCache(...)` in the route
  // doesn't throw "not a constructor".
  class VersionedCacheMock {
    get = cacheGetMock;
  }
  return {
    browseMock: vi.fn(),
    getPublicContentMock: vi.fn(),
    getPublicCreatorsMock: vi.fn(),
    getPublicCategoriesMock: vi.fn(),
    listPublishedCoursesMock: vi.fn(),
    cacheGetMock,
    VersionedCacheMock,
  };
});

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    // /explore auth path now hits the browse endpoint (org-scoped, not
    // creator-scoped). The studio `list()` endpoint is no longer touched
    // from explore — verifying that boundary is part of this test's job.
    content: { browse: browseMock },
    // Journeys rail (SPEC §8.5) — the org's published courses, fetched as a
    // separate public read after the content path.
    access: { listPublishedCourses: listPublishedCoursesMock },
  })),
}));

vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: getPublicContentMock,
}));

vi.mock('$lib/remote/org.remote', () => ({
  getPublicCreators: getPublicCreatorsMock,
}));

// Category strip options. MUST be mocked: the real `query()` calls
// `getRequestEvent()`, which has no app.hooks in a unit test, and the load's
// try/catch would swallow the failure into an empty strip — a green suite over
// a silently broken control.
vi.mock('$lib/remote/categories.remote', () => ({
  getPublicCategories: getPublicCategoriesMock,
}));

// Derived from the real shared presets rather than hand-typed. Every one of
// these stubs used to carry a FAKE value ('public, max-age=60' when the real
// preset said 300s), so neither removing a preset nor changing one could fail
// this test. `@codex/constants` has zero imports, so pulling it into the mock
// factory is safe here.
vi.mock('$lib/server/cache', async () => {
  const { CACHE_PRESETS } = await import('@codex/constants');
  return {
    CACHE_HEADERS: {
      PRIVATE: { 'Cache-Control': CACHE_PRESETS.private },
      DYNAMIC_PUBLIC: { 'Cache-Control': CACHE_PRESETS.public },
    },
  };
});

vi.mock('@codex/cache', async () => {
  const actual =
    await vi.importActual<typeof import('@codex/cache')>('@codex/cache');
  return {
    ...actual,
    VersionedCache: VersionedCacheMock,
  };
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

type LoadInput = Parameters<typeof import('../+page.server').load>[0];

const ORG_ID = 'org-1';
const ORG_SLUG = 'bruce-studio';

const baseInput = (overrides: {
  user?: { id: string } | null;
  url?: string;
  hasCacheKv?: boolean;
}): LoadInput => {
  const url = new URL(overrides.url ?? 'http://lvh.me:3000/explore');
  return {
    url,
    params: { slug: ORG_SLUG },
    parent: async () => ({ org: { id: ORG_ID, slug: ORG_SLUG } }),
    locals: { user: overrides.user ?? null },
    platform: overrides.hasCacheKv === false ? {} : { env: { CACHE_KV: {} } },
    cookies: {},
    setHeaders: vi.fn(),
  } as unknown as LoadInput;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('explore +page.server.ts — cache wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browseMock.mockResolvedValue({ items: [], pagination: { total: 0 } });
    getPublicContentMock.mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    getPublicCreatorsMock.mockResolvedValue({ items: [], pagination: {} });
    getPublicCategoriesMock.mockResolvedValue([]);
    listPublishedCoursesMock.mockResolvedValue([]);
    // Default: cache.get passes through to the fetcher so list/getPublicContent
    // is called normally. Individual tests override to simulate hits.
    cacheGetMock.mockImplementation(
      async (_id: string, _type: string, fetcher: () => Promise<unknown>) =>
        fetcher()
    );
  });

  describe('authenticated path (popular / top-selling sort)', () => {
    it('passes CacheType.COLLECTION_ORG_CONTENT(orgId) as the cache id (regression guard for id/type swap)', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular',
        })
      );

      expect(cacheGetMock).toHaveBeenCalledTimes(1);
      const [idArg, typeArg] = cacheGetMock.mock.calls[0];
      // Shared version key — one per org — is what `publish` bumps.
      expect(idArg).toBe(CacheType.COLLECTION_ORG_CONTENT(ORG_ID));
      // Per-combo type carries sort + contentType + category + page.
      expect(typeArg).toMatch(/^content:auth:popular:/);
    });

    it('includes sort + contentType + category + page in the cache type', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=top-selling&type=video&category=ritual&page=3',
        })
      );

      const [, typeArg] = cacheGetMock.mock.calls[0];
      expect(typeArg).toBe('content:auth:top-selling:video:ritual:3');
    });

    it('varies the cache type by category so two filter combos cannot collide', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&category=ritual',
        })
      );
      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&category=breath',
        })
      );

      const [, firstType] = cacheGetMock.mock.calls[0];
      const [, secondType] = cacheGetMock.mock.calls[1];
      expect(firstType).toBe('content:auth:popular:all:ritual:1');
      expect(secondType).toBe('content:auth:popular:all:breath:1');
    });

    it('forwards category to the browse endpoint (it is part of contentQuerySchema)', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&category=ritual',
        })
      );

      const params = browseMock.mock.calls[0][0] as URLSearchParams;
      expect(params.get('category')).toBe('ritual');
    });

    it('downgrades an auth-only sort to newest when `featured` is requested', async () => {
      // The browse endpoint has no `featured` filter, so honouring the sort
      // would silently return the whole catalogue behind a "Featured" chip.
      // The filter is the explicit ask, so the sort yields and we fall through
      // to the public branch, which does filter by featured.
      const { load } = await import('../+page.server');

      const result = await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&featured=true',
        })
      );

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      expect(browseMock).not.toHaveBeenCalled();
      expect(getPublicContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ featured: true, sort: 'newest' })
      );
      expect(result.filters.sort).toBe('newest');
    });

    it('uses 180s TTL for auth-sort cache entries', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular',
        })
      );

      const [, , , opts] = cacheGetMock.mock.calls[0];
      expect(opts).toMatchObject({ ttl: 180 });
    });

    it('bypasses the cache when search is present', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&q=hello',
        })
      );

      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(browseMock).toHaveBeenCalled();
    });

    it('bypasses the cache when creator filter is present', async () => {
      // Creator resolution happens via getPublicCreators — provide a match
      // so the creator filter is active.
      getPublicCreatorsMock.mockResolvedValueOnce({
        items: [
          {
            id: 'creator-1',
            name: 'Creator',
            username: 'creator1',
            avatarUrl: null,
            bio: null,
            socialLinks: null,
            role: 'creator',
            contentCount: 0,
          },
        ],
        pagination: {},
      });

      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular&creator=creator1',
        })
      );

      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(browseMock).toHaveBeenCalled();
    });

    it('bypasses the cache when CACHE_KV is not bound', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=popular',
          hasCacheKv: false,
        })
      );

      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(browseMock).toHaveBeenCalled();
    });
  });

  describe('unauthenticated path (newest / oldest / title sort)', () => {
    it('delegates to getPublicContent and does NOT use the auth-sort cache', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: null,
          url: 'http://lvh.me:3000/explore?sort=newest',
        })
      );

      expect(getPublicContentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_ID,
          sort: 'newest',
        })
      );
      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(browseMock).not.toHaveBeenCalled();
    });

    it('downgrades auth-only sorts to newest for unauthenticated users', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: null,
          url: 'http://lvh.me:3000/explore?sort=popular',
        })
      );

      // Auth-only sort silently downgraded → public path fires with newest.
      expect(getPublicContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'newest' })
      );
    });
  });

  describe('cache-header poisoning regression (Codex-vn49p)', () => {
    it('sets a PRIVATE (non-shared) cache header AFTER getPublicContent resolves on the unauthenticated path', async () => {
      const callOrder: string[] = [];
      getPublicContentMock.mockImplementationOnce(async () => {
        callOrder.push('getPublicContent');
        return { items: [], pagination: { total: 0 } };
      });

      const input = baseInput({
        user: null,
        url: 'http://lvh.me:3000/explore?sort=newest',
      });
      const setHeadersSpy = input.setHeaders as ReturnType<typeof vi.fn>;
      setHeadersSpy.mockImplementation(() => {
        callOrder.push('setHeaders');
      });

      const { load } = await import('../+page.server');
      await load(input);

      // This page is auth-varying (the org layout injects `user`), so it now
      // emits a PRIVATE (non-shared-cacheable) header instead of a `public`
      // one — shared caches key by URL not Cookie and would serve the anon
      // copy to signed-in users. setHeaders still runs after the fetch.
      expect(callOrder).toEqual(['getPublicContent', 'setHeaders']);
      expect(setHeadersSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          'Cache-Control': expect.stringContaining('private'),
        })
      );
    });

    it('does NOT call setHeaders when getPublicContent rejects on the unauthenticated path', async () => {
      getPublicContentMock.mockRejectedValueOnce(new Error('upstream 400'));

      const input = baseInput({
        user: null,
        url: 'http://lvh.me:3000/explore?sort=newest',
      });
      const setHeadersSpy = input.setHeaders as ReturnType<typeof vi.fn>;

      const { load } = await import('../+page.server');
      await expect(load(input)).rejects.toThrow('upstream 400');

      // Critical guarantee: an error response must inherit SvelteKit's default
      // no-cache headers, NEVER `public, max-age=300`. Otherwise the CDN
      // caches the error page for every subsequent visitor.
      expect(setHeadersSpy).not.toHaveBeenCalled();
    });
  });

  describe('journeys rail fetch (SPEC §8.5)', () => {
    it('fetches the org journeys and returns them in the load data', async () => {
      const courses = [
        {
          id: 'course-1',
          slug: 'rootwork',
          title: 'Rootwork',
          kicker: 'A guided descent',
          lede: 'Return to the body.',
          guideName: 'Alex Creator',
          priceCents: 4900,
        },
      ];
      listPublishedCoursesMock.mockResolvedValueOnce(courses);

      const { load } = await import('../+page.server');
      const result = await load(
        baseInput({ user: null, url: 'http://lvh.me:3000/explore' })
      );

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      expect(listPublishedCoursesMock).toHaveBeenCalledWith(ORG_ID);
      expect(result.journeys).toEqual(courses);
    });

    it('degrades to an empty rail when the journeys read rejects', async () => {
      listPublishedCoursesMock.mockRejectedValueOnce(new Error('upstream 500'));

      const { load } = await import('../+page.server');
      const result = await load(
        baseInput({ user: null, url: 'http://lvh.me:3000/explore' })
      );

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      // A failed journeys read must NOT crash the page — the load resolves
      // with an empty rail and the content path is unaffected.
      expect(result.journeys).toEqual([]);
      expect(getPublicContentMock).toHaveBeenCalled();
    });

    it('runs AFTER the content-path setHeaders (never reorders the poisoning guard)', async () => {
      const callOrder: string[] = [];
      getPublicContentMock.mockImplementationOnce(async () => {
        callOrder.push('getPublicContent');
        return { items: [], pagination: { total: 0 } };
      });
      listPublishedCoursesMock.mockImplementationOnce(async () => {
        callOrder.push('listPublishedCourses');
        return [];
      });

      const input = baseInput({
        user: null,
        url: 'http://lvh.me:3000/explore?sort=newest',
      });
      const setHeadersSpy = input.setHeaders as ReturnType<typeof vi.fn>;
      setHeadersSpy.mockImplementation(() => {
        callOrder.push('setHeaders');
      });

      const { load } = await import('../+page.server');
      await load(input);

      // Content fetch → content setHeaders → THEN journeys. The journeys read
      // never precedes or gates the content-path cache header.
      expect(callOrder).toEqual([
        'getPublicContent',
        'setHeaders',
        'listPublishedCourses',
      ]);
    });

    it('does NOT block the content path when the content fetch rejects (journeys never runs)', async () => {
      getPublicContentMock.mockRejectedValueOnce(new Error('upstream 400'));

      const input = baseInput({
        user: null,
        url: 'http://lvh.me:3000/explore?sort=newest',
      });
      const { load } = await import('../+page.server');
      await expect(load(input)).rejects.toThrow('upstream 400');

      // The content path throws before the journeys read is reached, so the
      // rail fetch never fires (and cannot mask the content error).
      expect(listPublishedCoursesMock).not.toHaveBeenCalled();
    });
  });

  /**
   * Category strip options.
   *
   * Regression guard for the blocker where the strip was derived from
   * `item.category` — a legacy free-text DISPLAY NAME — while both filter paths
   * match `categories.slug`. Every pill returned 0 results ("Somatics" → 0,
   * "somatics" → 7) and any category containing a space or `&` produced a full
   * HTTP 400 page, because `publicContentQueryParamsSchema.category` only
   * accepts `^[\p{L}\p{N}-]+$`.
   *
   * Falsifiability: the name/slug pairing test fails if the load stops
   * returning `categoryOptions` or flattens it back to bare names, and the
   * "space and ampersand" test fails if any writable value the strip could
   * produce would be rejected by that regex.
   */
  describe('category strip options (taxonomy, not a scrape of the page)', () => {
    const TAXONOMY = [
      { id: 'c1', name: 'Ancestral Medicine', slug: 'ancestral-medicine' },
      { id: 'c2', name: 'Sound & Vibration', slug: 'sound-vibration' },
      { id: 'c3', name: 'Somatics', slug: 'somatics' },
    ];

    it('returns the org taxonomy as name+slug pairs, ordered as served', async () => {
      getPublicCategoriesMock.mockResolvedValueOnce(TAXONOMY);
      const { load } = await import('../+page.server');

      const result = await load(baseInput({ user: null }));

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      expect(getPublicCategoriesMock).toHaveBeenCalledWith(ORG_ID);
      // Order is the curator's `sortOrder`, already applied by the endpoint —
      // the load must NOT re-sort it.
      expect(result.categoryOptions).toEqual([
        { name: 'Ancestral Medicine', slug: 'ancestral-medicine' },
        { name: 'Sound & Vibration', slug: 'sound-vibration' },
        { name: 'Somatics', slug: 'somatics' },
      ]);
    });

    it('every slug the strip can write survives the public query schema charset', async () => {
      // The exact guard from content.remote.ts. A display name would fail this
      // for two of the three fixtures; a slug passes for all three.
      const SLUG_CHARSET = /^[\p{L}\p{N}-]+$/u;
      getPublicCategoriesMock.mockResolvedValueOnce(TAXONOMY);
      const { load } = await import('../+page.server');

      const result = await load(baseInput({ user: null }));

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      for (const option of result.categoryOptions) {
        expect(option.slug).toMatch(SLUG_CHARSET);
      }
      // Sanity: the names these slugs render as would NOT have survived — this
      // is the difference the fix turns on.
      expect('Ancestral Medicine').not.toMatch(SLUG_CHARSET);
      expect('Sound & Vibration').not.toMatch(SLUG_CHARSET);
    });

    it('forwards the ?category= slug to the public content query unchanged', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: null,
          url: 'http://lvh.me:3000/explore?category=sound-vibration',
        })
      );

      expect(getPublicContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'sound-vibration' })
      );
    });

    it('degrades to an empty strip (never throws) when the taxonomy read fails', async () => {
      getPublicCategoriesMock.mockRejectedValueOnce(
        new Error('categories 500')
      );
      const { load } = await import('../+page.server');

      const result = await load(baseInput({ user: null }));

      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');

      expect(result.categoryOptions).toEqual([]);
      // The content path is untouched by a taxonomy failure.
      expect(result.content.items).toEqual([]);
    });

    it('starts the taxonomy read BEFORE the content fetch resolves (overlapping, not serial)', async () => {
      // Guards the latency claim in the load: awaiting the taxonomy AFTER the
      // content fetch added a serial upstream hop to a public page's critical
      // path. Dispatch order is the observable part of "runs concurrently".
      const order: string[] = [];
      let releaseContent: (v: unknown) => void = () => {};
      getPublicContentMock.mockImplementationOnce(() => {
        order.push('content:start');
        return new Promise((resolve) => {
          releaseContent = () => {
            order.push('content:end');
            resolve({ items: [], pagination: { total: 0 } });
          };
        });
      });
      getPublicCategoriesMock.mockImplementationOnce(async () => {
        order.push('categories:start');
        return [];
      });

      const { load } = await import('../+page.server');
      const pending = load(baseInput({ user: null }));
      // Let the synchronous part of the load run and both requests dispatch.
      await Promise.resolve();
      await Promise.resolve();
      releaseContent(null);
      await pending;

      // The taxonomy request must be in flight before the content fetch settles.
      expect(order.indexOf('categories:start')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('categories:start')).toBeLessThan(
        order.indexOf('content:end')
      );
    });
  });

  describe('architectural regression guards', () => {
    it('does NOT reference the deleted CacheType.ORG_CONTENT_SORTED constant', async () => {
      const cacheKeys = await import('@codex/cache');
      // Confirms the legacy global cache type is gone so the cached code
      // path can't accidentally reintroduce the broken pattern.
      expect(
        (cacheKeys.CacheType as Record<string, unknown>).ORG_CONTENT_SORTED
      ).toBeUndefined();
    });
  });
});
