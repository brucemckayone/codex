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
 * tampered `kind` falls back to the entitlement alone. A read that FAILS is
 * logged and counts as not settled: forwarding on it would send a duplicate
 * buyer to the dashboard as if this were a new purchase, so the next poll
 * retries, and the poll cap ends in the page's "Still confirming" copy.
 *
 * `session_id` separates "came back from Stripe" (poll, reassure) from "typed
 * this URL" (nothing to confirm), so a stray visit is not left waiting on a
 * payment that never happened.
 *
 * UNLOCK ON ARRIVAL (Codex-2hxff.22; owner decision 2026-10-26, Q-A)
 * A course purchase Stripe says is paid, with no record of ours yet, is
 * recorded by this load, with the webhook's own completion
 * (`POST /checkout/complete`), and the entitlement read again, so the buyer
 * is forwarded at once. A purchase no longer active (refunded, or paused by a
 * dispute) gets one plain notice instead of a wait.
 *
 * A COMPLETION REFUSED FOR GOOD (Codex-2hxff.81; owner decision 2026-10-27,
 * "Say we're on it")
 * The buyer has paid, and nothing will record it: the completion answered
 * `CHECKOUT_NOT_RECORDED`, and support was alerted. The load reports
 * `notRecorded`, and the page says so at once, with Contact support and Go to
 * library. The support email's subject quotes `notRecorded.reference` (the
 * session id and the alert's errorId), so support can match the two. It
 * stops checking, because each check would ask again and alert support
 * again.
 */
import { error, redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import type { OfferPathKind } from '$lib/page-builder/offer-paths';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  completeOnArrival,
  isNotRecorded,
  type NotRecorded,
} from '$lib/server/checkout-verify';
import { ApiError } from '$lib/server/errors';
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
  /** A course purchase no longer active: refunded, or paused by a dispute. */
  inactive?: boolean;
  /** This load recorded it (unlock on arrival): the entitlement is new. */
  recordedNow?: boolean;
  /**
   * Paid, and the completion was refused for good (Codex-2hxff.81), with
   * the reference the Contact support email quotes.
   */
  notRecorded?: NotRecorded;
}

const OFFER_PATH_KINDS: readonly OfferPathKind[] = [
  'purchase',
  'subscription',
  'tier',
];

function parseKind(value: string | null): OfferPathKind | null {
  return OFFER_PATH_KINDS.find((kind) => kind === value) ?? null;
}

/** The buyer's offer for the course, or null, logged, when it can't be read. */
function offerOrNull(
  api: ReturnType<typeof createServerApi>,
  courseId: string
) {
  return api.courses.offer(courseId).catch((err: unknown) => {
    logger.warn('journey-checkout-success: offer read failed', {
      courseId,
      status: err instanceof ApiError ? err.status : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
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
      const verified = await api.checkout.verify(sessionId);
      // Unlock on arrival (Codex-2hxff.22, Q-A "Yes, same call"): Stripe says
      // paid and our record is not there yet, so record it now, with the
      // webhook's own completion, and forward as usual. A completion that
      // fails is logged as one, and the verify stands as the answer: still
      // recording, so not settled, and the next check tries again.
      const recordedNow = verified.state === 'recording';
      const completed = recordedNow
        ? await completeOnArrival(api, sessionId, 'journey-checkout-success')
        : null;
      // Refused for good: nothing will record it, so nothing to wait for.
      if (isNotRecorded(completed)) {
        return { settled: false, duplicate: null, notRecorded: completed };
      }
      const v = completed ?? verified;
      const ours = v.course?.id === courseId;
      return {
        settled: v.sessionStatus !== 'complete' || !!v.course,
        duplicate: ours && v.duplicatePayment ? { kind: 'purchase' } : null,
        inactive: ours && (v.state === 'refunded' || v.state === 'paused'),
        recordedNow: recordedNow && v.state !== 'recording',
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

  // Both reads keep the buyer in the waiting room on failure (where the next
  // poll can succeed) instead of erroring them out of a flow they have already
  // paid for. A failed session read is NOT settled, so it never forwards.
  // Each failure is logged: the offer is the only gate that forwards.
  const [offerRead, record] = await Promise.all([
    offerOrNull(api, course.id),
    sessionId && kind
      ? readSession(api, kind, sessionId, course.id).catch(
          (err: unknown): SessionRecord => {
            logger.warn('journey-checkout-success: session verify failed', {
              kind,
              sessionId,
              status: err instanceof ApiError ? err.status : undefined,
              error: err instanceof Error ? err.message : String(err),
            });
            return { settled: false, duplicate: null };
          }
        )
      : null,
  ]);
  // Recorded by this load: the offer read beside it may predate the grant.
  const offer = record?.recordedNow
    ? await offerOrNull(api, course.id)
    : offerRead;

  const base = {
    courseTitle: course.title,
    dashboardPath: `${journeyPath}/dashboard`,
    checkoutPath: `${journeyPath}/checkout`,
    libraryPath: '/library',
    /** Came back from Stripe (vs. a direct visit) — decides the copy + polling. */
    arrivedFromStripe: sessionId !== null,
  };

  if (record?.duplicate) {
    return {
      ...base,
      duplicate: record.duplicate,
      inactive: false,
      notRecorded: null,
    };
  }

  // Refunded, or paused by a bank dispute: one plain notice, and nothing
  // more to wait for (owner decision 2026-10-26).
  if (record?.inactive) {
    return { ...base, duplicate: null, inactive: true, notRecorded: null };
  }

  // Paid, and nothing will record it: one notice that support is on it, and
  // nothing more to wait for (Codex-2hxff.81). Never forwarded, though a
  // buyer entitled some other way would be: this payment is not recorded.
  if (record?.notRecorded) {
    return {
      ...base,
      duplicate: null,
      inactive: false,
      notRecorded: record.notRecorded,
    };
  }

  // The grant has landed — hand them straight to the journey. With a record to
  // read, wait for it too: entitled with no row yet is a second payment whose
  // webhook is still in flight.
  if (offer?.entitled && (record === null || record.settled)) {
    redirect(303, base.dashboardPath);
  }

  return { ...base, duplicate: null, inactive: false, notRecorded: null };
};
