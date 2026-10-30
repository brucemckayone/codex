/**
 * Org Pricing page - server load
 *
 * Loads subscription tiers, the viewer's current subscription, a catalogue
 * sample for the marquee band, the org's published portals, and org stats.
 * FAQ comes from parent layout branding data.
 *
 * Public page — cache is PRIVATE because the payload carries the viewer's
 * subscription state.
 *
 * ── What is awaited and what is streamed ──────────────────────────────
 * `tiers` and `currentSubscription` are AWAITED. They are the page structure:
 * the tier grid IS the product, and CLAUDE.md requires awaiting data needed
 * for page structure. Previously both were streamed and unwrapped in a client
 * `$effect`, which never runs during SSR — so the server HTML for the page
 * whose entire job is communicating price contained zero prices (verified:
 * `class="card ` appeared 0 times, the skeleton 3 times). Crawlers, link
 * previews and JS-less clients saw a shimmer.
 *
 * They are awaited TOGETHER (one `Promise.all`), not in sequence, so a
 * signed-in visitor pays one round trip rather than two. Awaiting the
 * subscription alongside the tiers also removes a wrong-state flash: with
 * tiers awaited but the subscription streamed, a subscriber's own tier would
 * render "Subscribe" in the SSR HTML and only correct itself after hydration.
 *
 * Everything below the fold — the catalogue sample, portals, stats — stays a
 * bare streamed promise. None of it feeds `<svelte:head>` or the page's
 * structure, and the catalogue read is the slowest call on the page.
 *
 * Opened from an item's paywall (`?for=<contentSlug>`, Codex-2hxff.91, owner
 * decision U10), the page also STREAMS that item's plan set, so the hero can
 * name the plans that include it and each card can say whether it does. The
 * cards render first; a failed or unknown `for` is no highlight at all, and a
 * tampered one only changes a highlight.
 */
import { publicContentSlugSchema } from '@codex/validation';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { logReadFailure } from '$lib/server/read-failure';
import { getDisplayThumbnail } from '$lib/utils/thumbnail';
import type { PageServerLoad } from './$types';

/**
 * The catalogue band needs enough items to fill a marquee track twice over
 * and to represent all three media types. Four tiles cannot evidence a
 * "29 Titles" stat rendered 200px below them.
 */
const CATALOGUE_SAMPLE_LIMIT = '18';

/** The five fields the proof tile renders. See `CataloguePreviewItem`. */
export interface CataloguePreviewItem {
  id: string;
  title: string;
  contentType: 'video' | 'audio' | 'written';
  thumbnailUrl: string | null;
}

/** The item the pricing page was opened from: what the highlight reads. */
export interface PricingForContent {
  title: string;
  slug: string;
  /** The plans that include it (all ticks; the page keeps its active ones). */
  includedInTierIds: string[];
}

export const load: PageServerLoad = async ({
  parent,
  locals,
  platform,
  cookies,
  setHeaders,
  url,
}) => {
  const { org } = await parent();

  // Auth-varying HTML: the payload carries the viewer's subscription state and
  // the layout injects `user`. Shared caches key by URL, NOT by Cookie, so a
  // `public` copy cached for an anonymous visitor is served to signed-in users
  // — hiding their real subscription state. PRIVATE keeps it out of shared
  // caches. See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  const api = createServerApi(platform, cookies);

  const [tiers, currentSubscription] = await Promise.all([
    api.tiers.list(org.id).catch(() => []),
    // Tagged discriminator so a subscribed user doesn't see "Subscribe" CTA
    // when getCurrent errors transiently — the UI renders a retry alert and
    // disables the CTA until we actually know the state.
    locals.user
      ? api.subscription
          .getCurrent(org.id)
          .then((data) => ({ data, loadError: false as const }))
          .catch(() => ({ data: null, loadError: true as const }))
      : Promise.resolve({ data: null, loadError: false as const }),
  ]);

  // The item a paywall sent the visitor from. Its PUBLIC row, by slug in this
  // org (the same read as the item's own page, KV-cached in content-api), so
  // only a published item of this org is ever named. A slug the list refuses
  // names nothing, so it makes no call.
  const forSlug = url.searchParams.get('for');
  const forContent: Promise<PricingForContent | null> =
    forSlug && publicContentSlugSchema.safeParse(forSlug).success
      ? api.content
          .getPublicContent(
            new URLSearchParams({ orgId: org.id, slug: forSlug, limit: '1' })
          )
          .then((result) => {
            const item = result?.items?.[0];
            return item
              ? {
                  title: item.title,
                  slug: item.slug,
                  includedInTierIds: item.includedInTierIds ?? [],
                }
              : null;
          })
          .catch((error: unknown) => {
            logReadFailure(
              'Pricing highlight item not loaded',
              { orgId: org.id },
              error
            );
            return null;
          })
      : Promise.resolve(null);

  return {
    tiers,
    currentSubscription,
    isAuthenticated: !!locals.user,

    // The pricing highlight (streamed, U10): null → no highlight.
    forContent,

    // Catalogue sample for the marquee band (streamed). Projected down to the
    // four fields the tile renders: `getPublicContent` returns the whole
    // catalogue item per row (content metadata, access flags, creator, org,
    // media item), all of which would ship in the SSR payload for a band that
    // reads a title, a type and one image URL.
    // Items WITHOUT a thumbnail are kept — the tile paints a brand cover plate
    // with a type flair, so dropping them only makes a thin org look thinner.
    contentPreview: api.content
      .getPublicContent(
        new URLSearchParams({ orgId: org.id, limit: CATALOGUE_SAMPLE_LIMIT })
      )
      .then((result) =>
        (result?.items ?? []).map(
          (item): CataloguePreviewItem => ({
            id: item.id,
            title: item.title,
            contentType: item.contentType,
            // Shared precedence ladder (custom override → generated poster);
            // inlining it here is the drift `getDisplayThumbnail` exists to stop.
            thumbnailUrl: getDisplayThumbnail(item),
          })
        )
      )
      .catch(() => [] as CataloguePreviewItem[]),

    // The org's PUBLISHED portals (streamed). Each portal has a PUBLIC sales
    // page, so unlike a content item this is a conversion surface — which is
    // why the portals rail is interactive while the catalogue band is not.
    portals: api.access
      .listPublishedCourses(org.id)
      .then((result) => result ?? [])
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
