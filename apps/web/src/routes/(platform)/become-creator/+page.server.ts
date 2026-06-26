/**
 * Become Creator page server load
 *
 * Auth gate: redirects unauthenticated users to login.
 * Role gate: redirects non-customers (already creators) to studio.
 */

import { redirect } from '@sveltejs/kit';

import { buildCreatorsUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/become-creator');
  }

  if (locals.user.role !== 'customer') {
    // Already a creator — their studio lives on the `creators` subdomain,
    // not the platform apex (`/studio` here 404s).
    redirect(303, buildCreatorsUrl(url, '/studio'));
  }

  return {
    user: {
      name: locals.user.name,
    },
  };
};
