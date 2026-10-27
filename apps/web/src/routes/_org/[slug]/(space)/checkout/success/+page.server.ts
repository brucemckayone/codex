/**
 * Checkout success page - server load
 *
 * Verifies the Stripe checkout session after the user returns from payment.
 * Extracts session_id from URL, calls the ecom-api verify endpoint,
 * and returns the purchase status + content details for display.
 *
 * Unlock on arrival (Codex-2hxff.22): when Stripe says the session is paid
 * and our record is not there yet (`state: 'recording'`), the load also asks
 * for it to be recorded, with the webhook's own completion. That call is
 * streamed (`unlock`): the verify is awaited for first paint, and the page
 * says "Payment received" while the completion runs.
 *
 * A failed verify is logged. A 5xx, a network failure (including the client's
 * own timeout) or a rate limit is treated as pending and retried; any other
 * 4xx will not change on retry, so the page stops polling and shows its error
 * state (`verifyFailed`). Same rule as /subscription/success.
 */
import { error, redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  completeOnArrival,
  isTransientFailure,
} from '$lib/server/checkout-verify';
import { ApiError } from '$lib/server/errors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  url,
  locals,
  parent,
  platform,
  cookies,
  setHeaders,
  depends,
}) => {
  // Never cache — purchase verification must be fresh
  setHeaders(CACHE_HEADERS.PRIVATE);
  // Allow client-side retry polling via invalidate('checkout:verify')
  depends('checkout:verify');

  if (!locals.user) {
    redirect(302, '/login');
  }

  const sessionId = url.searchParams.get('session_id');
  const contentSlug = url.searchParams.get('contentSlug');

  if (!sessionId) {
    error(400, 'Missing checkout session ID');
  }

  const { org } = await parent();
  const api = createServerApi(platform, cookies);

  try {
    const result = await api.checkout.verify(sessionId);

    return {
      verification: result,
      verifyFailed: false,
      unlock:
        result.state === 'recording'
          ? completeOnArrival(api, sessionId, 'checkout-success')
          : null,
      contentSlug,
      org,
    };
  } catch (err) {
    const transient = isTransientFailure(err);
    logger.warn('checkout-success: verify failed', {
      sessionId,
      status: err instanceof ApiError ? err.status : undefined,
      transient,
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't error out. Transient: the page stays pending and retries — the
    // webhook may still be processing (Stripe sends events async).
    return {
      verification: null,
      verifyFailed: !transient,
      unlock: null,
      contentSlug,
      org,
    };
  }
};
