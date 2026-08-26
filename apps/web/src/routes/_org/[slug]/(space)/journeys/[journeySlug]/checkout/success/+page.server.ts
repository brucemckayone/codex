/**
 * Journey checkout return leg (Codex-2pryk.2.4.4) — a WAITING ROOM, not a receipt.
 *
 * Stripe sends the buyer back here; the `checkout.session.completed` webhook that
 * writes the entitlement arrives independently and may not have landed yet.
 * Redirecting straight to the dashboard would show a buyer who has just paid a
 * course they apparently cannot enter — so this page holds them for as long as
 * the grant takes and forwards the instant it exists.
 *
 * WHAT IT VERIFIES, AND WHY NOT THE STRIPE SESSION
 * `api.checkout.verify` is CONTENT-shaped (it returns `purchase.contentId` + a
 * `content` object) so it cannot describe a course purchase, and the three course
 * paths would need two more session-verify shapes between them (course purchase,
 * course subscription; the tier path already has `api.subscription.verify`).
 *
 * Rather than add those, this polls the thing the buyer actually cares about:
 * `offer.entitled` — the same `hasCourseEntitlement` read that gates the
 * dashboard. That makes the page fail-CLOSED and self-consistent: a forged or
 * bookmarked visit to this URL can only ever sit in "confirming", never assert
 * access, because the only thing that flips it is a real entitlement row. The
 * trade-off is that this page cannot show a receipt (amount paid) or distinguish
 * a failed payment from a slow webhook — it says "still confirming" for both.
 *
 * `session_id` is not verified, only PRESENCE-checked: it separates "came back
 * from Stripe" (poll, reassure) from "typed this URL" (nothing to confirm), so a
 * stray visit is not left waiting on a payment that never happened.
 */
import { error, redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { resolveCourseBySlug } from '$lib/server/journeys/round-d-seam';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params, url, locals, platform, cookies, setHeaders, depends } = event;

  // A per-user payment confirmation must never sit in any cache. PRIVATE is safe
  // to set before the awaits — `private, no-cache` is right for errors too.
  setHeaders(CACHE_HEADERS.PRIVATE);
  // The client re-polls by invalidating this key (see `+page.svelte`).
  depends('journey:entitlement');

  const journeyPath = `/journeys/${encodeURIComponent(params.journeySlug)}`;

  if (!locals.user) {
    redirect(
      303,
      `/login?redirect=${encodeURIComponent(`${journeyPath}/checkout/success${url.search}`)}`
    );
  }

  const course = await resolveCourseBySlug(event, params.journeySlug);
  if (!course) {
    throw error(404, 'This portal could not be found.');
  }

  // `.catch(() => null)` so a transient read failure keeps the buyer in the
  // waiting room (where the next poll can succeed) instead of erroring them out
  // of a flow they have already paid for.
  const offer = await createServerApi(platform, cookies)
    .courses.offer(course.id)
    .catch(() => null);

  // The grant has landed — hand them straight to the journey.
  if (offer?.entitled) {
    redirect(303, `${journeyPath}/dashboard`);
  }

  return {
    courseTitle: course.title,
    dashboardPath: `${journeyPath}/dashboard`,
    checkoutPath: `${journeyPath}/checkout`,
    libraryPath: '/library',
    /** Came back from Stripe (vs. a direct visit) — decides the copy + polling. */
    arrivedFromStripe: url.searchParams.has('session_id'),
  };
};
