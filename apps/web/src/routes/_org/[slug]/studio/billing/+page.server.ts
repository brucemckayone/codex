/**
 * Billing page - server load
 *
 * Owner-only guard: only organization owners can access billing.
 * Loads revenue analytics and top content for the billing dashboard.
 */
import { redirect } from '@sveltejs/kit';
import { getOrgRevenue, getTopContent } from '$lib/remote/billing.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
  const { org, userRole } = await parent();

  // Billing is restricted to owners only
  if (userRole !== 'owner') {
    redirect(302, `/${params.slug}/studio`);
  }

  // Load revenue and top content in parallel with graceful degradation
  const [revenueResult, topContentResult] = await Promise.allSettled([
    getOrgRevenue({ organizationId: org.id }),
    getTopContent({ organizationId: org.id, limit: 5 }),
  ]);

  const revenue =
    revenueResult.status === 'fulfilled' ? revenueResult.value : null;
  const topContent =
    topContentResult.status === 'fulfilled' ? topContentResult.value : null;

  // Log failures for monitoring
  if (revenueResult.status === 'rejected') {
    console.error('[Billing] Failed to fetch revenue:', revenueResult.reason);
  }
  if (topContentResult.status === 'rejected') {
    console.error(
      '[Billing] Failed to fetch top content:',
      topContentResult.reason
    );
  }

  return {
    revenue,
    topContent,
  };
};
