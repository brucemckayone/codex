/**
 * Creator checkout success page - server load
 *
 * Verifies the Stripe checkout session after the user returns from payment.
 * Extracts session_id from URL, calls the ecom-api verify endpoint,
 * and returns the purchase status + content details for display.
 *
 * Unlock on arrival (Codex-2hxff.22): while Stripe says paid and our record
 * is missing, the load also streams the completion (`unlock`), as the org
 * /checkout/success does.
 *
 * A failed verify is logged. A 5xx, a network failure (including the client's
 * own timeout) or a rate limit is treated as pending and retried; any other
 * 4xx will not change on retry, so the page stops polling and shows its error
 * state (`verifyFailed`). Same rule as the org /checkout/success.
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
  platform,
  cookies,
  setHeaders,
  depends,
}) => {
  setHeaders(CACHE_HEADERS.PRIVATE);
  // Allow client-side retry polling via invalidate('checkout:verify')
  depends('checkout:verify');

  if (!locals.user) {
    redirect(302, '/login');
  }

  const sessionId = url.searchParams.get('session_id');
  const contentSlug = url.searchParams.get('contentSlug');
  const username = url.searchParams.get('username');

  if (!sessionId) {
    error(400, 'Missing checkout session ID');
  }

  const api = createServerApi(platform, cookies);

  try {
    const result = await api.checkout.verify(sessionId);

    return {
      verification: result,
      verifyFailed: false,
      unlock:
        result.state === 'recording'
          ? completeOnArrival(api, sessionId, 'creator-checkout-success')
          : null,
      contentSlug,
      username,
    };
  } catch (err) {
    const transient = isTransientFailure(err);
    logger.warn('creator-checkout-success: verify failed', {
      sessionId,
      status: err instanceof ApiError ? err.status : undefined,
      transient,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      verification: null,
      verifyFailed: !transient,
      unlock: null,
      contentSlug,
      username,
    };
  }
};
