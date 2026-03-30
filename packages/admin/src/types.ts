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
 * Revenue statistics for an organization
 */
export interface RevenueStats {
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
  /** Daily revenue breakdown for last 30 days */
  revenueByDay: DailyRevenue[];
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
 * Revenue query options
 */
export interface RevenueQueryOptions {
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
