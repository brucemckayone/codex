/**
 * Type definitions for Content Management Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { dbHttp, dbWs } from '@codex/database';
import type {
  Content,
  MediaItem,
  NewContent,
  NewMediaItem,
} from '@codex/database/schema';
import type { Organization } from '@codex/organization';

/**
 * Database client type (properly typed from Drizzle)
 * Supports both HTTP (production) and WebSocket (tests) clients
 */
export type Database = typeof dbHttp | typeof dbWs;

/**
 * Transaction type for Drizzle ORM
 * Used for multi-step database operations
 */
export type DatabaseTransaction = Parameters<
  Parameters<typeof dbHttp.transaction>[0]
>[0];

/**
 * Configuration for service initialization
 */
export interface ServiceConfig {
  db: Database;
  environment: string;
}

//TODO: seems like we have paginiation types that could be better placed in some sort of shared types folder or better yet defined in the zod validation
/**
 * Pagination parameters for list queries
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

//TODO: seems like we have paginiation types that could be better placed in some sort of shared types folder
/**
 * Pagination metadata in responses
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

//TODO: seems like we have paginiation types that could be better placed in some sort of shared types folder or better yet defined in the zod validation
/**
 * Paginated response structure
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

/**
 * Sort order enum
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Content query filters
 */
export interface ContentFilters {
  status?: 'draft' | 'published' | 'archived';
  contentType?: 'video' | 'audio' | 'written';
  visibility?: 'public' | 'private' | 'members_only' | 'purchased_only';
  category?: string;
  organizationId?: string | null;
  search?: string;
  sortBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt'
    | 'title'
    | 'viewCount'
    | 'purchaseCount';
  sortOrder?: SortOrder;
}

/**
 * Media item query filters
 */
export interface MediaItemFilters {
  status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed';
  mediaType?: 'video' | 'audio';
  sortBy?: 'createdAt' | 'uploadedAt' | 'title';
  sortOrder?: SortOrder;
}

/**
 * Content with populated relations
 */
export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
  organization?: Organization | null;
  mediaItem?: MediaItem | null;
}

/**
 * Media item with populated relations
 */
export interface MediaItemWithRelations extends MediaItem {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Re-export database types for convenience
 */
export type { Content, MediaItem };
export type { NewContent, NewMediaItem };

// ============================================================================
// API Response Types
// ============================================================================

import type {
  PaginatedListResponse,
  SingleItemResponse,
} from '@codex/shared-types';

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
