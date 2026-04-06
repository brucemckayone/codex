/**
 * Settings layout - server load
 *
 * Passes orgId from parent studio layout for settings pages.
 * Role guard (admin/owner) is handled client-side in the settings pages
 * since the studio uses ssr = false.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
  const { org } = await parent();

  return {
    orgId: org.id,
  };
};
