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
 * Revenue figures for a single period. The standalone block shape is
 * reused inside `RevenueStats.previous` when a comparison period is
 * requested, so the type must stay flat (no nested `previous`).
 */
export interface RevenueBlock {
  /** Total revenue in cents (gross) */
  totalRevenueCents: number;
  /** Total number of completed purchases */
  totalPurchases: number;
  /** Average order value in cents */
  averageOrderValueCents: number;
  /** Platform fee collected in cents */
  platformFeeCents: number;
  /** Organization fee in cents */
  organizationFeeCents: number;
  /** Creator payout amount in cents */
  creatorPayoutCents: number;
  /** Daily revenue breakdown across the queried period */
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
 * Daily revenue breakdown
 */
export interface DailyRevenue {
  date: string; // ISO date string YYYY-MM-DD
  revenueCents: number;
  purchaseCount: number;
}

/**
 * Daily new-subscriber breakdown
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
 * Customer statistics for an organization
 */
export interface CustomerStats {
  /** Total unique customers (users with completed purchases) */
  totalCustomers: number;
  /** Customers whose first purchase was in last 30 days */
  newCustomersLast30Days: number;
}

/**
 * Top content item by revenue
 */
export interface TopContentItem {
  contentId: string;
  contentTitle: string;
  revenueCents: number;
  purchaseCount: number;
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
