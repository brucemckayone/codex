/**
 * Type definitions for Identity Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { dbHttp, dbWs } from '@codex/database';
import type { NewOrganization, Organization } from '@codex/database/schema';

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

//TODO: seems like we have paginiation types that could be better placed in some sort of shared types folder or better yet defined in the zod validation
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
 * Organization query filters
 */
export interface OrganizationFilters {
  search?: string;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: SortOrder;
}

/**
 * Re-export database types for convenience
 */
export type { Organization, NewOrganization };
