/**
 * Journey checkout — offer/pay SHELL server load (Codex-2pryk.3.1 · WP-3;
 * fidelity pass Codex-2pryk.3.6).
 *
 * The offer/pay step (HARDENING §E checkout row, FRONTEND-MAP §1 checkout). It
 * resolves the journey by slug through the SAME `../journey-data` seam the sales
 * page uses, then derives the presentational offer catalogue + order summary the
 * page renders ("one course, three ways in", SPEC §7). The sell page's primary
 * CTA (`buildJourneyUrl(..., { surface: 'checkout' })`) lands here.
 *
 * WHAT'S REAL vs. WHAT'S WP-6 (the settlement boundary):
 *   - REAL, DB-backed: the course + its one-off price (`course.priceCents`), the
 *     order-summary facts (practice/stage counts, content-type mix), the offer
 *     teasers authored on the landing page's `invite` section, and the social
 *     proof (`testimonials[0]`). All flow through the frozen `getCoursePage`.
 *   - OUT OF SCOPE → WP-6 monetization: the LIVE three-path resolution (real
 *     tier / `course_subscription_plans` prices), the Stripe checkout action,
 *     and the `entitlements` write on webhook success. The recurring offer
 *     prices shown here are page-builder teasers until then. See the offer model
 *     for the provenance split (`./checkout-offer-model`).
 */
import { error } from '@sveltejs/kit';
import { asString } from '$lib/page-builder/render/coerce';
import { CACHE_HEADERS } from '$lib/server/cache';
import { resolveCanEnterCourse } from '$lib/server/journeys/round-d-seam';
import { getCoursePage } from '../journey-data';
import type { PageServerLoad } from './$types';
import {
  buildHeadNote,
  deriveCheckoutOffers,
  deriveCourseSummary,
  resolvePreselectedOffer,
} from './checkout-offer-model';

export const load: PageServerLoad = async (event) => {
  const { params, parent, url, setHeaders } = event;

  // Let the org layout (auth + branding + org resolution) settle first.
  const { user } = await parent();

  const coursePage = await getCoursePage({ slug: params.journeySlug });
  if (!coursePage) {
    throw error(404, 'This portal could not be found.');
  }

  const { page, course, stages, testimonials } = coursePage;

  // Presentational catalogue + order summary (pure, testable derivation).
  const offers = deriveCheckoutOffers(page, course);
  const summary = deriveCourseSummary(course, stages);

  // Re-target the primary action when the viewer already has access: an
  // enrolled member / owner has nothing to buy, so they're sent to the journey
  // rather than shown a "buy again" CTA. Anonymous ⇒ definitionally not enrolled
  // (skip the worker round-trip); `.catch()` degrades a resolver hiccup to the
  // pre-purchase (join) view. The full purchase settlement is WP-6.
  const enrolled = user
    ? await resolveCanEnterCourse(event, user.id, course.id).catch(() => false)
    : false;

  // Prices are server-authoritative and the pay step is per-user — a checkout
  // response must never sit in a shared cache (matches the content-detail
  // purchase precedent). PRIVATE. WP-6 owns the real, cache-free Stripe action.
  setHeaders(CACHE_HEADERS.PRIVATE);

  const invite = page.sections.find(
    (s) => s.type === 'invite' && s.enabled !== false
  );

  return {
    orgSlug: params.slug,
    course,
    brandOverrides: page.brandOverrides,
    offers,
    summary,
    headNote: buildHeadNote(offers),
    // Risk-reversal fine print authored on the invite section (else undefined).
    priceNote: invite ? asString(invite.props, 'priceNote') : undefined,
    // Social proof — the first testimonial, or null (renders conditionally).
    testimonial: testimonials[0] ?? null,
    enrolled,
    // `?offer=` pre-selects one of the paths (deep-link from the sell page).
    preselectedOfferId: resolvePreselectedOffer(
      offers,
      url.searchParams.get('offer')
    ),
  };
};
