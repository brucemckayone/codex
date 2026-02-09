/**
 * Library Page - Server Load
 *
 * Fetches user's library on the server for SSR.
 * Data is hydrated into TanStack Query cache on client mount.
 */

import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, cookies, locals }) => {
  // Ensure user is authenticated
  if (!locals.session?.user) {
    redirect(303, '/login?redirect=/library');
  }

  const api = createServerApi(platform, cookies);

  try {
    const library = await api.access.getUserLibrary();
    return {
      library: library ?? { items: [], total: 0, page: 1, limit: 20 },
    };
  } catch (error) {
    console.error('Failed to load library:', error);
    return {
      library: { items: [], total: 0, page: 1, limit: 20 },
    };
  }
};
