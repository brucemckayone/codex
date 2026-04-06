/**
 * Account Subscriptions page - server load
 *
 * Lists all active/cancelling subscriptions for the current user.
 * Auth-gated: redirects to login if not authenticated.
 */
import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/subscriptions');
  }

  // Cache-Control is set by the parent account layout — don't duplicate it

  try {
    const api = createServerApi(platform, cookies);
    const subscriptions = await api.subscription.getMine();
    return { subscriptions };
  } catch {
    return { subscriptions: [] };
  }
};
