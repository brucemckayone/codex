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

import { createSearchQuerySchema } from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import {
  customerGrowth,
  revenueOnDay,
  utcDay,
  weekOverWeekChange,
} from '$lib/components/studio/dashboard/dashboard-figures';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats (Combined)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Studio dashboard's figures: revenue (every kind, from the payouts
 * ledger, Codex-2hxff.20), customers, content and views. Owners and admins
 * only: the route requires org management.
 *
 * `revenue.revenueByDay` is one entry per UTC calendar day of the last 30,
 * oldest first, zero-filled (Codex-2hxff.75), so "today", the sparkline and
 * the weekly change are read by date and calendar position. A change is
 * `null` when there is nothing to compare with: no badge, never "0%".
 *
 * A failed read REJECTS, after logging. It used to come back as zeros, which
 * the dashboard showed as "£0.00" in silence; the page shows "We couldn't
 * load your revenue." with Retry instead (the .74 pattern).
 *
 * Usage in Svelte:
 * ```svelte
 * <script>
 *   const stats = getDashboardStats(orgId);
 * </script>
 *
 * <TodayStat label="Revenue" value={formatPrice(stats.current.revenue.value)} />
 * ```
 */
export const getDashboardStats = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', orgId);

  let stats: Awaited<ReturnType<typeof api.analytics.getDashboardStats>>;
  try {
    stats = await api.analytics.getDashboardStats(searchParams);
  } catch (error) {
    logger.error('[Dashboard] Failed to fetch dashboard stats', {
      reason: String(error),
    });
    throw error;
  }

  const revenueByDay = stats.revenue.revenueByDay;
  const today = utcDay();
  const todayCents = revenueOnDay(revenueByDay, today);
  if (todayCents === null) {
    // Unknown, not £0: the dashboard makes no claim about today.
    logger.warn('[Dashboard] Revenue series has no entry for today', {
      today,
      lastDay: revenueByDay.at(-1)?.date ?? null,
    });
  }
  return {
    revenue: {
      value: stats.revenue.totalRevenueCents,
      byKind: stats.revenue.revenueByKind,
      change: weekOverWeekChange(revenueByDay),
      todayCents,
      revenueByDay,
    },
    customers: {
      value: stats.customers.totalCustomers,
      change: customerGrowth(stats.customers),
      newThisWeek: stats.customers.newCustomersLast7Days,
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

/**
 * Run a read that the page shows as "We couldn't load …" when it fails: log
 * the raw error here, because the alert never shows it, then reject (the .74
 * pattern). Never a fallback value: a read that failed is not an empty one.
 */
async function loggedRead<T>(
  label: string,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.error(label, { reason: String(error) });
    throw error;
  }
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

  return loggedRead('[Analytics] Failed to fetch revenue', () =>
    api.analytics.getRevenue(searchParams)
  );
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

    return loggedRead('[Analytics] Failed to fetch top content', () =>
      api.analytics.getTopContent(searchParams)
    );
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

    return loggedRead('[Analytics] Failed to fetch subscribers', () =>
      api.analytics.getSubscribers(searchParams)
    );
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

    return loggedRead('[Analytics] Failed to fetch followers', () =>
      api.analytics.getFollowers(searchParams)
    );
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
// Analytics Revenue-by-Creator (multi-creator split visibility — Codex-mtv05)
// ─────────────────────────────────────────────────────────────────────────────

const revenueByCreatorQuerySchema = z.object({
  organizationId: z.string().uuid(),
  // Only the main window — comparison windows are NOT supported in Phase 1
  // (current splits only, no historical drift surface).
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * Studio > Analytics "Revenue by creator" (Codex-zsh2p): one row per creator
 * who holds an active agreement, earned in the window, or is still owed
 * money. Earned is their cut of every kind from the payouts ledger, after
 * refunds; each share is `none`, `unreadable` or a display percentage, never
 * basis points. The page shows the section when more than one creator is
 * listed.
 */
export const getAnalyticsRevenueByCreator = query(
  revenueByCreatorQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('organizationId', params.organizationId);
    if (params.startDate) searchParams.set('startDate', params.startDate);
    if (params.endDate) searchParams.set('endDate', params.endDate);

    return loggedRead('[Analytics] Failed to fetch revenue by creator', () =>
      api.analytics.getRevenueByCreator(searchParams)
    );
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
  search: createSearchQuerySchema(200),
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

    return loggedRead('[Dashboard] Failed to fetch activity feed', () =>
      api.admin.getActivity(searchParams.toString() ? searchParams : undefined)
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
 * Writes a `grant` entitlement (not a purchase) so revenue analytics remain
 * accurate. Idempotent — a re-grant of a live grant is a no-op.
 *
 * Only content a grant can open (`isGrantableContent`) is accepted; anything
 * else is a 422 whose message is meant for the person granting. A 4xx is
 * forwarded with its message and code so the dialog can show it — otherwise
 * `handleError` would turn it into a generic 500 (Codex-2hxff.21).
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
    return forwardClientErrors(() =>
      api.admin.grantContentAccess(customerId, contentId, searchParams)
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Customer Access Grants (Codex-2hxff.21)
// ─────────────────────────────────────────────────────────────────────────────

const customerGrantsSchema = z.object({
  customerId: z.string(),
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * This organisation's support grants for one customer, newest first, live
 * and revoked both. Not cached anywhere: it is a support view and must be
 * current.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const grants = getCustomerGrants({ customerId, organizationId: orgId });
 * </script>
 *
 * {#each grants.current?.items ?? [] as grant (grant.id)}…{/each}
 * ```
 */
export const getCustomerGrants = query(
  customerGrantsSchema,
  async ({ customerId, organizationId, page, limit }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.admin.listCustomerGrants(customerId, organizationId, {
      page,
      limit,
    });
  }
);

const revokeGrantSchema = z.object({
  customerId: z.string(),
  entitlementId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

/**
 * Revoke one support grant. The customer's purchases are untouched, and
 * revoking twice is a no-op. The caller refreshes `getCustomerGrants`.
 *
 * Usage:
 * ```typescript
 * await revokeCustomerGrant({ customerId, entitlementId, organizationId });
 * ```
 */
export const revokeCustomerGrant = command(
  revokeGrantSchema,
  async ({ customerId, entitlementId, organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.admin.revokeCustomerGrant(
      customerId,
      entitlementId,
      organizationId
    );
  }
);
