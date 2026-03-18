/**
 * Team Management Page - Server Load
 *
 * Loads organization members for the team management page.
 * Admin/owner guard: only admins and owners can access this page.
 * The studio layout already restricts to creator+, this further restricts to admin+.
 */

import { redirect } from '@sveltejs/kit';
import { getOrgMembers } from '$lib/remote/org.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
  const { org, userRole } = await parent();

  // Admin/owner guard
  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(302, `/${params.slug}/studio`);
  }

  const membersResult = await getOrgMembers({ orgId: org.id, limit: 50 });

  return {
    members: membersResult?.items ?? [],
    pagination: membersResult?.pagination ?? null,
  };
};
