/**
 * Creator checkout success page - server load
 *
 * Verifies the Stripe checkout session after the user returns from payment.
 * Extracts session_id from URL, calls the ecom-api verify endpoint,
 * and returns the purchase status + content details for display.
 */
import { error, redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
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
      contentSlug,
      username,
    };
  } catch {
    return {
      verification: null,
      contentSlug,
      username,
    };
  }
};
