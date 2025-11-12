/**
 * Type definitions for Content Management Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { db, dbWs } from '@codex/database';
import type {
  Content,
  MediaItem,
  NewContent,
  NewMediaItem,
} from '@codex/database/schema';
import type { Organization } from '@codex/identity';

/**
 * Database client type (properly typed from Drizzle)
 * Supports both HTTP (production) and WebSocket (tests) clients
 */
export type Database = typeof db | typeof dbWs;

/**
 * Transaction type for Drizzle ORM
 * Used for multi-step database operations
 */
export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Configuration for service initialization
 */
export interface ServiceConfig {
  db: Database;
  environment: string;
}

/**
 * Pagination parameters for list queries
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Pagination metadata in responses
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

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
