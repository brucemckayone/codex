/**
 * E2E Test Types
 * Re-exports shared types and defines minimal e2e-specific types
 */

// Import types for local use
import type { Organization } from '@codex/database/schema';
import type { SessionData, UserData } from '@codex/shared-types';

// Re-export database types
export type { Content, Organization, User } from '@codex/database/schema';
// Re-export shared types
export type {
  ErrorResponse,
  PaginatedListResponse,
  SessionData,
  SingleItemResponse,
  UserData,
} from '@codex/shared-types';

// Admin domain types — defined locally to avoid cycle (test-utils can't depend on @codex/admin)
// Canonical definitions live in @codex/admin/src/types.ts
export type AdminContentStatus = 'draft' | 'published' | 'archived';

export interface AdminContentItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: AdminContentStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string | null;
  creator?: { id: string; email: string; name: string | null };
}

export interface DailyRevenue {
  date: string;
  revenueCents: number;
  purchaseCount: number;
}

export interface RevenueStats {
  totalRevenueCents: number;
  totalPurchases: number;
  averageOrderValueCents: number;
  platformFeeCents: number;
  organizationFeeCents: number;
  creatorPayoutCents: number;
  revenueByDay: DailyRevenue[];
}

export interface CustomerStats {
  totalCustomers: number;
  newCustomersLast30Days: number;
}

export interface TopContentItem {
  contentId: string;
  contentTitle: string;
  revenueCents: number;
  purchaseCount: number;
}

export interface CustomerWithStats {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date | string;
  totalPurchases: number;
  totalSpentCents: number;
}

export interface PurchaseHistoryItem {
  purchaseId: string;
  contentId: string;
  contentTitle: string;
  amountPaidCents: number;
  purchasedAt: Date | string;
}

export interface CustomerDetails {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date | string;
  totalPurchases: number;
  totalSpentCents: number;
  purchaseHistory: PurchaseHistoryItem[];
}

/**
 * Registered user with session cookie (e2e-specific)
 * Combines auth response with extracted cookie for subsequent requests
 */
export interface RegisteredUser {
  user: UserData;
  session: SessionData;
  cookie: string; // Extracted session cookie for subsequent requests
}

/**
 * Platform owner context with organization (e2e-specific)
 * Combines platform owner user, session, cookie, and their organization
 */
export interface PlatformOwnerContext {
  user: UserData;
  session: SessionData;
  cookie: string;
  organization: Organization;
}
