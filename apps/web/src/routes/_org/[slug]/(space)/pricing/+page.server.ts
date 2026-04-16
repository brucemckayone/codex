/**
 * Org Pricing page - server load
 *
 * Loads subscription tiers, user's current subscription, content preview
 * thumbnails, and org stats. FAQ comes from parent layout branding data.
 *
 * Public page — cache is DYNAMIC_PUBLIC for unauthenticated users.
 */
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  parent,
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  const { org } = await parent();

  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  const api = createServerApi(platform, cookies);

  return {
    // Existing
    tiers: api.tiers.list(org.id).catch(() => []),
    currentSubscription: locals.user
      ? api.subscription.getCurrent(org.id).catch(() => null)
      : Promise.resolve(null),
    isAuthenticated: !!locals.user,

    // Content thumbnails for preview section (streamed)
    contentPreview: api.content
      .getPublicContent(new URLSearchParams({ orgId: org.id, limit: '6' }))
      .then((result) => result?.items ?? [])
      .catch(() => []),

    // Org stats for content preview overlay
    stats: api.org.getPublicStats(org.slug).catch(() => null),
  };
};
