/**
 * Brand studio — server load (admin/owner gate).
 *
 * The studio layout already admits creator/admin/owner (members bounce to
 * access_denied). Brand *editing* is stricter: admin/owner only — the same
 * bar the retired settings/branding page enforced client-side. We reuse the
 * `userRole` the studio +layout.server.ts resolves via getMyMembership, so
 * there is no second role source.
 *
 * Runs under the studio's `ssr = false`: SvelteKit still executes this load
 * (via the data fetch) on navigation, so a non-privileged user is redirected
 * before the page component renders.
 *
 * Epic: Codex-cijzb · WP-1.1.
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
