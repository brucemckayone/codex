import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

/**
 * Profile page server load function
 *
 * - Requires authentication (redirects to /login if not logged in)
 * - Fetches user profile data from the API
 * - Falls back to locals.user if API call fails
 * - Sets appropriate cache headers for private data
 */
export const load: PageServerLoad = async ({
  locals,
  setHeaders,
  platform,
  cookies,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  setHeaders({ 'Cache-Control': 'private, no-cache' });

  try {
    const api = createServerApi(platform, cookies);
    const profile = await api.account.getProfile();

    return {
      user: profile.data,
    };
  } catch {
    // Fallback to locals.user if API call fails
    return {
      user: locals.user,
    };
  }
};
