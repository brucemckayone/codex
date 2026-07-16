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

  // Auth-varying HTML: the payload carries the viewer's subscription state and
  // the layout injects `user`. Shared caches key by URL, NOT by Cookie, so a
  // `public` copy cached for an anonymous visitor is served to signed-in users
  // — hiding their real subscription state. PRIVATE keeps it out of shared
  // caches. See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  const api = createServerApi(platform, cookies);

  return {
    // Existing
    tiers: api.tiers.list(org.id).catch(() => []),
    // Tagged discriminator so a subscribed user doesn't see "Subscribe" CTA
    // when getCurrent errors transiently — the UI renders a retry alert and
    // disables the CTA until we actually know the state.
    currentSubscription: locals.user
      ? api.subscription
          .getCurrent(org.id)
          .then((data) => ({ data, loadError: false as const }))
          .catch(() => ({ data: null, loadError: true as const }))
      : Promise.resolve({ data: null, loadError: false as const }),
    isAuthenticated: !!locals.user,

    // Content thumbnails for preview section (streamed)
    contentPreview: api.content
      .getPublicContent(new URLSearchParams({ orgId: org.id, limit: '6' }))
      .then((result) => result?.items ?? [])
      .catch(() => []),

    // Org stats for content preview overlay. Categories are normalised to
    // {name, count} so the template never faces the legacy string[] shape
    // that some worker bundles may still return during the rollout window.
    stats: api.org
      .getPublicStats(org.slug)
      .then((s) =>
        s
          ? {
              ...s,
              categories: (s.categories ?? []).map(
                (c: unknown): { name: string; count: number } =>
                  typeof c === 'string'
                    ? { name: c, count: 0 }
                    : (c as { name: string; count: number })
              ),
            }
          : null
      )
      .catch(() => null),
  };
};
