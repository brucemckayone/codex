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
 */
import { error, redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
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
    return { verification: result, org };
  } catch {
    // Webhook may still be processing. Returning null lets the component
    // show the pending state and retry via invalidate('subscription:verify').
    return { verification: null, org };
  }
};
