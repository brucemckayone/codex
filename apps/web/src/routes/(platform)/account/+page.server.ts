/**
 * Account profile page server load
 * Fetches profile data from the identity API with cache-backed SSR
 */

import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  return {};
};
