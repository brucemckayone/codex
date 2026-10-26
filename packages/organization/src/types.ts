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

/**
 * An organisation as `get`, `getBySlug` and `list` return it: every column but
 * `primaryConnectAccountUserId`, the payee's user id (Codex-kk6zx). Their
 * routes check sign-in, not membership, so a whole row let any free account
 * list every org's payee. Nothing reads the column (payee resolution retired
 * it, see packages/payments/src/resolve-organisation-payee.ts), so no reader
 * loses anything.
 */
export type ReadableOrganization = Omit<
  Organization,
  'primaryConnectAccountUserId'
>;

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response for GET /api/organizations/:id
 * Returns a single organization
 */
export type OrganizationResponse = SingleItemResponse<ReadableOrganization>;

/**
 * Response for GET /api/organizations
 * Returns paginated list of organizations
 */
export type OrganizationListResponse =
  PaginatedListResponse<ReadableOrganization>;

/**
 * Response for GET /api/organizations/slug/:slug
 * Returns organization by slug
 */
export type OrganizationBySlugResponse =
  SingleItemResponse<ReadableOrganization>;

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
