/**
 * API Response Types
 *
 * Standardized response type definitions for all Codex API endpoints.
 * Provides consistent response envelopes, pagination formats, and type definitions
 * for improved frontend integration and type safety.
 *
 * All endpoints use these types to ensure:
 * - Consistent pagination metadata
 * - Single-item responses wrapped in { data: T }
 * - List responses use { items: T[], pagination: PaginationMetadata }
 * - Special responses properly typed with JSDoc examples
 *
 * NOTE: Entity-specific response types (ContentResponse, MediaResponse, etc.)
 * are defined in their respective packages (@codex/content, @codex/identity)
 * to avoid circular dependencies.
 */

import type { ProgressData } from './worker-types';

/**
 * Standard pagination metadata for all paginated responses
 * @example
 * {
 *   page: 1,
 *   limit: 20,
 *   total: 145,
 *   totalPages: 8
 * }
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Generic wrapper for paginated list responses
 * All list endpoints return data in this format
 * @template T The type of items in the list
 * @example
 * {
 *   items: [{...}, {...}],
 *   pagination: { page: 1, limit: 20, total: 145, totalPages: 8 }
 * }
 */
export interface PaginatedListResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

/**
 * Generic wrapper for single-item responses
 * All single-item endpoints return data in this format
 * @template T The type of the item
 * @example
 * {
 *   data: {...}
 * }
 */
export interface SingleItemResponse<T> {
  data: T;
}

// ============================================================================
// Content Access Response Types
// ============================================================================

/**
 * Response for GET /api/access/content/:id/stream
 * Provides streaming URL for content playback
 * @example
 * {
 *   streamingUrl: "https://...",
 *   expiresAt: "2025-01-23T15:30:00Z",
 *   contentType: "video/mp4"
 * }
 */
export interface StreamingUrlResponse {
  streamingUrl: string;
  expiresAt: string; // ISO 8601 timestamp
  contentType: string;
}

/**
 * Response for GET /api/access/content/:id/progress
 * Returns current playback progress or null if not started
 * @example
 * {
 *   progress: {
 *     positionSeconds: 1200,
 *     durationSeconds: 3600,
 *     completed: false,
 *     updatedAt: "2025-01-23T15:30:00Z"
 *   }
 * }
 */
export interface PlaybackProgressResponse {
  progress: ProgressData | null;
}

/**
 * Response for GET /api/access/user/library
 * Returns user's library with content and purchase information
 * @example
 * {
 *   items: [{
 *     content: { id, title, description, thumbnailUrl, contentType, durationSeconds },
 *     purchase: { purchasedAt, priceCents },
 *     progress: { positionSeconds, durationSeconds, completed, percentComplete, updatedAt }
 *   }],
 *   pagination: { page, limit, total, totalPages }
 * }
 */
export interface UserLibraryResponse {
  items: Array<{
    content: {
      id: string;
      title: string;
      description: string;
      thumbnailUrl: string | null;
      contentType: string;
      durationSeconds: number;
    };
    purchase: {
      purchasedAt: string; // ISO 8601 timestamp
      priceCents: number;
    };
    progress: (ProgressData & { percentComplete: number }) | null;
  }>;
  pagination: PaginationMetadata;
}

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;

// ============================================================================
// Organization Response Types (generic, not entity-specific)
// ============================================================================

/**
 * Response for DELETE /api/organizations/:id
 * Returns success message with deletion confirmation
 * @example
 * {
 *   success: true,
 *   message: "Organization deleted successfully"
 * }
 */
export interface DeleteOrganizationResponse {
  success: true;
  message: string;
}

/**
 * Response for GET /api/organizations/check-slug/:slug
 * Indicates whether a slug is available for new organizations
 * @example
 * { available: true }
 */
export interface CheckSlugResponse {
  available: boolean;
}

// ============================================================================
// Membership Response Types
// ============================================================================

/**
 * Response for GET /api/organizations/:orgId/membership/:userId
 * Returns the user's role and join date within an organization
 * @example
 * { role: "admin", joinedAt: "2025-06-15T10:30:00.000Z" }
 * // or if not a member:
 * { role: null, joinedAt: null }
 */
// Maintenance: role union must match organizationMembers.role column CHECK constraint
// in packages/database schema. Update both locations if roles change.
export interface MembershipLookupResponse {
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null;
  joinedAt: string | null;
}

/**
 * Response for GET /api/organizations/:orgId/my-membership
 * Returns the authenticated user's own membership in an organization
 * Includes status field to show if membership is active, invited, or inactive
 * @example
 * { role: "admin", status: "active", joinedAt: "2025-06-15T10:30:00.000Z" }
 * // or if not a member:
 * { role: null, status: null, joinedAt: null }
 */
export interface MyMembershipResponse {
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null;
  status: 'active' | 'inactive' | 'invited' | null;
  joinedAt: string | null;
}

/**
 * Organization with user's role
 * Used in my-organizations list response
 */
export interface OrganizationWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member';
}

// ============================================================================
// Settings Response Types
// ============================================================================

/**
 * Branding settings response shape
 */
export interface BrandingSettingsResponse {
  logoUrl: string | null;
  primaryColorHex: string;
}

/**
 * Contact settings response shape
 */
export interface ContactSettingsResponse {
  platformName: string;
  supportEmail: string;
  contactUrl: string | null;
  timezone: string;
  // Social media URLs
  twitterUrl: string | null;
  youtubeUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}

/**
 * Feature settings response shape
 */
export interface FeatureSettingsResponse {
  enableSignups: boolean;
  enablePurchases: boolean;
}

/**
 * All settings combined response shape
 */
export interface AllSettingsResponse {
  branding: BrandingSettingsResponse;
  contact: ContactSettingsResponse;
  features: FeatureSettingsResponse;
}

/**
 * Public branding response shape (for unauthenticated endpoints)
 */
export interface PublicBrandingResponse {
  logoUrl: string | null;
  primaryColorHex: string;
  platformName: string;
}

/**
 * Public creator profile for organization directory
 * Used in public creators list endpoint
 */
export interface PublicCreator {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  contentCount?: number;
}

/**
 * Response for GET /api/organizations/public/:slug/creators
 * Returns paginated list of public creators for an organization
 * @example
 * {
 *   items: [{ id, username, name, avatarUrl, bio, contentCount }],
 *   pagination: { page: 1, limit: 12, total: 45, totalPages: 4 }
 * }
 */
export type PublicCreatorsResponse = PaginatedListResponse<PublicCreator>;

// ============================================================================
// User/Account Response Types
// ============================================================================

/**
 * Response for POST /api/user/avatar
 * Returns the uploaded avatar URL and metadata
 * @example
 * {
 *   data: {
 *     avatarUrl: "https://...",
 *     size: 123456,
 *     mimeType: "image/jpeg"
 *   }
 * }
 */
export interface AvatarUploadResponse {
  data: {
    avatarUrl: string;
    size: number;
    mimeType: string;
  };
}

// ============================================================================
// Account Response Types
// ============================================================================

/**
 * Response for GET /api/user/profile
 * User's profile information including creator profile fields
 * @example
 * {
 *   id: "123e4567-e89b-12d3-a456-426614174000",
 *   name: "Jane Creator",
 *   email: "jane@example.com",
 *   emailVerified: true,
 *   image: "https://...",
 *   username: "janecreator",
 *   bio: "Video creator and educator",
 *   socialLinks: { website: "https://jane.com", twitter: "@janecreator" }
 * }
 */
export interface UserProfileResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  username: string | null;
  bio: string | null;
  socialLinks: {
    website?: string;
    twitter?: string;
    youtube?: string;
    instagram?: string;
  } | null;
}

/**
 * Response for GET/PUT /api/user/notification-preferences
 * User's email notification preferences
 * @example
 * {
 *   emailMarketing: true,
 *   emailTransactional: true,
 *   emailDigest: false
 * }
 */
export interface NotificationPreferencesResponse {
  emailMarketing: boolean;
  emailTransactional: boolean;
  emailDigest: boolean;
}

// ============================================================================
// Analytics Response Types
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
 * Returns revenue statistics broken down by fee distribution and daily revenue
 * @example
 * {
 *   totalRevenueCents: 150000,
 *   totalPurchases: 45,
 *   averageOrderValueCents: 3333,
 *   platformFeeCents: 15000,
 *   organizationFeeCents: 7500,
 *   creatorPayoutCents: 127500,
 *   revenueByDay: [{ date: "2025-01-01", revenueCents: 5000, purchaseCount: 2 }]
 * }
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
 * Returns paginated list of top-performing content by revenue
 * @example
 * {
 *   items: [
 *     { contentId: "abc-123", contentTitle: "My Video", revenueCents: 5000, purchaseCount: 10 }
 *   ],
 *   pagination: { page: 1, limit: 10, total: 10, totalPages: 1 }
 * }
 */
export type TopContentAnalyticsResponse = PaginatedListResponse<{
  contentId: string;
  contentTitle: string;
  revenueCents: number;
  purchaseCount: number;
}>;

// ============================================================================
// Admin Response Types
// ============================================================================

/**
 * Customer list item for admin dashboard
 * Used in PaginatedListResponse<CustomerListItem>
 */
export interface CustomerListItem {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  totalPurchases: number;
  totalSpentCents: number;
}

/**
 * Purchase list item for account payment history
 * Used in PaginatedListResponse<PurchaseListItem>
 */
export interface PurchaseListItem {
  id: string;
  createdAt: string; // ISO 8601 timestamp
  contentId: string;
  contentTitle: string;
  amountCents: number;
  status: 'complete' | 'pending' | 'failed' | 'refunded';
}

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

/**
 * Response for GET /api/admin/activity
 * Returns paginated activity feed
 * @example
 * {
 *   items: [{ id: "1", type: "purchase", title: "New Purchase", description: null, timestamp: "..." }],
 *   pagination: { page: 1, limit: 20, total: 100, totalPages: 5 }
 * }
 */
export interface ActivityFeedResponse {
  items: ActivityItem[];
  pagination: PaginationMetadata;
}
