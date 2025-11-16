/**
 * Organization Service
 *
 * Manages organizations for content grouping.
 * Organizations are separate from "personal" content (organizationId = null).
 *
 * Key Principles:
 * - NO `any` types - all types properly inferred from Drizzle
 * - Proper error handling with custom error classes
 * - Soft deletes only (sets deleted_at)
 * - Slug uniqueness enforced
 */

import { isUniqueViolation } from '@codex/database';
import { organizations } from '@codex/database/schema';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@codex/validation';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/validation';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { ConflictError, OrganizationNotFoundError, wrapError } from '../errors';
import type {
  Database,
  Organization,
  OrganizationFilters,
  PaginatedResponse,
  PaginationParams,
  ServiceConfig,
} from '../types';

/**
 * Organization Service Class
 *
 * Handles all organization-related business logic:
 * - Create organizations
 * - Update organization metadata
 * - Delete organizations (soft delete)
 * - List organizations with filters
 */
export class OrganizationService {
  private db: Database;
  private environment: string;

  constructor(config: ServiceConfig) {
    this.db = config.db;
    this.environment = config.environment;
  }

  /**
   * Create new organization
   *
   * Security:
   * - Validates slug uniqueness
   * - Sanitizes URLs
   *
   * @param input - Organization creation data
   * @returns Created organization
   * @throws {ConflictError} If slug already exists
   */
  async create(input: CreateOrganizationInput): Promise<Organization> {
    // Validate input with Zod
    const validated = createOrganizationSchema.parse(input);

    try {
      const [newOrganization] = await this.db
        .insert(organizations)
        .values({
          name: validated.name,
          slug: validated.slug,
          description: validated.description || null,
          logoUrl: validated.logoUrl || null,
          websiteUrl: validated.websiteUrl || null,
        })
        .returning();

      if (!newOrganization) {
        throw new Error('Failed to create organization');
      }

      return newOrganization;
    } catch (error) {
      // Handle unique constraint violations (slug conflicts)
      if (isUniqueViolation(error)) {
        throw new ConflictError('Organization slug already exists', {
          slug: validated.slug,
        });
      }
      throw wrapError(error, { input: validated });
    }
  }

  /**
   * Get organization by ID
   *
   * @param id - Organization ID
   * @returns Organization or null if not found/deleted
   */
  async get(id: string): Promise<Organization | null> {
    try {
      const result = await this.db.query.organizations.findFirst({
        where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
      });

      return result || null;
    } catch (error) {
      throw wrapError(error, { organizationId: id });
    }
  }

  /**
   * Get organization by slug
   *
   * @param slug - Organization slug
   * @returns Organization or null if not found/deleted
   */
  async getBySlug(slug: string): Promise<Organization | null> {
    try {
      const result = await this.db.query.organizations.findFirst({
        where: and(
          eq(organizations.slug, slug.toLowerCase()),
          isNull(organizations.deletedAt)
        ),
      });

      return result || null;
    } catch (error) {
      throw wrapError(error, { slug });
    }
  }

  /**
   * Update organization
   *
   * @param id - Organization ID
   * @param input - Partial update data
   * @returns Updated organization
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   * @throws {ConflictError} If new slug conflicts with existing organization
   */
  async update(
    id: string,
    input: UpdateOrganizationInput
  ): Promise<Organization> {
    // Validate input
    const validated = updateOrganizationSchema.parse(input);

    try {
      const result = await this.db.transaction(async (tx) => {
        // Verify organization exists
        const existing = await tx.query.organizations.findFirst({
          where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
        });

        if (!existing) {
          throw new OrganizationNotFoundError(id);
        }

        // Update organization
        const [updated] = await tx
          .update(organizations)
          .set({
            ...validated,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, id))
          .returning();

        if (!updated) {
          throw new OrganizationNotFoundError(id);
        }

        return updated;
      });

      if (!result) {
        throw new OrganizationNotFoundError(id);
      }

      return result;
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      // Handle slug conflicts
      if (isUniqueViolation(error)) {
        throw new ConflictError('Organization slug already exists', {
          slug: validated.slug,
        });
      }
      throw wrapError(error, { organizationId: id, input: validated });
    }
  }

  /**
   * Soft delete organization
   *
   * Note: Content belonging to this organization will remain but show as "deleted organization"
   *
   * @param id - Organization ID
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   */
  async delete(id: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx.query.organizations.findFirst({
          where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
        });

        if (!existing) {
          throw new OrganizationNotFoundError(id);
        }

        await tx
          .update(organizations)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, id));
      });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId: id });
    }
  }

  /**
   * List organizations with filtering and pagination
   *
   * Features:
   * - Pagination (page, limit)
   * - Search (name, description)
   * - Sorting (by createdAt, name)
   *
   * @param filters - Query filters
   * @param pagination - Pagination parameters
   * @returns Paginated organization list with metadata
   */
  async list(
    filters: OrganizationFilters = {},
    pagination: PaginationParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<Organization>> {
    try {
      const { page, limit } = pagination;
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions = [isNull(organizations.deletedAt)];

      // Add search filter
      if (filters.search) {
        whereConditions.push(
          or(
            ilike(organizations.name, `%${filters.search}%`),
            ilike(organizations.description ?? '', `%${filters.search}%`)
          )!
        );
      }

      // Determine sort column and order
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        sortOrder === 'desc'
          ? desc(organizations[sortColumn])
          : asc(organizations[sortColumn]);

      // Get items
      const items = await this.db.query.organizations.findMany({
        where: and(...whereConditions),
        limit,
        offset,
        orderBy: [orderByClause],
      });

      // Get total count
      const countResult = await this.db
        .select({ total: count() })
        .from(organizations)
        .where(and(...whereConditions));

      const totalRecord = countResult[0];
      if (!totalRecord) {
        throw new Error('Failed to get organization count');
      }

      const { total } = totalRecord;

      const totalCount = Number(total);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        items,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
        },
      };
    } catch (error) {
      throw wrapError(error, { filters, pagination });
    }
  }

  /**
   * Check if slug is available
   *
   * Useful for frontend validation before creating organization
   *
   * @param slug - Slug to check
   * @returns True if slug is available, false if taken
   */
  async isSlugAvailable(slug: string): Promise<boolean> {
    try {
      const existing = await this.db.query.organizations.findFirst({
        where: and(
          eq(organizations.slug, slug.toLowerCase()),
          isNull(organizations.deletedAt)
        ),
        columns: { id: true },
      });

      return !existing;
    } catch (error) {
      throw wrapError(error, { slug });
    }
  }
}

/**
 * Factory function to create OrganizationService instance
 *
 * Usage:
 * ```typescript
 * const service = createOrganizationService({ db, environment: 'production' });
 * const org = await service.create(input);
 * ```
 */
export function createOrganizationService(
  config: ServiceConfig
): OrganizationService {
  return new OrganizationService(config);
}
