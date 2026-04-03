/**
 * Become Creator page server load
 *
 * Auth gate: redirects unauthenticated users to login.
 * Role gate: redirects non-customers (already creators) to studio.
 */

import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/become-creator');
  }

  if (locals.user.role !== 'customer') {
    redirect(303, '/studio');
  }

  return {
    user: {
      name: locals.user.name,
    },
  };
};
