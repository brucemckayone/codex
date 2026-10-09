/**
 * The canvas-first page editor (WP-7b) — server load, admin/owner gate.
 *
 * Page editing is stricter than studio access, and the role comes from the
 * studio layout's `getMyMembership` read, so there is one role source. It
 * runs under the studio's `ssr = false` too — SvelteKit still calls it on
 * navigation, so a non-privileged user is redirected before the editor
 * renders.
 *
 * This route replaced the legacy page builder wholesale (WP-9a): it moved
 * here from `page-next/+page.server.ts` unchanged — the legacy route had the
 * identical admin/owner gate, so there was no logic to merge.
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
