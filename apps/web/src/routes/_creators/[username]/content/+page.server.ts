/**
 * Creator Content Catalog - server load
 *
 * Fetches a creator's published content with search, type filtering, and pagination.
 * Reuses the creator profile lookup from the parent page, then queries content
 * scoped by creatorId with URL-driven filters.
 * Sets PRIVATE cache headers — the page is auth-varying (creator layout
 * injects `user`), so it must not be shared-cached.
 */
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
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

  // Parse URL search params for filtering and pagination
  const search = url.searchParams.get('search') ?? '';
  const typeFilter = url.searchParams.get('type') ?? 'all';
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );

  // Attempt to fetch the creator's profile from identity API
  let creatorId: string | null = null;
  let creatorName: string | null = null;

  try {
    const profileResult = await api.fetch<{
      data?: {
        id: string;
        name: string | null;
      };
    }>('identity', `/api/user/public/${encodeURIComponent(username)}`);
    creatorId = profileResult?.data?.id ?? null;
    creatorName = profileResult?.data?.name ?? null;
  } catch {
    // Profile endpoint may not exist yet - degrade gracefully
    creatorId = null;
  }

  // Fetch creator's published content with filters
  let contentItems: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    contentType: string;
    thumbnailUrl?: string | null;
    priceCents?: number | null;
    mediaItem?: {
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
    } | null;
  }> = [];
  let totalPages = 1;
  let total = 0;

  if (creatorId) {
    try {
      const contentParams = new URLSearchParams();
      contentParams.set('creatorId', creatorId);
      contentParams.set('status', 'published');
      contentParams.set('limit', String(CONTENT_LIMIT));
      contentParams.set('page', String(page));
      contentParams.set('sortBy', 'publishedAt');
      contentParams.set('sortOrder', 'desc');

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

      const contentResult = await api.content.list(contentParams);
      contentItems = contentResult?.items ?? [];
      totalPages = contentResult?.pagination?.totalPages ?? 1;
      total = contentResult?.pagination?.total ?? 0;
    } catch {
      // Content fetch failed - show empty state
      contentItems = [];
    }
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
    search,
    typeFilter,
    pagination: {
      page,
      totalPages,
      total,
    },
  };
};
