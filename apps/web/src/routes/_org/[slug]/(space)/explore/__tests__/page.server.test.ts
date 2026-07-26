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

vi.mock('$lib/server/cache', () => ({
  CACHE_HEADERS: {
    PRIVATE: { 'cache-control': 'private' },
    DYNAMIC_PUBLIC: { 'cache-control': 'public, max-age=60' },
  },
}));

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
      // Per-combo type carries sort + contentType + page.
      expect(typeArg).toMatch(/^content:auth:popular:/);
    });

    it('includes sort + contentType + page in the cache type', async () => {
      const { load } = await import('../+page.server');

      await load(
        baseInput({
          user: { id: 'user-1' },
          url: 'http://lvh.me:3000/explore?sort=top-selling&type=video&page=3',
        })
      );

      const [, typeArg] = cacheGetMock.mock.calls[0];
      expect(typeArg).toBe('content:auth:top-selling:video:3');
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
          'cache-control': expect.stringContaining('private'),
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

      expect(listPublishedCoursesMock).toHaveBeenCalledWith(ORG_ID);
      // Narrow out the `void` half of the PageServerLoad return union.
      if (!result) throw new Error('load returned no data');
      expect(result.journeys).toEqual(courses);
    });

    it('degrades to an empty rail when the journeys read rejects', async () => {
      listPublishedCoursesMock.mockRejectedValueOnce(new Error('upstream 500'));

      const { load } = await import('../+page.server');
      const result = await load(
        baseInput({ user: null, url: 'http://lvh.me:3000/explore' })
      );

      // A failed journeys read must NOT crash the page — the load resolves
      // with an empty rail and the content path is unaffected.
      if (!result) throw new Error('load returned no data');
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
