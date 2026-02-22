/**
 * Admin Dashboard Types
 *
 * Types for admin dashboard services.
 * These are shared types used across admin services and E2E tests.
 */

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
  /** Top performing content by revenue (paginated response) */
  topContent: {
    items: TopContentItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
    };
  };
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
 * Content status for admin filtering
 */
export type AdminContentStatus = 'draft' | 'published' | 'archived';

/**
 * Admin content item with creator info
 */
export interface AdminContentItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: AdminContentStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string | null;
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
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
  createdAt: Date | string;
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
  purchasedAt: Date | string;
}

/**
 * Customer details with purchase history
 */
export interface CustomerDetails {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date | string;
  totalPurchases: number;
  totalSpentCents: number;
  purchaseHistory: PurchaseHistoryItem[];
}
