/**
 * Checkout success pages: what a failed session verify means (Codex-o4jvw),
 * and the completion they ask for on arrival (Codex-2hxff.22).
 *
 * The content (org and creator) and tier subscription success loads poll the
 * ecom-api verify endpoint until our row for the Stripe session exists. A
 * failure the next poll may not repeat keeps the page pending; any other
 * failure will not change on retry — not this user's session, or no such
 * session — so the page stops polling and shows its error state.
 *
 * The journey success load does not classify: any failed read there counts as
 * not settled, because forwarding on it would send a buyer who paid twice to
 * the dashboard as if this were a new purchase.
 */

import type { CheckoutSessionVerifyResult } from '@codex/purchase';
import { logger } from '$lib/observability';
import type { createServerApi } from './api';
import { ApiError } from './errors';

/**
 * A failed verify worth retrying: a 5xx, the client's own timeout (408, see
 * `request` in `./api`), a rate limit (429), or no response at all (a network
 * failure throws something other than an ApiError).
 */
export function isTransientFailure(err: unknown): boolean {
  return (
    !(err instanceof ApiError) ||
    err.status >= 500 ||
    err.status === 408 ||
    err.status === 429
  );
}

/**
 * The completion was refused for good (Codex-2hxff.81; owner decision
 * 2026-10-27, "Say we're on it"). The buyer has paid, nothing will record it,
 * and support was alerted. The page says so and stops checking.
 *
 * `reference` is what the buyer's Contact support email quotes, so support
 * can match it to the alert: the buyer's own session id, then the errorId
 * ecom-api logged the alert under. It never holds an email address, an
 * amount or Stripe's text.
 */
export interface NotRecorded {
  kind: 'not_recorded';
  reference: string;
}

/**
 * What the completion on arrival comes to: the session as read after, a
 * {@link NotRecorded}, or null for any other failure (the page's checks
 * carry on).
 */
export type ArrivalCompletion =
  | CheckoutSessionVerifyResult
  | NotRecorded
  | null;

/** The completion was refused for good: a {@link NotRecorded}. */
export function isNotRecorded(
  completion: ArrivalCompletion
): completion is NotRecorded {
  return completion !== null && 'kind' in completion;
}

/** ecom-api's errorIds are `crypto.randomUUID()`; nothing else is quoted. */
const ERROR_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unlock on arrival (owner decision 2026-10-26; Stripe's "trigger fulfillment
 * on your landing page"): Stripe says the session is paid and our record is
 * not there yet, so ask for it to be recorded now, with the webhook's own
 * completion (`POST /checkout/complete`). It answers with the session as
 * read after.
 *
 * Never rejects. ecom-api's `CHECKOUT_NOT_RECORDED` (`CheckoutNotRecordedError`
 * in @codex/purchase) resolves to a {@link NotRecorded}. Any other failure is
 * logged and resolves to null: the page's capped checks carry on, and the
 * webhook records the purchase meanwhile. A load returns it unawaited, so
 * the page paints "Payment received" at once.
 */
export function completeOnArrival(
  api: ReturnType<typeof createServerApi>,
  sessionId: string,
  page: string
): Promise<ArrivalCompletion> {
  return api.checkout
    .complete(sessionId)
    .catch((err: unknown): ArrivalCompletion => {
      if (err instanceof ApiError && err.code === 'CHECKOUT_NOT_RECORDED') {
        // ecom-api alerted support at error under this errorId.
        const details = err.details as { errorId?: unknown } | undefined;
        const errorId =
          typeof details?.errorId === 'string' && ERROR_ID.test(details.errorId)
            ? details.errorId
            : undefined;
        logger.warn(`${page}: the purchase could not be recorded`, {
          sessionId,
          errorId,
        });
        return {
          kind: 'not_recorded',
          reference: errorId ? `${sessionId} / ${errorId}` : sessionId,
        };
      }
      logger.warn(`${page}: completion on arrival failed`, {
        sessionId,
        status: err instanceof ApiError ? err.status : undefined,
        transient: isTransientFailure(err),
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
}
