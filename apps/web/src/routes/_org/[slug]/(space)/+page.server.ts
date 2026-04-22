/**
 * Organization landing page - server load
 *
 * Single-fetch architecture: one `getPublicContent` call (limit 50) returns
 * the whole recent catalogue; we slice it in-memory into typed `sections`
 * (Spotlight / Editor's Picks / Videos / Audio / Articles / Free / per-Category)
 * plus a flat `allContent` array that feeds the bottom full-catalogue grid.
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
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import type { ContentItem, FeedSection } from './feed-types';

// publicContentQuerySchema caps limit at 50. For V1 this is acceptable —
// the homepage surfaces recent items; exhaustive browsing happens via
// /explore's paginated grid. Revisit if orgs complain about catalogue
// truncation at the bottom grid.
const MAX_CATALOGUE_ITEMS = 50;
const CATEGORY_MIN_ITEMS = 3;
const MAX_CATEGORY_SECTIONS = 4;

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
  if (featured.length > 0) {
    const useSpread = featured.length <= 2;
    sections.push({
      id: 'featured',
      layout: useSpread ? 'spread' : 'carousel',
      eyebrow: "Editor's picks",
      title: 'Featured',
      items: useSpread ? featured.slice(0, 2) : featured,
    });
  }

  // ── Videos / Audio / Articles — each media type owns its layout ─────
  const byType = [
    {
      id: 'videos' as const,
      layout: 'carousel' as const,
      eyebrow: 'Watch',
      title: 'Videos',
      match: 'video' as const,
    },
    {
      id: 'audio' as const,
      layout: 'mosaic' as const,
      eyebrow: 'Listen',
      title: 'Audio',
      match: 'audio' as const,
    },
    {
      id: 'articles' as const,
      layout: 'editorial' as const,
      eyebrow: 'Read',
      title: 'Articles',
      match: 'written' as const,
    },
  ];
  for (const { id, layout, eyebrow, title, match } of byType) {
    const items = remaining.filter((i) => i.contentType === match);
    if (items.length === 0) continue;
    sections.push({
      id,
      layout,
      eyebrow,
      title,
      items: promoteFeatured(items),
    });
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
        items: promoteFeatured(free),
      });
    }
  }

  // ── Per-category rows (≥ CATEGORY_MIN_ITEMS items each, top N) ──────
  const byCategory = new Map<string, ContentItem[]>();
  for (const item of remaining) {
    if (!item.category) continue;
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }
  const categoryEntries = [...byCategory.entries()]
    .filter(([, items]) => items.length >= CATEGORY_MIN_ITEMS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CATEGORY_SECTIONS);
  for (const [category, items] of categoryEntries) {
    sections.push({
      id: `category:${category}`,
      layout: 'carousel',
      eyebrow: 'Browse',
      // Title-case the display label but keep the raw value for the URL
      // so category filters still match the stored DB value.
      title: category.charAt(0).toUpperCase() + category.slice(1),
      viewAllHref: `/explore?category=${encodeURIComponent(category)}`,
      viewAllLabel: 'View all',
      items: promoteFeatured(items),
    });
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

  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
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

  return {
    sections,
    allContent,
    stats: statsResult,
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),
  };
};
