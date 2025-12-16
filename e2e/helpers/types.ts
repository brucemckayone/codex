/**
 * E2E Test Types
 * Re-exports shared types and defines minimal e2e-specific types
 */

// Import types for local use
import type { Organization } from '@codex/database/schema';
import type { SessionData, UserData } from '@codex/shared-types';

// Re-export admin types from @codex/admin (single source of truth)
export type {
  AdminContentItem,
  AdminContentStatus,
  CustomerDetails,
  CustomerStats,
  CustomerWithStats,
  DailyRevenue,
  PaginatedResponse as AdminPaginatedResponse,
  PurchaseHistoryItem,
  RevenueStats,
  TopContentItem,
} from '@codex/admin';
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
