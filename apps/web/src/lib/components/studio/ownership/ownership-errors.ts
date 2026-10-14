/**
 * Readable copy for a failed ownership (or member) remote call (Codex-2hxff.2).
 *
 * The remotes forward a worker 4xx as an `HttpError` whose body keeps the
 * worker's `code` (see `$lib/server/forward-client-errors`). This maps each
 * code in the API contract to something the person can act on. Anything else —
 * a 5xx, a network failure — falls through to `queryErrorMessage`, which
 * handles every rejection shape SvelteKit produces.
 */

import { queryErrorMessage } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

/**
 * The worker's `error.code`, wherever the rejection carries it: under `body`
 * for an `HttpError`, at the top for anything code-bearing.
 */
export function remoteErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const body = (error as { body?: unknown }).body;
  if (body !== null && typeof body === 'object') {
    const nested = (body as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  const direct = (error as { code?: unknown }).code;
  return typeof direct === 'string' ? direct : undefined;
}

export function ownershipErrorMessage(error: unknown): string {
  switch (remoteErrorCode(error)) {
    // The send button enables only on a match, so a mismatch the server still
    // reports means the name changed since the page loaded (a rename).
    case 'CONFIRM_NAME_MISMATCH':
      return m.ownership_error_confirm_name();
    case 'VALIDATION_ERROR':
      return m.ownership_error_validation();
    case 'NOT_ORGANISATION_OWNER':
      return m.ownership_error_not_owner();
    case 'FORBIDDEN':
      return m.ownership_error_forbidden();
    case 'NOT_FOUND':
      return m.ownership_error_not_found();
    case 'OWNERSHIP_OFFER_NOT_OPEN':
      return m.ownership_error_not_open();
    case 'CONFLICT':
      return m.ownership_error_conflict();
    case 'OWNERSHIP_TRANSFER_REQUIRED':
      return m.ownership_error_transfer_required();
    case 'INELIGIBLE_OWNERSHIP_RECIPIENT':
      return m.ownership_error_ineligible();
    case 'RATE_LIMIT_EXCEEDED':
      return m.ownership_error_rate_limited();
    default:
      return (
        queryErrorMessage(error, m.ownership_error_generic()) ??
        m.ownership_error_generic()
      );
  }
}
