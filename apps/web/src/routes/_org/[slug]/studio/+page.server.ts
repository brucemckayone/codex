/**
 * Studio dashboard page - server load
 *
 * Fetches dashboard stats and activity feed in parallel.
 * Stats include revenue, customers, content count, and views.
 * Activity feed shows recent purchases, publishes, and signups.
 */
import { getActivityFeed, getDashboardStats } from '$lib/remote/admin.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, depends }) => {
  depends('cache:studio-page:dashboard');
  const { org } = await parent();

  const [stats, activity] = await Promise.all([
    getDashboardStats(org.id),
    getActivityFeed({ organizationId: org.id, limit: 10 }),
  ]);

  return {
    stats,
    activities: activity?.items ?? [],
  };
};
