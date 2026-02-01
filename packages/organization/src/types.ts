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

import type {
  PaginatedListResponse,
  SingleItemResponse,
} from '@codex/shared-types';

/**
 * Pagination parameters for list queries
 */
export interface PaginationParams {
  page: number;
  limit: number;
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

// ============================================================================
// API Response Types
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
