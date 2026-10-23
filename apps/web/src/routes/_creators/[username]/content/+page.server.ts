/**
 * Creator Content Catalog - server load
 *
 * Fetches a creator's published content with search, type filtering, and pagination.
 * Resolves the creator itself (`getPublicProfile`; no such creator is a 404),
 * then queries the public list scoped by creatorId with URL-driven filters.
 * Sets PRIVATE cache headers — the page is auth-varying (creator layout
 * injects `user`), so it must not be shared-cached.
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { withoutRawBody } from '$lib/server/content-detail';
import { logCreatorContentFailure } from '../content-failure';
import type { PageServerLoad } from './$types';

const CONTENT_LIMIT = 12;

export const load: PageServerLoad = async ({
  params,
  url,
  platform,
  cookies,
  setHeaders,
}) => {
  // Strip leading @ from username (URL convention: /@alex-creator)
  const username = params.username.replace(/^@/, '');
  const api = createServerApi(platform, cookies);

  // Parse URL search params for filtering and pagination. Bounded to what the
  // public list accepts (page 1-1000, search trimmed to 255), so a hand-edited
  // URL never reaches content-api as a 400: logCreatorContentFailure logs a
  // 4xx at error level as OUR contract bug, and a visitor must not be able to
  // raise that alarm with a URL.
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 255);
  const typeFilter = url.searchParams.get('type') ?? 'all';
  const page = Math.min(
    1000,
    Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  );

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

    if (typeFilter && typeFilter !== 'all') {
      const typeMap: Record<string, string> = {
        video: 'video',
        audio: 'audio',
        article: 'written',
      };
      const mappedType = typeMap[typeFilter];
      if (mappedType) {
        contentParams.set('contentType', mappedType);
      }
    }

    const contentResult = await api.content.getPublicContent(contentParams);
    // Cards draw metadata only; no body reaches this page's HTML.
    contentItems = (contentResult?.items ?? []).map(withoutRawBody);
    totalPages = contentResult?.pagination?.totalPages ?? 1;
    total = contentResult?.pagination?.total ?? 0;
  } catch (err) {
    logCreatorContentFailure(
      'Creator catalogue content not loaded',
      creatorId,
      err
    );
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
