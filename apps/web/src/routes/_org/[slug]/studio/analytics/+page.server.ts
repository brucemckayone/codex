/**
 * Analytics Page - Server Load
 *
 * Fetches revenue analytics and top content data in parallel.
 * Admin/owner guard: only admins and owners can access this page.
 * Extracts dateFrom/dateTo from URL search params (default: last 30 days).
 */

import { redirect } from '@sveltejs/kit';
import {
  getAnalyticsRevenue,
  getAnalyticsTopContent,
} from '$lib/remote/admin.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
  const { org, userRole } = await parent();

  // Admin/owner guard
  if (userRole !== 'admin' && userRole !== 'owner') {
    redirect(302, `/${params.slug}/studio`);
  }

  // Parse date range from URL, default to last 30 days
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const dateFrom =
    url.searchParams.get('dateFrom') ?? defaultFrom.toISOString().split('T')[0];
  const dateTo =
    url.searchParams.get('dateTo') ?? now.toISOString().split('T')[0];

  // Fetch revenue and top content in parallel
  const [revenue, topContent] = await Promise.all([
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

  return {
    revenue,
    topContent,
    dateFrom,
    dateTo,
  };
};
