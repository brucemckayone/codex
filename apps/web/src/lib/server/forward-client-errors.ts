/**
 * Forward a worker's 4xx to the browser as an `HttpError` that keeps its CODE.
 *
 * A remote function that lets an `ApiError` escape hands it to `handleError`
 * (hooks.server.ts), which in production replaces it with
 * `{ message: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }` and a
 * 500. For ownership transfer that erases the one thing the UI needs: whether
 * the offer was already accepted (`OWNERSHIP_OFFER_NOT_OPEN`), whether another
 * offer is open (`CONFLICT`), or whether the owner must transfer first
 * (`OWNERSHIP_TRANSFER_REQUIRED`). Those are user-actionable, so they are
 * re-thrown through `error()`, whose body SvelteKit delivers to the client
 * verbatim (`App.Error` declares `code`).
 *
 * Every 4xx is forwarded. A 5xx may carry internals, so it stays an
 * unexpected error and `handleError` sanitises it, unless the caller names
 * its `details.code` in `serverCodes` (below).
 *
 * A refusal whose class code says too little (`BUSINESS_LOGIC_ERROR`) can
 * carry its own in `details.code`. A caller that names the codes it expects
 * (`detailCodes`, e.g. `PUBLISH_REFUSAL_CODES`) gets that one as `code`; any
 * other keeps the class.
 *
 * One of those that holds until a set time says when, in a `details` field
 * the caller names (`retryAfterFrom`): it goes on as `retryAfter`, so the
 * screen says that time in the creator's own zone. A delete too soon after
 * its last notice sends `retryAt` (Codex-a6ofh.6); a course plan Stripe
 * refuses until the hour turns, `retryAfter` (Codex-2hxff.66).
 *
 * A 5xx goes on only when the caller names its `details.code` in
 * `serverCodes`: a refusal whose words are written to be shown and whose
 * details hold only ids (a course plan's 503 `STRIPE_UNAVAILABLE`). Any other
 * 5xx stays unexpected.
 */

import { error } from '@sveltejs/kit';
import { ApiError } from './errors';

export interface ForwardOptions {
  /** The `details.code`s that go on as `code`, in place of the class code. */
  detailCodes?: readonly string[];
  /** The `details` field one of those carries its retry time in, sent on as `retryAfter`. */
  retryAfterFrom?: 'retryAt' | 'retryAfter';
  /** The `details.code`s a 5xx goes on with, as a refusal; their code goes on too. */
  serverCodes?: readonly string[];
}

export async function forwardClientErrors<T>(
  run: () => Promise<T>,
  { detailCodes = [], retryAfterFrom, serverCodes = [] }: ForwardOptions = {}
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!ApiError.isApiError(err)) throw err;
    // Only `details.reason`, an expected `details.code` and its retry time,
    // each only a string, go on: never the rest of `details`.
    const details = err.details as Record<string, unknown> | undefined;
    const reason = details?.reason;
    const detailCode = details?.code;
    const named =
      typeof detailCode === 'string' &&
      (detailCodes.includes(detailCode) || serverCodes.includes(detailCode))
        ? detailCode
        : null;
    const refusal =
      (err.status >= 400 && err.status < 500) ||
      (err.status >= 500 && named !== null && serverCodes.includes(named));
    if (refusal) {
      const retryAfter =
        named !== null && retryAfterFrom
          ? details?.[retryAfterFrom]
          : undefined;
      error(err.status, {
        message: err.message,
        code: named ?? err.code,
        ...(typeof reason === 'string' && { reason }),
        ...(typeof retryAfter === 'string' && { retryAfter }),
      });
    }
    throw err;
  }
}
