/**
 * Creator Content Catalog - server load
 *
 * Fetches a creator's published content with search, type filtering, and pagination.
 * Resolves the creator itself (`getPublicProfile`; no such creator is a 404),
 * then queries the public list scoped by creatorId with URL-driven filters.
 * Sets PRIVATE cache headers — the page is auth-varying (creator layout
 * injects `user`), so it must not be shared-cached.
 */
import { boundSearchParam, clampPageParam } from '@codex/validation';
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { withoutRawBody } from '$lib/server/content-detail';
import { logReadFailure } from '$lib/server/read-failure';
import { creatorHandle } from '../creator-handle';
import type { PageServerLoad } from './$types';

const CONTENT_LIMIT = 12;

/**
 * `?type=` to the API's content type. A Map, not an object literal: an object
 * answers `constructor` or `toString` from its prototype, so `?type=constructor`
 * sent a content type the API refused with a 400.
 */
const CONTENT_TYPE_BY_FILTER = new Map([
  ['video', 'video'],
  ['audio', 'audio'],
  ['article', 'written'],
]);

export const load: PageServerLoad = async ({
  params,
  url,
  platform,
  cookies,
  setHeaders,
}) => {
  // The handle without its leading @ (URL convention: /@alex-creator).
  const username = creatorHandle(params.username);
  const api = createServerApi(platform, cookies);

  // Parse URL search params for filtering and pagination. Bounded to what the
  // public list accepts (a page it lists, a search with no NUL, which Postgres
  // refuses in text and so was a content-api 500), so a hand-edited URL never
  // reaches content-api as a 400: logReadFailure logs a 4xx at error level as
  // OUR contract bug, and a visitor must not be able to raise that alarm with
  // a URL.
  const search = boundSearchParam(url.searchParams.get('search'));
  const typeFilter = url.searchParams.get('type') ?? 'all';
  const page = clampPageParam(url.searchParams.get('page'));

  // The creator's public profile from identity-api. Note this used to read
  // `profileResult?.data?.id` off a raw `api.fetch`, i.e. it expected the
  // un-unwrapped procedure envelope. `getPublicProfile` goes through
  // `request()`, which unwraps `{ data: T }` to `T`, so the fields are read
  // directly.
  const profile = await api.account.getPublicProfile(username);
  // No such creator is a 404, as on the detail page, not a 200 "no content".
  if (!profile?.id) {
    error(404, 'Creator not found');
  }
  const creatorId = profile.id;
  const creatorName = profile.name ?? null;

  // Fetch creator's published content with filters
  let contentItems: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    contentType: 'video' | 'audio' | 'written';
    thumbnailUrl?: string | null;
    priceCents?: number | null;
    mediaItem?: {
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
    } | null;
    organization?: { slug?: string | null } | null;
  }> = [];
  let totalPages = 1;
  let total = 0;
  // A failed read renders an error state, never "hasn't published" or "no
  // content matches your search", which would blame the visitor's query.
  let contentError = false;

  // The PUBLIC list scoped by creator, not the studio list, which needs a
  // session and lists the signed-in user's own content (Codex-osuqt).
  try {
    const contentParams = new URLSearchParams();
    contentParams.set('creatorId', creatorId);
    contentParams.set('limit', String(CONTENT_LIMIT));
    contentParams.set('page', String(page));
    contentParams.set('sort', 'newest');

    if (search) {
      contentParams.set('search', search);
    }

    const contentType = CONTENT_TYPE_BY_FILTER.get(typeFilter);
    if (contentType) {
      contentParams.set('contentType', contentType);
    }

    const contentResult = await api.content.getPublicContent(contentParams);
    // Cards draw metadata only; no body reaches this page's HTML.
    contentItems = contentResult.items.map(withoutRawBody);
    totalPages = contentResult.pagination.totalPages;
    total = contentResult.pagination.total;
  } catch (err) {
    logReadFailure('Creator catalogue content not loaded', { creatorId }, err);
    contentError = true;
  }

  // Auth-varying HTML — the creator layout injects the auth-aware `user`
  // section, so the response differs by auth state. Shared caches key by URL,
  // NOT by Cookie, so a `public` copy cached for an anonymous visitor is served
  // to signed-in users too. PRIVATE keeps it out of shared caches.
  // See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  return {
    username,
    creatorName,
    contentItems,
    contentError,
    search,
    typeFilter,
    pagination: {
      page,
      totalPages,
      total,
    },
  };
};
