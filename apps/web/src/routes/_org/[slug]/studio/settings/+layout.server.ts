/**
 * Settings layout - server load
 *
 * Role guard: only admin or owner can access settings.
 * Redirects to studio root if insufficient permissions.
 */
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent, params }) => {
  const { org, userRole } = await parent();

  // Settings are restricted to admin and owner roles
  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(302, '/studio');
  }

  return {
    orgId: org.id,
  };
};
