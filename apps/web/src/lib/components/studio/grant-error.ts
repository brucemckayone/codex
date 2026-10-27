/**
 * What a grant dialog says when a grant fails (Codex-2hxff.21).
 *
 * The admin route refuses an item a grant cannot open with a 422, and its
 * message is written for the person granting ("This item can't be granted:
 * a grant only opens paid or subscriber content."). `grantContentAccess`
 * forwards a 4xx as an `HttpError` carrying that message, so a 4xx is shown
 * in the worker's own words. Anything else (a 5xx, already sanitised, or a
 * network failure) gets the generic line.
 */

import { queryErrorMessage } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

/** The worker's reason for a refused grant (a forwarded 4xx), or `null`. */
export function grantRefusalReason(err: unknown): string | null {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) return null;
  return queryErrorMessage(err, '') || null;
}

/** The reason when the worker gave one, else the generic failure line. */
export function grantErrorMessage(err: unknown): string {
  return grantRefusalReason(err) ?? m.studio_customers_grant_error();
}
