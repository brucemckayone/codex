/**
 * Organization landing page — server load.
 *
 * Single catalogue fetch (`getPublicContent`, limit 50, newest-first) feeds the
 * whole page: the client derives every section from `allContent` — "Editor's
 * picks" (featured), "New this week" (recent minus featured), and the "Browse
 * everything" module (all types + topic filter). `allContent` items now carry
 * `categorySlugs`, so the topic filter matches client-side with no extra fetch.
 *
 * Shell + Stream (apps/web CLAUDE.md): the catalogue + stats are awaited (first
 * paint + SEO); the secondary rails — topic categories, cross-device continue
 * watching, creators, subscription pricing — are streamed as bare promises,
 * each `.catch()`-guarded so a failure degrades to an empty section rather than
 * crashing the load.
 *
 * Every fan-out sits BELOW `await parent()`, so an unknown org slug issues no
 * subrequests from this load at all — see the comment on that await.
 *
 * `feedCategories` (derived from `allContent`) still powers the hero pills;
 * `categories` (the curated taxonomy) powers "Browse by topic" + the browse
 * module's active-topic chip. See +page.svelte for render + URL sync.
 */

import { getPublicCategories } from '$lib/remote/categories.remote';
import { getPublicContent } from '$lib/remote/content.remote';
import { listPublishedJourneys } from '$lib/remote/journeys.remote';
import { getContinueWatching } from '$lib/remote/library.remote';
import { getPublicCreators, getPublicStats } from '$lib/remote/org.remote';
import { listTiers } from '$lib/remote/subscription.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import type { ContentItem } from './feed-types';

// publicContentQuerySchema caps limit at 50. For V1 this is acceptable —
// the homepage surfaces recent items; exhaustive browsing happens via
// /explore's paginated grid. Revisit if orgs complain about catalogue
// truncation at the bottom grid.
const MAX_CATALOGUE_ITEMS = 50;

/**
 * How many featured portals may take a slide in "Editor's picks".
 *
 * Capped where featured CONTENT is not, because the two are bounded differently:
 * content picks are already limited by whatever is featured inside the 50-item
 * catalogue window, whereas `listPublishedJourneys({ featured: true })` would
 * return every promoted journey in the org. Four keeps the carousel a curated
 * set rather than a second catalogue.
 */
const MAX_FEATURED_PORTALS = 4;

export const load: PageServerLoad = async ({
  params: routeParams,
  setHeaders,
  parent,
}) => {
  /*
    `parent()` FIRST — nothing fans out until the org is known to exist.

    Codex-kgrdp.20. `getPublicStats` and `getPublicCreators` take the route slug,
    not `org.id`, so they used to be fired here BEFORE this await purely to
    overlap with it. For a real org that parallelism was free; for an unknown
    slug it was pure waste, and the wildcard subdomain route means unknown slugs
    are the bulk of the traffic under a scan — two subrequests and two Neon
    queries issued before anything had checked the org existed, on a request
    whose only possible outcome was 404.

    Worse, neither promise carried a `.catch()` at the point it was created:
    when `parent()` threw 404 the load unwound with two live rejections nobody
    was waiting on, which is exactly the unhandled-rejection crash the
    streaming rules in apps/web/CLAUDE.md prohibit.

    Moving them below the await costs no first paint. This is the same trade
    `featuredJourneysPromise` already makes a few lines down: they are fired
    immediately after `parent()` resolves and awaited only after the catalogue
    fetch, so they run CONCURRENTLY with the longer of the two reads rather than
    with `parent()`. Shell + stream is preserved — the catalogue and stats stay
    awaited (first paint + SEO), creators stays streamed.
  */
  const { org } = await parent();

  // `.catch()` at the point of creation, not at the point of use: a rejection
  // that arrives before its `await` must already be handled.
  const statsPromise = getPublicStats(routeParams.slug).catch(() => null);
  const creatorsPromise = getPublicCreators({
    slug: routeParams.slug,
    limit: 12,
  })
    .then((r) => ({
      items: r?.items ?? [],
      total: r?.pagination?.total ?? 0,
    }))
    .catch(() => ({ items: [], total: 0 }));

  /*
    Featured PORTALS — the journeys a creator has promoted
    (`landing_pages.featured`), which join the content picks as slides in
    "Editor's picks" below.

    AWAITED, unlike the `journeys` rail further down, and that difference is
    deliberate. The picks carousel is built from awaited data; feeding it a
    streamed source would grow the slide count after hydration, which shifts
    layout, changes the dot count under the user, and re-runs the carousel's
    IntersectionObserver effect. A carousel may not gain slides late.

    Fired AFTER `parent()` so it can pass the org id `parent()` already resolved.
    It used to run in the pre-`parent()` parallel group precisely BECAUSE it
    re-derived the org from the request hostname — that made it independent, but
    it also meant every call paid a redundant `getPublicInfo` hop, twice per
    render counting the rail below. Passing `organizationId` puts these reads on
    the same footing as the content/categories/stats reads (Codex-72k55), and
    costs no wall-clock: it now runs concurrently with the catalogue fetch, which
    is the longer of the two.
  */
  const featuredJourneysPromise = listPublishedJourneys({
    featured: true,
    limit: MAX_FEATURED_PORTALS,
    organizationId: org.id,
  }).catch(() => []);

  // Single catalogue fetch — the client slices it into every section below.
  const catalogueResult = await getPublicContent({
    orgId: org.id,
    limit: MAX_CATALOGUE_ITEMS,
    sort: 'newest',
  }).catch(() => null);

  const allContent: ContentItem[] = catalogueResult?.items ?? [];

  // Both in flight since just before the catalogue fetch — these awaits resolve
  // existing promises rather than starting requests. Already `.catch()`-guarded
  // at creation, so neither can reject here.
  const statsResult = await statsPromise;
  const featuredJourneys = await featuredJourneysPromise;

  // Set cache headers only after the critical awaits. If `parent()` throws
  // (e.g. an auth/branding load failure), the resulting error response
  // inherits SvelteKit's default no-cache headers instead of poisoning the
  // CDN with the public-cache policy. This page is auth-varying (the layout
  // injects `user`), and shared caches key by URL, NOT by Cookie — so a
  // `public` response cached for an anonymous visitor is served to signed-in
  // users too. PRIVATE keeps it out of shared caches.
  // See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  // Hero pills — content-type/category quick links derived from `allContent`
  // (already on this request) rather than the taxonomy, so counts reflect
  // exactly what's loaded on the page. Sorted by count DESC so the
  // most-stocked categories lead the row.
  const feedCategories = (() => {
    const counts = new Map<string, number>();
    for (const item of allContent) {
      if (!item.category) continue;
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // Subscription pricing for the SubscribeCTA banner. Streamed (non-blocking)
  // so the landing page first paint isn't gated on the tiers query; the CTA
  // gracefully falls back to its "Cancel anytime" meta string while pricing
  // resolves. Returns the cheapest monthly price + whether an annual tier
  // offers a meaningful discount; the banner derives the save % itself.
  const tiersPromise = listTiers(org.id)
    .then((tiers) => {
      if (!tiers || tiers.length === 0) return null;
      // Pick the cheapest monthly price as the "From" anchor. Every tier
      // has a priceMonthly (the server-side schema enforces it), so a
      // reduce() gets the minimum in one pass.
      const cheapestMonthly = tiers.reduce(
        (min, t) => (t.priceMonthly < min ? t.priceMonthly : min),
        tiers[0].priceMonthly
      );
      // Pair it with the matching tier's annual price so the save-teaser
      // compares apples-to-apples (same tier, two intervals).
      const cheapestTier =
        tiers.find((t) => t.priceMonthly === cheapestMonthly) ?? tiers[0];
      return {
        startingPriceCents: cheapestMonthly,
        monthlyPriceCents: cheapestTier.priceMonthly,
        annualPriceCents: cheapestTier.priceAnnual,
        currency: 'GBP',
      };
    })
    .catch(() => null);

  return {
    allContent,
    // Awaited — see MAX_FEATURED_PORTALS. These become "Editor's picks" slides
    // alongside featured content, so they must be present in the SSR HTML.
    featuredJourneys,
    stats: statsResult,
    feedCategories,
    // Streamed: curated topic taxonomy for "Browse by topic" + browse chip.
    categories: getPublicCategories(org.id).catch(() => []),
    // Streamed: cross-device resume rail (server-backed via video_playback).
    // Anonymous visitors and any transport error resolve to an empty rail.
    continueWatching: getContinueWatching(undefined).catch(() => []),
    // Streamed: guided journeys for this org (featured-first, capped). Hidden
    // when the org has none; any transport error degrades to an empty rail.
    // Takes the resolved org id for the same reason as the featured read above.
    journeys: listPublishedJourneys({
      limit: 12,
      organizationId: org.id,
    }).catch(() => []),
    // Streamed: already shaped + `.catch()`-guarded where it was created.
    creators: creatorsPromise,
    subscriptionPricing: tiersPromise,
  };
};
