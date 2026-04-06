/**
 * Account Subscriptions page - server load
 *
 * Lists all active/cancelling subscriptions for the current user.
 * Auth-gated: redirects to login if not authenticated.
 */
import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/subscriptions');
  }

  setHeaders(CACHE_HEADERS.PRIVATE);

  try {
    const api = createServerApi(platform, cookies);
    const subscriptions = await api.subscription.getMine();
    return { subscriptions };
  } catch {
    return { subscriptions: [] };
  }
};
