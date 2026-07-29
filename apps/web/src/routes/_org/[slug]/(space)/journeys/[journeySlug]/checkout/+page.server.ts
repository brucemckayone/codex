/**
 * Journey checkout — offer/pay surface server load (Codex-2pryk.3.1 · WP-3;
 * fidelity pass Codex-2pryk.3.6; offer rewire Codex-2pryk.2.4.3).
 *
 * The offer/pay step (HARDENING §E checkout row, FRONTEND-MAP §1 checkout). It
 * resolves the journey by slug through the SAME `../journey-data` seam the sales
 * page uses, then reads the AUTHORITATIVE offer and derives the selectable ways
 * in ("one course, three ways in", SPEC §7). The sell page's primary CTA
 * (`buildJourneyUrl(..., { surface: 'checkout' })`) lands here.
 *
 * WHERE EVERY NUMBER ON THIS PAGE COMES FROM
 *   - The OFFER (which paths exist, and every price) is `GET /courses/:id/offer`
 *     → `CourseAccessService.getCourseOffer`, composed from `courses.price_cents`
 *     + `course_subscription_plans` + `course_tier_access ⋈ subscription_tiers`.
 *     Authored `invite` copy may only decorate a path that read returns; see
 *     `$lib/page-builder/offer-paths.ts`. Until Codex-2pryk.2.4.3 this page built
 *     its catalogue out of that authored copy and shipped whatever `priceLabel`
 *     the creator had typed.
 *   - The ORDER SUMMARY facts (practice/stage counts, content-type mix) and the
 *     social proof (`testimonials[0]`) come from `getCoursePage`.
 *   - `entitled` comes from the SAME offer read. `getCourseOffer` resolves it via
 *     `hasCourseEntitlement`, which is exactly what the former
 *     `resolveCanEnterCourse` round-trip called — so reading it here is one
 *     worker call fewer AND drops a `.catch(() => false)` that used to demote an
 *     entitled viewer to the buy view on any resolver hiccup.
 *
 * The offer read is AWAITED, not streamed: it is the subject of the page. If it
 * fails we surface an error rather than render a pay page with no or partial
 * prices — a checkout that silently drops a way in is the bug this rewire fixes.
 *
 * The SUBMIT lives in `$lib/remote/journey-checkout.remote.ts` (a `form()`, so
 * the pay step works with JS off). This load deliberately sends it NOTHING but
 * `signedIn`: the form re-resolves the course from the slug and the price from
 * the offer server-side, so no price or plan/tier id is ever round-tripped
 * through the browser (Codex-2pryk.2.4.4).
 */
import { error } from '@sveltejs/kit';
import type { CourseOffer } from '$lib/page-builder';
import {
  buildHeadNote,
  deriveOfferPathsForPage,
  resolvePreselectedOffer,
} from '$lib/page-builder/offer-paths';
import { asString } from '$lib/page-builder/render/coerce';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { ApiError } from '$lib/server/errors';
import { getCoursePage } from '../journey-data';
import type { PageServerLoad } from './$types';
import { deriveCourseSummary } from './checkout-offer-model';

export const load: PageServerLoad = async (event) => {
  const { params, parent, url, setHeaders, platform, cookies } = event;

  // Let the org layout (auth + branding + org resolution) settle first.
  const { user } = await parent();

  const coursePage = await getCoursePage({ slug: params.journeySlug });
  if (!coursePage) {
    throw error(404, 'This portal could not be found.');
  }

  const { page, course, stages, testimonials } = coursePage;

  // Prices are server-authoritative and the pay step is per-user — a checkout
  // response must never sit in a shared cache (matches the content-detail
  // purchase precedent). PRIVATE is safe to set before the awaits below: unlike
  // the `public, s-maxage` presets it cannot poison a CDN with an error page.
  setHeaders(CACHE_HEADERS.PRIVATE);

  const api = createServerApi(platform, cookies);

  // The authoritative offer. Auth is optional on the route and the session
  // cookie is forwarded, so `entitled` reflects THIS viewer.
  let offer: CourseOffer;
  try {
    offer = await api.courses.offer(course.id);
  } catch (err) {
    // A missing course behind a published page is a genuine 404; anything else
    // is the offer read being unavailable. Either way we refuse to render a pay
    // page whose prices we could not confirm.
    if (ApiError.isApiError(err) && err.status === 404) {
      throw error(404, 'This portal could not be found.');
    }
    throw error(
      503,
      'We could not load the ways into this course just now. Please try again in a moment.'
    );
  }

  const offers = deriveOfferPathsForPage(offer, course, page.sections);
  const summary = deriveCourseSummary(course, stages);

  const invite = page.sections.find(
    (s) => s.type === 'invite' && s.enabled !== false
  );

  return {
    orgSlug: params.slug,
    course,
    brandOverrides: page.brandOverrides,
    offers,
    summary,
    headNote: buildHeadNote(offer),
    // Risk-reversal fine print authored on the invite section (else undefined).
    priceNote: invite ? asString(invite.props, 'priceNote') : undefined,
    // Social proof — the first testimonial, or null (renders conditionally).
    testimonial: testimonials[0] ?? null,
    // Already holds access ⇒ nothing to buy; the CTA re-targets to the journey.
    enrolled: offer.entitled,
    // Labels the pay CTA honestly for an anonymous buyer ("Sign in to continue").
    // The submit works either way — it redirects to login and back with the same
    // `?offer=` — but an unexplained detour mid-payment loses people.
    signedIn: Boolean(user),
    // `?offer=` pre-selects one of the paths (deep-link from the sell page).
    preselectedOfferId: resolvePreselectedOffer(
      offers,
      url.searchParams.get('offer')
    ),
  };
};
