/**
 * Creator profile server load
 *
 * Fetches creator's published content via the public content endpoint.
 * Since there is no dedicated "get user by username" API, the page uses the
 * username from the URL and fetches public content scoped by search query.
 * Sets DYNAMIC_PUBLIC cache headers for edge caching.
 */
import { getPublicContent } from '$lib/remote/content.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const CONTENT_LIMIT = 12;

export const load: PageServerLoad = async ({
  params,
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { username } = params;
  const api = createServerApi(platform, cookies);

  // Attempt to fetch the creator's profile from identity API.
  // This is a best-effort lookup; if the endpoint doesn't exist or the user
  // isn't found, we gracefully degrade to showing just the username.
  let creatorProfile: {
    id?: string;
    name?: string | null;
    image?: string | null;
    bio?: string | null;
    socialLinks?: {
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    } | null;
  } | null = null;

  try {
    const profileResult = await api.fetch<{
      data?: {
        id: string;
        name: string | null;
        image: string | null;
        bio: string | null;
        socialLinks?: {
          website?: string;
          twitter?: string;
          youtube?: string;
          instagram?: string;
        } | null;
      };
    }>('identity', `/api/user/public/${encodeURIComponent(username)}`);
    creatorProfile = profileResult?.data ?? null;
  } catch {
    // Profile endpoint may not exist yet - degrade gracefully
    creatorProfile = null;
  }

  // Fetch creator's published content.
  // If we got a creator profile with an ID, we could filter by creatorId.
  // For now, the public content endpoint doesn't support creatorId filter
  // on its own, so we rely on what's available.
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
    creator?: {
      id?: string;
      name?: string | null;
    } | null;
  }> = [];

  // If we have the creator's content via their profile, use that.
  // Otherwise, content will be populated as endpoints mature.
  if (creatorProfile?.id) {
    try {
      const params = new URLSearchParams();
      params.set('creatorId', creatorProfile.id);
      params.set('status', 'published');
      params.set('limit', String(CONTENT_LIMIT));
      params.set('sortBy', 'publishedAt');
      params.set('sortOrder', 'desc');

      const contentResult = await api.content.list(params);
      contentItems = contentResult?.items ?? [];
    } catch {
      // Content fetch failed - show empty state
      contentItems = [];
    }
  }

  return {
    username,
    user: locals.user,
    creatorProfile,
    contentItems,
  };
};
