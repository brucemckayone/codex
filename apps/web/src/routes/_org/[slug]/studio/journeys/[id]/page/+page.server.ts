/**
 * Journey sales-page builder — server load (admin/owner gate).
 *
 * A byte-clone of `studio/brand/+page.server.ts` (Codex-2pryk.3.3 · WP-5):
 * page *editing* is stricter than studio access — admin/owner only. We reuse the
 * `userRole` the studio `+layout.server.ts` resolves via getMyMembership, so
 * there is no second role source.
 *
 * Runs under the studio's `ssr = false`: SvelteKit still executes this load (via
 * the data fetch) on navigation, so a non-privileged user is redirected before
 * the builder renders.
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
