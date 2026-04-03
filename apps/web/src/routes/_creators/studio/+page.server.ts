/**
 * Creator studio dashboard - server load
 *
 * Simplified dashboard for the personal creator studio.
 * Stats and analytics are deferred until backend supports
 * creator-scoped queries without organizationId.
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('cache:studio-page:dashboard');
  return {};
};
