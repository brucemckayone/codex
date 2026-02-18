/**
 * Admin Remote Functions
 *
 * Server-side functions for admin/analytics data using SvelteKit Remote Functions.
 * Uses `query()` for cached reads that can be awaited directly in Svelte templates.
 *
 * These functions use the existing server API client, which handles:
 * - URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 */

import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats (Combined)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dashboard statistics combining revenue, customers, and content metrics
 *
 * Uses Promise.all() to fetch multiple endpoints in parallel for optimal performance.
 *
 * Usage in Svelte:
 * ```svelte
 * <script>
 *   const stats = await getDashboardStats(orgId);
 * </script>
 *
 * <StatCard label="Revenue" value={stats.revenue.value} change={stats.revenue.change} />
 * ```
 */
export const getDashboardStats = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  // Build URLSearchParams for each endpoint
  const searchParamsRev = new URLSearchParams();
  searchParamsRev.set('organizationId', orgId);

  const searchParamsCust = new URLSearchParams();
  searchParamsCust.set('organizationId', orgId);
  searchParamsCust.set('limit', '1');

  const searchParamsContent = new URLSearchParams();
  searchParamsContent.set('organizationId', orgId);
  searchParamsContent.set('limit', '100');

  // Fetch all stats in parallel for optimal performance
  const [revenue, customers, topContent] = await Promise.all([
    api.analytics.getRevenue(searchParamsRev),
    api.admin.getCustomers(searchParamsCust),
    api.analytics.getTopContent(searchParamsContent),
  ]);

  // Calculate change percentages from revenueByDay data
  const revenueByDay = revenue?.revenueByDay ?? [];
  const recentRevenue = revenueByDay
    .slice(0, 7)
    .reduce((sum, day) => sum + day.revenueCents, 0);
  const previousRevenue = revenueByDay
    .slice(7, 14)
    .reduce((sum, day) => sum + day.revenueCents, 0);
  const revenueChange =
    previousRevenue > 0
      ? Math.round(((recentRevenue - previousRevenue) / previousRevenue) * 100)
      : 0;

  return {
    revenue: {
      value: revenue?.totalRevenueCents ?? 0,
      change: revenueChange,
    },
    customers: {
      value: customers?.pagination?.total ?? 0,
      change: 0, // Change not provided by API
    },
    contentCount: {
      value: topContent?.pagination?.total ?? 0,
      change: 0, // Content count change not provided by API
    },
    views: {
      value: 0, // Views not tracked by current API
      change: 0,
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Revenue
// ─────────────────────────────────────────────────────────────────────────────

const revenueQuerySchema = z.object({
  organizationId: z.string().uuid(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
});

/**
 * Revenue analytics over time with optional date range and granularity
 *
 * Usage:
 * ```svelte
 * <script>
 *   const revenue = await getAnalyticsRevenue({
 *     organizationId: orgId,
 *     dateFrom: '2025-01-01',
 *     dateTo: '2025-01-31',
 *     granularity: 'day'
 *   });
 * </script>
 * ```
 */
export const getAnalyticsRevenue = query(revenueQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) searchParams.set('dateTo', params.dateTo);
  if (params.granularity) searchParams.set('granularity', params.granularity);
  searchParams.set('organizationId', params.organizationId);

  return api.analytics.getRevenue(
    searchParams.toString() ? searchParams : undefined
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Top Content
// ─────────────────────────────────────────────────────────────────────────────

const topContentQuerySchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
});

/**
 * Top performing content by views and revenue
 *
 * Usage:
 * ```svelte
 * <script>
 *   const topContent = await getAnalyticsTopContent({ organizationId: orgId, limit: 10 });
 * </script>
 *
 * {#each topContent.items as content}
 *   <ContentPerformanceRow content={content} />
 * {/each}
 * ```
 */
export const getAnalyticsTopContent = query(
  topContentQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    searchParams.set('limit', String(params.limit));

    return api.analytics.getTopContent(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Customers List
// ─────────────────────────────────────────────────────────────────────────────

const customersQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
});

/**
 * Customer listing with pagination and filtering
 *
 * Usage:
 * ```svelte
 * <script>
 *   const customers = await getCustomers({
 *     organizationId: orgId,
 *     page: 1,
 *     limit: 20
 *   });
 * </script>
 *
 * <CustomerTable customers={customers.items} pagination={customers.pagination} />
 * ```
 */
export const getCustomers = query(customersQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit));
  if (params.organizationId)
    searchParams.set('organizationId', params.organizationId);
  if (params.search) searchParams.set('search', params.search);
  if (params.role) searchParams.set('role', params.role);
  if (params.status) searchParams.set('status', params.status);

  return api.admin.getCustomers(
    searchParams.toString() ? searchParams : undefined
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Activity Feed
// ─────────────────────────────────────────────────────────────────────────────

const activityFeedQuerySchema = z.object({
  organizationId: z.uuid().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  type: z
    .enum(['purchase', 'publish', 'signup', 'all'])
    .optional()
    .default('all'),
});

/**
 * Recent activity feed for dashboard
 *
 * Activity types:
 * - purchase: Customer purchased content
 * - publish: Content was published
 * - signup: New user signed up
 *
 * Usage:
 * ```svelte
 * <script>
 *   const activity = await getActivityFeed({
 *     organizationId: orgId,
 *     limit: 10
 *   });
 * </script>
 *
 * <ActivityFeed items={activity.items} />
 * ```
 */
export const getActivityFeed = query(
  activityFeedQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('page', String(params.page));
    searchParams.set('limit', String(params.limit));
    if (params.organizationId)
      searchParams.set('organizationId', params.organizationId);
    if (params.type !== 'all') searchParams.set('type', params.type);

    return api.admin.getActivity(
      searchParams.toString() ? searchParams : undefined
    );
  }
);
