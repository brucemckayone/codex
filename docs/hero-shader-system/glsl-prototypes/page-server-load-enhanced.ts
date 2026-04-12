/**
 * Enhanced Page Server Load — PROTOTYPE (docs only)
 *
 * Shows the changes needed to pass content totals, social links,
 * and feature flags through to the hero section.
 *
 * Changes from current +page.server.ts:
 *   1. Return contentTotal from pagination (currently discarded)
 *   2. Social links and features come from parent layout (if public info is extended)
 *      OR from a separate fetch (shown here)
 *
 * In production: modify apps/web/src/routes/_org/[slug]/(space)/+page.server.ts
 */

import type { UserLibraryResponse } from '@codex/access';
import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  platform,
  cookies,
  locals,
  setHeaders,
  parent,
}) => {
  const { org } = await parent();

  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Build parallel fetch promises
  const contentPromise = getPublicContent({
    orgId: org.id,
    limit: 6,
    sort: 'newest',
  });

  const creatorsPromise = getPublicCreators({
    slug: org.slug,
    limit: 3,
  });

  // Continue watching: only for authenticated users
  let continueWatchingPromise: Promise<UserLibraryResponse> | null = null;
  if (locals.user) {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('filter', 'in_progress');
    params.set('limit', '6');
    params.set('sortBy', 'recent');
    continueWatchingPromise = api.access.getUserLibrary(params);
  }

  // Await only what's critical for first paint
  const contentResult = await contentPromise.catch(() => null);

  return {
    newReleases: contentResult?.items ?? [],

    // ── NEW: Content total from pagination ────────────────
    // Previously discarded — now passed through for stats bar.
    // No API change needed: PaginatedListResponse already includes pagination.total
    contentTotal: contentResult?.pagination?.total ?? 0,

    // Stream non-critical data
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),

    continueWatching:
      continueWatchingPromise
        ?.then((r) => r?.items ?? undefined)
        ?.catch(() => undefined) ?? Promise.resolve(undefined),

    // ── NOTE: Social links and feature flags ──────────────
    //
    // Option A (preferred): Extend GET /api/organizations/public/:slug/info
    // to include socialLinks and features. Then they're available in the
    // parent layout data (data.org.socialLinks, data.org.features) and
    // don't need a separate fetch here.
    //
    // Option B: Fetch here. Requires auth (settings endpoints need org management).
    // Not ideal for the public landing page.
    //
    // Decision: Go with Option A. See doc 07-content-enrichment.md for details.
  };
};
