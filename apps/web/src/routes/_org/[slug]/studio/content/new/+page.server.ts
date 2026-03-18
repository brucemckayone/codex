/**
 * Studio Content Creation - server load
 *
 * Passes organization ID from parent layout for the create form.
 * Auth is handled by the parent studio layout (redirects to login/join).
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();

  return {
    organizationId: org.id,
  };
};
