/**
 * Content Management Endpoints
 *
 * RESTful API for managing content items (videos, audio, written content).
 * All routes require authentication and enforce creator ownership.
 *
 * Endpoints:
 * - POST   /api/content            - Create content
 * - GET    /api/content/check-slug/:slug - Check slug availability
 * - GET    /api/content/:id        - Get by ID
 * - PATCH  /api/content/:id        - Update content
 * - GET    /api/content            - List with filters
 * - POST   /api/content/:id/publish   - Publish content
 * - POST   /api/content/:id/unpublish - Unpublish content
 * - DELETE /api/content/:id        - Soft delete
 * - POST   /api/content/:id/thumbnail - Upload content thumbnail
 */

import { CacheType, VersionedCache } from '@codex/cache';
import { AUTH_ROLES } from '@codex/constants';
import type {
  ContentInvalidationReason,
  ContentResponse,
  CreateContentResponse,
  DeleteContentResponse,
  PublishContentResponse,
  UnpublishContentResponse,
  UpdateContentResponse,
} from '@codex/content';
import {
  ContentNotFoundError,
  checkContentSlugSchema,
  contentBrowseQuerySchema,
  contentQuerySchema,
  createContentSchema,
  invalidateContentAccess,
  updateContentSchema,
} from '@codex/content';
import { createDbClient } from '@codex/database';
import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/image-processing';
import type { Logger } from '@codex/observability';
import type { CheckSlugResponse, HonoEnv } from '@codex/shared-types';
import { createIdParamsSchema } from '@codex/validation';
import {
  invalidateOrgSlugCache,
  multipartProcedure,
  PaginatedResult,
  procedure,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { cleanupContentThumbnailOnDelete } from './content-cleanup';

/**
 * Bump the org content version in KV after publish/unpublish/delete.
 * Also invalidates the slug-keyed cache (public org info, stats, creators)
 * since content changes affect creator contentCount and org stats.
 * Fire-and-forget via waitUntil — does not block the response.
 */
function bumpOrgContentVersion(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  organizationId: string | null | undefined,
  obs?: Logger
): void {
  if (!organizationId || !env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: env.CACHE_KV });
  const db = createDbClient(env);
  executionCtx.waitUntil(
    Promise.all([
      // Invalidate org content collection version
      cache.invalidate(CacheType.COLLECTION_ORG_CONTENT(organizationId)),
      // Invalidate slug-keyed cache (stats, creators, public info) — shared
      // helper resolves orgId → slug and swallows transient failures.
      invalidateOrgSlugCache({ db, cache, orgId: organizationId, logger: obs }),
      // Invalidate the public topic list: publish/unpublish/delete changes the
      // set of categories with ≥1 published item, so a cached "Browse by topic"
      // list could otherwise show empty or missing topics until TTL.
      cache.invalidate(CacheType.CATEGORIES(organizationId)),
    ]).catch((err: unknown) => {
      obs?.warn('Cache invalidation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );
}

/**
 * Fan per-user library cache invalidation after a content mutation.
 *
 * Codex-c01do — content mutations (update-access-config, unpublish, delete,
 * publish) previously bumped ONLY catalogue version keys. The per-user
 * library cache (`COLLECTION_USER_LIBRARY`) was untouched, so library UI
 * showed stale accessType flags until the next visibility-change staleness
 * roundtrip. Access decisions at click time are always live (server-side)
 * — this is UX drift, not a security bug — but per feedback_dont_defer_cache_issues
 * we close the gap proactively.
 *
 * Fire-and-forget: the whole block is wrapped in `waitUntil` so the route
 * response is never blocked on KV writes.
 */
function fanContentInvalidation(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  contentId: string,
  organizationId: string | null | undefined,
  reason: ContentInvalidationReason,
  obs?: Logger,
  options: { includeFollowers?: boolean } = {}
): void {
  if (!env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: env.CACHE_KV });
  const db = createDbClient(env);
  const waitUntil = executionCtx.waitUntil.bind(executionCtx);

  // Wrap the whole fanout in waitUntil so the DB `resolveAffectedUsers`
  // query does not block the response. The helper internally hands each
  // per-user KV bump to waitUntil as well.
  executionCtx.waitUntil(
    invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId,
      organizationId: organizationId ?? null,
      reason,
      logger: obs,
      includeFollowers: options.includeFollowers ?? false,
    }).catch((err: unknown) => {
      obs?.warn('content-invalidation: fanout failed', {
        contentId,
        organizationId,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );
}

const app = new Hono<HonoEnv>();

/**
 * POST /api/content
 * Create new content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {CreateContentResponse}
 */
app.post(
  '/',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx): Promise<CreateContentResponse['data']> => {
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);

/**
 * GET /api/content/check-slug/:slug
 * Check if a content slug is available
 *
 * Query params:
 * - organizationId (optional): scope check to org content
 * - excludeContentId (optional): exclude a content item (for edit mode)
 *
 * Returns: { available: boolean } (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {CheckSlugResponse}
 */
app.get(
  '/check-slug/:slug',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: checkContentSlugSchema.pick({ slug: true }),
      query: checkContentSlugSchema
        .pick({ organizationId: true, excludeContentId: true })
        .optional(),
    },
    handler: async (ctx): Promise<CheckSlugResponse> => {
      const available = await ctx.services.content.isSlugAvailable(
        ctx.input.params.slug,
        ctx.user.id,
        ctx.input.query?.organizationId ?? null,
        ctx.input.query?.excludeContentId ?? null
      );
      return { available };
    },
  })
);

/**
 * GET /api/content/:id
 * Get content by ID
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {ContentResponse}
 */
app.get(
  '/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<ContentResponse['data']> => {
      const content = await ctx.services.content.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!content) {
        throw new ContentNotFoundError(ctx.input.params.id);
      }
      return content;
    },
  })
);

/**
 * PATCH /api/content/:id
 * Update content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {UpdateContentResponse}
 */
app.patch(
  '/:id',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: {
      params: createIdParamsSchema(),
      body: updateContentSchema,
    },
    handler: async (ctx): Promise<UpdateContentResponse['data']> => {
      const result = await ctx.services.content.update(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );
      // Fan per-user library invalidation (Codex-c01do). Covers access-config
      // edits — the most common cause of stale accessType flags in library UI.
      fanContentInvalidation(
        ctx.env,
        ctx.executionCtx,
        result.id,
        result.organizationId,
        'content_updated',
        ctx.obs
      );
      // Bump the org content collection version too. An edit changes the
      // public payload (title, description, price, thumbnail, accessType), and
      // the KV-cached public list AND slug-keyed detail page live under
      // COLLECTION_ORG_CONTENT(orgId). Without this bump they serve stale copy
      // until the 5-min TTL. Previously only publish/unpublish/delete bumped
      // it, so edits went stale on the catalogue until the next lifecycle event.
      bumpOrgContentVersion(
        ctx.env,
        ctx.executionCtx,
        result.organizationId,
        ctx.obs
      );
      return result;
    },
  })
);

/**
 * GET /api/content
 * List content with filters and pagination
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {ContentListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentQuerySchema },
    handler: async (ctx) => {
      // Studio-scope: returns the signed-in creator's content across all
      // their orgs (drafts list, dashboard). organizationId is optional.
      const result = await ctx.services.content.list(
        ctx.user.id,
        ctx.input.query,
        { scope: 'studio' }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/content/browse
 * Browse content within an org (cross-creator).
 *
 * Multi-tenant boundary: organizationId is REQUIRED via the schema, and
 * the service rejects browse-mode queries that lack it. Used by the
 * authenticated /explore "popular" / "top-selling" sorts where the
 * caller is browsing other creators' content within an org context.
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 */
app.get(
  '/browse',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentBrowseQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.content.list(
        ctx.user.id,
        ctx.input.query,
        { scope: 'browse' }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/content/:id/publish
 * Publish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {PublishContentResponse}
 */
app.post(
  '/:id/publish',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<PublishContentResponse['data']> => {
      const result = await ctx.services.content.publish(
        ctx.input.params.id,
        ctx.user.id
      );
      bumpOrgContentVersion(
        ctx.env,
        ctx.executionCtx,
        result.organizationId,
        ctx.obs
      );
      // Fan per-user library invalidation (Codex-c01do). A publish adds the
      // item to subscribers'/members' libraries — they need a fresh view.
      fanContentInvalidation(
        ctx.env,
        ctx.executionCtx,
        result.id,
        result.organizationId,
        'content_published',
        ctx.obs
      );

      // TODO: Send new-content-published email to subscribers
      // Requires a subscriber query (users with contentAccess in this org).
      // Template is seeded and ready — wire up when subscriber list
      // query is implemented in ContentAccessService.

      return result;
    },
  })
);

/**
 * POST /api/content/:id/unpublish
 * Unpublish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {UnpublishContentResponse}
 */
app.post(
  '/:id/unpublish',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<UnpublishContentResponse['data']> => {
      const result = await ctx.services.content.unpublish(
        ctx.input.params.id,
        ctx.user.id
      );
      bumpOrgContentVersion(
        ctx.env,
        ctx.executionCtx,
        result.organizationId,
        ctx.obs
      );
      // Fan per-user library invalidation (Codex-c01do). Unpublish must
      // remove the item from subscribers'/members' libraries.
      fanContentInvalidation(
        ctx.env,
        ctx.executionCtx,
        result.id,
        result.organizationId,
        'content_unpublished',
        ctx.obs
      );
      return result;
    },
  })
);

/**
 * DELETE /api/content/:id
 * Soft delete content
 *
 * Security: Creator/Admin only, Strict rate limit (5 req/15min)
 * @returns {DeleteContentResponse}
 */
app.delete(
  '/:id',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
      rateLimit: 'strict', // 20/min for destructive operations
    },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx): Promise<DeleteContentResponse> => {
      // Read org BEFORE delete so we can (a) bump its version and (b) fan
      // per-user library invalidation while the row is still readable.
      // Note: the per-user fanout query in `invalidateContentAccess` runs
      // against the content-id — we want to resolve affected users using the
      // pre-delete state (purchases, subscribers, members) which survives
      // the soft-delete unchanged. It's safe to call after delete because
      // we key by contentId and purchases/subscriptions/memberships don't
      // soft-delete alongside content.
      let organizationId: string | undefined;
      const contentId = ctx.input.params.id;
      try {
        const content = await ctx.services.content.get(contentId, ctx.user.id);
        organizationId = content?.organizationId ?? undefined;
      } catch {
        // Pre-fetch for cache invalidation is non-critical
      }
      await ctx.services.content.delete(contentId, ctx.user.id);
      // Codex-ko8ko: content soft-delete must not strand the thumbnail's R2
      // objects. Best-effort — records orphans for the hourly sweep on R2
      // failure and never throws; awaited so the request-scoped DB stays open
      // for its orphan-record / thumbnailUrl-clear writes.
      await cleanupContentThumbnailOnDelete(
        ctx.services.imageProcessing,
        contentId,
        ctx.user.id,
        ctx.obs
      );
      bumpOrgContentVersion(ctx.env, ctx.executionCtx, organizationId, ctx.obs);
      // Fan per-user library invalidation (Codex-c01do). Soft-delete must
      // remove the item from everyone's library UI immediately.
      fanContentInvalidation(
        ctx.env,
        ctx.executionCtx,
        contentId,
        organizationId ?? null,
        'content_deleted',
        ctx.obs
      );
      return null;
    },
  })
);

/**
 * POST /api/content/:id/thumbnail
 * Upload and process content thumbnail
 *
 * Security: Creator/Admin only, must own content
 * Content-Type: multipart/form-data
 * Form field: thumbnail (file)
 */
app.post(
  '/:id/thumbnail',
  multipartProcedure({
    policy: { auth: 'required', roles: ['creator', 'admin'] },
    input: { params: createIdParamsSchema() },
    files: {
      thumbnail: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx) => {
      // Verify content exists and is owned by user
      const content = await ctx.services.content.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!content) {
        throw new ContentNotFoundError(ctx.input.params.id);
      }

      // Process image via service registry
      const result = await ctx.services.imageProcessing.processContentThumbnail(
        ctx.input.params.id,
        ctx.user.id,
        new File([ctx.files.thumbnail.buffer], ctx.files.thumbnail.name, {
          type: ctx.files.thumbnail.type,
        })
      );

      // Thumbnail is part of the public content payload, so cached list/detail
      // pages must pick up the new image. Bump the org content version.
      bumpOrgContentVersion(
        ctx.env,
        ctx.executionCtx,
        content.organizationId,
        ctx.obs
      );

      return {
        thumbnailUrl: result.url,
        size: result.size,
        mimeType: result.mimeType,
      };
    },
  })
);

/**
 * DELETE /api/content/:id/thumbnail
 * Remove content thumbnail (revert to auto-generated)
 *
 * Security: Creator/Admin only, must own content
 */
app.delete(
  '/:id/thumbnail',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx) => {
      const { id: contentId } = ctx.input.params;

      // Get content to verify ownership
      const content = await ctx.services.content.get(contentId, ctx.user.id);
      if (!content) {
        throw new ContentNotFoundError(contentId);
      }

      // Use service method for cleanup (deletes R2 files + clears DB field)
      await ctx.services.imageProcessing.deleteContentThumbnail(
        contentId,
        content.creatorId
      );

      // Reverting to the auto-generated thumbnail changes the public payload —
      // bump the org content version so cached list/detail pages refresh.
      bumpOrgContentVersion(
        ctx.env,
        ctx.executionCtx,
        content.organizationId,
        ctx.obs
      );

      return null;
    },
  })
);

export default app;
