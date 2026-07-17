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
 * `feedCategories` (derived from `allContent`) still powers the hero pills;
 * `categories` (the curated taxonomy) powers "Browse by topic" + the browse
 * module's active-topic chip. See +page.svelte for render + URL sync.
 */

import { getPublicCategories } from '$lib/remote/categories.remote';
import { getPublicContent } from '$lib/remote/content.remote';
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

export const load: PageServerLoad = async ({
  params: routeParams,
  setHeaders,
  parent,
}) => {
  // Fire queries that don't need org.id in parallel with the parent() await.
  const statsPromise = getPublicStats(routeParams.slug);
  const creatorsPromise = getPublicCreators({
    slug: routeParams.slug,
    limit: 12,
  });

  const { org } = await parent();

  // Single catalogue fetch — the client slices it into every section below.
  const catalogueResult = await getPublicContent({
    orgId: org.id,
    limit: MAX_CATALOGUE_ITEMS,
    sort: 'newest',
  }).catch(() => null);

  const allContent: ContentItem[] = catalogueResult?.items ?? [];

  const statsResult = await statsPromise.catch(() => null);

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
    stats: statsResult,
    feedCategories,
    // Streamed: curated topic taxonomy for "Browse by topic" + browse chip.
    categories: getPublicCategories(org.id).catch(() => []),
    // Streamed: cross-device resume rail (server-backed via video_playback).
    // Anonymous visitors and any transport error resolve to an empty rail.
    continueWatching: getContinueWatching(undefined).catch(() => []),
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),
    subscriptionPricing: tiersPromise,
  };
};
