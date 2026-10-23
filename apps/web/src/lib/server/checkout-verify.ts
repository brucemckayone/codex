/**
 * Checkout success pages: what a failed session verify means (Codex-o4jvw).
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
