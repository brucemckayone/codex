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

/**
 * The `listPublic` projection — `mediaItem: null` keeps `toPublicItem` a
 * no-op. `organization: null` is a personal piece: the relation is always
 * present on a real row, null when the piece has no org.
 */
const ROWS = {
  items: [
    {
      id: '4d000000-0000-4000-8000-000000000001',
      title: 'First light',
      slug: 'first-light',
      contentType: 'video',
      creator: { id: 'creator-1', name: 'Ada' },
      mediaItem: null,
      organization: null,
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

/**
 * The creator form backs a creator's public profile, catalogue and detail
 * page (Codex-osuqt). The schema used to refuse it, so the web loaders fell
 * back to the studio list, which lists the SIGNED-IN user's own content.
 */
describe('GET /api/content/public?creatorId — a creator without an org (Codex-osuqt)', () => {
  // A BetterAuth user id: 32 alphanumerics, NOT a uuid. The schema first
  // shipped as uuidSchema, which refused every real creator.
  const CREATOR_ID = 'a62da3ad5c94736a88f90ff5c666143c';

  it("returns the list envelope and asks the service for that creator's content only", async () => {
    const res = await dispatch(`/api/content/public?creatorId=${CREATOR_ID}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: ROWS.items,
      pagination: ROWS.pagination,
    });
    const [query] = contentSpies.listPublic.mock.calls[0] ?? [];
    expect(query).toMatchObject({ creatorId: CREATOR_ID });
    expect(query).not.toHaveProperty('orgId');
  });

  it('is not KV-cached: the 60s CDN window is its only cache', async () => {
    const first = await dispatch(`/api/content/public?creatorId=${CREATOR_ID}`);
    await dispatch(`/api/content/public?creatorId=${CREATOR_ID}`);

    // `shouldCachePublicContentQuery` skips any query naming a creator, so
    // both reads reach the service and a publish shows within the CDN window.
    expect(contentSpies.listPublic).toHaveBeenCalledTimes(2);
    expect(first.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=60'
    );
  });

  // The case the rule exists for: with an org named, the read would take the KV
  // branch, and the slot key carries no creator, so a creator-filtered read
  // would be served the whole org's list. The creatorId-only case above
  // skips KV for want of an orgId whatever the rule says.
  it('is not KV-cached with an org named too', async () => {
    const query = `/api/content/public?orgId=${ORG_ID}&creatorId=${CREATOR_ID}`;
    await dispatch(query);
    await dispatch(query);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(2);
  });

  it('refuses a creatorId that is not a user id', async () => {
    const res = await dispatch('/api/content/public?creatorId=x%3Afeat%3Atrue');

    expect(res.status).toBe(400);
    expect(contentSpies.listPublic).not.toHaveBeenCalled();
  });

  it('still refuses a query with no scope at all', async () => {
    const res = await dispatch('/api/content/public');

    expect(res.status).toBe(400);
    expect(contentSpies.listPublic).not.toHaveBeenCalled();
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

  // Org delete invalidates under the lowercase DB id, so an uppercase read must
  // key the same slot, or it caches where no invalidation reaches.
  it('keys an uppercase org id as the lowercase one', async () => {
    categorySpies.listPublicForOrg.mockResolvedValue([]);

    await dispatch(
      `/api/content/public/categories?orgId=${OTHER_ORG_ID.toUpperCase()}`
    );
    await dispatch(`/api/content/public/categories?orgId=${OTHER_ORG_ID}`);

    expect(categorySpies.listPublicForOrg).toHaveBeenCalledTimes(1);
    expect(categorySpies.listPublicForOrg).toHaveBeenCalledWith(OTHER_ORG_ID);
  });

  it('keys an uppercase org id as the lowercase one for the content list too', async () => {
    await dispatch(`/api/content/public?orgId=${OTHER_ORG_ID.toUpperCase()}`);
    await dispatch(`/api/content/public?orgId=${OTHER_ORG_ID}`);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(1);
    expect(contentSpies.listPublic.mock.calls[0]?.[0]).toMatchObject({
      orgId: OTHER_ORG_ID,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Codex-1g5lh.13 — thumbnailUrl and hlsPreviewUrl come from DIFFERENT buckets
//
// `toPublicItem` (r2-public-urls.ts) builds both fields in one function, and
// before Codex-1g5lh.13 it built both from `R2_PUBLIC_URL_BASE` — the ASSETS
// host. But `hlsPreviewKey`
// is a MEDIA-bucket key, so the assets host had no object to serve and every
// public HLS preview 404'd on its manifest in production while its poster
// loaded fine. These cases pin the split, in both directions: the preview may
// move to a media-preview host, and the thumbnail may NOT follow it there.
//
// `/discover` is used for the split assertions on purpose — it is the one
// uncached branch. No KV slot carries a URL anyway: the org list caches the
// row and builds its URLs after the cache, against the env of that request.
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
      creator: { id: 'creator-1', name: 'Ada' },
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

describe('toPublicItem — the assets host and the preview host are separate', () => {
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

  it('a slot cached while the assets base was missing serves the poster once it is set', async () => {
    // The slot holds the row, not the URL, so a missing CDN base is never
    // frozen into KV as a null poster for the slot's whole TTL.
    const path = `/api/content/public?orgId=${ORG_ID}`;
    const miss = await firstMediaItem(path, { R2_PUBLIC_URL_BASE: undefined });
    const hit = await firstMediaItem(path);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(1); // proves it hit
    expect(miss.thumbnailUrl).toBeNull();
    expect(hit.thumbnailUrl).toBe(`${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`);
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

// ═══════════════════════════════════════════════════════════════════════════
// Codex-ve5eh — the anonymous media item is an ALLOW-LIST, not the row
//
// The route used to spread `...item.mediaItem`, and `listPublic` loaded
// `mediaItem: true`, so the whole media_items row went to every anonymous
// visitor: the original upload's key, the master playlist key, the RunPod job
// id, the transcoder's free-text error. The mock returns that whole row, plus a
// column that is not in the schema yet (`transcodingErrorCode`, as a later
// migration adds one), so this pins the ROUTE's allow-list on its own, whatever
// the service selects.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGINAL_KEY = 'creator-1/originals/media-1/media.mp4';
const MASTER_KEY = 'creator-1/hls/media-1/master.m3u8';
const MEZZANINE_KEY = 'creator-1/mezzanine/media-1/mezzanine.mov';
const RUNPOD_JOB_ID = 'runpod-job-7f3c91';
const TRANSCODER_ERROR = 'ffmpeg exited 1: moov atom not found in /work/in.mp4';

/** Every media_items column, as `mediaItem: true` loaded it, and one more. */
const FULL_MEDIA_ROW = {
  id: '4d000000-0000-4000-8000-0000000000b2',
  creatorId: 'creator-1',
  title: 'raw-upload-final-v3.mp4',
  description: 'Studio-only notes on this upload',
  mediaType: 'video',
  status: 'ready',
  r2Key: ORIGINAL_KEY,
  fileSizeBytes: 104857600,
  mimeType: 'video/mp4',
  durationSeconds: 1325,
  width: 1920,
  height: 1080,
  hlsMasterPlaylistKey: MASTER_KEY,
  hlsPreviewKey: PREVIEW_KEY,
  thumbnailKey: THUMB_KEY,
  waveformKey: 'creator-1/waveforms/media-1/waveform.json',
  waveformImageKey: 'creator-1/waveforms/media-1/waveform.png',
  runpodJobId: RUNPOD_JOB_ID,
  transcodingError: TRANSCODER_ERROR,
  transcodingErrorCode: 'DECODE_FAILED',
  transcodingAttempts: 2,
  transcodingPriority: 2,
  transcodingProgress: null,
  transcodingStep: null,
  mezzanineKey: MEZZANINE_KEY,
  mezzanineStatus: 'ready',
  readyVariants: ['1080p', '720p'],
  loudnessIntegrated: -1400,
  loudnessPeak: -100,
  loudnessRange: 700,
  uploadedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  deletedAt: null,
};

const ROWS_WITH_FULL_MEDIA = {
  items: [
    {
      id: '4d000000-0000-4000-8000-0000000000a2',
      title: 'Bone Deep',
      slug: 'bone-deep',
      contentType: 'video',
      creator: { id: 'creator-1', name: 'Ada' },
      mediaItem: FULL_MEDIA_ROW,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

/** The three fields the web reads: cards, the detail shell, the hero. */
const PUBLIC_MEDIA_FIELDS = [
  'durationSeconds',
  'hlsPreviewUrl',
  'thumbnailUrl',
];

/** Every path that runs `listPublic` through `toPublicItem`. */
const PUBLIC_LIST_PATHS: Array<[string, string]> = [
  ['org list', `/api/content/public?orgId=${ORG_ID}`],
  ['org detail by slug', `/api/content/public?orgId=${ORG_ID}&slug=bone-deep`],
  ['creator profile', '/api/content/public?creatorId=creator1'],
  ['discover', '/api/content/public/discover'],
];

describe('the anonymous media item carries no internal column (Codex-ve5eh)', () => {
  beforeEach(() => {
    contentSpies.listPublic.mockResolvedValue(ROWS_WITH_FULL_MEDIA);
  });

  it.each(
    PUBLIC_LIST_PATHS
  )('%s: the media item is exactly the three public fields', async (_name, path) => {
    const res = await dispatch(path);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { mediaItem: Record<string, unknown> }[];
    };
    expect(Object.keys(body.items[0]?.mediaItem ?? {}).sort()).toEqual(
      PUBLIC_MEDIA_FIELDS
    );
  });

  it.each(
    PUBLIC_LIST_PATHS
  )('%s: the fields the web reads are present and resolved', async (_name, path) => {
    const res = await dispatch(path);

    const body = (await res.json()) as {
      items: { mediaItem: Record<string, unknown> }[];
    };
    expect(body.items[0]?.mediaItem).toEqual({
      durationSeconds: 1325,
      thumbnailUrl: `${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`,
      hlsPreviewUrl: `${R2_PUBLIC_URL_BASE}/${PREVIEW_KEY}`,
    });
  });

  it.each(
    PUBLIC_LIST_PATHS
  )('%s: no raw key, job id or transcoder text is anywhere in the body', async (_name, path) => {
    const text = await (await dispatch(path)).text();

    for (const secret of [
      ORIGINAL_KEY,
      MASTER_KEY,
      MEZZANINE_KEY,
      RUNPOD_JOB_ID,
      TRANSCODER_ERROR,
      'DECODE_FAILED',
      'waveform.json',
    ]) {
      expect(text).not.toContain(secret);
    }
    // The two keys the URLs are built from are read on the server only.
    for (const field of [
      'r2Key',
      'thumbnailKey',
      'hlsPreviewKey',
      'hlsMasterPlaylistKey',
      'runpodJobId',
      'transcodingError',
      'transcodingErrorCode',
      'mezzanineKey',
      'fileSizeBytes',
    ]) {
      expect(text).not.toContain(`"${field}"`);
    }
  });

  it('a KV cache HIT serves the same narrowed item, built from the cached row', async () => {
    await dispatch(`/api/content/public?orgId=${ORG_ID}`);
    const hit = await dispatch(`/api/content/public?orgId=${ORG_ID}`);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(1); // proves it hit
    const body = (await hit.json()) as {
      items: { mediaItem: Record<string, unknown> }[];
    };
    expect(Object.keys(body.items[0]?.mediaItem ?? {}).sort()).toEqual(
      PUBLIC_MEDIA_FIELDS
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Codex-567de — the anonymous org is an ALLOW-LIST too
//
// `listPublic` loaded `organization: true` and the route spread the row, so
// every anonymous list carried the whole organizations row: the payee's
// `primaryConnectAccountUserId`, websiteUrl, description, timestamps. The mock
// returns that whole row plus a column the schema does not have yet, so this
// pins the route's copy-by-name on its own, whatever the service selects.
// ═══════════════════════════════════════════════════════════════════════════

const PAYEE_USER_ID = 'payeeuser7f3c91';

/** Every organizations column, as `organization: true` loaded it, and one more. */
const FULL_ORG_ROW = {
  id: ORG_ID,
  name: 'Bone Deep Studio',
  slug: 'bone-deep-studio',
  description: 'An internal description nobody asked for',
  logoUrl: `${R2_PUBLIC_URL_BASE}/org-1/logo/md.webp`,
  websiteUrl: 'https://bone-deep.example',
  primaryConnectAccountUserId: PAYEE_USER_ID,
  stripeAccountStatus: 'restricted',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deletedAt: null,
};

const ROWS_WITH_FULL_ORG = {
  items: [
    {
      id: '4d000000-0000-4000-8000-0000000000a3',
      title: 'Bone Deep',
      slug: 'bone-deep',
      contentType: 'video',
      creator: { id: 'creator-1', name: 'Ada' },
      mediaItem: null,
      organization: FULL_ORG_ROW,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

describe('the anonymous org carries only its four public fields (Codex-567de)', () => {
  beforeEach(() => {
    contentSpies.listPublic.mockResolvedValue(ROWS_WITH_FULL_ORG);
  });

  it.each(
    PUBLIC_LIST_PATHS
  )('%s: the org is exactly id, name, slug and logoUrl, with their values', async (_name, path) => {
    const res = await dispatch(path);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { organization: Record<string, unknown> }[];
    };
    expect(body.items[0]?.organization).toEqual({
      id: ORG_ID,
      name: 'Bone Deep Studio',
      slug: 'bone-deep-studio',
      logoUrl: `${R2_PUBLIC_URL_BASE}/org-1/logo/md.webp`,
    });
  });

  it.each(
    PUBLIC_LIST_PATHS
  )('%s: no payee id or other internal org column is anywhere in the body', async (_name, path) => {
    const text = await (await dispatch(path)).text();

    expect(text).not.toContain(PAYEE_USER_ID);
    // `description` is left out: a content row has one of its own. The exact
    // toEqual above already refuses it on the org.
    for (const field of [
      'primaryConnectAccountUserId',
      'stripeAccountStatus',
      'websiteUrl',
    ]) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
});

/**
 * `Cache-Control` on this router (Codex-1j5fw · WP3).
 *
 * WHY THIS BLOCK IS NEW. Until WP3 the header on all three routes came from an
 * `app.use('*')` at the top of `public.ts`, and NOTHING asserted it — this file
 * covered the envelope and the R2 bases, `public-cache.test.ts` covered the KV
 * keys, and neither read a header. So deleting that middleware in favour of
 * `policy: { cache: 'public' }` was a change to the highest-traffic public
 * surface on the platform with no test standing under it. These cases are that
 * test, and they pin the EXACT string: the mistake this vocabulary exists to
 * prevent is an `s-maxage` widening, and only a whole-string assertion sees one.
 */
describe('Cache-Control — declared per route, not by a wildcard middleware', () => {
  const PUBLIC_60 = 'public, max-age=60, s-maxage=60';

  it.each([
    ['GET /', `/api/content/public?orgId=${ORG_ID}`],
    ['GET /categories', `/api/content/public/categories?orgId=${ORG_ID}`],
    ['GET /discover', '/api/content/public/discover'],
  ])('%s carries the 60s shared-cache header', async (_name, path) => {
    const res = await dispatch(path);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_60);
  });

  it('the header is identical on a cache HIT and a cache MISS', async () => {
    // The middleware ran after `await next()` and so could not tell the two
    // apart. `procedure()` emits from the policy, which also cannot — asserted
    // because a preset resolved inside the cached fetcher instead of on the
    // policy WOULD differ, and the difference would be invisible on first read.
    const miss = await dispatch(`/api/content/public?orgId=${ORG_ID}`);
    const hit = await dispatch(`/api/content/public?orgId=${ORG_ID}`);

    expect(contentSpies.listPublic).toHaveBeenCalledTimes(1); // proves it hit
    expect(miss.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(hit.headers.get('Cache-Control')).toBe(PUBLIC_60);
  });

  it('NO s-maxage on a validation FAILURE — a 400 must not be edge-cached', async () => {
    // `procedure()` emits the preset on the SUCCESS path only, deliberately: a
    // shared cache holding a 400 (or a 429) for 60s turns one malformed request
    // into a 60-second outage for that URL. Asserted here because these are the
    // only routes on the platform whose success preset is shared-cacheable AND
    // whose input is fully attacker-controlled.
    const res = await dispatch('/api/content/public/categories?orgId=nope');

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('s-maxage');
  });
});
