/**
 * Database Query Helper Utilities
 *
 * Reusable query patterns for common operations across all service classes.
 * These helpers eliminate code duplication and ensure consistent query patterns.
 *
 * Key Patterns:
 * - Soft delete filtering (isNull(deletedAt))
 * - Creator scoping (eq(creatorId, value))
 * - Organization scoping (eq(organizationId, value))
 * - Pagination calculation (offset from page/limit)
 * - Combined scoping patterns
 *
 * Design Principles:
 * - Type-safe with proper Drizzle ORM integration
 * - Composable - can be combined with and() for complex queries
 * - Consistent naming conventions
 * - Zero runtime overhead (inline functions)
 *
 * @example
 * ```typescript
 * import { whereNotDeleted, withCreatorScope } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 * import { and } from 'drizzle-orm';
 *
 * // Query non-deleted content for a specific creator
 * const result = await db.query.content.findMany({
 *   where: and(
 *     whereNotDeleted(content),
 *     withCreatorScope(content, creatorId)
 *   )
 * });
 * ```
 */

import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * Type for a table with a deletedAt column
 * Used to ensure type safety when filtering soft-deleted records
 */
type TableWithDeletedAt = {
  deletedAt: PgColumn;
};

/**
 * Type for a table with a creatorId column
 * Used to ensure type safety when scoping to creator
 */
type TableWithCreatorId = {
  creatorId: PgColumn;
};

/**
 * Type for a table with an organizationId column
 * Used to ensure type safety when scoping to organization
 */
type TableWithOrganizationId = {
  organizationId: PgColumn;
};

/**
 * Filter out soft-deleted records
 *
 * Returns a SQL condition that checks if deletedAt is NULL.
 * Use this in WHERE clauses to exclude soft-deleted records.
 *
 * @param table - Table with deletedAt column
 * @returns SQL condition: isNull(table.deletedAt)
 *
 * @example
 * ```typescript
 * import { whereNotDeleted } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 *
 * // Find all non-deleted content
 * const result = await db.query.content.findMany({
 *   where: whereNotDeleted(content)
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Combine with other conditions using and()
 * import { and, eq } from 'drizzle-orm';
 *
 * const result = await db.query.content.findFirst({
 *   where: and(
 *     whereNotDeleted(content),
 *     eq(content.id, contentId)
 *   )
 * });
 * ```
 */
export function whereNotDeleted<T extends TableWithDeletedAt>(
  table: T
): SQL<unknown> {
  return isNull(table.deletedAt);
}

/**
 * Scope query to a specific creator
 *
 * Returns a SQL condition that filters records by creatorId.
 * Use this for creator-scoped queries to ensure users can only
 * access their own content.
 *
 * @param table - Table with creatorId column
 * @param creatorId - Creator ID to filter by
 * @returns SQL condition: eq(table.creatorId, creatorId)
 *
 * @example
 * ```typescript
 * import { withCreatorScope } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 *
 * // Get content for specific creator
 * const result = await db.query.content.findMany({
 *   where: withCreatorScope(content, 'user-123')
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Combine with whereNotDeleted for complete scoping
 * import { and } from 'drizzle-orm';
 *
 * const result = await db.query.content.findMany({
 *   where: and(
 *     withCreatorScope(content, creatorId),
 *     whereNotDeleted(content)
 *   )
 * });
 * ```
 */
export function withCreatorScope<T extends TableWithCreatorId>(
  table: T,
  creatorId: string
): SQL<unknown> {
  return eq(table.creatorId, creatorId);
}

/**
 * Scope query to a specific organization
 *
 * Returns a SQL condition that filters records by organizationId.
 * Use this for organization-scoped queries to ensure proper
 * multi-tenancy isolation.
 *
 * @param table - Table with organizationId column
 * @param organizationId - Organization ID to filter by
 * @returns SQL condition: eq(table.organizationId, organizationId)
 *
 * @example
 * ```typescript
 * import { withOrgScope } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 *
 * // Get content for specific organization
 * const result = await db.query.content.findMany({
 *   where: withOrgScope(content, 'org-456')
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Filter organization content that's not deleted
 * import { and } from 'drizzle-orm';
 *
 * const result = await db.query.content.findMany({
 *   where: and(
 *     withOrgScope(content, orgId),
 *     whereNotDeleted(content)
 *   )
 * });
 * ```
 */
export function withOrgScope<T extends TableWithOrganizationId>(
  table: T,
  organizationId: string
): SQL<unknown> {
  return eq(table.organizationId, organizationId);
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Current page number (1-indexed) */
  page: number;
  /** Number of items per page */
  limit: number;
}

/**
 * Pagination result with offset
 */
export interface PaginationResult {
  /** Number of items per page */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Calculate pagination offset and limit
 *
 * Converts page-based pagination to offset-based pagination
 * for SQL queries. Page numbers are 1-indexed.
 *
 * @param options - Page number and limit
 * @returns Object with limit and offset for SQL query
 *
 * @example
 * ```typescript
 * import { withPagination } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 *
 * // Get page 2 with 20 items per page
 * const { limit, offset } = withPagination({ page: 2, limit: 20 });
 * // Returns: { limit: 20, offset: 20 }
 *
 * const result = await db.query.content.findMany({
 *   where: whereNotDeleted(content),
 *   limit,
 *   offset
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Use with pagination parameters from API
 * const pagination = { page: 1, limit: 50 };
 * const { limit, offset } = withPagination(pagination);
 *
 * const items = await db.query.content.findMany({
 *   limit,
 *   offset,
 *   orderBy: [desc(content.createdAt)]
 * });
 * ```
 */
export function withPagination(options: PaginationOptions): PaginationResult {
  const { page, limit } = options;
  const offset = (page - 1) * limit;

  return {
    limit,
    offset,
  };
}

/**
 * Combined helper: non-deleted records scoped to creator
 *
 * Combines whereNotDeleted() and withCreatorScope() into a single
 * SQL condition. This is the most common query pattern for
 * creator-owned resources like content and media items.
 *
 * @param table - Table with both deletedAt and creatorId columns
 * @param creatorId - Creator ID to filter by
 * @returns SQL condition combining both filters
 *
 * @example
 * ```typescript
 * import { scopedNotDeleted } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 * import { and, eq } from 'drizzle-orm';
 *
 * // Get specific content item for creator
 * const result = await db.query.content.findFirst({
 *   where: and(
 *     scopedNotDeleted(content, creatorId),
 *     eq(content.id, contentId)
 *   )
 * });
 * ```
 *
 * @example
 * ```typescript
 * // List all content for creator (common pattern)
 * const items = await db.query.content.findMany({
 *   where: scopedNotDeleted(content, creatorId),
 *   limit: 20,
 *   offset: 0
 * });
 * ```
 */
export function scopedNotDeleted<
  T extends TableWithDeletedAt & TableWithCreatorId,
>(table: T, creatorId: string): SQL<unknown> {
  // Note: We compose conditions using and() from drizzle-orm
  return and(isNull(table.deletedAt), eq(table.creatorId, creatorId))!;
}

/**
 * Combined helper: non-deleted records scoped to organization
 *
 * Combines whereNotDeleted() and withOrgScope() into a single
 * SQL condition. Use this for organization-scoped resources to
 * enforce multi-tenancy at the query level.
 *
 * @param table - Table with both deletedAt and organizationId columns
 * @param organizationId - Organization ID to filter by
 * @returns SQL condition combining both filters
 *
 * @example
 * ```typescript
 * import { orgScopedNotDeleted } from '@codex/database/utils';
 * import { content } from '@codex/database/schema';
 * import { and, eq } from 'drizzle-orm';
 *
 * // Get organization content by slug
 * const result = await db.query.content.findFirst({
 *   where: and(
 *     orgScopedNotDeleted(content, orgId),
 *     eq(content.slug, slug)
 *   )
 * });
 * ```
 *
 * @example
 * ```typescript
 * // List all content for organization
 * const items = await db.query.content.findMany({
 *   where: orgScopedNotDeleted(content, orgId),
 *   orderBy: [desc(content.publishedAt)]
 * });
 * ```
 */
export function orgScopedNotDeleted<
  T extends TableWithDeletedAt & TableWithOrganizationId,
>(table: T, organizationId: string): SQL<unknown> {
  // Note: We compose conditions using and() from drizzle-orm
  return and(
    isNull(table.deletedAt),
    eq(table.organizationId, organizationId)
  )!;
}
