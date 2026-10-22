/**
 * Journey checkout return leg (Codex-2pryk.2.4.4) — a WAITING ROOM, not a receipt.
 *
 * Stripe sends the buyer back here; the `checkout.session.completed` webhook that
 * writes the entitlement arrives independently and may not have landed yet.
 * Redirecting straight to the dashboard would show a buyer who has just paid a
 * course they apparently cannot enter — so this page holds them for as long as
 * the grant takes and forwards the instant it exists.
 *
 * WHAT IT POLLS
 * The thing the buyer actually cares about: `offer.entitled` — the same
 * `hasCourseEntitlement` read that gates the dashboard. That makes the page
 * fail-CLOSED and self-consistent: a forged or bookmarked visit to this URL can
 * only ever sit in "confirming", never assert access, because the only thing
 * that flips it is a real entitlement row. The trade-off is that this page
 * cannot show a receipt (amount paid) or distinguish a failed payment from a
 * slow webhook — it says "still confirming" for both.
 *
 * A SECOND PAYMENT (Codex-o4jvw)
 * A buyer who already held access is entitled BEFORE this payment's own row is
 * written, so the entitlement alone would forward them as if the payment were a
 * fresh purchase, while it is being refunded. So when the checkout said which
 * path it took (`kind`, set by `startJourneyCheckout`), the load also reads our
 * record of THIS session from that path's verify endpoint, which checks the
 * session is the buyer's own. It waits for that record before forwarding, and
 * when the record is a duplicate the page says so instead. A missing or
 * tampered `kind`, or a read that fails, falls back to the entitlement alone.
 *
 * `session_id` separates "came back from Stripe" (poll, reassure) from "typed
 * this URL" (nothing to confirm), so a stray visit is not left waiting on a
 * payment that never happened.
 */
import { error, redirect } from '@sveltejs/kit';
import type { OfferPathKind } from '$lib/page-builder/offer-paths';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { resolveCourseBySlug } from '$lib/server/journeys/round-d-seam';
import type { PageServerLoad } from './$types';

/** A payment for access the buyer already held, being refunded (Codex-o4jvw). */
type JourneyDuplicate =
  | { kind: 'purchase' }
  | { kind: 'subscription' }
  | {
      kind: 'tier';
      organizationName: string;
      /** The tier of the subscription the buyer keeps. */
      keptTierName: string;
      /** The tier this payment was for, when it is not the one kept. */
      otherTierName: string | null;
    };

/**
 * Our record of the session: `settled` once there is nothing left to wait for
 * (our row exists, or the session never completed), and the duplicate when the
 * row is one.
 */
interface SessionRecord {
  settled: boolean;
  duplicate: JourneyDuplicate | null;
}

const OFFER_PATH_KINDS: readonly OfferPathKind[] = [
  'purchase',
  'subscription',
  'tier',
];

function parseKind(value: string | null): OfferPathKind | null {
  return OFFER_PATH_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * Read the session from the endpoint that owns its path. A course purchase or
 * plan recorded for ANOTHER course reports nothing: the notice names this one.
 */
async function readSession(
  api: ReturnType<typeof createServerApi>,
  kind: OfferPathKind,
  sessionId: string,
  courseId: string
): Promise<SessionRecord> {
  switch (kind) {
    case 'purchase': {
      const v = await api.checkout.verify(sessionId);
      const ours = v.course?.id === courseId;
      return {
        settled: v.sessionStatus !== 'complete' || !!v.course,
        duplicate: ours && v.duplicatePayment ? { kind: 'purchase' } : null,
      };
    }
    case 'subscription': {
      const v = await api.checkout.verifyCourseSubscription(sessionId);
      const sub = v.subscription;
      return {
        settled: v.sessionStatus !== 'complete' || !!sub,
        duplicate:
          sub?.courseId === courseId && sub.duplicateOf
            ? { kind: 'subscription' }
            : null,
      };
    }
    case 'tier': {
      const v = await api.subscription.verify(sessionId);
      const sub = v.subscription;
      const kept = sub?.duplicateOf;
      return {
        settled: v.sessionStatus !== 'complete' || !!sub,
        duplicate:
          sub && kept
            ? {
                kind: 'tier',
                organizationName: sub.organizationName,
                keptTierName: kept.tierName,
                otherTierName: kept.tierId !== sub.tierId ? sub.tierName : null,
              }
            : null,
      };
    }
  }
}

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

  const api = createServerApi(platform, cookies);
  const sessionId = url.searchParams.get('session_id');
  const kind = parseKind(url.searchParams.get('kind'));

  // `.catch(() => null)` so a transient read failure keeps the buyer in the
  // waiting room (where the next poll can succeed) instead of erroring them out
  // of a flow they have already paid for.
  const [offer, record] = await Promise.all([
    api.courses.offer(course.id).catch(() => null),
    sessionId && kind
      ? readSession(api, kind, sessionId, course.id).catch(() => null)
      : null,
  ]);

  const base = {
    courseTitle: course.title,
    dashboardPath: `${journeyPath}/dashboard`,
    checkoutPath: `${journeyPath}/checkout`,
    libraryPath: '/library',
    /** Came back from Stripe (vs. a direct visit) — decides the copy + polling. */
    arrivedFromStripe: sessionId !== null,
  };

  if (record?.duplicate) {
    return { ...base, duplicate: record.duplicate };
  }

  // The grant has landed — hand them straight to the journey. With a record to
  // read, wait for it too: entitled with no row yet is a second payment whose
  // webhook is still in flight.
  if (offer?.entitled && (record === null || record.settled)) {
    redirect(303, base.dashboardPath);
  }

  return { ...base, duplicate: null };
};
