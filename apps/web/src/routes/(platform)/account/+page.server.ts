/**
 * Account profile page server load
 * Fetches profile data from the identity API with cache-backed SSR
 */

import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  try {
    const api = createServerApi(platform, cookies);
    const response = await api.account.getProfile();
    return { profile: response.data };
  } catch {
    return { profile: null };
  }
};
