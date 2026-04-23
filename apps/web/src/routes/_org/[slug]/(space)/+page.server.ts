/**
 * Organization landing page - server load
 *
 * Single-fetch architecture: one `getPublicContent` call (limit 50) returns
 * the whole recent catalogue; we slice it in-memory into typed `sections`
 * (Spotlight / Editor's Picks / Videos / Audio / Articles / Free) plus a
 * flat `allContent` array that feeds the bottom full-catalogue grid.
 *
 * Category discovery lives in the sticky pill bar at the top of the feed —
 * clicking any pill navigates to /explore?category=X for the dedicated
 * filtered view. No per-category carousels are rendered inline.
 *
 * Each section carries an explicit `layout` tag (`spotlight | spread |
 * carousel | mosaic | editorial | bento`) so the renderer dispatches on
 * server-picked layouts instead of reinventing the rule in the template.
 *
 * See feed-types.ts for the FeedSection / FeedLayout contract and
 * +page.svelte for render dispatch.
 *
 * Continue watching stays client-side via libraryCollection (localStorage).
 */

import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators, getPublicStats } from '$lib/remote/org.remote';
import { listTiers } from '$lib/remote/subscription.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import type { ContentItem, FeedSection } from './feed-types';

// publicContentQuerySchema caps limit at 50. For V1 this is acceptable —
// the homepage surfaces recent items; exhaustive browsing happens via
// /explore's paginated grid. Revisit if orgs complain about catalogue
// truncation at the bottom grid.
const MAX_CATALOGUE_ITEMS = 50;

// Bento "Discover Mix" section — optional second grid beat between
// Audio wall and Articles. Off by default so the landing page ships
// without the extra density; flip to true once the layout has been
// evaluated against real org content.
const DISCOVER_MIX_ENABLED = false;
const DISCOVER_MIX_ITEMS = 6;

/**
 * Moves the first creator-flagged item in `items` to index 0. If no item is
 * flagged, the array is returned unchanged (the server fetch is already
 * sorted newest-first, so the natural index-0 item is the auto-promote).
 */
function promoteFeatured(items: ContentItem[]): ContentItem[] {
  const idx = items.findIndex((i) => i.featured);
  if (idx <= 0) return items;
  return [items[idx], ...items.slice(0, idx), ...items.slice(idx + 1)];
}

function buildSections(all: ContentItem[]): FeedSection[] {
  const sections: FeedSection[] = [];

  // ── Spotlight — single hero-sized anchor at top ──────────────────────
  // Prefer the first creator-flagged item; fall back to the newest item
  // (`all` is already sorted newest-first server-side). If the catalogue
  // is empty, no Spotlight is rendered.
  const spotlight = all.find((i) => i.featured) ?? all[0];
  if (spotlight) {
    sections.push({
      id: 'spotlight',
      layout: 'spotlight',
      eyebrow: "Editor's pick",
      title: spotlight.title,
      items: [spotlight],
    });
  }

  // Exclude the Spotlight item from every downstream section so it never
  // appears twice on the page.
  const remaining = spotlight ? all.filter((i) => i.id !== spotlight.id) : all;

  // ── Editor's Picks — remaining creator-flagged items, 2-up spread ────
  // 1-2 items render as an editorial spread. 3+ items fall back to a
  // carousel so we don't visually force a grid that can't breathe.
  const featured = remaining.filter((i) => i.featured);
  const featuredInSection =
    featured.length > 0
      ? featured.length <= 2
        ? featured.slice(0, 2)
        : featured
      : [];
  if (featured.length > 0) {
    const useSpread = featured.length <= 2;
    sections.push({
      id: 'featured',
      layout: useSpread ? 'spread' : 'carousel',
      eyebrow: "Editor's picks",
      title: 'Featured',
      items: featuredInSection,
    });
  }

  // ── Recent releases — newest items across all types, mixed carousel ───
  // `remaining` is already newest-first (server fetched with sort: 'newest').
  // Exclude items already surfaced in the Editor's Picks section to avoid
  // duplication. Cap at 8 items — enough to fill a carousel without
  // overwhelming the page. Skip entirely below 3 items so low-content
  // orgs don't get a visually sparse row — discovery happens elsewhere.
  const NEW_RELEASE_MAX = 8;
  const NEW_RELEASE_MIN = 3;
  const featuredIds = new Set(featuredInSection.map((i) => i.id));
  const newestSlice = remaining
    .filter((i) => !featuredIds.has(i.id))
    .slice(0, NEW_RELEASE_MAX);
  if (newestSlice.length >= NEW_RELEASE_MIN) {
    sections.push({
      id: 'new-release',
      layout: 'carousel',
      eyebrow: 'New',
      title: 'Recent releases',
      // Mixed-type row — normalise thumb ratios so the carousel reads as
      // one rhythm (same reasoning as Free samples / per-category rows).
      mixedTypes: true,
      items: newestSlice,
    });
  }

  // ── Videos / Audio / Articles — each media type owns its layout ─────
  // Rich layouts (audio mosaic, article editorial) need a minimum item
  // count to look balanced. Below that threshold we gracefully fall
  // back to the carousel — a single audio tile in a 4-col mosaic reads
  // as a bug, not a design decision.
  const MOSAIC_MIN = 3;
  const EDITORIAL_MIN = 3;
  const byType = [
    {
      id: 'videos' as const,
      preferredLayout: 'carousel' as const,
      minForPreferred: 0,
      eyebrow: 'Watch',
      title: 'Videos',
      match: 'video' as const,
    },
    {
      id: 'audio' as const,
      preferredLayout: 'mosaic' as const,
      minForPreferred: MOSAIC_MIN,
      eyebrow: 'Listen',
      title: 'Audio',
      match: 'audio' as const,
    },
    {
      id: 'articles' as const,
      preferredLayout: 'editorial' as const,
      minForPreferred: EDITORIAL_MIN,
      eyebrow: 'Read',
      title: 'Articles',
      match: 'written' as const,
    },
  ];
  for (const {
    id,
    preferredLayout,
    minForPreferred,
    eyebrow,
    title,
    match,
  } of byType) {
    const items = remaining.filter((i) => i.contentType === match);
    if (items.length === 0) continue;
    const layout =
      items.length >= minForPreferred ? preferredLayout : 'carousel';
    sections.push({
      id,
      layout,
      eyebrow,
      title,
      items: promoteFeatured(items),
    });
  }

  // ── Discover Mix — optional cross-type bento grid ───────────────────
  // Picks up to DISCOVER_MIX_ITEMS items from the catalogue and arranges
  // them in a varied tile grid. Unlike the type-sections above, items may
  // re-appear from Videos/Audio/Articles — the mix is a curated remix
  // that emphasises BREADTH, not exclusivity. Skips the Spotlight item
  // because surfacing the hero twice would feel redundant. Gated so V1
  // can ship without the extra density — flip DISCOVER_MIX_ENABLED once
  // the section's information density is validated in real orgs.
  if (DISCOVER_MIX_ENABLED && remaining.length >= DISCOVER_MIX_ITEMS) {
    // Bias towards type variety: walk the catalogue, preferring tiles
    // whose type hasn't yet been placed (up to 2 per type) before filling
    // remaining slots in natural order.
    const picks: ContentItem[] = [];
    const typeCount = { video: 0, audio: 0, written: 0 } as Record<
      string,
      number
    >;
    // First pass: take up to 2 of each type in newest-first order.
    for (const item of remaining) {
      if (picks.length >= DISCOVER_MIX_ITEMS) break;
      const t = item.contentType ?? 'video';
      if ((typeCount[t] ?? 0) >= 2) continue;
      picks.push(item);
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    // Second pass: fill any remaining slots without a type cap.
    if (picks.length < DISCOVER_MIX_ITEMS) {
      const pickedIds = new Set(picks.map((p) => p.id));
      for (const item of remaining) {
        if (picks.length >= DISCOVER_MIX_ITEMS) break;
        if (pickedIds.has(item.id)) continue;
        picks.push(item);
      }
    }

    if (picks.length >= DISCOVER_MIX_ITEMS) {
      sections.push({
        id: 'discover-mix',
        layout: 'bento',
        eyebrow: 'A taste',
        title: 'Discover',
        items: picks,
      });
    }
  }

  // ── Free samples — only if org has both free and non-free content ───
  const hasPaid = remaining.some((i) => i.accessType !== 'free');
  if (hasPaid) {
    const free = remaining.filter((i) => i.accessType === 'free');
    if (free.length > 0) {
      sections.push({
        id: 'free',
        layout: 'carousel',
        eyebrow: 'Try',
        title: 'Free samples',
        // Free samples mix all content types — force uniform thumb ratio
        // so the row reads as one rhythm instead of a jagged mix of
        // 1:1 audio next to 16:9 video next to 3:2 article tiles.
        mixedTypes: true,
        items: promoteFeatured(free),
      });
    }
  }

  return sections;
}

export const load: PageServerLoad = async ({
  params: routeParams,
  locals,
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

  // REVALIDATE variant forces browsers to revalidate on every request so a
  // user who signs in (or buys/subscribes) doesn't get served the anonymous
  // response cached during an earlier logged-out visit to the same URL.
  setHeaders(
    locals.user
      ? CACHE_HEADERS.PRIVATE
      : CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE
  );

  // Single catalogue fetch — slice in memory for every section below.
  const catalogueResult = await getPublicContent({
    orgId: org.id,
    limit: MAX_CATALOGUE_ITEMS,
    sort: 'newest',
  }).catch(() => null);

  const allContent: ContentItem[] = catalogueResult?.items ?? [];
  const sections = buildSections(allContent);

  const statsResult = await statsPromise.catch(() => null);

  // Categories for the hero pill row + sticky pill bar. Derived from
  // `allContent` (already on this request) rather than `stats.categories`
  // so counts reflect exactly what's loaded on the page and the pill bar
  // stays healthy regardless of whether the org-api worker has picked up
  // the aggregated-count service contract. Sorted by count DESC so the
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
    sections,
    allContent,
    stats: statsResult,
    feedCategories,
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),
    subscriptionPricing: tiersPromise,
  };
};
