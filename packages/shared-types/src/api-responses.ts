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
 */

import type {
  Content,
  ContentWithRelations,
  MediaItem,
  MediaItemWithRelations,
} from '@codex/content';
import type { Organization } from '@codex/identity';

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
// Content Response Types
// ============================================================================

/**
 * Response for GET /api/content/:id
 * Returns a single content item with full relations
 */
export type ContentResponse = SingleItemResponse<ContentWithRelations>;

/**
 * Response for GET /api/content
 * Returns paginated list of content items with relations
 */
export type ContentListResponse = PaginatedListResponse<ContentWithRelations>;

/**
 * Response for POST /api/content
 * Returns newly created content item
 */
export type CreateContentResponse = SingleItemResponse<Content>;

/**
 * Response for PATCH /api/content/:id
 * Returns updated content item
 */
export type UpdateContentResponse = SingleItemResponse<Content>;

/**
 * Response for POST /api/content/:id/publish
 * Returns published content item
 */
export type PublishContentResponse = SingleItemResponse<Content>;

/**
 * Response for POST /api/content/:id/unpublish
 * Returns unpublished content item
 */
export type UnpublishContentResponse = SingleItemResponse<Content>;

/**
 * Response for DELETE /api/content/:id
 * Returns null (204 No Content)
 */
export type DeleteContentResponse = null;

// ============================================================================
// Media Response Types
// ============================================================================

/**
 * Response for GET /api/media/:id
 * Returns a single media item with full relations
 */
export type MediaResponse = SingleItemResponse<MediaItemWithRelations>;

/**
 * Response for GET /api/media
 * Returns paginated list of media items with relations
 */
export type MediaListResponse = PaginatedListResponse<MediaItemWithRelations>;

/**
 * Response for POST /api/media
 * Returns newly created media item
 */
export type CreateMediaResponse = SingleItemResponse<MediaItem>;

/**
 * Response for PATCH /api/media/:id
 * Returns updated media item
 */
export type UpdateMediaResponse = SingleItemResponse<MediaItem>;

/**
 * Response for DELETE /api/media/:id
 * Returns null (204 No Content)
 */
export type DeleteMediaResponse = null;

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
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    updatedAt: string; // ISO 8601 timestamp
  } | null;
}

/**
 * Response for GET /api/access/user/library
 * Returns user's library with content and purchase information
 * IMPORTANT: Replaces inline type definition at ContentAccessService:394-426
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
    progress: {
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
      percentComplete: number;
      updatedAt: string; // ISO 8601 timestamp
    } | null;
  }>;
  pagination: PaginationMetadata;
}

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;

// ============================================================================
// Organization Response Types
// ============================================================================

/**
 * Response for GET /api/organizations/:id
 * Returns a single organization
 */
export type OrganizationResponse = SingleItemResponse<Organization>;

/**
 * Response for GET /api/organizations
 * Returns paginated list of organizations
 */
export type OrganizationListResponse = PaginatedListResponse<Organization>;

/**
 * Response for GET /api/organizations/slug/:slug
 * Returns organization by slug
 */
export type OrganizationBySlugResponse = SingleItemResponse<Organization>;

/**
 * Response for POST /api/organizations
 * Returns newly created organization
 */
export type CreateOrganizationResponse = SingleItemResponse<Organization>;

/**
 * Response for PATCH /api/organizations/:id
 * Returns updated organization
 */
export type UpdateOrganizationResponse = SingleItemResponse<Organization>;

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
