import { z } from 'zod';
import {
  createOptionalTextSchema,
  createSanitizedStringSchema,
  nonNegativeIntSchema,
  uuidSchema,
} from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Category (topic taxonomy) Validation Schemas
 *
 * Security-focused validation for the per-space category taxonomy that powers
 * the org landing "Browse by topic" module. Aligned with the database schema
 * at `packages/database/src/schema/categories.ts`.
 *
 * Mirrors the `baseContentSchema` / `createContentSchema` / `contentQuerySchema`
 * family in `content-schemas.ts`:
 * 1. Input length limits match database column constraints exactly.
 * 2. All user-generated strings are trimmed/sanitised.
 * 3. Inferred types are exported for use across the service + route layers.
 *
 * The `slug` is NOT part of any input schema — it is derived server-side from
 * `name` via `slugify()` (see `@codex/validation` primitives) and made unique
 * per resolved space by `CategoriesService`. Likewise `organizationId` /
 * `creatorId` come from the resolved request space (auth context + org
 * resolution), NOT from the request body, so they are absent from the
 * create/update body schemas and present only as optional query filters.
 */

// ============================================================================
// Reusable Schema Components
// ============================================================================

/**
 * Category icon — an emoji or a lucide icon name. Max 64 chars (DB column).
 */
const categoryIconSchema = z
  .string()
  .trim()
  .max(64, 'Icon must be 64 characters or less')
  .optional()
  .nullable();

/**
 * R2 object key for the category cover image. Max 500 chars (DB column).
 * The key itself is minted by the upload pipeline (WP-3); this only bounds
 * length when a caller sets/clears it directly.
 */
const coverImageKeySchema = z
  .string()
  .trim()
  .max(500, 'Cover image key must be 500 characters or less')
  .optional()
  .nullable();

// ============================================================================
// Create / Update Schemas
// ============================================================================

/**
 * Create Category Input
 *
 * Aligns with database schema: packages/database/src/schema/categories.ts.
 * `sortOrder` is optional (defaults to 0 at the service/DB layer). `slug` is
 * derived from `name`, never supplied by the caller.
 */
export const createCategorySchema = z.object({
  name: createSanitizedStringSchema(1, 100, 'Category name'),
  description: createOptionalTextSchema(500, 'Description'),
  icon: categoryIconSchema,
  coverImageKey: coverImageKeySchema,
  sortOrder: nonNegativeIntSchema.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/**
 * Update Category Input
 * All fields optional (partial update). The service keeps `slug` stable across
 * renames (deep links stay valid), so `slug` is intentionally not updatable
 * here.
 */
export const updateCategorySchema = createCategorySchema.partial();

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ============================================================================
// Query Parameter Schema
// ============================================================================

/**
 * Category query/filter schema
 * Extends pagination with an optional org filter and a name search. Listing is
 * resolved-space-scoped at the service layer from the AUTH context (the route
 * forces `creatorId = ctx.user.id`), so `creatorId` is intentionally NOT a
 * query param — accepting it would falsely imply cross-creator listing.
 * `organizationId` is a UUID (org PK) the org-scoped route passes through.
 */
export const categoryQuerySchema = paginationSchema.extend({
  organizationId: uuidSchema.optional(),
  search: z.string().max(255).optional(),
});

export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;
