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
  depends,
}) => {
  const { org } = await parent();

  // Subscribe to the org-version invalidation key the platform layout
  // uses for cross-device sync — when Tab A cancels (or reactivates) a
  // subscription and Tab B fires the visibilitychange handler in
  // `_org/[slug]/+layout.svelte:287`, that
  // `invalidate('cache:org-versions')` needs to re-run THIS load too so
  // the streamed `currentSubscription` reflects the new state. Without
  // it the tier card CTA stays stuck on "Current plan" until a hard
  // reload. Covered by subscription-cross-device.spec.ts.
  depends('cache:org-versions');

  // REVALIDATE variant forces browsers to revalidate on every request so a
  // user who signs in (or subscribes) doesn't see the anonymous tier list
  // cached from an earlier logged-out visit (which would hide their current
  // subscription state in the payload).
  setHeaders(
    locals.user
      ? CACHE_HEADERS.PRIVATE
      : CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE
  );

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
