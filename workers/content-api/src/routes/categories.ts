/**
 * Category Management Endpoints
 *
 * Authenticated CRUD + reorder + cover upload for the per-space topic taxonomy
 * that powers the org landing "Browse by topic" module.
 *
 * Space + authorization model (see `resolveManagedCategorySpace`):
 *   • ORG space — pass `?organizationId=`; the caller must be an owner/admin
 *     member of that org (mirrors `requireOrgManagement`).
 *   • PERSONAL space — omit it; the space is the caller's own creator id.
 * The SERVICE scopes every query to the resolved space; these routes add the
 * owner/admin gate for the org case. `:categoryId` (NOT `:id`) is used for the
 * item param so the procedure org resolver never mistakes it for an org key.
 *
 * Endpoints (mounted at /api/categories):
 *  - GET    /                  - List categories in the resolved space
 *  - POST   /                  - Create a category; 201
 *  - POST   /reorder           - Reorder categories; 204
 *  - PATCH  /:categoryId       - Update a category
 *  - DELETE /:categoryId       - Soft delete; 204
 *  - POST   /:categoryId/cover - Upload/replace the cover image (multipart)
 */

import { CacheType, VersionedCache } from '@codex/cache';
import { AUTH_ROLES } from '@codex/constants';
import { CategoryNotFoundError } from '@codex/content';
import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/image-processing';
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings, HonoEnv } from '@codex/shared-types';
import {
  categoryQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  uuidSchema,
  z,
} from '@codex/validation';
import {
  checkOrganizationMembership,
  multipartProcedure,
  PaginatedResult,
  procedure,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { resolveCategoryCoverUrl } from './category-cover-url';
import {
  type CategoryManagementSpace,
  type MembershipChecker,
  resolveManagedCategorySpace,
  resolveMemberCategorySpace,
} from './category-space';

const app = new Hono<HonoEnv>();

// Item param uses `categoryId` (not `id`) so the procedure org resolver never
// treats it as an org-resolution key. Org scope arrives via `?organizationId=`.
const categoryIdParamSchema = z.object({ categoryId: uuidSchema });
const orgScopeQuerySchema = z.object({ organizationId: uuidSchema.optional() });
const reorderCategoriesBodySchema = z.object({
  orderedIds: z.array(uuidSchema).min(1).max(200),
});

/** Platform roles allowed to reach these routes (org gate applied per-handler). */
const CATEGORY_MANAGER_ROLES = [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN];

/**
 * A `waitUntil` for CACHE WRITES ONLY — the shape of `ProcedureContext.cacheWrite`
 * (see `packages/worker-utils/src/procedure/types.ts`). Declared structurally
 * rather than imported; the two must stay assignable, and passing `ctx.cacheWrite`
 * straight through at every call site below is what checks that. If `CacheWrite`
 * is ever exported from the barrel, import it and delete this alias.
 */
type CacheWriteFn = (promise: Promise<unknown>) => void;

/**
 * Bind the audited membership lookup to this request's env/obs/cacheWrite.
 *
 * `cacheWrite` IS REQUIRED HERE, and `checkOrganizationMembership`'s own parameter
 * is now required too — it was optional, and that optionality is exactly what let
 * this call site and `identity-api/routes/membership.ts` keep the broken behaviour
 * silently. That helper's membership write-through is
 * `kv.put(...).catch(() => {})` handed to `cacheWrite()` — so omitting the argument
 * did not make the write best-effort, it made the write DEAD: an in-flight `put`
 * with nothing holding
 * the request open is cancelled the moment the response returns, which is how
 * the production cache accumulated version keys and no data keys (Codex-e32xz).
 * Every category route below runs inside a `procedure()` handler and therefore
 * has `ctx.cacheWrite`, so there is no caller with an excuse; making the
 * parameter required means a route added later cannot silently reintroduce the
 * bare `put`.
 *
 * `cacheWrite`, NOT `ctx.background()`: `procedure()` chains
 * `waitUntil(cleanup())` and cleanup calls `pool.end()`, so a background task
 * that touches the DATABASE races a torn-down pool. A KV put has no pool to
 * lose. Same reasoning as `ProcedureContext.cacheWrite`.
 */
function membershipChecker(
  env: Bindings,
  obs: ObservabilityClient | undefined,
  cacheWrite: CacheWriteFn
): MembershipChecker {
  return (orgId, uid) =>
    checkOrganizationMembership(orgId, uid, env, obs, cacheWrite);
}

/**
 * Curation gate (mutations): org space requires owner/admin; personal = self.
 */
function resolveManagementSpace(
  organizationId: string | undefined,
  userId: string,
  env: Bindings,
  obs: ObservabilityClient | undefined,
  cacheWrite: CacheWriteFn
): Promise<CategoryManagementSpace> {
  return resolveManagedCategorySpace({
    organizationId,
    userId,
    checkMembership: membershipChecker(env, obs, cacheWrite),
  });
}

/**
 * Member gate (list / create): org space requires any active member; personal
 * = self. Lets a plain creator list + inline-create categories to tag content.
 */
function resolveMemberSpace(
  organizationId: string | undefined,
  userId: string,
  env: Bindings,
  obs: ObservabilityClient | undefined,
  cacheWrite: CacheWriteFn
): Promise<CategoryManagementSpace> {
  return resolveMemberCategorySpace({
    organizationId,
    userId,
    checkMembership: membershipChecker(env, obs, cacheWrite),
  });
}

/**
 * Bump the per-space category version after a mutation so the public topic
 * list (and any future category read cache) re-fetches. Fire-and-forget via
 * `waitUntil` — never blocks the response, swallows KV hiccups.
 */
function invalidateCategories(
  env: Bindings,
  executionCtx: ExecutionContext,
  space: CategoryManagementSpace,
  obs: ObservabilityClient | undefined
): void {
  if (!env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: env.CACHE_KV,
    waitUntil: (promise) => executionCtx.waitUntil(promise),
  });
  executionCtx.waitUntil(
    cache
      .invalidate(CacheType.CATEGORIES(space.organizationId, space.creatorId))
      .catch((err: unknown) => {
        obs?.warn('category cache invalidation failed', {
          organizationId: space.organizationId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );
}

/**
 * GET /api/categories
 * List categories in the caller's resolved space (studio/management).
 */
app.get(
  '/',
  procedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: { query: categoryQuerySchema },
    handler: async (ctx) => {
      const space = await resolveMemberSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );
      const result = await ctx.services.categories.list({
        organizationId: space.organizationId,
        creatorId: space.creatorId,
        page: ctx.input.query.page,
        limit: ctx.input.query.limit,
        search: ctx.input.query.search,
      });
      // Resolve each raw R2 cover key to a CDN URL (same convention as the
      // public topic list) so studio covers render on cold load — never expose
      // the raw key to the client.
      const r2Base = ctx.env.R2_PUBLIC_URL_BASE;
      const items = result.items.map((row) => ({
        ...row,
        coverImageUrl: resolveCategoryCoverUrl(row.coverImageKey, r2Base),
      }));
      return new PaginatedResult(items, result.pagination);
    },
  })
);

/**
 * POST /api/categories
 * Create a category in the caller's resolved space.
 */
app.post(
  '/',
  procedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: { body: createCategorySchema, query: orgScopeQuerySchema },
    successStatus: 201,
    handler: async (ctx) => {
      const space = await resolveMemberSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );
      const category = await ctx.services.categories.create(
        ctx.input.body,
        space
      );
      invalidateCategories(ctx.env, ctx.executionCtx, space, ctx.obs);
      return category;
    },
  })
);

/**
 * POST /api/categories/reorder
 * Reorder categories (assigns sortOrder = index). Transactional in the service.
 */
app.post(
  '/reorder',
  procedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: { body: reorderCategoriesBodySchema, query: orgScopeQuerySchema },
    successStatus: 204,
    handler: async (ctx) => {
      const space = await resolveManagementSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );
      await ctx.services.categories.reorder(ctx.input.body.orderedIds, space);
      invalidateCategories(ctx.env, ctx.executionCtx, space, ctx.obs);
      return null;
    },
  })
);

/**
 * PATCH /api/categories/:categoryId
 * Update a category's editable fields (slug is stable across renames).
 */
app.patch(
  '/:categoryId',
  procedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: {
      params: categoryIdParamSchema,
      query: orgScopeQuerySchema,
      body: updateCategorySchema,
    },
    handler: async (ctx) => {
      const space = await resolveManagementSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );
      const category = await ctx.services.categories.update(
        ctx.input.params.categoryId,
        ctx.input.body,
        space
      );
      invalidateCategories(ctx.env, ctx.executionCtx, space, ctx.obs);
      return category;
    },
  })
);

/**
 * DELETE /api/categories/:categoryId
 * Soft delete a category (its content_categories join rows are left in place).
 */
app.delete(
  '/:categoryId',
  procedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: { params: categoryIdParamSchema, query: orgScopeQuerySchema },
    successStatus: 204,
    handler: async (ctx) => {
      const space = await resolveManagementSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );
      await ctx.services.categories.softDelete(
        ctx.input.params.categoryId,
        space
      );
      invalidateCategories(ctx.env, ctx.executionCtx, space, ctx.obs);
      return null;
    },
  })
);

/**
 * POST /api/categories/:categoryId/cover
 * Upload (or replace) the category cover image.
 *
 * Security: same owner/admin (org) or self (personal) gate as the mutations.
 * Content-Type: multipart/form-data. Form field: `cover` (file).
 */
app.post(
  '/:categoryId/cover',
  multipartProcedure({
    policy: {
      auth: 'required',
      roles: CATEGORY_MANAGER_ROLES,
      rateLimit: 'api',
    },
    input: { params: categoryIdParamSchema, query: orgScopeQuerySchema },
    files: {
      cover: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx) => {
      const space = await resolveManagementSpace(
        ctx.input.query.organizationId,
        ctx.user.id,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );

      // Verify the category exists in the caller's space BEFORE writing R2, so
      // an out-of-space id can never seed an orphaned cover object.
      const existing = await ctx.services.categories.get(
        ctx.input.params.categoryId,
        space
      );
      if (!existing) {
        throw new CategoryNotFoundError(ctx.input.params.categoryId);
      }

      const processed = await ctx.services.imageProcessing.processCategoryCover(
        ctx.input.params.categoryId,
        new File([ctx.files.cover.buffer], ctx.files.cover.name, {
          type: ctx.files.cover.type,
        })
      );

      // Persist the base key on the row — the space-aware service owns the write.
      const updated = await ctx.services.categories.update(
        ctx.input.params.categoryId,
        { coverImageKey: processed.coverImageKey },
        space
      );

      invalidateCategories(ctx.env, ctx.executionCtx, space, ctx.obs);

      return {
        coverImageKey: updated.coverImageKey,
        coverImageUrl: processed.url,
      };
    },
  })
);

export default app;
