/**
 * Journey checkout — offer/pay SHELL (Codex-2pryk.3.1 · WP-3).
 *
 * The STRUCTURAL shell for the offer/pay step (HARDENING §E checkout row,
 * FRONTEND-MAP §1 checkout). It resolves the journey by slug through the SAME
 * `../journey-data` integration seam the sales page uses, so the sell page's
 * primary CTA (`buildJourneyUrl(..., { surface: 'checkout' })`) lands on a
 * coherent offer summary instead of a 404.
 *
 * OUT OF WP-3 SCOPE (owned by WP-6 monetization): the real three-path offer
 * selection (SPEC §7 — tier / course-subscription / one-off), the Stripe
 * checkout form action (mirror `content/[contentSlug]` `handlePurchaseAction`),
 * and the `entitlements` write on webhook success. This shell renders the offer
 * + a placeholder pay affordance so the funnel is navigable end-to-end today.
 */
import { error } from '@sveltejs/kit';
import { CACHE_HEADERS } from '$lib/server/cache';
import { getCoursePage } from '../journey-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  parent,
  url,
  setHeaders,
}) => {
  // Let the org layout (auth + branding + org resolution) settle first.
  await parent();

  const coursePage = await getCoursePage({ slug: params.journeySlug });
  if (!coursePage) {
    throw error(404, 'This journey could not be found.');
  }

  // Prices are server-authoritative and the pay step is per-user — a checkout
  // response must never sit in a shared cache (matches the content-detail
  // purchase precedent). PRIVATE. WP-6 owns the real, cache-free Stripe action.
  setHeaders(CACHE_HEADERS.PRIVATE);

  return {
    course: coursePage.course,
    orgSlug: params.slug,
    // `?offer=` pre-selects one of the three access paths (HARDENING §E). The
    // real path catalogue is WP-6; the shell just echoes the pre-selection.
    preselectedOffer: url.searchParams.get('offer'),
  };
};
