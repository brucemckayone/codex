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
import { command, getRequestEvent, query } from '$app/server';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats (Combined)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dashboard statistics combining revenue, customers, and content metrics
 *
 * Uses Promise.allSettled() for graceful degradation - if one endpoint fails,
 * others still return data. Errors are logged for monitoring.
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

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', orgId);

  try {
    const stats = await api.analytics.getDashboardStats(searchParams);

    // Derive week-over-week revenue change (same logic as before)
    const revenueByDay = stats.revenue.revenueByDay ?? [];
    const recentRevenue = revenueByDay
      .slice(0, 7)
      .reduce((sum, day) => sum + day.revenueCents, 0);
    const previousRevenue = revenueByDay
      .slice(7, 14)
      .reduce((sum, day) => sum + day.revenueCents, 0);
    const revenueChange =
      previousRevenue > 0
        ? Math.round(
            ((recentRevenue - previousRevenue) / previousRevenue) * 100
          )
        : 0;

    return {
      revenue: {
        value: stats.revenue.totalRevenueCents,
        change: revenueChange,
        revenueByDay: stats.revenue.revenueByDay,
      },
      customers: {
        value: stats.customers.totalCustomers,
        change: 0, // Change % not provided by backend
      },
      contentCount: {
        value: stats.topContent?.pagination?.total ?? 0,
        change: 0,
      },
      views: {
        value: 0, // Views not tracked by current backend
        change: 0,
      },
    };
  } catch (error) {
    logger.error('[Dashboard] Failed to fetch dashboard stats', {
      reason: String(error),
    });

    return {
      revenue: { value: 0, change: 0, revenueByDay: [] },
      customers: { value: 0, change: 0 },
      contentCount: { value: 0, change: 0 },
      views: { value: 0, change: 0 },
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Analytics date-range primitives
// ─────────────────────────────────────────────────────────────────────────────

// ISO-date strings travel end-to-end as strings; the admin-api re-parses them
// via isoDateSchema on receipt. Forwarding verbatim avoids a Date → ISO round-trip.
const dateRangeFields = {
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  compareFrom: z.string().optional(),
  compareTo: z.string().optional(),
} as const;

function setDateRangeParams(
  searchParams: URLSearchParams,
  params: {
    startDate?: string;
    endDate?: string;
    compareFrom?: string;
    compareTo?: string;
  }
) {
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.compareFrom) searchParams.set('compareFrom', params.compareFrom);
  if (params.compareTo) searchParams.set('compareTo', params.compareTo);
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Revenue
// ─────────────────────────────────────────────────────────────────────────────

const revenueQuerySchema = z.object({
  organizationId: z.string().uuid(),
  ...dateRangeFields,
});

/**
 * Revenue analytics with optional period-over-period comparison.
 *
 * When both compareFrom and compareTo are provided, the response includes a
 * `previous` block with the comparison-window figures.
 *
 * Usage:
 * ```svelte
 * const revenue = await getAnalyticsRevenue({
 *   organizationId: orgId,
 *   startDate: '2026-03-01',
 *   endDate: '2026-03-31',
 *   compareFrom: '2026-02-01',
 *   compareTo: '2026-02-28',
 * });
 * ```
 */
export const getAnalyticsRevenue = query(revenueQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', params.organizationId);
  setDateRangeParams(searchParams, params);

  return api.analytics.getRevenue(searchParams);
});

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Top Content
// ─────────────────────────────────────────────────────────────────────────────

const topContentQuerySchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  ...dateRangeFields,
});

/**
 * Top content leaderboard (revenue-ranked) with per-row thumbnail, period
 * views, and optional revenue trend delta vs the comparison window.
 *
 * Usage:
 * ```svelte
 * const top = await getAnalyticsTopContent({
 *   organizationId: orgId,
 *   limit: 10,
 *   startDate, endDate, compareFrom, compareTo,
 * });
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
    setDateRangeParams(searchParams, params);

    return api.analytics.getTopContent(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Subscribers
// ─────────────────────────────────────────────────────────────────────────────

const subscribersQuerySchema = z.object({
  organizationId: z.string().uuid(),
  ...dateRangeFields,
});

/**
 * Subscriber KPIs: active / new / churned with daily breakdown and optional
 * period-over-period `previous` block.
 */
export const getAnalyticsSubscribers = query(
  subscribersQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    setDateRangeParams(searchParams, params);

    return api.analytics.getSubscribers(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Followers
// ─────────────────────────────────────────────────────────────────────────────

const followersQuerySchema = z.object({
  organizationId: z.string().uuid(),
  ...dateRangeFields,
});

/**
 * Follower KPIs: total / new with daily breakdown and optional
 * period-over-period `previous` block.
 *
 * Note: unfollows hard-delete the row, so `totalFollowers` for past windows is
 * a lower-bound approximation — see FollowerBlock docstring in @codex/admin.
 */
export const getAnalyticsFollowers = query(
  followersQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    setDateRangeParams(searchParams, params);

    return api.analytics.getFollowers(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Content Performance
// ─────────────────────────────────────────────────────────────────────────────

const contentPerformanceQuerySchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
  ...dateRangeFields,
});

/**
 * Per-content engagement metrics — distinct viewers, watch time, average
 * completion — with optional watch-time trend delta vs the comparison window.
 *
 * LEFT-JOIN semantics: content with zero playback activity in the window still
 * appears with zero metrics (useful for surfacing under-performers).
 */
export const getAnalyticsContentPerformance = query(
  contentPerformanceQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    searchParams.set('limit', String(params.limit));
    setDateRangeParams(searchParams, params);

    return api.analytics.getContentPerformance(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin Content List (org-scoped)
// ─────────────────────────────────────────────────────────────────────────────

const adminContentQuerySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(100),
});

export const listAdminContent = query(
  adminContentQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    if (params.status) searchParams.set('status', params.status);
    searchParams.set('limit', String(params.limit));
    return api.admin.listContent(searchParams);
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
  contentId: z.string().uuid().optional(),
  joinedWithin: z.coerce.number().int().positive().optional(),
  minSpendCents: z.coerce.number().int().nonnegative().optional(),
  maxSpendCents: z.coerce.number().int().positive().optional(),
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
  if (params.contentId) searchParams.set('contentId', params.contentId);
  if (params.joinedWithin)
    searchParams.set('joinedWithin', String(params.joinedWithin));
  if (params.minSpendCents != null)
    searchParams.set('minSpendCents', String(params.minSpendCents));
  if (params.maxSpendCents != null)
    searchParams.set('maxSpendCents', String(params.maxSpendCents));

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

// ─────────────────────────────────────────────────────────────────────────────
// Customer Detail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get customer details with purchase history
 *
 * Returns customer profile, aggregated stats (total spent, purchase count),
 * and full purchase history for the organization.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const detail = await getCustomerDetail(customerId);
 * </script>
 *
 * <p>{detail.name} — {detail.email}</p>
 * ```
 */
const customerDetailSchema = z.object({
  customerId: z.string(),
  organizationId: z.string().uuid(),
});

export const getCustomerDetail = query(
  customerDetailSchema,
  async ({ customerId, organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', organizationId);
    return api.admin.getCustomerDetail(customerId, searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Grant Content Access
// ─────────────────────────────────────────────────────────────────────────────

const grantAccessSchema = z.object({
  customerId: z.string(),
  contentId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

/**
 * Grant complimentary content access to a customer
 *
 * Creates a contentAccess record (not a purchase) so revenue analytics
 * remain accurate. Idempotent — returns success if access already exists.
 *
 * Usage:
 * ```typescript
 * await grantContentAccess({ customerId, contentId, organizationId });
 * ```
 */
export const grantContentAccess = command(
  grantAccessSchema,
  async ({ customerId, contentId, organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', organizationId);
    return api.admin.grantContentAccess(customerId, contentId, searchParams);
  }
);
