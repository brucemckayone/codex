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

import { PAGINATION, RESERVED_SUBDOMAINS_SET } from '@codex/constants';
import {
  isUniqueViolation,
  whereNotDeleted,
  withPagination,
} from '@codex/database';
import {
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { BaseService } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@codex/validation';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/validation';
import { and, asc, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import {
  ConflictError,
  LastOwnerError,
  MemberNotFoundError,
  NotFoundError,
  OrganizationNotFoundError,
  wrapError,
} from '../errors';
import type {
  Organization,
  OrganizationFilters,
  PaginationParams,
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
export class OrganizationService extends BaseService {
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
      // Diagnostic logging for debugging connection/constraint issues
      this.obs?.error('Organization creation failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        isUniqueViolation: isUniqueViolation(error),
        slug: validated.slug,
        environment: this.environment,
      });

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
        where: and(eq(organizations.id, id), whereNotDeleted(organizations)),
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
          whereNotDeleted(organizations)
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
          where: and(eq(organizations.id, id), whereNotDeleted(organizations)),
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
          where: and(eq(organizations.id, id), whereNotDeleted(organizations)),
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
    pagination: PaginationParams = { page: 1, limit: PAGINATION.DEFAULT }
    //TODO: seems like we have paginiation types that could be better placed in some sort of shared types folder or better yet defined in the zod validation
  ): Promise<PaginatedListResponse<Organization>> {
    try {
      const { limit, offset } = withPagination(pagination);

      // Build WHERE conditions
      const whereConditions = [whereNotDeleted(organizations)];

      // Add search filter
      if (filters.search) {
        const searchCondition = or(
          ilike(organizations.name, `%${filters.search}%`),
          ilike(organizations.description ?? '', `%${filters.search}%`)
        );
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Determine sort column and order
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        sortOrder === 'desc'
          ? desc(organizations[sortColumn])
          : asc(organizations[sortColumn]);

      // Get items (secondary sort by id ensures deterministic pagination)
      const items = await this.db.query.organizations.findMany({
        where: and(...whereConditions),
        limit,
        offset,
        orderBy: [orderByClause, asc(organizations.id)],
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
          page: pagination.page,
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
   * Checks both the reserved subdomains list (infrastructure conflicts)
   * and database uniqueness (existing organizations).
   *
   * @param slug - Slug to check
   * @returns True if slug is available, false if taken or reserved
   */
  async isSlugAvailable(slug: string): Promise<boolean> {
    const normalizedSlug = slug.toLowerCase();

    // Reject reserved subdomains (cdn, auth, api, etc.)
    if (RESERVED_SUBDOMAINS_SET.has(normalizedSlug)) {
      return false;
    }

    try {
      const existing = await this.db.query.organizations.findFirst({
        where: and(
          eq(organizations.slug, normalizedSlug),
          whereNotDeleted(organizations)
        ),
        columns: { id: true },
      });

      return !existing;
    } catch (error) {
      throw wrapError(error, { slug });
    }
  }

  /**
   * Get public creators for an organization by slug
   *
   * Returns public-safe creator information (no emails, no internal IDs).
   * Only active members with owner/admin/creator roles are included.
   *
   * @param slug - Organization slug
   * @returns Array of public creator profiles
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   */
  async getPublicCreators(slug: string): Promise<
    Array<{
      name: string;
      avatarUrl: string | null;
      role: string;
      joinedAt: Date;
    }>
  > {
    try {
      const org = await this.db.query.organizations.findFirst({
        where: and(
          eq(organizations.slug, slug.toLowerCase()),
          whereNotDeleted(organizations)
        ),
        columns: { id: true },
      });

      if (!org) {
        throw new OrganizationNotFoundError(slug);
      }

      const members = await this.db
        .select({
          name: users.name,
          avatarUrl: users.avatarUrl,
          image: users.image,
          role: organizationMemberships.role,
          joinedAt: organizationMemberships.createdAt,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.status, 'active'),
            inArray(organizationMemberships.role, ['owner', 'admin', 'creator'])
          )
        );

      return members.map((m) => ({
        name: m.name,
        avatarUrl: m.avatarUrl ?? m.image ?? null,
        role: m.role,
        joinedAt: m.joinedAt,
      }));
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      throw wrapError(error, { slug });
    }
  }

  /**
   * List organization members with pagination and filters
   *
   * @param organizationId - Organization ID
   * @param query - Pagination and filter params
   * @returns Paginated list of members
   */
  async listMembers(
    organizationId: string,
    query: {
      page: number;
      limit: number;
      role?: string;
      status?: string;
    }
  ): Promise<
    PaginatedListResponse<{
      id: string;
      userId: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      role: string;
      status: string;
      joinedAt: Date;
    }>
  > {
    try {
      const { limit, offset } = withPagination({
        page: query.page,
        limit: query.limit,
      });

      const conditions = [
        eq(organizationMemberships.organizationId, organizationId),
      ];

      if (query.role) {
        conditions.push(eq(organizationMemberships.role, query.role));
      }
      if (query.status) {
        conditions.push(eq(organizationMemberships.status, query.status));
      }

      const members = await this.db
        .select({
          id: organizationMemberships.id,
          userId: organizationMemberships.userId,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
          image: users.image,
          role: organizationMemberships.role,
          status: organizationMemberships.status,
          joinedAt: organizationMemberships.createdAt,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(asc(organizationMemberships.createdAt));

      const countResult = await this.db
        .select({ total: count() })
        .from(organizationMemberships)
        .where(and(...conditions));

      const totalRecord = countResult[0];
      if (!totalRecord) {
        throw new Error('Failed to get member count');
      }

      const totalCount = Number(totalRecord.total);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        items: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatarUrl: m.avatarUrl ?? m.image ?? null,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
        })),
        pagination: {
          page: query.page,
          limit,
          total: totalCount,
          totalPages,
        },
      };
    } catch (error) {
      throw wrapError(error, { organizationId });
    }
  }

  /**
   * Invite a member to an organization
   *
   * @param organizationId - Organization ID
   * @param input - Invite data (email, role)
   * @param invitedBy - User ID of the inviter
   * @returns Created membership
   */
  async inviteMember(
    organizationId: string,
    input: { email: string; role: string },
    invitedBy: string
  ): Promise<{
    id: string;
    userId: string;
    role: string;
    status: string;
    joinedAt: Date;
  }> {
    try {
      // Find user by email
      const user = await this.db.query.users.findFirst({
        where: eq(users.email, input.email),
        columns: { id: true },
      });

      if (!user) {
        throw new NotFoundError('User not found', { email: input.email });
      }

      // Check if already a member
      const existing = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, user.id)
        ),
      });

      if (existing) {
        throw new ConflictError(
          'User is already a member of this organization'
        );
      }

      const [membership] = await this.db
        .insert(organizationMemberships)
        .values({
          organizationId,
          userId: user.id,
          role: input.role,
          status: 'active',
          invitedBy,
        })
        .returning();

      if (!membership) {
        throw new Error('Failed to create membership');
      }

      return {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.createdAt,
      };
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      throw wrapError(error, { organizationId, email: input.email });
    }
  }

  /**
   * Update a member's role in an organization
   *
   * Safety: Cannot demote the last owner.
   *
   * @param organizationId - Organization ID
   * @param userId - User ID to update
   * @param role - New role
   * @returns Updated membership
   */
  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<{
    id: string;
    userId: string;
    role: string;
    status: string;
    joinedAt: Date;
  }> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId)
        ),
      });

      if (!membership) {
        throw new MemberNotFoundError(userId);
      }

      // Safety: If demoting from owner, check there's at least one other active owner
      if (membership.role === 'owner' && role !== 'owner') {
        const ownerCount = await this.db
          .select({ total: count() })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.role, 'owner'),
              eq(organizationMemberships.status, 'active')
            )
          );

        const totalOwners = Number(ownerCount[0]?.total ?? 0);
        if (totalOwners <= 1) {
          throw new LastOwnerError();
        }
      }

      const [updated] = await this.db
        .update(organizationMemberships)
        .set({ role, updatedAt: new Date() })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId)
          )
        )
        .returning();

      if (!updated) {
        throw new MemberNotFoundError(userId);
      }

      return {
        id: updated.id,
        userId: updated.userId,
        role: updated.role,
        status: updated.status,
        joinedAt: updated.createdAt,
      };
    } catch (error) {
      if (
        error instanceof MemberNotFoundError ||
        error instanceof LastOwnerError
      ) {
        throw error;
      }
      throw wrapError(error, { organizationId, userId });
    }
  }

  /**
   * Remove a member from an organization
   *
   * Safety: Cannot remove the last owner.
   *
   * @param organizationId - Organization ID
   * @param userId - User ID to remove
   */
  async removeMember(organizationId: string, userId: string): Promise<void> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId)
        ),
      });

      if (!membership) {
        throw new MemberNotFoundError(userId);
      }

      // Safety: Cannot remove the last owner
      if (membership.role === 'owner') {
        const ownerCount = await this.db
          .select({ total: count() })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.role, 'owner'),
              eq(organizationMemberships.status, 'active')
            )
          );

        const totalOwners = Number(ownerCount[0]?.total ?? 0);
        if (totalOwners <= 1) {
          throw new LastOwnerError();
        }
      }

      await this.db
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId)
          )
        );
    } catch (error) {
      if (
        error instanceof MemberNotFoundError ||
        error instanceof LastOwnerError
      ) {
        throw error;
      }
      throw wrapError(error, { organizationId, userId });
    }
  }
}
