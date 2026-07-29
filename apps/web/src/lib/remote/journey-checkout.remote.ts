/**
 * Journey checkout submit — the pay step (Codex-2pryk.2.4.4 · SPEC §7).
 *
 * The one link that was missing. The whole settlement chain behind this has been
 * landed since `1cccc951` — the three checkout endpoints, the webhook handler,
 * `completeCoursePurchase`, the entitlement writer, migration 0080 — but the
 * button on the checkout page was `onclick={() => (initiated = true)}`, so no
 * course could be bought.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY A `form()` AND NOT A `command()`
 * ═══════════════════════════════════════════════════════════════════════════
 * A payment button that needs JavaScript to function is a conversion and
 * accessibility gap. This is a `form()`, so the pay step is a real POST that
 * works with JS off: pick a radio, press Continue, get 303'd to Stripe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THE CLIENT IS TRUSTED WITH: A SLUG AND AN OPAQUE ID. NOTHING ELSE.
 * ═══════════════════════════════════════════════════════════════════════════
 * No price, no plan id, no tier id, no course id crosses the wire from the
 * browser. The handler:
 *   1. resolves the course from the SLUG server-side (`resolveCourseBySlug`,
 *      org-scoped by request host) — so there is no (courseId, slug) pair that
 *      could disagree;
 *   2. re-reads the AUTHORITATIVE offer (`getCourseOffer`);
 *   3. resolves the submitted `offerId` against it (`resolveOfferTarget`) — an id
 *      naming a path that does not exist, or has been withdrawn since the page
 *      was rendered, is refused;
 *   4. sends only ids + redirect URLs onward. All three endpoints re-resolve the
 *      amount from the course/plan/tier row, so the charged amount is not a
 *      function of anything the client said.
 *
 * The worst a tampered `offerId` can do is name another real path on the SAME
 * course and be charged that path's real price.
 */
import { isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import {
  resolveOfferTarget,
  toWireInterval,
} from '$lib/page-builder/offer-paths';
import { createServerApi } from '$lib/server/api';
import { resolveCourseBySlug } from '$lib/server/journeys/round-d-seam';

const journeyCheckoutSchema = z.object({
  /** The journey's org-scoped slug — the route param the form was rendered on. */
  journeySlug: z.string().min(1).max(255),
  /**
   * A canonical offer path id (`purchase`, `subscription-monthly`,
   * `subscription-annual`, `tier:<tierId>`). Validated against the real offer,
   * not by shape — a well-formed id for a withdrawn path must still be refused.
   */
  offerId: z.string().min(1).max(128),
});

/** Shape the checkout page renders when the pay step cannot proceed. */
type CheckoutFailure = { success: false; error: string };

export const startJourneyCheckout = form(
  journeyCheckoutSchema,
  async ({ journeySlug, offerId }): Promise<CheckoutFailure> => {
    const event = getRequestEvent();
    const { platform, cookies, url, locals } = event;

    const checkoutPath = `/journeys/${encodeURIComponent(journeySlug)}/checkout`;
    // Preserve the CHOICE across the login round-trip: an anonymous buyer who
    // picked the annual plan and had to sign in comes back to the annual plan
    // selected, not to a reset page.
    const returnTo = `${checkoutPath}?offer=${encodeURIComponent(offerId)}`;

    // All three checkout endpoints are `auth: 'required'`. Send an anonymous
    // buyer to sign in rather than surfacing a 401 as a generic failure.
    if (!locals.user) {
      redirect(303, `/login?redirect=${encodeURIComponent(returnTo)}`);
    }

    try {
      const course = await resolveCourseBySlug(event, journeySlug);
      if (!course) {
        return { success: false, error: 'This portal could not be found.' };
      }

      const api = createServerApi(platform, cookies);
      const offer = await api.courses.offer(course.id);

      // Already holds access — charging again would be the bug, not the feature.
      if (offer.entitled) {
        redirect(303, `/journeys/${encodeURIComponent(journeySlug)}/dashboard`);
      }

      const target = resolveOfferTarget(offer, offerId);
      if (!target) {
        return {
          success: false,
          error:
            'That way in is no longer available. Please choose another option.',
        };
      }

      // Stripe expands `{CHECKOUT_SESSION_ID}` on redirect. The success page is
      // a waiting room: it polls the entitlement and forwards to the dashboard
      // the moment the webhook has written it, so the buyer never lands on a
      // dashboard that does not yet know about their purchase.
      const successUrl = `${url.origin}${checkoutPath}/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${url.origin}${returnTo}`;

      const sessionUrl = await createSession({
        api,
        target,
        courseId: course.id,
        organizationId: offer.organizationId,
        successUrl,
        cancelUrl,
      });

      if (!sessionUrl) {
        return {
          success: false,
          error: 'Checkout could not be started. Please try again.',
        };
      }

      redirect(303, sessionUrl);
    } catch (error) {
      // Every branch above signals success by THROWING a redirect — let those
      // through untouched, or the buyer would see "checkout failed" on the way
      // to Stripe.
      if (isRedirect(error)) throw error;
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Checkout could not be started. Please try again.',
      };
    }
  }
);

/**
 * Dispatch to the endpoint that owns this path. Each takes ids + redirect URLs
 * only; the amount is resolved server-side from the row behind the path.
 *
 * Note the interval MAPPING (`toWireInterval`): the plan/tier columns are
 * `price_monthly` / `price_annual`, but every checkout schema validates
 * `billingIntervalEnum` = `'month' | 'year'`.
 */
async function createSession({
  api,
  target,
  courseId,
  organizationId,
  successUrl,
  cancelUrl,
}: {
  api: ReturnType<typeof createServerApi>;
  target: NonNullable<ReturnType<typeof resolveOfferTarget>>;
  courseId: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  switch (target.kind) {
    case 'purchase': {
      const session = await api.checkout.course({
        courseId,
        successUrl,
        cancelUrl,
      });
      return session.sessionUrl;
    }

    case 'subscription': {
      const session = await api.checkout.courseSubscription({
        courseId,
        billingInterval: toWireInterval(target.billingInterval ?? 'monthly'),
        successUrl,
        cancelUrl,
      });
      return session.sessionUrl;
    }

    case 'tier': {
      // `resolveOfferTarget` only ever emits a tier target with a tierId, but
      // narrow explicitly rather than assert — a missing id here would create a
      // Stripe session for the wrong thing.
      if (!target.tierId) return null;
      const session = await api.subscription.checkout({
        organizationId,
        tierId: target.tierId,
        billingInterval: toWireInterval(target.billingInterval ?? 'monthly'),
        successUrl,
        cancelUrl,
      });
      return session.sessionUrl;
    }

    default:
      return null;
  }
}
