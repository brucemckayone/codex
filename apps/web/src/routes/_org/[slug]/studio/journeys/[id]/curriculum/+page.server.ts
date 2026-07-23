/**
 * Journey curriculum editor — server load (admin/owner gate).
 *
 * Curriculum editing is mutating, so it is admin/owner only (FRONTEND-MAP §E:
 * course-editor uses an admin/owner server gate). Reuses the `userRole` the
 * studio `+layout.server.ts` resolves — no second role source. Runs under the
 * studio's `ssr = false`; SvelteKit still executes it on navigation, so a
 * non-privileged user is redirected before the editor renders.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { userRole } = await parent();

  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(303, '/studio');
  }

  return {};
};
