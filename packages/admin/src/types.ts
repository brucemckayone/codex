/**
 * Type definitions for Admin Dashboard Services
 *
 * Imports shared types from @codex/service-errors and @codex/database.
 * Defines admin-specific domain types only.
 */

import type { Content, Purchase, User } from '@codex/database/schema';
import type {
  PaginatedListResponse,
  PaginationMetadata,
  PaginationParams,
} from '@codex/shared-types';

// Re-export ServiceConfig from service-errors (standard pattern)
export type { ServiceConfig } from '@codex/service-errors';

// Re-export pagination types for convenience
export type { PaginatedListResponse, PaginationMetadata, PaginationParams };

// ============================================================================
// Analytics Types
// ============================================================================

/**
 * The four kinds of payment an organisation's revenue is made of
 * (Codex-2hxff.20 WEB-02): one-off content sales, course sales, organisation
 * subscription payments and course-plan (course subscription) payments.
 */
export type RevenueKind = 'one_off' | 'course' | 'subscription' | 'course_plan';

/**
 * Revenue figures for a single period. The standalone block shape is
 * reused inside `RevenueStats.previous` when a comparison period is
 * requested, so the type must stay flat (no nested `previous`).
 *
 * Read from the payouts ledger, one row per Stripe charge of the organisation
 * whose first ledger row falls in the window (owner decision Q1, "Count
 * everything now", 2026-10-26). Each payment counts what the buyer kept: its
 * standing refunds and lost chargebacks come off on the sale's day, and every
 * slice comes off by its share, by the clawback's own rounding (Q-C).
 */
export interface RevenueBlock {
  /** Every kind of payment, in cents, after refunds and lost chargebacks */
  totalRevenueCents: number;
  /** The same total by kind; the four add up to `totalRevenueCents` */
  revenueByKind: Record<RevenueKind, number>;
  /** One-off and course sales not refunded in full (sales only, S1) */
  totalPurchases: number;
  /** One-off and course revenue over `totalPurchases`, in cents (sales only) */
  averageOrderValueCents: number;
  /** Codex's fee on every kind, subscriptions included, after its share of refunds */
  platformFeeCents: number;
  /**
   * What is left once Codex's fee and the creators' cut are taken: the
   * organisation's own share. It absorbs the rounding pennies of a partial
   * refund, so the statement adds up to the penny.
   */
  organizationFeeCents: number;
  /** The creators' cut of every kind, after its share of refunds */
  creatorPayoutCents: number;
  /**
   * One entry per UTC calendar day of the window, oldest first, zero-filled
   * (Codex-2hxff.75). `revenueCents` counts every kind; `purchaseCount`
   * counts sales only, like `totalPurchases`.
   */
  revenueByDay: DailyRevenue[];
}

/**
 * Revenue statistics for an organization. Fields are inherited from
 * RevenueBlock; `previous` is populated only when compareFrom/compareTo
 * are provided so existing callers keep their original shape.
 */
export interface RevenueStats extends RevenueBlock {
  /** Comparison-period figures — present only when requested */
  previous?: RevenueBlock;
}

/**
 * One UTC calendar day of revenue. A block's list has one per day of its
 * window, oldest first, with days that had no payment at zero.
 */
export interface DailyRevenue {
  date: string; // ISO date string YYYY-MM-DD
  revenueCents: number;
  purchaseCount: number;
}

/**
 * One UTC calendar day of new subscribers; a block's list has one per day of
 * its window, oldest first, zero-filled (Codex-2hxff.75).
 */
export interface DailySubscribers {
  date: string; // ISO date string YYYY-MM-DD
  newSubscribers: number;
}

/**
 * Subscriber figures for a single period. The standalone block shape is
 * reused inside `SubscriberStats.previous` when a comparison period is
 * requested, so the type must stay flat (no nested `previous`).
 */
export interface SubscriberBlock {
  /** Subscriptions alive at the end of the period (active / past_due / cancelling) */
  activeSubscribers: number;
  /** Subscriptions created within the period */
  newSubscribers: number;
  /** Subscriptions cancelled within the period */
  churnedSubscribers: number;
  /** Daily new-subscriber breakdown across the queried period */
  subscribersByDay: DailySubscribers[];
}

/**
 * Subscriber statistics for an organization. Fields are inherited from
 * SubscriberBlock; `previous` is populated only when compareFrom/compareTo
 * are provided so existing callers keep their original shape.
 */
export interface SubscriberStats extends SubscriberBlock {
  /** Comparison-period figures — present only when requested */
  previous?: SubscriberBlock;
}

/**
 * Subscriber query options. `compareFrom`/`compareTo` opt into the
 * previous-period block on the response; if either is missing the comparison
 * is skipped.
 */
export interface SubscriberQueryOptions {
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/**
 * One UTC calendar day of new followers; a block's list has one per day of
 * its window, oldest first, zero-filled (Codex-2hxff.75).
 */
export interface DailyFollowers {
  date: string; // ISO date string YYYY-MM-DD
  newFollowers: number;
}

/**
 * Follower figures for a single period. The standalone block shape is
 * reused inside `FollowerStats.previous` when a comparison period is
 * requested, so the type must stay flat (no nested `previous`).
 *
 * Note: following has no status/cancellation column — unfollowing
 * hard-deletes the row. `totalFollowers` is therefore an approximation
 * of "rows that existed and were created by the end of the period"; a
 * user who followed and then unfollowed within the window leaves no
 * trace. Live "active follower" counts are only accurate when
 * `endDate` is now.
 */
export interface FollowerBlock {
  /** Rows created on or before the end of the period (approximation — see note) */
  totalFollowers: number;
  /** Follows created within the period */
  newFollowers: number;
  /** Daily new-follower breakdown across the queried period */
  followersByDay: DailyFollowers[];
}

/**
 * Follower statistics for an organization. Fields are inherited from
 * FollowerBlock; `previous` is populated only when compareFrom/compareTo
 * are provided so existing callers keep their original shape.
 */
export interface FollowerStats extends FollowerBlock {
  /** Comparison-period figures — present only when requested */
  previous?: FollowerBlock;
}

/**
 * Follower query options. `compareFrom`/`compareTo` opt into the
 * previous-period block on the response; if either is missing the comparison
 * is skipped.
 */
export interface FollowerQueryOptions {
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/**
 * Customer statistics for an organization
 */
export interface CustomerStats {
  /** Total unique customers (users with completed purchases) */
  totalCustomers: number;
  /** Customers whose first purchase was in last 30 days */
  newCustomersLast30Days: number;
  /**
   * Customers whose first purchase was in the last 7 UTC calendar days, today
   * included: the dashboard's "new customers this week".
   */
  newCustomersLast7Days: number;
}

/**
 * Top content item by revenue.
 *
 * `viewsInPeriod` counts distinct users with a `videoPlayback` row updated
 * within the current period — a single row per (user, content) means this is
 * "distinct engaged viewers", not total impressions. `trendDelta` is the
 * revenue change vs the previous period in cents; it is `null` when
 * `compareFrom`/`compareTo` are not provided (so existing callers that don't
 * request a comparison keep a stable shape).
 */
export interface TopContentItem {
  contentId: string;
  contentTitle: string;
  /** Content thumbnail URL (custom-uploaded) for leaderboard rendering — null when not set */
  thumbnailUrl: string | null;
  revenueCents: number;
  purchaseCount: number;
  /** Distinct users with playback activity in the current period */
  viewsInPeriod: number;
  /** Revenue change vs previous period in cents — null when comparison not requested */
  trendDelta: number | null;
}

/**
 * Top-content query options. `compareFrom`/`compareTo` opt into per-row
 * `trendDelta` on the response; if either is missing the delta stays null
 * and the query matches a single-period shape.
 */
export interface TopContentQueryOptions {
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/**
 * Per-content engagement row sourced from video_playback joined to content.
 *
 * Notes on the metrics:
 *  - `totalViews` is `COUNT(DISTINCT user_id)` over video_playback rows
 *    whose `updated_at` sits inside the window — one row per (user, content)
 *    is enforced by the table's composite unique, so this is "distinct
 *    engaged viewers", not total impressions or session counts.
 *  - `totalWatchTimeSeconds` is `SUM(position_seconds)`. Because playback
 *    state is an upserted last-known position (not an append-only log), a
 *    user who scrubbed backward leaves a smaller position behind — this is
 *    therefore a lower-bound proxy for watch time, not an exact stopwatch.
 *  - `avgCompletionPercent` averages `position_seconds / duration_seconds`
 *    across rows, clamped 0..100 per-row so corrupt positions beyond the
 *    duration cannot blow the mean past the display range. Rows with
 *    `duration_seconds = 0` resolve to NULL via a CASE guard (not NULLIF
 *    — `GREATEST(0, NULL)` collapses to 0 in Postgres, which would have
 *    smuggled a 0% row back into the average), so AVG skips them cleanly.
 *  - Content with zero playback activity still appears (LEFT JOIN), with
 *    `totalViews = 0`, `totalWatchTimeSeconds = 0`, and
 *    `avgCompletionPercent = 0`.
 *  - `trendDelta` is the change in `totalWatchTimeSeconds` vs the previous
 *    window; `null` when `compareFrom`/`compareTo` are not supplied.
 */
export interface ContentPerformanceItem {
  contentId: string;
  title: string;
  totalViews: number;
  totalWatchTimeSeconds: number;
  avgCompletionPercent: number;
  trendDelta: number | null;
}

/**
 * Content-performance query options. `compareFrom`/`compareTo` opt into
 * per-row `trendDelta` (change in total watch-time vs previous window);
 * if either is missing the delta stays null.
 */
export interface ContentPerformanceQueryOptions {
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/**
 * Revenue query options. `compareFrom`/`compareTo` opt into the previous-period
 * block on the response; if either is missing the comparison is skipped.
 */
export interface RevenueQueryOptions {
  startDate?: Date;
  endDate?: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/**
 * A creator's share under one kind of agreement, in a shape that cannot be
 * mistaken for 0% (Codex-zsh2p).
 *
 * - `none`: no active agreement of this kind. Shown "None" (owner decision
 *   2026-10-26).
 * - `unreadable`: an active agreement with no current proposal, so no share
 *   on record: it pays nothing. Shown "—", never "0%" (fazy6, 2026-10-25).
 * - `share`: a display percentage (0..100), never basis points.
 */
export type AgreementShare =
  | { kind: 'none' }
  | { kind: 'unreadable' }
  | { kind: 'share'; percent: number };

/**
 * One creator on Studio > Analytics "Revenue by creator" (Codex-zsh2p, owner
 * decisions Q3 and Q-E, 2026-10-26). One row per creator who holds an active
 * agreement in the organisation, earned a slice in the window, or is still
 * owed money.
 *
 *  - `earnedCents`: their `creator_payout` slices on the organisation's
 *    charges in the window, every kind, sent or not, less the share their
 *    refunds and lost chargebacks took (the revenue block's rule). The owner
 *    pool (`creator_payout_to_owner`) is the organisation's money, not a
 *    creator's cut. The Payouts page's "earned" stays money sent.
 *  - `subscriptionShare` / `salesShare`: from their active `subscription` /
 *    `content_purchase` agreement's current proposal, as the payment resolver
 *    reads it. Sales covers one-off and course sales.
 *  - `lastPayoutAt`: the latest `resolved_at` of their paid `creator_payout`
 *    rows in this organisation, ever; `null` when nothing has been sent.
 *  - `pendingPayoutCents`: money this organisation owes them and has not yet
 *    sent: their pending and failed `creator_payout` rows (those held for
 *    review or by an open dispute included), less what partial refunds
 *    already took off each (done `pending_reduction` steps).
 */
export interface CreatorRevenueSplitItem {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  earnedCents: number;
  subscriptionShare: AgreementShare;
  salesShare: AgreementShare;
  lastPayoutAt: string | null; // ISO string for JSON-safe transport
  pendingPayoutCents: number;
}

/**
 * Options for `AdminAnalyticsService.getRevenueByCreator`. Date filter is
 * optional and aligns with the existing studio analytics window primitives.
 */
export interface CreatorRevenueQueryOptions {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Dashboard stats - combined metrics for studio overview
 * Includes revenue, customer, and top content data for dashboard view
 */
export interface DashboardStats {
  /** Revenue metrics and daily breakdown */
  revenue: RevenueStats;
  /** Customer counts and new customer metrics */
  customers: CustomerStats;
  /** Top performing content by revenue (paginated response for consistency) */
  topContent: PaginatedListResponse<TopContentItem>;
}

/**
 * Dashboard stats query options
 */
export interface DashboardStatsOptions {
  startDate?: Date;
  endDate?: Date;
  topContentLimit?: number;
}

// ============================================================================
// Content Management Types
// ============================================================================

/**
 * Content item with creator info for admin view
 */
export interface AdminContentItem extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Content status for admin filtering
 */
export type AdminContentStatus = 'draft' | 'published' | 'archived';

/**
 * Options for listing content in admin dashboard
 * Extends standard pagination with optional status filter
 */
export interface AdminContentListOptions extends PaginationParams {
  status?: AdminContentStatus;
}

// ============================================================================
// Customer Management Types
// ============================================================================

/**
 * Customer with aggregated purchase stats
 */
export interface CustomerWithStats {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  totalPurchases: number;
  totalSpentCents: number;
}

/**
 * Purchase history item for customer details
 */
export interface PurchaseHistoryItem {
  purchaseId: string;
  contentId: string;
  contentTitle: string;
  amountPaidCents: number;
  purchasedAt: Date;
}

/**
 * Customer details with purchase history
 */
export interface CustomerDetails {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  totalPurchases: number;
  totalSpentCents: number;
  purchaseHistory: PurchaseHistoryItem[];
}

/**
 * A support grant in the Studio customer drawer (a `grant` entitlement).
 * Revoked grants are listed too, as the audit trail. Dates are ISO 8601.
 * A name is `null` when that person's account has been deleted.
 */
export interface CustomerGrant {
  /** The entitlement id — what the revoke route takes. */
  id: string;
  contentId: string;
  contentTitle: string;
  contentSlug: string;
  grantedAt: string;
  grantedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
}

// ============================================================================
// Analytics Response Types (canonical home — moved from @codex/shared-types)
// ============================================================================

/**
 * Revenue data point for a specific day
 */
export interface RevenueByDay {
  date: string;
  revenueCents: number;
  purchaseCount: number;
}

/**
 * Response for GET /api/admin/analytics/revenue
 */
export interface RevenueAnalyticsResponse {
  totalRevenueCents: number;
  revenueByKind: Record<RevenueKind, number>;
  totalPurchases: number;
  averageOrderValueCents: number;
  platformFeeCents: number;
  organizationFeeCents: number;
  creatorPayoutCents: number;
  revenueByDay: RevenueByDay[];
}

/**
 * Response for GET /api/admin/analytics/top-content
 */
export type TopContentAnalyticsResponse = PaginatedListResponse<{
  contentId: string;
  contentTitle: string;
  revenueCents: number;
  purchaseCount: number;
}>;

/**
 * Customer list item for admin dashboard
 */
export interface CustomerListItem {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  totalPurchases: number;
  totalSpentCents: number;
}

// ============================================================================
// Activity Feed Types
// ============================================================================

/**
 * Activity feed item type
 */
export type ActivityItemType =
  | 'purchase'
  | 'content_published'
  | 'member_joined';

/**
 * Individual activity feed item
 */
export interface ActivityItem {
  id: string;
  type: ActivityItemType;
  title: string;
  description: string | null;
  timestamp: string;
}

// Keep legacy alias
export type { ActivityItem as ActivityFeedItem };

/**
 * Response for GET /api/admin/activity
 */
export interface ActivityFeedResponse {
  items: ActivityItem[];
  pagination: PaginationMetadata;
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { Content, Purchase, User };
