/**
 * Analytics Page - Server Load
 *
 * Fetches revenue analytics and top content data in parallel.
 * Admin/owner guard: only admins and owners can access this page.
 * Extracts dateFrom/dateTo from URL search params (default: last 30 days).
 */

import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import {
  getAnalyticsRevenue,
  getAnalyticsTopContent,
} from '$lib/remote/admin.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  parent,
  params,
  url,
  depends,
}) => {
  depends('cache:studio-page:analytics');
  const { org, userRole } = await parent();

  // Admin/owner guard
  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(302, '/studio');
  }

  // Parse date range from URL, default to last 30 days
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const dateFrom =
    url.searchParams.get('dateFrom') ?? defaultFrom.toISOString().split('T')[0];
  const dateTo =
    url.searchParams.get('dateTo') ?? now.toISOString().split('T')[0];

  // Fetch revenue and top content in parallel with graceful degradation
  const [revenueResult, topContentResult] = await Promise.allSettled([
    getAnalyticsRevenue({
      organizationId: org.id,
      dateFrom,
      dateTo,
    }),
    getAnalyticsTopContent({
      organizationId: org.id,
      limit: 10,
    }),
  ]);

  if (revenueResult.status === 'rejected') {
    logger.error('[Analytics] Failed to fetch revenue', {
      reason: String(revenueResult.reason),
    });
  }
  if (topContentResult.status === 'rejected') {
    logger.error('[Analytics] Failed to fetch top content', {
      reason: String(topContentResult.reason),
    });
  }

  return {
    revenue: revenueResult.status === 'fulfilled' ? revenueResult.value : null,
    topContent:
      topContentResult.status === 'fulfilled' ? topContentResult.value : null,
    dateFrom,
    dateTo,
  };
};
