/**
 * Category (Topic Taxonomy) Remote Functions
 *
 * Server-side functions for the studio categories management surface. Powers
 * the org landing "Browse by topic" curation UI.
 *
 * Uses `query()` for the cached, refreshable category list, `form()` for
 * progressive-enhancement create/update + the multipart cover upload, and
 * `command()` for the programmatic delete + reorder mutations.
 *
 * Every function targets an ORG space: `organizationId` is a required argument
 * and is forwarded to the backend as `?organizationId=`. Omitting it would make
 * content-api operate on the caller's PERSONAL creator space instead (the
 * backend query param is optional), so the studio surface always passes it.
 *
 * References:
 * - Pattern: apps/web/src/lib/remote/branding.remote.ts (logo upload)
 * - Pattern: apps/web/src/lib/remote/content.remote.ts (create/update forms)
 * - Backend: workers/content-api/src/routes/categories.ts
 * - Validation: packages/validation/src/content/category-schemas.ts
 */

import {
  createCategorySchema,
  updateCategorySchema,
  z,
} from '@codex/validation';
import { command, form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { type StudioCategory, toStudioCategory } from './categories.types';

// ─────────────────────────────────────────────────────────────────────────────
// List Query
// ─────────────────────────────────────────────────────────────────────────────

/** Management list caps at the pagination max (100); mutations refresh this. */
const CATEGORY_LIST_LIMIT = 100;

/**
 * List an org's categories for the studio management page.
 *
 * Ordered by the curator's `sortOrder` (backend default). Refreshed after every
 * mutation below so the UI stays authoritative without a manual reload.
 */
export const getCategories = query(
  z.string().uuid(),
  async (organizationId): Promise<StudioCategory[]> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const params = new URLSearchParams();
    params.set('organizationId', organizationId);
    params.set('limit', String(CATEGORY_LIST_LIMIT));

    const result = await api.categories.list(params);
    return (result?.items ?? []).map(toStudioCategory);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Form-input coercion helpers
// ─────────────────────────────────────────────────────────────────────────────

// FormData values arrive as strings. These coerce to the domain-schema shape;
// `createCategorySchema`/`updateCategorySchema` remain the validation authority
// (applied inside each handler so failures surface as `{ success: false }`).

/** Empty/whitespace string → null (clears the field). */
const optionalTextField = z
  .string()
  .optional()
  .default('')
  .transform((v) => (v.trim() === '' ? null : v.trim()));

/** Empty string → undefined (omit); otherwise coerce to a number. */
const optionalSortField = z
  .string()
  .optional()
  .default('')
  .transform((v) => (v.trim() === '' ? undefined : Number(v)));

const createCategoryFormSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim(),
  description: optionalTextField,
  icon: optionalTextField,
  sortOrder: optionalSortField,
});

const updateCategoryFormSchema = createCategoryFormSchema.extend({
  categoryId: z.string().uuid(),
});

/** Single-flight refresh of the list after a mutation (fire-and-forget). */
function refreshCategories(organizationId: string): void {
  void getCategories(organizationId).refresh();
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Category Form
// ─────────────────────────────────────────────────────────────────────────────

export const createCategoryForm = form(
  createCategoryFormSchema,
  async ({ organizationId, name, description, icon, sortOrder }) => {
    // Domain validation authority (mirrors the content-api route body schema).
    const parsed = createCategorySchema.safeParse({
      name,
      description,
      icon,
      sortOrder,
    });
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? 'Invalid category',
      };
    }

    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const category = await api.categories.create(organizationId, parsed.data);
      refreshCategories(organizationId);
      return { success: true as const, category: toStudioCategory(category) };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to create category',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Category Form
// ─────────────────────────────────────────────────────────────────────────────

export const updateCategoryForm = form(
  updateCategoryFormSchema,
  async ({
    categoryId,
    organizationId,
    name,
    description,
    icon,
    sortOrder,
  }) => {
    const parsed = updateCategorySchema.safeParse({
      name,
      description,
      icon,
      sortOrder,
    });
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? 'Invalid category',
      };
    }

    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const category = await api.categories.update(
        categoryId,
        organizationId,
        parsed.data
      );
      refreshCategories(organizationId);
      return { success: true as const, category: toStudioCategory(category) };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to update category',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Delete Category Command
// ─────────────────────────────────────────────────────────────────────────────

export const deleteCategory = command(
  z.object({
    organizationId: z.string().uuid(),
    categoryId: z.string().uuid(),
  }),
  async ({ organizationId, categoryId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      await api.categories.remove(categoryId, organizationId);
      refreshCategories(organizationId);
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to delete category',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Reorder Categories Command
// ─────────────────────────────────────────────────────────────────────────────

export const reorderCategories = command(
  z.object({
    organizationId: z.string().uuid(),
    // Matches the backend `reorderCategoriesBodySchema` bounds exactly.
    orderedIds: z.array(z.string().uuid()).min(1).max(200),
  }),
  async ({ organizationId, orderedIds }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      await api.categories.reorder(organizationId, orderedIds);
      refreshCategories(organizationId);
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to reorder categories',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Upload Category Cover Form (multipart)
// ─────────────────────────────────────────────────────────────────────────────

/** Web-image cover types (backend is authoritative via SUPPORTED_IMAGE_MIME_TYPES). */
const ALLOWED_COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const uploadCoverSchema = z.object({
  organizationId: z.string().uuid(),
  categoryId: z.string().uuid(),
  cover: z
    .instanceof(File)
    .refine(
      (file) => ALLOWED_COVER_TYPES.includes(file.type),
      'Cover must be PNG, JPEG, or WebP'
    )
    .refine(
      (file) => file.size <= MAX_COVER_BYTES,
      'File must be less than 10MB'
    ),
});

/**
 * Upload (or replace) a category cover image.
 *
 * Uses form() for native FormData submission (File objects cannot be serialized
 * by command()/devalue). Copies the branding logo-upload flow: the api client
 * re-forwards the File via `forwardMultipartUpload`, and on success returns the
 * persisted key + resolved md-variant URL so the caller can paint the cover
 * without a reload.
 */
export const uploadCategoryCoverForm = form(
  uploadCoverSchema,
  async ({ organizationId, categoryId, cover }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.categories.uploadCover(
        categoryId,
        organizationId,
        cover
      );
      refreshCategories(organizationId);
      return {
        success: true as const,
        categoryId,
        coverImageKey: result.coverImageKey,
        coverImageUrl: result.coverImageUrl,
      };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to upload cover',
      };
    }
  }
);
