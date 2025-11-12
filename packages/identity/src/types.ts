/**
 * Type definitions for Identity Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { db, dbWs } from '@codex/database';
import type { Organization, NewOrganization } from '@codex/database/schema';

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
