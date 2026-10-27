/**
 * Subscription success page - server load
 *
 * Counterpart to /checkout/success for subscription-mode Stripe sessions.
 * Fetches `session_id` from the URL, calls the ecom-api verify endpoint,
 * and surfaces the resulting `{ sessionStatus, subscription? }` to the
 * component. Auto-retry is driven by `invalidate('subscription:verify')`
 * in the UI until `subscription` is populated — i.e. the webhook has landed
 * and written our DB row. Without this gate, users land on /library before
 * the subscription row exists and see an empty library.
 *
 * A failed verify is logged. A 5xx, a network failure (including the client's
 * own timeout) or a rate limit is treated as pending and retried; any other
 * 4xx — not this user's session, or no such session — will not change on
 * retry, so the page stops polling and shows its error state (`verifyFailed`).
 */
import { error, redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { isTransientFailure } from '$lib/server/checkout-verify';
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
  setHeaders(CACHE_HEADERS.PRIVATE);
  depends('subscription:verify');

  if (!locals.user) {
    redirect(302, '/login');
  }

  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) {
    error(400, 'Missing checkout session ID');
  }

  const { org } = await parent();
  const api = createServerApi(platform, cookies);

  try {
    const result = await api.subscription.verify(sessionId);
    return { verification: result, verifyFailed: false, org };
  } catch (err) {
    const transient = isTransientFailure(err);
    logger.warn('subscription-success: verify failed', {
      sessionId,
      status: err instanceof ApiError ? err.status : undefined,
      transient,
      error: err instanceof Error ? err.message : String(err),
    });
    // Transient: returning null lets the component show the pending state
    // and retry via invalidate('subscription:verify').
    return { verification: null, verifyFailed: !transient, org };
  }
};
