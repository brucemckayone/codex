/**
 * Categories Service
 *
 * Manages the per-space category taxonomy that powers the org landing
 * "Browse by topic" module. Every operation is scoped to a resolved space:
 * an ORG space (`organizationId` set) is ORG-OWNED — shared across the org's
 * creators and manageable by any actor in the org — while a PERSONAL space
 * (`organizationId` null) is scoped to a single `creatorId`. `creatorId` is
 * always recorded on the row as authorship, but does NOT gate org-space
 * mutations; per-actor authorization (owner/admin) lives upstream at the route
 * policy, not in this service.
 *
 * Mirrors `ContentService` conventions EXACTLY:
 * - NO `any` types — all inferred from Drizzle.
 * - Space scoping on ALL queries (`scopedNotDeleted` / `withOrgScope` +
 *   `whereNotDeleted`) via the shared `spaceWhere` helper.
 * - Transactions (`db.transaction()`) for multi-step / roll-back-on-failure ops.
 * - Typed `ServiceError` subclasses; unknowns wrapped via `handleError`.
 * - Soft deletes only (sets `deletedAt`).
 *
 * Slug rule: `slug` is derived from `name` via the canonical `slugify()`
 * (`@codex/validation`) and made unique per resolved space by suffixing
 * (`-2`, `-3`, …) on collision, so a friendly `create` almost never rejects a
 * duplicate display name. `slug` is stable across renames — `update` does not
 * re-derive it, so existing `?category=<slug>` deep links keep working.
 */

import { CONTENT_STATUS } from '@codex/constants';
import {
  isUniqueViolation,
  paginatedQuery,
  scopedNotDeleted,
  whereNotDeleted,
  withOrgScope,
} from '@codex/database';
import type { Category, NewCategory } from '@codex/database/schema';
import { categories, content, contentCategories } from '@codex/database/schema';
import { BaseService, ValidationError } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@codex/validation';
import {
  createCategorySchema,
  slugify,
  updateCategorySchema,
} from '@codex/validation';
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  like,
  or,
  type SQL,
} from 'drizzle-orm';
import {
  CategoryNotFoundError,
  CategorySlugConflictError,
  InternalServiceError,
} from '../errors';
import type { DatabaseTransaction } from '../types';

/**
 * Resolved space a category belongs to. Mirrors `content` scoping: an org row
 * sets `organizationId`; a personal row leaves it null and is owned by
 * `creatorId`. The SAME shape is used for create/list AND for
 * get/update/softDelete/reorder so scope resolves identically everywhere.
 */
export interface CategorySpace {
  /** Owning org, or null/undefined for a personal creator space. */
  organizationId?: string | null;
  /** Owning/authoring creator (BetterAuth user id). Always required. */
  creatorId: string;
}

/**
 * Categories Service Class
 *
 * Scoped CRUD + reorder for the topic taxonomy.
 */
export class CategoriesService extends BaseService {
  /**
   * Create a new category in the resolved space.
   *
   * Derives the slug from `name` and guarantees per-space uniqueness by
   * appending a numeric suffix on collision (`news`, `news-2`, `news-3`, …),
   * so a duplicate display name is friendly rather than fatal. Runs inside a
   * transaction so the availability read + insert are atomic against
   * concurrent creates in the same space; under a genuine concurrent race the
   * losing writer still gets a `CategorySlugConflictError` from the partial
   * unique index (the backstop below).
   *
   * @param input - Validated category creation data (name required)
   * @param space - Resolved space (org or personal) the category belongs to
   * @returns The created category row
   * @throws {ValidationError} If the name yields an empty slug (all punctuation)
   * @throws {CategorySlugConflictError} On a concurrent slug race at INSERT
   */
  async create(
    input: CreateCategoryInput,
    space: CategorySpace
  ): Promise<Category> {
    const validated = createCategorySchema.parse(input);
    const organizationId = space.organizationId ?? null;

    const baseSlug = slugify(validated.name);
    if (!baseSlug) {
      // A name of only punctuation/emoji slugifies to '' — the DB slug column
      // is NOT NULL and a blank slug is unusable in a URL. Reject at the
      // boundary rather than persist an unusable row.
      throw new ValidationError(
        'Category name must contain at least one letter or number',
        { name: validated.name }
      );
    }

    try {
      const result = await this.db.transaction(async (tx) => {
        const slug = await this.resolveUniqueSlug(
          tx as DatabaseTransaction,
          baseSlug,
          space
        );

        const [row] = await tx
          .insert(categories)
          .values({
            organizationId,
            creatorId: space.creatorId,
            name: validated.name,
            slug,
            description: validated.description ?? null,
            icon: validated.icon ?? null,
            coverImageKey: validated.coverImageKey ?? null,
            sortOrder: validated.sortOrder ?? 0,
          })
          .returning();

        if (!row) {
          throw new InternalServiceError('Failed to create category', {
            creatorId: space.creatorId,
            organizationId,
          });
        }

        return row;
      });

      if (!result) {
        throw new InternalServiceError(
          'Failed to create category after transaction',
          { creatorId: space.creatorId, organizationId }
        );
      }

      return result;
    } catch (error) {
      // Race backstop: the availability read is inside the tx, but a concurrent
      // create in the same space can still claim the same suffix. The per-space
      // partial unique index rejects it (23505); surface as a typed conflict.
      if (isUniqueViolation(error)) {
        throw new CategorySlugConflictError(baseSlug);
      }
      this.handleError(error, 'create');
    }
  }

  /**
   * List categories in a resolved space, ordered by `sortOrder` then `name`.
   *
   * Scope mirrors `content` listing: an ORG space returns every category in
   * the org (org-owned, shared across creators); a PERSONAL space
   * (`organizationId` null) is filtered to `creatorId`.
   *
   * @param params - Resolved space + pagination + optional name search
   * @returns Paginated list envelope (`{ items, pagination }`)
   */
  async list(params: {
    organizationId?: string | null;
    creatorId: string;
    page: number;
    limit: number;
    search?: string;
  }): Promise<PaginatedListResponse<Category>> {
    try {
      const whereConditions = [...this.spaceWhere(params)];

      if (params.search) {
        const escaped = params.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
        whereConditions.push(ilike(categories.name, `%${escaped}%`));
      }

      const where = and(...whereConditions);
      return await paginatedQuery({
        page: params.page,
        limit: params.limit,
        fetchItems: (limit, offset) =>
          this.db.query.categories.findMany({
            where,
            limit,
            offset,
            orderBy: [asc(categories.sortOrder), asc(categories.name)],
          }),
        countQuery: { db: this.db, table: categories, where },
      });
    } catch (error) {
      this.handleError(error, 'list');
    }
  }

  /**
   * List an org's categories for PUBLIC (unauthenticated) topic cards.
   *
   * Unlike {@link list} (studio/management, per-space, paginated), this is the
   * landing "Browse by topic" feed: ORG-space only, unpaginated (the curated
   * topic set is small), and filtered to categories that have AT LEAST ONE
   * published, non-deleted content item — so an empty topic never renders as a
   * dead-end card. Ordered by `sortOrder` then `name` (the curator's explicit
   * landing order).
   *
   * @param organizationId - Owning organization
   * @returns Live, non-empty org categories (no pagination envelope)
   */
  async listPublicForOrg(organizationId: string): Promise<Category[]> {
    try {
      // Category ids that have ≥1 published, non-deleted content item in this
      // org. DISTINCT keeps the IN-list bounded by the topic count, not the
      // membership-row count.
      const activeCategoryIds = this.db
        .selectDistinct({ categoryId: contentCategories.categoryId })
        .from(contentCategories)
        .innerJoin(content, eq(contentCategories.contentId, content.id))
        .where(
          and(
            eq(content.organizationId, organizationId),
            eq(content.status, CONTENT_STATUS.PUBLISHED),
            isNull(content.deletedAt)
          )
        );

      return await this.db.query.categories.findMany({
        where: and(
          eq(categories.organizationId, organizationId),
          whereNotDeleted(categories),
          inArray(categories.id, activeCategoryIds)
        ),
        orderBy: [asc(categories.sortOrder), asc(categories.name)],
      });
    } catch (error) {
      this.handleError(error, 'listPublicForOrg');
    }
  }

  /**
   * Get a single category by id, scoped to its resolved space.
   *
   * @param id - Category ID
   * @param space - Resolved space (org → any org actor; personal → creator)
   * @returns The category or null if absent / out of space / soft-deleted
   */
  async get(id: string, space: CategorySpace): Promise<Category | null> {
    try {
      const row = await this.db.query.categories.findFirst({
        where: and(eq(categories.id, id), ...this.spaceWhere(space)),
      });
      return row ?? null;
    } catch (error) {
      this.handleError(error, 'get');
    }
  }

  /**
   * Update a category's editable fields. Existence within the resolved space is
   * verified before the write. `slug` is intentionally NOT re-derived on rename
   * so deep links stay valid. Absent fields are left unchanged; explicit `null`
   * clears a nullable field (Drizzle skips `undefined` keys in `.set()`).
   *
   * @param id - Category ID
   * @param input - Partial update payload
   * @param space - Resolved space (org → any org actor; personal → creator)
   * @throws {CategoryNotFoundError} If absent / out of space
   */
  async update(
    id: string,
    input: UpdateCategoryInput,
    space: CategorySpace
  ): Promise<Category> {
    const validated = updateCategorySchema.parse(input);

    try {
      const result = await this.db.transaction(async (tx) => {
        const existing = await tx.query.categories.findFirst({
          where: and(eq(categories.id, id), ...this.spaceWhere(space)),
        });

        if (!existing) {
          throw new CategoryNotFoundError(id);
        }

        const [updated] = await tx
          .update(categories)
          .set({ ...validated, updatedAt: new Date() })
          .where(and(eq(categories.id, id), ...this.spaceWhere(space)))
          .returning();

        if (!updated) {
          throw new CategoryNotFoundError(id);
        }

        return updated;
      });

      if (!result) {
        throw new CategoryNotFoundError(id);
      }

      return result;
    } catch (error) {
      if (error instanceof CategoryNotFoundError) {
        throw error;
      }
      this.handleError(error, 'update');
    }
  }

  /**
   * Soft delete a category (sets `deletedAt`). Its `content_categories` join
   * rows are left in place — a soft-deleted category simply drops out of
   * listings via the `deletedAt IS NULL` filter, and its slug frees up for
   * reuse.
   *
   * @param id - Category ID
   * @param space - Resolved space (org → any org actor; personal → creator)
   * @throws {CategoryNotFoundError} If absent / out of space
   */
  async softDelete(id: string, space: CategorySpace): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx.query.categories.findFirst({
          where: and(eq(categories.id, id), ...this.spaceWhere(space)),
        });

        if (!existing) {
          throw new CategoryNotFoundError(id);
        }

        await tx
          .update(categories)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(categories.id, id), ...this.spaceWhere(space)));
      });
    } catch (error) {
      if (error instanceof CategoryNotFoundError) {
        throw error;
      }
      this.handleError(error, 'softDelete');
    }
  }

  /**
   * Reorder categories: assigns `sortOrder = index` for each id in `orderedIds`.
   *
   * Runs in a single transaction. Every id must be a live category in the
   * resolved space — if any update matches no row (out-of-space, missing, or
   * soft-deleted id) the method throws inside the transaction, rolling back ALL
   * sortOrder changes so a partial reorder can never commit.
   *
   * @param orderedIds - Category IDs in their new display order
   * @param space - Resolved space (org → any org actor; personal → creator)
   * @throws {CategoryNotFoundError} If any id is absent / out of space (rolls back)
   */
  async reorder(orderedIds: string[], space: CategorySpace): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        // `.entries()` types `id` as `string` (element type), avoiding the
        // `string | undefined` that indexed access yields under
        // noUncheckedIndexedAccess.
        for (const [index, id] of orderedIds.entries()) {
          const [updated] = await tx
            .update(categories)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(categories.id, id), ...this.spaceWhere(space)))
            .returning();

          if (!updated) {
            // Throwing inside the transaction rolls back every prior update in
            // this reorder — no partial commit.
            throw new CategoryNotFoundError(id);
          }
        }
      });
    } catch (error) {
      if (error instanceof CategoryNotFoundError) {
        throw error;
      }
      this.handleError(error, 'reorder');
    }
  }

  /**
   * Build the not-deleted + resolved-space predicate shared by every query.
   *
   * ORG space (`organizationId` set): scoped by organization — categories are
   * ORG-OWNED, so ANY actor in the org may target the row (per-actor
   * owner/admin authorization is enforced upstream at the route policy, not
   * here). PERSONAL space (`organizationId` null): scoped to the owning
   * `creatorId`. `creatorId` is still recorded on org rows as authorship, but
   * never gates org-space access.
   */
  private spaceWhere(space: CategorySpace): SQL<unknown>[] {
    return space.organizationId
      ? [
          whereNotDeleted(categories),
          withOrgScope(categories, space.organizationId),
        ]
      : [
          scopedNotDeleted(categories, space.creatorId),
          isNull(categories.organizationId),
        ];
  }

  /**
   * Resolve a collision-free slug within a resolved space.
   *
   * Reads the space's live slugs matching the base or a numeric-suffixed form,
   * then returns the base slug if free, else the lowest available
   * `${base}-${n}` (n ≥ 2). The `LIKE '${base}-%'` prefilter only widens the
   * candidate set; exact collision is decided by set membership, so unrelated
   * slugs like `${base}-roundup` never shift the chosen suffix. `baseSlug` is
   * produced by `slugify` (only `[a-z0-9-]`), so it needs no LIKE escaping.
   */
  private async resolveUniqueSlug(
    tx: DatabaseTransaction,
    baseSlug: string,
    space: CategorySpace
  ): Promise<string> {
    const existing = await tx
      .select({ slug: categories.slug })
      .from(categories)
      .where(
        and(
          ...this.spaceWhere(space),
          or(
            eq(categories.slug, baseSlug),
            like(categories.slug, `${baseSlug}-%`)
          )
        )
      );

    const taken = new Set(existing.map((row) => row.slug));
    if (!taken.has(baseSlug)) {
      return baseSlug;
    }

    let suffix = 2;
    while (taken.has(`${baseSlug}-${suffix}`)) {
      suffix++;
    }
    return `${baseSlug}-${suffix}`;
  }
}

// Re-export for type callers that want the input shapes alongside the service.
export type { NewCategory };
