/**
 * Billing page - server load
 *
 * Owner-only guard: only organization owners can access billing.
 * Loads revenue analytics and top content for the billing dashboard.
 */
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { getOrgRevenue, getTopContent } from '$lib/remote/billing.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, depends }) => {
  depends('cache:studio-page:billing');
  const { org, userRole } = await parent();

  // Billing is restricted to owners only
  if (userRole !== 'owner') {
    redirect(302, '/studio');
  }

  try {
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
      logger.error('[Billing] Failed to fetch revenue', {
        reason: String(revenueResult.reason),
      });
    }
    if (topContentResult.status === 'rejected') {
      logger.error('[Billing] Failed to fetch top content', {
        reason: String(topContentResult.reason),
      });
    }

    return {
      revenue,
      topContent,
    };
  } catch (err) {
    logger.error('[Billing] Load failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { revenue: null, topContent: null };
  }
};
