/**
 * Type definitions for Identity Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { DatabaseClient } from '@codex/database';
import type { NewOrganization, Organization } from '@codex/database/schema';

/**
 * Database client type — re-exported from `@codex/database` so consumers
 * see a single canonical shape. Accepts HTTP or WS clients (services
 * read under HTTP in workers and WS in tests).
 */
export type Database = DatabaseClient;

import type {
  PaginatedListResponse,
  PaginationParams,
  SingleItemResponse,
  SortOrder,
} from '@codex/shared-types';

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
export type { PaginationParams, SortOrder };

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
