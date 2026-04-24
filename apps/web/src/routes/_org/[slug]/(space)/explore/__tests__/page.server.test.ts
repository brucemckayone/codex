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
  listMock,
  getPublicContentMock,
  getPublicCreatorsMock,
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
    listMock: vi.fn(),
    getPublicContentMock: vi.fn(),
    getPublicCreatorsMock: vi.fn(),
    cacheGetMock,
    VersionedCacheMock,
  };
});

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    content: { list: listMock },
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
    listMock.mockResolvedValue({ items: [], pagination: { total: 0 } });
    getPublicContentMock.mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    getPublicCreatorsMock.mockResolvedValue({ items: [], pagination: {} });
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
      expect(listMock).toHaveBeenCalled();
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
      expect(listMock).toHaveBeenCalled();
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
      expect(listMock).toHaveBeenCalled();
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
      expect(listMock).not.toHaveBeenCalled();
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
