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
}
