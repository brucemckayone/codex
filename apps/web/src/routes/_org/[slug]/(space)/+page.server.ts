/**
 * Organization landing page - server load
 *
 * Composes a single flat `feedItems` array that the page renders as one
 * edge-to-edge grid. Interleaves featured content (creator-flagged),
 * new releases, creator spotlights, and section ledes.
 *
 * Continue watching stays client-side via libraryCollection (localStorage).
 * Each fetch is independently error-handled so one failure does not
 * break the page.
 */

import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators, getPublicStats } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

type ContentItem = NonNullable<
  Awaited<ReturnType<typeof getPublicContent>>
>['items'][number];

type CreatorItem = NonNullable<
  Awaited<ReturnType<typeof getPublicCreators>>
>['items'][number];

export type FeedItem =
  | {
      kind: 'lede';
      eyebrow: string;
      title: string;
      viewAllHref?: string;
      viewAllLabel?: string;
      sectionId: string;
    }
  | {
      kind: 'content';
      span: 'normal' | 'full';
      content: ContentItem;
      sectionId: string;
    }
  | {
      kind: 'creator-spotlight';
      creator: CreatorItem;
      sectionId: string;
    };

export const load: PageServerLoad = async ({
  params: routeParams,
  locals,
  setHeaders,
  parent,
}) => {
  // Fire off parallel-eligible queries BEFORE awaiting parent() — only needs slug.
  const statsPromise = getPublicStats(routeParams.slug);
  const creatorsPromise = getPublicCreators({
    slug: routeParams.slug,
    limit: 12,
  });

  // Now wait for the layout to resolve the org (needed for orgId).
  const { org } = await parent();

  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Two content queries: featured (creator-flagged), new releases (rest).
  const featuredPromise = getPublicContent({
    orgId: org.id,
    limit: 3,
    sort: 'newest',
    featured: true,
  });
  const newReleasesPromise = getPublicContent({
    orgId: org.id,
    limit: 12,
    sort: 'newest',
    featured: false,
  });

  // Await only what's critical for first paint. Creators stream.
  const [featuredResult, newReleasesResult, statsResult] = await Promise.all([
    featuredPromise.catch(() => null),
    newReleasesPromise.catch(() => null),
    statsPromise.catch(() => null),
  ]);

  const featured = featuredResult?.items ?? [];
  const newReleases = newReleasesResult?.items ?? [];

  // Compose the feed. Order expresses the editorial rhythm:
  //   1. Featured lede → full-width featured cards (tint zone A)
  //   2. New Releases lede → first tile full-width (auto-promoted),
  //      rest normal tiles touching edge-to-edge (tint zone B)
  const feedItems: FeedItem[] = [];

  if (featured.length > 0) {
    feedItems.push({
      kind: 'lede',
      eyebrow: "Editor's picks",
      title: 'Featured',
      sectionId: 'featured',
    });
    for (const item of featured) {
      feedItems.push({
        kind: 'content',
        span: 'full',
        content: item,
        sectionId: 'featured',
      });
    }
  }

  if (newReleases.length > 0) {
    feedItems.push({
      kind: 'lede',
      eyebrow: 'Just Published',
      title: 'New Releases',
      viewAllHref: '/explore',
      viewAllLabel: 'View all',
      sectionId: 'new-releases',
    });
    newReleases.forEach((item, i) => {
      feedItems.push({
        kind: 'content',
        // Auto-promote the first new release to full-width if no featured
        // items filled the editor's-picks slot. Keeps the page visually
        // anchored even for orgs that haven't curated yet.
        span: i === 0 && featured.length === 0 ? 'full' : 'normal',
        content: item,
        sectionId: 'new-releases',
      });
    });
  }

  return {
    feedItems,
    // Kept separately for SEO hints (hydrateIfNeeded into contentCollection).
    newReleases,
    featuredCount: featured.length,
    stats: statsResult,
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),
  };
};
