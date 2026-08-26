/**
 * The branding surface moved to the unified /studio/brand workspace
 * (Codex-cijzb). Permanent-redirect any old bookmarks / inbound links.
 *
 * Runs under the studio subtree's `ssr = false`, so this executes on the
 * client during navigation; the redirect fires before the (stub) page renders.
 */
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  redirect(301, '/studio/brand');
};
