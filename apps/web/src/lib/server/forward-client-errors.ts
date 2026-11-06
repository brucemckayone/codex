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
 * 5xx is NOT forwarded, for the reason `journeys.remote.ts` gives: it may carry
 * internals, so it stays an unexpected error and `handleError` sanitises it.
 *
 * A refusal whose class code says too little (`BUSINESS_LOGIC_ERROR`) can
 * carry its own in `details.code`. A caller that names the codes it expects
 * (`detailCodes`, e.g. `PUBLISH_REFUSAL_CODES`) gets that one as `code`, as
 * `coursePlanRefusal` (journeys.remote.ts) does; any other keeps the class.
 */

import { error } from '@sveltejs/kit';
import { ApiError } from './errors';

export async function forwardClientErrors<T>(
  run: () => Promise<T>,
  { detailCodes }: { detailCodes?: readonly string[] } = {}
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (ApiError.isApiError(err) && err.status >= 400 && err.status < 500) {
      // Only `details.reason` and an expected `details.code`, each only a
      // string, go on: never the rest of `details`.
      const details = err.details as
        | { reason?: unknown; code?: unknown }
        | undefined;
      const reason = details?.reason;
      const detailCode = details?.code;
      error(err.status, {
        message: err.message,
        code:
          typeof detailCode === 'string' && detailCodes?.includes(detailCode)
            ? detailCode
            : err.code,
        ...(typeof reason === 'string' && { reason }),
      });
    }
    throw err;
  }
}
