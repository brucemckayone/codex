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

import {
  type DepartureTerminatedAgreement,
  lockProposalsOnDeparture,
  terminateAgreementsOnDeparture,
  withdrawProposalsOnDeparture,
} from '@codex/agreements';
import { isReservedSubdomain, PAGINATION } from '@codex/constants';
import {
  isUniqueViolation,
  listedCreatorConditions,
  toIso,
  whereNotDeleted,
  withPagination,
} from '@codex/database';
import type { SocialLinks } from '@codex/database/schema';
import {
  content,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizationOwnershipPeriods,
  organizations,
  users,
} from '@codex/database/schema';
import type { ServiceConfig } from '@codex/service-errors';
import {
  BaseService,
  InternalServiceError,
  ValidationError,
} from '@codex/service-errors';
import type {
  OrganizationPublicStatsResponse,
  PaginatedListResponse,
} from '@codex/shared-types';
import { buildOrgUrl } from '@codex/urls';
import type {
  CreateOrganizationInput,
  OfferOwnershipInput,
  UpdateOrganizationInput,
} from '@codex/validation';
import {
  createOrganizationSchema,
  createPlatformImageUrlSchema,
  PLATFORM_IMAGE_URL_MESSAGE,
  updateOrganizationSchema,
} from '@codex/validation';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  ConflictError,
  MemberNotFoundError,
  NotFoundError,
  OrganizationNotFoundError,
  OwnershipTransferRequiredError,
} from '../errors';
import type {
  Organization,
  OrganizationFilters,
  PaginationParams,
} from '../types';
import {
  type WithdrawnCatalogue,
  withdrawCatalogueOnDeparture,
} from './catalogue-departure';
import {
  countDepartureEffects,
  type DeparturePreview,
} from './departure-preview';
import {
  acceptOwnershipOffer,
  createOwnershipOffer,
  declineOwnershipOffer,
  getOwnershipView,
  getPendingOwnershipOffer,
  lockOfferToRecipient,
  type OwnershipChange,
  type OwnershipOfferDto,
  type OwnershipViewCore,
  reassignOrganisationOwner,
  toOfferDto,
  withdrawOfferForIneligibleRecipient,
  withdrawOwnershipOffer,
} from './ownership-transfer';

/**
 * Organization Service Class
 *
 * Handles all organization-related business logic:
 * - Create organizations
 * - Update organization metadata
 * - Delete organizations (soft delete)
 * - List organizations with filters
 */
/**
 * OrganizationService configuration.
 *
 * Adds the public asset CDN base to the standard `ServiceConfig` so the
 * write paths can reject an externally-hosted `logoUrl` (Codex-8so68).
 * Optional because the binding itself is optional in `HonoEnv`; when it is
 * absent the logo gate FAILS CLOSED (no base ⇒ no URL can be
 * platform-produced).
 */
/** What a member's removal ended, for the post-commit follow-up. */
export interface MemberDeparture {
  organizationId: string;
  creatorId: string;
  /** The removal moment: every agreement and item it ended carries it. */
  at: Date;
  endedAgreements: DepartureTerminatedAgreement[];
  catalogue: WithdrawnCatalogue;
}

export interface OrganizationServiceConfig extends ServiceConfig {
  /** Public asset CDN base — the `R2_PUBLIC_URL_BASE` worker binding. */
  r2PublicUrlBase?: string;
  /**
   * Ownership-transfer emails (Codex-2hxff.2). Fire-and-forget, like
   * `AgreementLifecycleMailer`; when absent the transfer still works and only
   * the email is skipped.
   */
  ownershipMailer?: OwnershipMailer;
  /**
   * Told what a member's removal ended, after the removal commits: their
   * agreements (Codex-2hxff.18) and the content and courses taken off sale
   * (Codex-2hxff.64). The registry uses it to clear caches, cancel course
   * subscriptions at period end, and email the creator once. When absent the
   * removal still ends everything; only that follow-up work is skipped.
   */
  onMemberRemoved?: (departure: MemberDeparture) => Promise<void>;
  /** Absolute web-app base for the emails' Studio links (`WEB_APP_URL`). */
  webAppUrl?: string;
  /** `ExecutionContext.waitUntil`, to send the emails off the request path. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type OwnershipTemplateName =
  | 'ownership-offered'
  | 'ownership-transferred'
  | 'ownership-offer-closed';

/** Matches `sendEmailToWorker`'s params, so the registry wires it directly. */
export type OwnershipMailer = (params: {
  to: string;
  toName?: string;
  templateName: OwnershipTemplateName;
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => void;

/** What happened, for the email dispatcher. */
type OwnershipEvent =
  | { kind: 'offered'; offer: OwnershipOfferDto }
  | {
      kind: 'closed';
      offer: OwnershipOfferDto;
      outcome: 'declined' | 'withdrawn';
    }
  | { kind: 'transferred'; organizationId: string; change: OwnershipChange };

const emailDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * A membership that is not its org's active owner, for the WHERE of a write
 * that must never touch the owner (Codex-kk9nv.8). An earlier read is not
 * enough: an accept or a support reassign can make the member the owner
 * after that read, and an UPDATE that waited on the row re-checks only its
 * own WHERE against the committed row. The DB caps active owners at one but
 * cannot require one.
 */
const notTheActiveOwner = () =>
  sql`not (${organizationMemberships.role} = 'owner' and ${organizationMemberships.status} = 'active')`;

export class OrganizationService extends BaseService {
  /**
   * Narrowed `logoUrl` schema, bound to this worker's asset CDN base.
   * Built once per instance — the base never changes within a request.
   */
  private readonly logoUrlSchema: ReturnType<
    typeof createPlatformImageUrlSchema
  >;

  private readonly ownershipMailer: OwnershipMailer | undefined;
  private readonly onMemberRemoved:
    | OrganizationServiceConfig['onMemberRemoved']
    | undefined;
  private readonly webAppUrl: string | undefined;
  private readonly waitUntil: ((promise: Promise<unknown>) => void) | undefined;

  constructor(config: OrganizationServiceConfig) {
    super(config);
    this.logoUrlSchema = createPlatformImageUrlSchema(config.r2PublicUrlBase);
    this.ownershipMailer = config.ownershipMailer;
    this.onMemberRemoved = config.onMemberRemoved;
    this.webAppUrl = config.webAppUrl;
    this.waitUntil = config.waitUntil;
  }

  /**
   * Reject an externally-hosted organisation logo (Codex-8so68).
   *
   * `createOrganizationSchema`/`updateOrganizationSchema` only prove the
   * value is an http(s) URL, so a direct API call could aim the logo — which
   * renders on every public org page — at a third-party host, leaking every
   * visitor's IP and referrer and bypassing the R2 upload pipeline. The
   * allowed base is the `R2_PUBLIC_URL_BASE` binding, unreachable from a Zod
   * schema in `@codex/validation`, so the gate lives here on the write path.
   *
   * `websiteUrl`, which sits next to `logoUrl` in the same schema, is a
   * legitimate external link and is deliberately NOT checked.
   *
   * MUST be called from BOTH create() and update(), and BEFORE the
   * transaction opens. No grandfather clause: an update that re-submits a
   * legacy external URL is rejected (owner decision).
   */
  private assertPlatformLogoUrl(logoUrl: string | null | undefined): void {
    if (logoUrl == null) return;
    if (this.logoUrlSchema.safeParse(logoUrl).success) return;

    throw new ValidationError(PLATFORM_IMAGE_URL_MESSAGE, {
      field: 'logoUrl',
    });
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
  async create(
    input: CreateOrganizationInput,
    userId: string
  ): Promise<Organization> {
    // Validate input with Zod
    const validated = createOrganizationSchema.parse(input);

    // Zod only proved the logo is an http(s) URL — reject any host other than
    // the platform asset CDN (Codex-8so68). Mirrored in update().
    this.assertPlatformLogoUrl(validated.logoUrl);

    try {
      return await this.db.transaction(async (tx) => {
        // A live creator, read under KEY SHARE (Codex-kk9nv.8). An account
        // deletion holds the row exclusively from its scrub to its commit, so
        // a create in that window waits, then finds no live user, instead of
        // giving the org a deleted owner. One that reads first makes the scrub
        // wait, and the deletion then sees this org and refuses.
        const [creator] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), whereNotDeleted(users)))
          .for('key share');
        if (!creator) {
          throw new NotFoundError('User not found');
        }

        const [newOrganization] = await tx
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
          throw new InternalServiceError('Failed to create organization');
        }

        // Auto-create owner membership for the creating user
        await tx.insert(organizationMemberships).values({
          organizationId: newOrganization.id,
          userId,
          role: 'owner',
          status: 'active',
        });

        // ...and their ownership period, in the same transaction: membership is
        // who may act as owner, the period is who is PAID as owner at a given
        // time (Codex-2hxff.2). The two are only ever written together.
        await tx.insert(organizationOwnershipPeriods).values({
          organizationId: newOrganization.id,
          userId,
          startedAt: newOrganization.createdAt,
          source: 'created',
        });

        return newOrganization;
      });
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
      this.handleError(error, 'create');
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
      this.handleError(error, 'get');
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
      this.handleError(error, 'getBySlug');
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

    // Same external-host gate as create() (Codex-8so68). The schema is a
    // partial, so an absent `logoUrl` is a no-op and an explicit null clears
    // it; only a string is checked.
    this.assertPlatformLogoUrl(validated.logoUrl);

    try {
      return await this.db.transaction(async (tx) => {
        await this.findOrgByIdOrThrow(tx, id);

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
      this.handleError(error, 'update');
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
        await this.findOrgByIdOrThrow(tx, id);

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
      this.handleError(error, 'delete');
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
  ): Promise<PaginatedListResponse<Organization>> {
    try {
      const { limit, offset } = withPagination(pagination);

      // Build WHERE conditions
      const whereConditions = [whereNotDeleted(organizations)];

      // Add search filter
      if (filters.search) {
        const escaped = filters.search
          .replace(/%/g, '\\%')
          .replace(/_/g, '\\_');
        const searchCondition = or(
          ilike(organizations.name, `%${escaped}%`),
          ilike(organizations.description ?? '', `%${escaped}%`)
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

      // Run items + count queries concurrently (independent queries)
      const [items, countResult] = await Promise.all([
        this.db.query.organizations.findMany({
          where: and(...whereConditions),
          limit,
          offset,
          orderBy: [orderByClause, asc(organizations.id)],
        }),
        this.db
          .select({ total: count() })
          .from(organizations)
          .where(and(...whereConditions)),
      ]);

      const totalCount = Number(countResult[0]?.total ?? 0);
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
      this.handleError(error, 'list');
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
    if (isReservedSubdomain(normalizedSlug)) {
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
      this.handleError(error, 'isSlugAvailable');
    }
  }

  /**
   * Get public creators for an organization by slug
   *
   * Returns public-safe creator information (no emails, no internal IDs).
   * Only active members with owner/admin/creator roles are included.
   *
   * @param slug - Organization slug
   * @param pagination - Optional pagination params { page, limit }
   * @returns Paginated list of public creator profiles with content counts
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   */
  async getPublicCreators(
    slug: string,
    pagination?: { page: number; limit: number }
  ): Promise<
    PaginatedListResponse<{
      id: string;
      name: string;
      username: string | null;
      avatarUrl: string | null;
      bio: string | null;
      socialLinks: SocialLinks | null;
      role: string;
      joinedAt: string;
      contentCount: number;
      recentContent: {
        title: string;
        slug: string;
        thumbnailUrl: string | null;
        contentType: string;
      }[];
      organizations: {
        name: string;
        slug: string;
        logoUrl: string | null;
      }[];
    }>
  > {
    const { page = 1, limit = PAGINATION.DEFAULT } = pagination ?? {};
    const { limit: queryLimit, offset } = withPagination({ page, limit });

    try {
      const org = await this.findOrgIdBySlugOrThrow(slug);

      // Run count + members queries concurrently (both depend on org.id but not each other)
      const [countResult, members] = await Promise.all([
        this.db
          .select({ totalCount: count() })
          .from(organizationMemberships)
          .where(this.activeCreatorWhere(org.id)),
        this.db
          .select({
            userId: users.id,
            name: users.name,
            username: users.username,
            avatarUrl: users.avatarUrl,
            image: users.image,
            bio: users.bio,
            socialLinks: users.socialLinks,
            role: organizationMemberships.role,
            joinedAt: organizationMemberships.createdAt,
            contentCount: count(content.id),
          })
          .from(organizationMemberships)
          .innerJoin(users, eq(organizationMemberships.userId, users.id))
          .leftJoin(
            content,
            and(
              eq(content.creatorId, users.id),
              eq(content.organizationId, org.id),
              eq(content.status, 'published'),
              isNull(content.deletedAt)
            )
          )
          .where(this.activeCreatorWhere(org.id))
          .groupBy(
            users.id,
            organizationMemberships.id,
            users.name,
            users.username,
            users.avatarUrl,
            users.image,
            users.bio,
            users.socialLinks,
            organizationMemberships.role,
            organizationMemberships.createdAt
          )
          .orderBy(asc(organizationMemberships.createdAt))
          .limit(queryLimit)
          .offset(offset),
      ]);

      const totalCount = countResult[0]?.totalCount ?? 0;
      const totalPages = Math.ceil(totalCount / limit);

      // Fetch recent published content per creator (up to 4 each, for drawer gallery)
      const creatorIdsWithContent = members
        .filter((m) => Number(m.contentCount ?? 0) > 0)
        .map((m) => m.userId);

      type ContentItem = {
        title: string;
        slug: string;
        thumbnailUrl: string | null;
        contentType: string;
      };
      const recentContentMap = new Map<string, ContentItem[]>();

      if (creatorIdsWithContent.length > 0) {
        // Use ROW_NUMBER() window function to fetch only top 4 per creator
        // instead of fetching ALL content then truncating in JS
        const recentItems = await this.db.execute<{
          creator_id: string;
          title: string;
          slug: string;
          thumbnail_url: string | null;
          content_type: string;
        }>(sql`
          SELECT creator_id, title, slug, thumbnail_url, content_type FROM (
            SELECT
              ${content.creatorId} AS creator_id,
              ${content.title} AS title,
              ${content.slug} AS slug,
              ${content.thumbnailUrl} AS thumbnail_url,
              ${content.contentType} AS content_type,
              ROW_NUMBER() OVER (
                PARTITION BY ${content.creatorId}
                ORDER BY ${content.publishedAt} DESC
              ) AS rn
            FROM ${content}
            WHERE ${inArray(content.creatorId, creatorIdsWithContent)}
              AND ${content.organizationId} = ${org.id}
              AND ${content.status} = 'published'
              AND ${content.deletedAt} IS NULL
          ) ranked
          WHERE rn <= 4
        `);

        for (const item of recentItems.rows) {
          const existing = recentContentMap.get(item.creator_id) ?? [];
          existing.push({
            title: item.title,
            slug: item.slug,
            thumbnailUrl: item.thumbnail_url,
            contentType: item.content_type,
          });
          recentContentMap.set(item.creator_id, existing);
        }
      }

      // Fetch other org memberships per creator (for org logo row)
      const allUserIds = members.map((m) => m.userId);
      const otherOrgsMap = new Map<
        string,
        { name: string; slug: string; logoUrl: string | null }[]
      >();

      if (allUserIds.length > 0) {
        const otherMemberships = await this.db
          .select({
            userId: organizationMemberships.userId,
            name: organizations.name,
            slug: organizations.slug,
            logoUrl: organizations.logoUrl,
          })
          .from(organizationMemberships)
          .innerJoin(
            organizations,
            eq(organizationMemberships.organizationId, organizations.id)
          )
          .where(
            and(
              inArray(organizationMemberships.userId, allUserIds),
              eq(organizationMemberships.status, 'active'),
              whereNotDeleted(organizations),
              // Exclude the current org
              sql`${organizationMemberships.organizationId} != ${org.id}`
            )
          );

        for (const row of otherMemberships) {
          const existing = otherOrgsMap.get(row.userId) ?? [];
          existing.push({
            name: row.name,
            slug: row.slug,
            logoUrl: row.logoUrl,
          });
          otherOrgsMap.set(row.userId, existing);
        }
      }

      return {
        items: members.map((m) => ({
          id: m.userId,
          name: m.name,
          username: m.username ?? null,
          avatarUrl: m.avatarUrl ?? m.image ?? null,
          bio: m.bio ?? null,
          socialLinks: (m.socialLinks as SocialLinks) ?? null,
          role: m.role,
          joinedAt: toIso(m.joinedAt),
          contentCount: Number(m.contentCount ?? 0),
          recentContent: recentContentMap.get(m.userId) ?? [],
          organizations: otherOrgsMap.get(m.userId) ?? [],
        })),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
        },
      };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      this.handleError(error, 'getPublicCreators');
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
      } else {
        // removeMember soft-deletes by flipping status to 'inactive' (the row
        // survives for audit). Without this the removed member reappears the
        // moment the team page refreshes, so removal reads as a no-op.
        //
        // Excluding the tombstone rather than allow-listing 'active' keeps
        // 'invited' members visible — the team table has no status column, so
        // pending invites are rendered as ordinary rows and must not vanish.
        conditions.push(ne(organizationMemberships.status, 'inactive'));
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
        throw new InternalServiceError('Failed to get member count', {
          organizationId,
        });
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
      this.handleError(error, 'listMembers');
    }
  }

  /**
   * What removing this member would unwind, as counts: active agreements,
   * content and courses on sale, live course subscriptions and affected tier
   * subscribers — all scoped to this organisation and this member as creator
   * (Codex-2hxff.64; see `./departure-preview.ts`). Read by the Studio's
   * Remove dialog before the owner confirms. Not cached.
   *
   * @throws {MemberNotFoundError} If the user has no membership here
   */
  async getDeparturePreview(
    organizationId: string,
    userId: string
  ): Promise<DeparturePreview> {
    try {
      const preview = await countDepartureEffects(this.db, {
        organizationId,
        creatorId: userId,
      });
      if (!preview) {
        throw new MemberNotFoundError(userId);
      }
      return preview;
    } catch (error) {
      this.handleError(error, 'getDeparturePreview');
    }
  }

  /**
   * Get the current user's membership in an organization
   *
   * Returns the user's role and joined date for the specified organization.
   * Returns null for role/joinedAt if not a member (graceful degradation).
   * Does not throw errors for "not found" - this is intentional for frontend convenience.
   *
   * @param organizationId - Organization ID
   * @param userId - User ID to check membership for
   * @returns Membership lookup response with role and joinedAt (both null if not a member)
   */
  async getMyMembership(
    organizationId: string,
    userId: string
  ): Promise<{
    role: string | null;
    joinedAt: string | null;
    /** The caller's open ownership offer, for the Studio banner. */
    pendingOwnershipOffer: {
      offerId: string;
      offeredByName: string;
      expiresAt: string;
    } | null;
  }> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active')
        ),
        columns: {
          role: true,
          createdAt: true,
        },
      });

      return {
        role: membership?.role ?? null,
        joinedAt: toIso(membership?.createdAt),
        pendingOwnershipOffer: membership
          ? await getPendingOwnershipOffer(
              this.db,
              organizationId,
              userId,
              new Date()
            )
          : null,
      };
    } catch (error) {
      this.handleError(error, 'getMyMembership');
    }
  }

  /**
   * Get all organizations for a user
   *
   * Returns organizations where user has an active membership.
   * Results ordered by organization name.
   *
   * @param userId - User ID
   * @returns Array of organizations with user's role
   */
  async getUserOrganizations(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      logoUrl: string | null;
      role: string;
    }>
  > {
    try {
      const memberships = await this.db.query.organizationMemberships.findMany({
        where: and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active')
        ),
        with: {
          organization: {
            columns: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              deletedAt: true,
            },
          },
        },
        columns: {
          role: true,
        },
      });

      // Filter to active memberships with non-deleted orgs, then map to return type
      return memberships
        .filter(
          (
            m
          ): m is typeof m & {
            organization: NonNullable<typeof m.organization>;
          } => m.organization !== null && m.organization.deletedAt === null
        )
        .map(({ organization, role }) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logoUrl: organization.logoUrl,
          role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      this.handleError(error, 'getUserOrganizations');
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
      return await this.db.transaction(async (tx) => {
        // Find the live user by email, under KEY SHARE (Codex-kk9nv.8). An
        // account deletion holds the row exclusively from its scrub to its
        // commit, so an invite reading in that window waits, then finds the
        // address gone. One that reads first makes the scrub wait, and the
        // deletion then ends this membership with the others.
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, input.email), whereNotDeleted(users)))
          .for('key share');

        if (!user) {
          throw new NotFoundError('User not found by email', {
            organizationId,
          });
        }

        // Check if already a member
        const existing = await tx.query.organizationMemberships.findFirst({
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

        const [membership] = await tx
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
          throw new InternalServiceError('Failed to create membership', {
            organizationId,
            userId: user.id,
          });
        }

        return {
          id: membership.id,
          userId: membership.userId,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.createdAt,
        };
      });
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof ConflictError ||
        error instanceof InternalServiceError
      )
        throw error;
      this.handleError(error, 'inviteMember');
    }
  }

  /**
   * Update a member's role in an organization
   *
   * The owner's role cannot be changed here, and nobody can be made owner here
   * (Codex-2hxff.2): ownership moves only by transfer. A recipient of an open
   * ownership offer who stops being an admin or creator has the offer
   * withdrawn in the same transaction.
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
      const result = await this.db.transaction(async (tx) => {
        const membership = await this.findMembershipOrThrow(
          tx,
          organizationId,
          userId
        );

        if (
          (membership.role === 'owner' && membership.status === 'active') ||
          role === 'owner'
        ) {
          throw new OwnershipTransferRequiredError({ organizationId });
        }

        // Leaving admin and creator ends eligibility for an ownership offer.
        // Lock, then write (see removeMember): the offer is locked before the
        // membership, and withdrawn after it by a fresh read.
        const leavesRecipientRoles = role !== 'admin' && role !== 'creator';
        if (leavesRecipientRoles) {
          await lockOfferToRecipient(tx, organizationId, userId);
        }

        const [updated] = await tx
          .update(organizationMemberships)
          .set({ role, updatedAt: new Date() })
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.userId, userId),
              notTheActiveOwner()
            )
          )
          .returning();

        // The row exists (read above), so none back means it was made the
        // owner while this waited on it.
        if (!updated) {
          throw new OwnershipTransferRequiredError({ organizationId });
        }

        const withdrawn = leavesRecipientRoles
          ? await withdrawOfferForIneligibleRecipient(
              tx,
              organizationId,
              userId,
              new Date()
            )
          : null;

        return {
          membership: {
            id: updated.id,
            userId: updated.userId,
            role: updated.role,
            status: updated.status,
            joinedAt: updated.createdAt,
          },
          withdrawn,
        };
      });
      if (result.withdrawn) {
        this.notifyOwnership({
          kind: 'closed',
          offer: toOfferDto(result.withdrawn),
          outcome: 'withdrawn',
        });
      }
      return result.membership;
    } catch (error) {
      this.handleError(error, 'updateMemberRole');
    }
  }

  /**
   * Remove a member from an organization
   *
   * The owner cannot be removed — they transfer ownership first
   * (Codex-2hxff.2). Removing the recipient of an open ownership offer
   * withdraws it in the same transaction, and so does ending the member's
   * revenue-share agreements in the organisation (owner decision AGR-09, "End
   * on removal"): money earned before is still paid to them. Everything of
   * theirs on sale there is taken off sale too (Codex-2hxff.64): buyers keep
   * what they bought, tier subscribers keep it until their next renewal.
   *
   * @param organizationId - Organization ID
   * @param userId - User ID to remove
   */
  async removeMember(organizationId: string, userId: string): Promise<void> {
    try {
      const { withdrawn, departure } = await this.db.transaction(async (tx) => {
        const membership = await this.findMembershipOrThrow(
          tx,
          organizationId,
          userId
        );

        if (membership.role === 'owner' && membership.status === 'active') {
          throw new OwnershipTransferRequiredError({ organizationId });
        }

        const now = new Date();
        const departing = { organizationId, creatorId: userId, at: now };
        // LOCK, then write (Codex-kk9nv.8). The member's open proposals and
        // ownership offer are locked before their membership, the order an
        // accept or a counter takes them in. They are withdrawn after it, by
        // fresh reads: an offer created while the membership change waited
        // (createOwnershipOffer holds the membership while it inserts) is
        // withdrawn too.
        await lockProposalsOnDeparture(tx, departing);
        await lockOfferToRecipient(tx, organizationId, userId);
        const [ended] = await tx
          .update(organizationMemberships)
          .set({ status: 'inactive', updatedAt: now })
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.userId, userId),
              notTheActiveOwner()
            )
          )
          // Bare `.returning()`: the client union collapses the projected
          // overload. Only whether a row came back matters.
          .returning();
        // The row exists (read above), so none back means it was made the
        // owner since, by an accept or a support reassign that committed while
        // this waited.
        // The throw rolls back the locks and nothing is ended.
        if (!ended) {
          throw new OwnershipTransferRequiredError({ organizationId });
        }

        await withdrawProposalsOnDeparture(tx, departing);
        const withdrawn = await withdrawOfferForIneligibleRecipient(
          tx,
          organizationId,
          userId,
          now
        );
        const endedAgreements = await terminateAgreementsOnDeparture(tx, {
          organizationId,
          creatorId: userId,
          at: now,
        });
        const catalogue = await withdrawCatalogueOnDeparture(tx, {
          organizationId,
          creatorId: userId,
          at: now,
        });
        const departure: MemberDeparture = {
          organizationId,
          creatorId: userId,
          at: now,
          endedAgreements,
          catalogue,
        };
        return { withdrawn, departure };
      });
      this.notifyMemberRemoved(departure);
      if (withdrawn) {
        this.notifyOwnership({
          kind: 'closed',
          offer: toOfferDto(withdrawn),
          outcome: 'withdrawn',
        });
      }
    } catch (error) {
      this.handleError(error, 'removeMember');
    }
  }

  /**
   * Get public members for an organization by slug
   *
   * Returns public-safe member information (no emails, no internal IDs).
   * Only active members are included.
   *
   * @param slug - Organization slug
   * @param query - Optional query params { page, limit, role }
   * @returns Paginated list of public member profiles
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   */
  async getPublicMembers(
    slug: string,
    query?: { page: number; limit: number; role?: string }
  ): Promise<
    PaginatedListResponse<{
      name: string;
      avatarUrl: string | null;
      role: string;
      joinedAt: string;
    }>
  > {
    const { page = 1, limit = PAGINATION.DEFAULT } = query ?? {};
    const { limit: queryLimit, offset } = withPagination({ page, limit });

    try {
      const org = await this.findOrgIdBySlugOrThrow(slug);

      // Build conditions for filtering
      const conditions = [
        eq(organizationMemberships.organizationId, org.id),
        eq(organizationMemberships.status, 'active'),
      ];

      if (query?.role) {
        conditions.push(eq(organizationMemberships.role, query.role));
      }

      // Run count + members queries concurrently (independent queries)
      const [countResult, members] = await Promise.all([
        this.db
          .select({ totalCount: count() })
          .from(organizationMemberships)
          .where(and(...conditions)),
        this.db
          .select({
            name: users.name,
            avatarUrl: users.avatarUrl,
            image: users.image,
            role: organizationMemberships.role,
            joinedAt: organizationMemberships.createdAt,
          })
          .from(organizationMemberships)
          .innerJoin(users, eq(organizationMemberships.userId, users.id))
          .where(and(...conditions))
          .orderBy(asc(organizationMemberships.createdAt))
          .limit(queryLimit)
          .offset(offset),
      ]);

      const totalCount = countResult[0]?.totalCount ?? 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        items: members.map((m) => ({
          name: m.name,
          avatarUrl: m.avatarUrl ?? m.image ?? null,
          role: m.role,
          joinedAt: toIso(m.joinedAt),
        })),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
        },
      };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      this.handleError(error, 'getPublicMembers');
    }
  }

  /**
   * Get public aggregate statistics for an organization.
   *
   * Returns content counts by type, total duration, creator count,
   * and total views. All counts exclude soft-deleted and unpublished items.
   *
   * @param slug - Organization slug
   * @returns Aggregate statistics for hero section display
   * @throws {OrganizationNotFoundError} If organization doesn't exist
   */
  async getPublicStats(slug: string): Promise<OrganizationPublicStatsResponse> {
    try {
      const org = await this.findOrgIdBySlugOrThrow(slug);

      const publishedContentFilter = and(
        eq(content.organizationId, org.id),
        eq(content.status, 'published'),
        isNull(content.deletedAt)
      );

      // Run all aggregation queries concurrently
      const [contentStats, durationResult, creatorCount, categoryResult] =
        await Promise.all([
          // Content counts by type + total views in a single query
          this.db
            .select({
              total: count(),
              videoCount: sql<number>`count(*) filter (where ${content.contentType} = 'video')`,
              audioCount: sql<number>`count(*) filter (where ${content.contentType} = 'audio')`,
              writtenCount: sql<number>`count(*) filter (where ${content.contentType} = 'written')`,
              totalViews: sql<number>`coalesce(sum(${content.viewCount}), 0)`,
            })
            .from(content)
            .where(publishedContentFilter),

          // Total duration from media items linked to published content
          this.db
            .select({
              totalSeconds: sql<number>`coalesce(sum(${mediaItems.durationSeconds}), 0)`,
            })
            .from(content)
            .innerJoin(mediaItems, eq(content.mediaItemId, mediaItems.id))
            .where(publishedContentFilter),

          // Active creator count (owner/admin/creator roles)
          this.db
            .select({ total: count() })
            .from(organizationMemberships)
            .where(this.activeCreatorWhere(org.id)),

          // Categories with item counts (non-null, ordered by popularity, capped)
          this.db
            .select({
              category: content.category,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(content)
            .where(
              and(publishedContentFilter, sql`${content.category} is not null`)
            )
            .groupBy(content.category)
            .orderBy(sql`count(*) desc`)
            .limit(20),
        ]);

      const stats = contentStats[0];

      return {
        content: {
          total: Number(stats?.total ?? 0),
          video: Number(stats?.videoCount ?? 0),
          audio: Number(stats?.audioCount ?? 0),
          written: Number(stats?.writtenCount ?? 0),
        },
        totalDurationSeconds: Number(durationResult[0]?.totalSeconds ?? 0),
        creators: Number(creatorCount[0]?.total ?? 0),
        totalViews: Number(stats?.totalViews ?? 0),
        categories: categoryResult
          .filter(
            (r): r is { category: string; count: number } => r.category !== null
          )
          .map((r) => ({ name: r.category, count: Number(r.count) })),
      };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw error;
      }
      this.handleError(error, 'getPublicStats');
    }
  }

  /**
   * Find a non-deleted org by id inside a transaction.
   * Throws OrganizationNotFoundError if the org is missing or soft-deleted.
   */
  private async findOrgByIdOrThrow(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    id: string
  ): Promise<void> {
    const existing = await tx.query.organizations.findFirst({
      where: and(eq(organizations.id, id), whereNotDeleted(organizations)),
      columns: { id: true },
    });

    if (!existing) {
      throw new OrganizationNotFoundError(id);
    }
  }

  /**
   * Resolve a non-deleted org's id by slug (case-insensitive).
   * Used by public profile queries — scope-free because slugs are public.
   */
  private async findOrgIdBySlugOrThrow(slug: string): Promise<{ id: string }> {
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

    return org;
  }

  /**
   * SQL where-clause for active "creator" memberships (owner/admin/creator roles).
   * Shared by public profile stats and creator listings. The conditions are
   * the same ones IdentityService uses to invalidate this list's cache
   * (`listedCreatorConditions`, Codex-kk9nv.7).
   */
  private activeCreatorWhere(orgId: string) {
    return and(
      eq(organizationMemberships.organizationId, orgId),
      ...listedCreatorConditions()
    );
  }

  /**
   * Find a membership inside a transaction.
   * Throws MemberNotFoundError if the user is not in the org.
   * Caller is responsible for last-owner safety checks (different rules per operation).
   */
  private async findMembershipOrThrow(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    organizationId: string,
    userId: string
  ) {
    const membership = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      ),
    });

    if (!membership) {
      throw new MemberNotFoundError(userId);
    }

    return membership;
  }

  // ══════════════════════════════════════════════════════════════════════
  // OWNERSHIP (Codex-2hxff.2 — one owner; transfer by offer and accept)
  // ══════════════════════════════════════════════════════════════════════
  //
  // The data side lives in `./ownership-transfer.ts`; these methods add error
  // handling and the emails. Role rules are enforced here, not by policy: no
  // `procedure()` policy flag means "the owner".

  /** Who owns the organisation, and the offer state the viewer may see. */
  async getOwnership(
    organizationId: string,
    viewerId: string
  ): Promise<OwnershipViewCore> {
    try {
      return await getOwnershipView(
        this.db,
        organizationId,
        viewerId,
        new Date()
      );
    } catch (error) {
      this.handleError(error, 'getOwnership');
    }
  }

  /** The owner offers ownership to an active admin or creator. */
  async offerOwnership(
    organizationId: string,
    ownerUserId: string,
    input: OfferOwnershipInput
  ): Promise<OwnershipOfferDto> {
    try {
      const offer = toOfferDto(
        await createOwnershipOffer(
          this.db,
          { organizationId, ownerUserId, ...input },
          new Date()
        )
      );
      this.notifyOwnership({ kind: 'offered', offer });
      return offer;
    } catch (error) {
      this.handleError(error, 'offerOwnership');
    }
  }

  /** The owner withdraws their open offer. No email: they did it. */
  async withdrawOwnershipOffer(
    organizationId: string,
    offerId: string,
    ownerUserId: string
  ): Promise<OwnershipOfferDto> {
    try {
      return toOfferDto(
        await withdrawOwnershipOffer(
          this.db,
          { organizationId, offerId, ownerUserId },
          new Date()
        )
      );
    } catch (error) {
      this.handleError(error, 'withdrawOwnershipOffer');
    }
  }

  /** The recipient declines; the owner is told. */
  async declineOwnershipOffer(
    organizationId: string,
    offerId: string,
    recipientUserId: string
  ): Promise<OwnershipOfferDto> {
    try {
      const offer = toOfferDto(
        await declineOwnershipOffer(
          this.db,
          { organizationId, offerId, recipientUserId },
          new Date()
        )
      );
      this.notifyOwnership({ kind: 'closed', offer, outcome: 'declined' });
      return offer;
    } catch (error) {
      this.handleError(error, 'declineOwnershipOffer');
    }
  }

  /**
   * The recipient accepts: they become the owner and the previous owner an
   * admin. The caller must invalidate both users' membership caches.
   */
  async acceptOwnershipOffer(
    organizationId: string,
    offerId: string,
    recipientUserId: string
  ): Promise<OwnershipChange & { previousOwnerUserId: string }> {
    try {
      const change = await acceptOwnershipOffer(
        this.db,
        { organizationId, offerId, recipientUserId },
        new Date()
      );
      const { previousOwnerUserId } = change;
      if (!previousOwnerUserId) {
        // An accepted offer always demotes its offerer.
        throw new InternalServiceError('Accepted offer had no previous owner', {
          organizationId,
        });
      }
      this.notifyOwnership({ kind: 'transferred', organizationId, change });
      return { ...change, previousOwnerUserId };
    } catch (error) {
      this.handleError(error, 'acceptOwnershipOffer');
    }
  }

  /**
   * Platform support assigns a new owner (admin-api, `platform_owner`). The
   * caller must invalidate both users' membership caches.
   */
  async reassignOwner(
    organizationId: string,
    newOwnerUserId: string
  ): Promise<OwnershipChange> {
    try {
      const { change } = await reassignOrganisationOwner(
        this.db,
        { organizationId, newOwnerUserId },
        new Date()
      );
      this.notifyOwnership({ kind: 'transferred', organizationId, change });
      return change;
    } catch (error) {
      this.handleError(error, 'reassignOwner');
    }
  }

  /**
   * Hand what a removal ended to the follow-up work (caches, course
   * subscriptions, the creator's email), after the commit and through
   * `waitUntil` when available. Never throws: the removal is the source of
   * truth; a failure here is logged and the follow-up's own retries recover.
   */
  private notifyMemberRemoved(departure: MemberDeparture): void {
    const notify = this.onMemberRemoved;
    if (!notify) return;
    // Deferred, so a callback that throws synchronously becomes a rejection
    // here instead of a 500 for a removal that has already committed.
    const task = Promise.resolve()
      .then(() => notify(departure))
      .catch((error: unknown) => {
        this.obs.error('Member removal follow-up failed', {
          organizationId: departure.organizationId,
          creatorId: departure.creatorId,
          agreementIds: departure.endedAgreements.map((a) => a.id),
          contentIds: departure.catalogue.contentIds.length,
          courseIds: departure.catalogue.courseIds.length,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    this.waitUntil?.(task);
  }

  /**
   * Send an ownership email after the change has committed — through
   * `waitUntil` when available, so the lookups never delay the response.
   * Never throws: the change is the source of truth, the email an
   * observation of it.
   */
  private notifyOwnership(event: OwnershipEvent): void {
    const mailer = this.ownershipMailer;
    const webAppUrl = this.webAppUrl;
    if (!mailer) return;
    if (!webAppUrl) {
      this.obs.warn('Ownership email skipped: no web-app URL configured', {
        kind: event.kind,
      });
      return;
    }
    const task = this.sendOwnershipEmails(event, mailer, webAppUrl).catch(
      (error: unknown) => {
        this.obs.warn('Ownership email dispatch failed', {
          kind: event.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
    this.waitUntil?.(task);
  }

  private async sendOwnershipEmails(
    event: OwnershipEvent,
    mailer: OwnershipMailer,
    webAppUrl: string
  ): Promise<void> {
    const organizationId =
      event.kind === 'transferred'
        ? event.organizationId
        : event.offer.organizationId;
    const [org] = await this.db
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return;
    const settingsUrl = buildOrgUrl(
      new URL(webAppUrl),
      org.slug,
      '/studio/settings'
    );

    if (event.kind === 'transferred') {
      const { change } = event;
      // The new owner, the previous owner (an admin now) and every other
      // active admin: after the change that is exactly owner + admins.
      const team = await this.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.status, 'active'),
            inArray(organizationMemberships.role, ['owner', 'admin'])
          )
        );
      const names = new Map(team.map((member) => [member.id, member.name]));
      const data = {
        orgName: org.name,
        newOwnerName: names.get(change.ownerUserId) ?? 'The new owner',
        previousOwnerName:
          (change.previousOwnerUserId &&
            names.get(change.previousOwnerUserId)) ||
          'the previous owner',
        transferredAtDisplay: emailDate.format(new Date(change.ownerSince)),
        deepLinkUrl: settingsUrl,
      };
      for (const member of team) {
        mailer({
          to: member.email,
          toName: member.name,
          templateName: 'ownership-transferred',
          category: 'transactional',
          userId: member.id,
          organizationId,
          data,
        });
      }
      return;
    }

    const { offer } = event;
    const people = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [offer.offeredByUserId, offer.recipientUserId]));
    const owner = people.find((p) => p.id === offer.offeredByUserId);
    const recipient = people.find((p) => p.id === offer.recipientUserId);
    if (!owner || !recipient) return;

    if (event.kind === 'offered') {
      mailer({
        to: recipient.email,
        toName: recipient.name,
        templateName: 'ownership-offered',
        category: 'transactional',
        userId: recipient.id,
        organizationId,
        data: {
          recipientName: recipient.name,
          offeredByName: owner.name,
          orgName: org.name,
          expiresAtDisplay: emailDate.format(new Date(offer.expiresAt)),
          deepLinkUrl: settingsUrl,
        },
      });
      return;
    }

    mailer({
      to: owner.email,
      toName: owner.name,
      templateName: 'ownership-offer-closed',
      category: 'transactional',
      userId: owner.id,
      organizationId,
      data: {
        ownerName: owner.name,
        recipientName: recipient.name,
        orgName: org.name,
        outcome: event.outcome,
        outcomeSentence:
          event.outcome === 'declined'
            ? `${recipient.name} declined your offer to become the owner of ${org.name}.`
            : `Your offer to make ${recipient.name} the owner of ${org.name} was withdrawn, because they are no longer an admin or creator.`,
        deepLinkUrl: settingsUrl,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // FOLLOWER METHODS (audience relationship — separate from team roles)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Follow an organization (free opt-in).
   * Idempotent — silently no-ops if already following.
   */
  async followOrganization(orgId: string, userId: string): Promise<void> {
    try {
      await this.db
        .insert(organizationFollowers)
        .values({ organizationId: orgId, userId })
        .onConflictDoNothing();

      this.obs.info('User followed organization', {
        organizationId: orgId,
        userId,
      });
    } catch (error) {
      this.handleError(error, 'followOrganization');
    }
  }

  /**
   * Unfollow an organization.
   * Idempotent — silently no-ops if not following.
   */
  async unfollowOrganization(orgId: string, userId: string): Promise<void> {
    try {
      await this.db
        .delete(organizationFollowers)
        .where(
          and(
            eq(organizationFollowers.organizationId, orgId),
            eq(organizationFollowers.userId, userId)
          )
        );

      this.obs.info('User unfollowed organization', {
        organizationId: orgId,
        userId,
      });
    } catch (error) {
      this.handleError(error, 'unfollowOrganization');
    }
  }

  /**
   * Check if a user is following an organization.
   */
  async isFollowing(orgId: string, userId: string): Promise<boolean> {
    try {
      const row = await this.db.query.organizationFollowers.findFirst({
        where: and(
          eq(organizationFollowers.organizationId, orgId),
          eq(organizationFollowers.userId, userId)
        ),
        columns: { id: true },
      });
      return !!row;
    } catch (error) {
      this.handleError(error, 'isFollowing');
    }
  }

  /**
   * Get the follower count for an organization (public).
   */
  async getFollowerCount(orgId: string): Promise<number> {
    try {
      const result = await this.db
        .select({ total: count() })
        .from(organizationFollowers)
        .where(eq(organizationFollowers.organizationId, orgId));

      return Number(result[0]?.total ?? 0);
    } catch (error) {
      this.handleError(error, 'getFollowerCount');
    }
  }
}
