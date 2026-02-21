/**
 * Account Profile Page - Server Load
 *
 * Fetches user profile data for the account profile page.
 * Falls back to locals.user if API call fails.
 */

import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  setHeaders,
  platform,
  cookies,
}) => {
  // Auth is handled by +layout.server.ts, but double-check
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  setHeaders(CACHE_HEADERS.PRIVATE);

  try {
    const api = createServerApi(platform, cookies);
    const profile = await api.account.getProfile();
    return { user: profile?.data ?? locals.user };
  } catch (error) {
    console.error('Failed to load profile:', error);
    // Fall back to session user data
    return { user: locals.user };
  }
};
