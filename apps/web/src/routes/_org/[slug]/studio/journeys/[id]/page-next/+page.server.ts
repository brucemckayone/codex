/**
 * The canvas-first page editor (WP-7b) — server load, admin/owner gate.
 *
 * The same gate as the current builder (`../page/+page.server.ts`): page
 * editing is stricter than studio access, and the role comes from the studio
 * layout's `getMyMembership` read, so there is one role source. It runs under
 * the studio's `ssr = false` too — SvelteKit still calls it on navigation, so
 * a non-privileged user is redirected before the editor renders.
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
