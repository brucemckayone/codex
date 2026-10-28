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
 */

import { error } from '@sveltejs/kit';
import { ApiError } from './errors';

export async function forwardClientErrors<T>(
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (ApiError.isApiError(err) && err.status >= 400 && err.status < 500) {
      // Only `details.reason`, and only a string, goes on: never the rest of
      // `details`.
      const reason = (err.details as { reason?: unknown } | undefined)?.reason;
      error(err.status, {
        message: err.message,
        code: err.code,
        ...(typeof reason === 'string' && { reason }),
      });
    }
    throw err;
  }
}
