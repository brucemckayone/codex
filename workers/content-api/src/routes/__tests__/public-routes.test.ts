/**
 * `GET /api/content/public` through the REAL route + real `procedure()`
 * resolver, against the REAL Miniflare `CACHE_KV` binding (Codex-e32xz).
 *
 * WHY THIS FILE EXISTS. `public-cache.test.ts` unit-tests the cache wrapper's
 * key semantics; it cannot see the RESPONSE ENVELOPE, and the envelope is where
 * this endpoint was broken:
 *
 *   The handler's fetcher built a `PaginatedResult` and handed that instance
 *   straight to `cache.get`, which round-trips it through
 *   JSON.stringify/JSON.parse. A cache HIT therefore returned a PLAIN object,
 *   `procedure()`'s `result instanceof PaginatedResult` check failed, and the
 *   list envelope silently degraded from `{ items, pagination }` to
 *   `{ data: { items, pagination } }` — which is not what
 *   `api.content.getPublicContent` (typed `PaginatedListResponse`) reads.
 *
 * It was invisible in production only because of the OTHER half of Codex-e32xz:
 * `VersionedCache` wrote its data slot as an un-awaited promise, workerd
 * cancelled it when the response returned, and so there was never a hit to
 * degrade (62 version keys, 0 data keys in `CACHE_KV_PRODUCTION`). Fixing the
 * write is what makes this reachable, so the two must be fixed together.
 *
 * Falsifiability (verified by reverting the fix): with the old handler these
 * tests fail two ways at once — `expect(body).not.toHaveProperty('data')` fails
 * on the cache hit, AND the run reports "Isolated storage failed" because the
 * un-awaited put is still in flight when the test ends. That storage error is
 * the same symptom that made `journeys-routes.test.ts` substitute an in-memory
 * KV for the real binding.
 *
 * SCOPE LIMIT, stated plainly: this file does NOT falsify the `waitUntil` half
 * of the fix. An in-process Miniflare put is not cancelled the way workerd
 * cancels one at end-of-response, so the "service runs ONCE" assertion below
 * can pass even with the write left floating. The rigorous proof for the
 * registration/completion contract lives in
 * `packages/cache/src/__tests__/versioned-cache-waituntil.test.ts`, which gates
 * the put on a deferred and asserts the ORDER.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Service spies (replace the real @codex/content classes) ─────────────────

const contentSpies = {
  listPublic: vi.fn(),
  // The registry calls `setCache(...)` on the constructed instance, so the spy
  // object must answer it or the getter throws before the handler runs.
  setCache: vi.fn(),
};

const categorySpies = {
  listPublicForOrg: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
    CategoriesService: vi.fn(() => categorySpies),
  };
});

// Import the route AFTER the mock so the real registry resolves the mocked class.
import publicRoutes from '../public';

const ORG_ID = '4d111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '4d222222-2222-4222-8222-222222222222';
const R2_PUBLIC_URL_BASE = 'http://localhost:4100';

/** The `listPublic` projection — `mediaItem: null` keeps `resolveR2Urls` a no-op. */
const ROWS = {
  items: [
    {
      id: '4d000000-0000-4000-8000-000000000001',
      title: 'First light',
      slug: 'first-light',
      contentType: 'video',
      mediaItem: null,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE,
} as unknown as typeof env;

function buildApp() {
  const app = new Hono();
  app.route('/api/content/public', publicRoutes);
  return app;
}

async function dispatch(
  path: string,
  envOverrides?: Record<string, unknown>
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp().fetch(
    new Request(`http://content-api.test${path}`),
    envOverrides
      ? ({ ...testEnv, ...envOverrides } as unknown as typeof env)
      : testEnv,
    ec
  );
  // Drains the cache write the handler registered on `waitUntil`. In workerd
  // proper, an un-registered put is cancelled here instead — which is why
  // production had 0 data keys.
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  contentSpies.listPublic.mockResolvedValue(ROWS);
  categorySpies.listPublicForOrg.mockResolvedValue([]);
  // No KV reset needed — `isolatedStorage` rolls back writes between tests.
});

describe('GET /api/content/public — list envelope survives a cache HIT', () => {
  it('returns the top-level { items, pagination } envelope on a cache MISS', async () => {
    const res = await dispatch(`/api/content/public?orgId=${ORG_ID}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: ROWS.items,
      pagination: ROWS.pagination,
    });
  });

  it('returns the SAME envelope on the cache HIT — not { data: { items } }', async () => {
    await dispatch(`/api/content/public?orgId=${ORG_ID}`);
    const second = await dispatch(`/api/content/public?orgId=${ORG_ID}`);

    expect(second.status).toBe(200);
    const body = (await second.json()) as Record<string, unknown>;

    // The regression this file exists for: a cached PaginatedResult loses its
    // class identity across JSON, so procedure() would wrap it as a single item.
    expect(body).not.toHaveProperty('data');
    expect(body).toEqual({ items: ROWS.items, pagination: ROWS.pagination });
  });

  it('actually HITS: the DB-backed service runs ONCE across two reads', async () => {
    await dispatch(`/api/content/public?orgId=${ORG_ID}`);
    await dispatch(`/api/content/public?orgId=${ORG_ID}`);

    // Proves the cached branch is REACHED end-to-end (real KV, real resolver).
    // See the scope limit in the file header: in-process Miniflare does not
    // cancel a floating put, so this assertion alone does not prove the
    // `waitUntil` registration — the cache package's test does that.
    expect(contentSpies.listPublic).toHaveBeenCalledTimes(1);
  });

  it('ORG ISOLATION: a second org is a miss, never a hit on the first org’s rows', async () => {
    await dispatch(`/api/content/public?orgId=${ORG_ID}`);
    await dispatch(`/api/content/public?orgId=${OTHER_ORG_ID}`);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(2);
    expect(contentSpies.listPublic).toHaveBeenLastCalledWith(
      expect.objectContaining({ orgId: OTHER_ORG_ID })
    );
  });

  it('a search query bypasses the cache entirely and still returns the list envelope', async () => {
    const first = await dispatch(
      `/api/content/public?orgId=${ORG_ID}&search=light`
    );
    const second = await dispatch(
      `/api/content/public?orgId=${ORG_ID}&search=light`
    );

    expect(await first.json()).toEqual({
      items: ROWS.items,
      pagination: ROWS.pagination,
    });
    expect(await second.json()).toEqual({
      items: ROWS.items,
      pagination: ROWS.pagination,
    });
    // `shouldCachePublicContentQuery` excludes search — both reads hit the DB.
    expect(contentSpies.listPublic).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/content/public/categories — cache write survives', () => {
  it('serves the second read from cache (single-item envelope, unchanged)', async () => {
    const CATEGORY_ID = '4d000000-0000-4000-8000-0000000000c1';
    const rows = [
      {
        id: CATEGORY_ID,
        name: 'Ceremony',
        slug: 'ceremony',
        description: null,
        icon: null,
        sortOrder: 0,
        coverImageKey: null,
      },
    ];
    categorySpies.listPublicForOrg.mockResolvedValue(rows);

    const first = await dispatch(
      `/api/content/public/categories?orgId=${ORG_ID}`
    );
    const second = await dispatch(
      `/api/content/public/categories?orgId=${ORG_ID}`
    );

    const expected = {
      data: [
        {
          id: CATEGORY_ID,
          name: 'Ceremony',
          slug: 'ceremony',
          description: null,
          icon: null,
          sortOrder: 0,
          coverImageUrl: null,
        },
      ],
    };
    expect(await first.json()).toEqual(expected);
    expect(await second.json()).toEqual(expected);
    expect(categorySpies.listPublicForOrg).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Codex-1g5lh.13 — thumbnailUrl and hlsPreviewUrl come from DIFFERENT buckets
//
// `resolveR2Urls` builds both fields in one function, and before this change it
// built both from `R2_PUBLIC_URL_BASE` — the ASSETS host. But `hlsPreviewKey`
// is a MEDIA-bucket key, so the assets host had no object to serve and every
// public HLS preview 404'd on its manifest in production while its poster
// loaded fine. These cases pin the split, in both directions: the preview may
// move to a media-preview host, and the thumbnail may NOT follow it there.
//
// `/discover` is used for the split assertions on purpose — it is the one
// uncached branch, so no KV slot can carry a URL built under a different env.
// ═══════════════════════════════════════════════════════════════════════════

const MEDIA_PREVIEW_BASE = 'https://cdn-media-preview.test';
const THUMB_KEY = 'creator-1/media-thumbnails/media-1/md.webp';
const PREVIEW_KEY = 'creator-1/hls/media-1/preview/preview.m3u8';

/** A row with BOTH kinds of key, which is what a transcoded video really has. */
const ROWS_WITH_MEDIA = {
  items: [
    {
      id: '4d000000-0000-4000-8000-0000000000a1',
      title: 'Bone Deep',
      slug: 'bone-deep',
      contentType: 'video',
      mediaItem: {
        id: '4d000000-0000-4000-8000-0000000000b1',
        thumbnailKey: THUMB_KEY,
        hlsPreviewKey: PREVIEW_KEY,
      },
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

type MediaUrls = { thumbnailUrl: string | null; hlsPreviewUrl: string | null };

async function firstMediaItem(
  path: string,
  envOverrides?: Record<string, unknown>
): Promise<MediaUrls> {
  const res = await dispatch(path, envOverrides);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    items: { mediaItem: MediaUrls }[];
  };
  const [first] = body.items;
  if (!first) throw new Error(`no items returned from ${path}`);
  return first.mediaItem;
}

describe('resolveR2Urls — the assets host and the preview host are separate', () => {
  beforeEach(() => {
    contentSpies.listPublic.mockResolvedValue(ROWS_WITH_MEDIA);
  });

  it('DEFAULT (no media base set): both resolve on the assets host', async () => {
    // This is what production runs. It is only correct because apps/web's
    // cdn-proxy now serves the `{creatorId}/hls/{mediaId}/preview/` prefix from
    // a read-only media binding — so the assets host answers for previews.
    const media = await firstMediaItem('/api/content/public/discover');

    expect(media.thumbnailUrl).toBe(`${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`);
    expect(media.hlsPreviewUrl).toBe(`${R2_PUBLIC_URL_BASE}/${PREVIEW_KEY}`);
  });

  it('with R2_PUBLIC_MEDIA_URL_BASE set, the PREVIEW moves and the THUMBNAIL does not', async () => {
    const media = await firstMediaItem('/api/content/public/discover', {
      R2_PUBLIC_MEDIA_URL_BASE: MEDIA_PREVIEW_BASE,
    });

    // The preview follows the media base…
    expect(media.hlsPreviewUrl).toBe(`${MEDIA_PREVIEW_BASE}/${PREVIEW_KEY}`);
    // …and the thumbnail stays on the assets host. THE TRAP: both fields are
    // built in one function, so a fix that threads the new base through
    // wholesale sends every thumbnail to a bucket that does not hold it.
    expect(media.thumbnailUrl).toBe(`${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`);
    expect(media.thumbnailUrl).not.toContain(MEDIA_PREVIEW_BASE);
  });

  it('the org-scoped list splits the bases the same way', async () => {
    const media = await firstMediaItem(
      `/api/content/public?orgId=${ORG_ID}&limit=1`,
      { R2_PUBLIC_MEDIA_URL_BASE: MEDIA_PREVIEW_BASE }
    );

    expect(media.hlsPreviewUrl).toBe(`${MEDIA_PREVIEW_BASE}/${PREVIEW_KEY}`);
    expect(media.thumbnailUrl).toBe(`${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`);
  });

  it('no base at all yields nulls, never a raw R2 key on the wire', async () => {
    const media = await firstMediaItem('/api/content/public/discover', {
      R2_PUBLIC_URL_BASE: undefined,
    });

    expect(media.thumbnailUrl).toBeNull();
    expect(media.hlsPreviewUrl).toBeNull();
  });

  it('a media base with no assets base still never invents a thumbnail host', async () => {
    // Guards the inverse mistake: the fallback runs assets → media, not the
    // other way round, so an unset assets base must not borrow the media one.
    const media = await firstMediaItem('/api/content/public/discover', {
      R2_PUBLIC_URL_BASE: undefined,
      R2_PUBLIC_MEDIA_URL_BASE: MEDIA_PREVIEW_BASE,
    });

    expect(media.thumbnailUrl).toBeNull();
    expect(media.hlsPreviewUrl).toBe(`${MEDIA_PREVIEW_BASE}/${PREVIEW_KEY}`);
  });
});
