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
 * - GET    /api/content/where-counts - Where the creator's content is filed
 * - GET    /api/content/attention  - "Needs you" counts, by kind
 * - POST   /api/content/:id/publish   - Publish content
 * - POST   /api/content/:id/unpublish - Unpublish content
 * - DELETE /api/content/:id        - Soft delete
 * - POST   /api/content/:id/thumbnail - Upload content thumbnail
 * - POST   /api/content/:id/categories - Add categories (keeps the set)
 * - POST   /api/content/bulk/{publish,unpublish,delete,categories,access}
 *          - One action on up to CONTENT_BULK_MAX pieces, a result for each
 */

import {
  AUTH_ROLES,
  CONTENT_STATUS,
  type ContentAttentionCounts,
} from '@codex/constants';
import type {
  CancelPublishRequestResponse,
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
  updateContentSchema,
} from '@codex/content';
import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/image-processing';
import type {
  CheckSlugResponse,
  ContentBulkResponse,
  ContentPortalUses,
  ContentWhereCounts,
  HonoEnv,
} from '@codex/shared-types';
import {
  addContentCategoriesSchema,
  contentAttentionQuerySchema,
  contentBulkAccessSchema,
  contentBulkCategoriesSchema,
  contentBulkSchema,
  createIdParamsSchema,
  publishContentQuerySchema,
  updateContentQuerySchema,
} from '@codex/validation';
import {
  multipartProcedure,
  PaginatedResult,
  procedure,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { cleanupContentThumbnailOnDelete } from './content-cleanup';
import {
  afterBulkChange,
  afterContentPublished,
  bumpOrgContentVersion,
  fanContentInvalidation,
} from './content-invalidation';
import {
  resolveR2PublicBases,
  toPublicItems,
  withPosterUrls,
} from './r2-public-urls';

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
 * GET /api/content/browse
 * Browse content within an org (cross-creator).
 *
 * Multi-tenant boundary: organizationId is REQUIRED via the schema, and
 * the service rejects browse-mode queries that lack it. Used by the
 * authenticated /explore "popular" / "top-selling" sorts where the
 * caller is browsing other creators' content within an org context.
 *
 * ROUTE ORDER IS LOAD-BEARING: this MUST stay above `GET /:id`. Hono resolves
 * in registration order, so with `/:id` first every request to `/browse` was
 * matched as `id = "browse"`, failed that route's UUID params schema, and
 * returned 422 `{"code":"VALIDATION_ERROR","details":[{"path":"params.id",
 * "message":"Invalid ID format"}]}` — which surfaced to signed-in users as a
 * full-page 500 "Invalid request data" the moment they picked "Most Popular" or
 * "Top Selling" on /explore. `/check-slug/:slug` sits above `/:id` for the same
 * reason. Any future static child of this router belongs above `/:id` too.
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 */
app.get(
  '/browse',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentBrowseQuerySchema },
    handler: async (ctx) => {
      // page and limit go in their own argument: list() pages only from that
      // one, so left inside the filters they were ignored and every page
      // returned the first 20 items (Codex-uuj1g).
      const { page, limit, ...filters } = ctx.input.query;
      const result = await ctx.services.content.list(
        ctx.user.id,
        filters,
        { page, limit },
        { scope: 'browse' }
      );
      // The public list's item, not the row (Codex-1bdx0): this route is any
      // signed-in account, and it used to send whole media_items rows (raw R2
      // keys, RunPod job id, transcoding error) and the whole organizations
      // row, with no URL resolved. The cards read the poster as
      // `mediaItem.thumbnailUrl`, which this resolves.
      return new PaginatedResult(
        toPublicItems(result.items, resolveR2PublicBases(ctx.env), ctx.obs),
        result.pagination
      );
    },
  })
);

/**
 * GET /api/content/where-counts
 * How the creator's own content is filed (Codex-a6ofh.3.2): the personal
 * studio's "Where" menu, "Everywhere 14 · Personal 3 · Studio Alpha 9"
 * (mockup L4b). A static child, so above `/:id`, as `/browse` is.
 *
 * Returns: ContentWhereCounts (200)
 * Security: Authenticated users, own content only, API rate limit (100 req/min)
 */
app.get(
  '/where-counts',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx): Promise<ContentWhereCounts> =>
      ctx.services.content.whereCounts(ctx.user.id),
  })
);

/**
 * GET /api/content/attention
 * What the creator's own pieces need, by kind (Codex-a6ofh.3.4): the content
 * list's "Needs you" chips, counted across every page by the rule the list's
 * `needs` filter uses. Where the list looks: `organizationId`, or
 * `scope=personal` (the service's `organizationId: null`), or neither for
 * everywhere. A static child, so above `/:id`.
 *
 * Returns: ContentAttentionCounts (200)
 * Security: Authenticated users, own content only, API rate limit (100 req/min)
 */
app.get(
  '/attention',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentAttentionQuerySchema },
    handler: async (ctx): Promise<ContentAttentionCounts> => {
      const { scope, organizationId } = ctx.input.query;
      return ctx.services.content.attentionCounts(
        ctx.user.id,
        scope ? null : organizationId
      );
    },
  })
);

// ============================================================================
// Bulk actions (Codex-a6ofh.3.5, owner 2026-11-12: "Bulk endpoints, one
// bump"): the content list's selection, at most CONTENT_BULK_MAX pieces. Each
// piece goes through its own route's rules in its own transaction and gets a
// result of its own; the request fails only for its body, auth or the rate
// limit. One bulk call is one rate-limit hit. The caches are refreshed once
// per org after the loop (`afterBulkChange`), on the per-piece routes' own
// conditions. Static children, so above every `/:id` route: with `/:id/publish`
// first, `/bulk/publish` was read as the piece "bulk".
// ============================================================================

/**
 * POST /api/content/bulk/publish
 * Publish each piece, publish when ready included (owner D-b1): one whose
 * media is on its way is `scheduled`.
 *
 * Security: Creator/Admin only, own pieces (another's is not found), API
 * rate limit (100 req/min)
 * @returns {ContentBulkResponse}
 */
app.post(
  '/bulk/publish',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: contentBulkSchema },
    handler: async (ctx): Promise<ContentBulkResponse> => {
      const { results, touched } = await ctx.services.content.publishMany(
        ctx.input.body.ids,
        ctx.user.id
      );
      afterBulkChange(
        ctx.env,
        ctx.executionCtx,
        touched,
        'content_published',
        ctx.obs
      );
      return { results };
    },
  })
);

/**
 * POST /api/content/bulk/unpublish
 * Take each piece down; a draft is `unchanged`. Buyers keep playback.
 *
 * Security: Creator/Admin only, own pieces, API rate limit (100 req/min)
 * @returns {ContentBulkResponse}
 */
app.post(
  '/bulk/unpublish',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: contentBulkSchema },
    handler: async (ctx): Promise<ContentBulkResponse> => {
      const { results, touched } = await ctx.services.content.unpublishMany(
        ctx.input.body.ids,
        ctx.user.id
      );
      afterBulkChange(
        ctx.env,
        ctx.executionCtx,
        touched,
        'content_unpublished',
        ctx.obs
      );
      return { results };
    },
  })
);

/**
 * POST /api/content/bulk/delete
 * Soft-delete each piece. One people bought is left alone (owner D-b4):
 * `refused`, `CONTENT_HAS_BUYERS`. Each deleted cover's files are cleared in
 * the background, so the answer does not wait on R2.
 *
 * Security: Creator/Admin only, own pieces, strict rate limit (20/min): one
 * call deletes at most CONTENT_BULK_MAX pieces
 * @returns {ContentBulkResponse}
 */
app.post(
  '/bulk/delete',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
      rateLimit: 'strict',
    },
    input: { body: contentBulkSchema },
    handler: async (ctx): Promise<ContentBulkResponse> => {
      const { results, touched } = await ctx.services.content.deleteMany(
        ctx.input.body.ids,
        ctx.user.id
      );
      // Codex-ko8ko, as a delete one at a time: never strand a cover's R2
      // objects. Each cleanup is best-effort and never throws, and
      // `background` holds the request's DB open for its orphan records.
      ctx.background(
        Promise.allSettled(
          touched.map(({ id }) =>
            cleanupContentThumbnailOnDelete(
              ctx.services.imageProcessing,
              id,
              ctx.user.id,
              ctx.obs
            )
          )
        )
      );
      afterBulkChange(
        ctx.env,
        ctx.executionCtx,
        touched,
        'content_deleted',
        ctx.obs
      );
      return { results };
    },
  })
);

/**
 * POST /api/content/bulk/categories
 * File each piece in more categories, keeping the ones it has, as
 * `POST /:id/categories`: each one's space and 20-category limit hold.
 *
 * Security: Creator/Admin only, own pieces, API rate limit (100 req/min)
 * @returns {ContentBulkResponse}
 */
app.post(
  '/bulk/categories',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: contentBulkCategoriesSchema },
    handler: async (ctx): Promise<ContentBulkResponse> => {
      const { results, touched } = await ctx.services.content.addCategoriesMany(
        ctx.input.body.ids,
        ctx.user.id,
        ctx.input.body.categoryIds
      );
      // As the per-piece route: the org caches, no library fan-out.
      afterBulkChange(ctx.env, ctx.executionCtx, touched, null, ctx.obs);
      return { results };
    },
  })
);

/**
 * POST /api/content/bulk/access
 * Set who can watch each piece (owner D-b2): `PATCH /:id` with the access
 * fields alone, under its rules. A move to Followers or Team only leaves
 * alone a piece people bought (owner R1, `CONTENT_HAS_BUYERS`).
 *
 * Security: Creator/Admin only, own pieces, API rate limit (100 req/min)
 * @returns {ContentBulkResponse}
 */
app.post(
  '/bulk/access',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: contentBulkAccessSchema },
    handler: async (ctx): Promise<ContentBulkResponse> => {
      const { results, touched } = await ctx.services.content.accessMany(
        ctx.input.body.ids,
        ctx.user.id,
        ctx.input.body.access
      );
      afterBulkChange(
        ctx.env,
        ctx.executionCtx,
        touched,
        'content_updated',
        ctx.obs
      );
      return { results };
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
 * GET /api/content/:id/portals
 * The portals the creator's own piece is a practice in, draft portals too,
 * for its editor (Codex-a6ofh.2.5). A read of its own, so the piece's read
 * stays lean and this loads only where it is shown. Empty for a piece that
 * is not the caller's.
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {ContentPortalUses}
 */
app.get(
  '/:id/portals',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<ContentPortalUses> =>
      ctx.services.courseJourney.getContentPortalUses(
        ctx.input.params.id,
        ctx.user.id
      ),
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
      // `asDraft=true`: a draft's autosave, refused (409
      // CONTENT_ALREADY_LIVE) once the piece has been live (Codex-a6ofh.2).
      query: updateContentQuerySchema,
    },
    handler: async (ctx): Promise<UpdateContentResponse['data']> => {
      const {
        content: result,
        droppedThumbnailUrl,
        hasBeenLive,
      } = await ctx.services.content.updateReportingDroppedThumbnail(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id,
        { asDraft: ctx.input.query.asDraft }
      );
      // The editor's "use media thumbnail" moves the row off an uploaded
      // thumbnail without the DELETE route; its folder goes here instead
      // (Codex-kk9nv.5). Only this content's own folder is ever deleted.
      if (droppedThumbnailUrl) {
        await ctx.services.imageProcessing.deleteDroppedContentThumbnail(
          result.id,
          result.creatorId,
          droppedThumbnailUrl
        );
      }
      // A draft that was never live is in no cache (see `hasBeenLive` in
      // @codex/constants; the service judges it from the row before the
      // update).
      if (!hasBeenLive) return result;
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
 * POST /api/content/:id/categories
 * File a piece in more categories, keeping the ones it has (Codex-a6ofh.3.3):
 * the list's bulk "Add to category". A PATCH of `categoryIds` replaces the
 * set, so it cannot add without reading each piece first.
 *
 * Security: Creator/Admin only, as PATCH; API rate limit (100 req/min). Each
 * category must be in the piece's own space, and the piece's total stays at
 * most CONTENT_MAX_CATEGORIES (400 otherwise).
 * @returns {{ data: { categoryIds: string[] } }} its live categories after
 */
app.post(
  '/:id/categories',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: {
      params: createIdParamsSchema(),
      body: addContentCategoriesSchema,
    },
    handler: async (ctx): Promise<{ categoryIds: string[] }> => {
      const result = await ctx.services.content.addCategories(
        ctx.input.params.id,
        ctx.user.id,
        ctx.input.body.categoryIds
      );
      // As PATCH: a never-live draft is in no cache. A live piece's public
      // row carries its topic slugs, and the topic list counts it. An add
      // that filed nothing new (each one already held) changed neither.
      if (result.hasBeenLive && result.changed) {
        bumpOrgContentVersion(
          ctx.env,
          ctx.executionCtx,
          result.organizationId,
          ctx.obs
        );
      }
      return { categoryIds: result.categoryIds };
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
      // Paged from its own argument, as /browse is (Codex-uuj1g).
      // `scope=personal` is the content filed under no org, the service's
      // `organizationId: null` (Codex-a6ofh.3.2); the schema refuses it
      // beside an organizationId. `include=categories` names each row's
      // categories (the org studio's list, Codex-a6ofh.3.3).
      const { page, limit, scope, include, ...filters } = ctx.input.query;
      const result = await ctx.services.content.list(
        ctx.user.id,
        scope ? { ...filters, organizationId: null } : filters,
        { page, limit },
        { scope: 'studio', withCategories: include === 'categories' }
      );
      // The list's poster fallback (Codex-a6ofh.3.1): the row carries the
      // poster's R2 key, which the page cannot resolve; the URL goes beside it.
      return new PaginatedResult(
        withPosterUrls(result.items, resolveR2PublicBases(ctx.env), ctx.obs),
        result.pagination
      );
    },
  })
);

/**
 * POST /api/content/:id/publish
 * Publish content, or with `?whenReady=true` (Codex-a6ofh.2.7) schedule it to go
 * live once its media, still on its way, is ready
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {PublishContentResponse} The published content, or the scheduled
 *   draft (status `draft`, `publishRequestedAt` set)
 */
app.post(
  '/:id/publish',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema(), query: publishContentQuerySchema },
    handler: async (ctx): Promise<PublishContentResponse['data']> => {
      const result = await ctx.services.content.publish(
        ctx.input.params.id,
        ctx.user.id,
        { whenReady: ctx.input.query.whenReady }
      );
      // A schedule changed nothing public: no version to bump, no library
      // to fan out to.
      if (result.status !== CONTENT_STATUS.PUBLISHED) return result;
      afterContentPublished(ctx.env, ctx.executionCtx, result, ctx.obs);

      // TODO: Send new-content-published email to subscribers
      // Requires a subscriber query (users with contentAccess in this org).
      // Template is seeded and ready — wire up when subscriber list
      // query is implemented in ContentAccessService.

      return result;
    },
  })
);

/**
 * DELETE /api/content/:id/publish-request
 * Cancel a publish-when-ready schedule (Codex-a6ofh.2.7): the draft stays a
 * draft. One with neither a schedule nor a blocked reason comes back as it
 * is; one that went live first is a 409 (`CONTENT_ALREADY_LIVE`), never a
 * "cancelled".
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {CancelPublishRequestResponse}
 */
app.delete(
  '/:id/publish-request',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<CancelPublishRequestResponse['data']> =>
      ctx.services.content.cancelPublishRequest(
        ctx.input.params.id,
        ctx.user.id
      ),
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
 * The cover file both thumbnail routes take, so an upload and a stage never
 * refuse differently (Codex-a6ofh.2.5). The studio checks the same size
 * before sending (`CONTENT_THUMBNAIL_MAX_BYTES`).
 */
const THUMBNAIL_FILES = {
  thumbnail: {
    required: true,
    maxSize: MAX_IMAGE_SIZE_BYTES,
    allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
  },
} as const;

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
    files: THUMBNAIL_FILES,
    handler: async (ctx) => {
      // Verify content exists and is owned by user
      const content = await ctx.services.content.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!content) {
        throw new ContentNotFoundError(ctx.input.params.id);
      }

      // Thumbnail is part of the public content payload, so cached list/detail
      // pages must pick up the new image: bump the org content version. Also
      // when it throws: a write can commit and still report failure, and the
      // thumbnail it replaced is then deleted (Codex-kk9nv.16).
      const result = await ctx.services.imageProcessing
        .processContentThumbnail(
          ctx.input.params.id,
          ctx.user.id,
          new File([ctx.files.thumbnail.buffer], ctx.files.thumbnail.name, {
            type: ctx.files.thumbnail.type,
          })
        )
        .finally(() =>
          bumpOrgContentVersion(
            ctx.env,
            ctx.executionCtx,
            content.organizationId,
            ctx.obs
          )
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
 * POST /api/content/:id/thumbnail/stage
 * Ready a cover for a piece that has been live, without applying it
 * (Codex-a6ofh.2.5): its changes wait for Update, which sends the URL this
 * returns as `thumbnailUrl`. Nothing on the row or in public changes, so no
 * cache version is bumped. A piece holds one stage at a time (a new one
 * retires the last), and one never applied is reclaimed by the sweep.
 *
 * `rateLimit: 'strict'` (20/min), not the upload's `'api'`: every stage
 * leaves files for the sweep, where an upload deletes the folder it replaced.
 *
 * Security: Creator/Admin only, must own content
 * Content-Type: multipart/form-data
 * Form field: thumbnail (file)
 */
app.post(
  '/:id/thumbnail/stage',
  multipartProcedure({
    policy: {
      auth: 'required',
      roles: ['creator', 'admin'],
      rateLimit: 'strict',
    },
    input: { params: createIdParamsSchema() },
    files: THUMBNAIL_FILES,
    handler: async (ctx) => {
      const content = await ctx.services.content.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!content) {
        throw new ContentNotFoundError(ctx.input.params.id);
      }

      const result = await ctx.services.imageProcessing.stageContentThumbnail(
        ctx.input.params.id,
        ctx.user.id,
        new File([ctx.files.thumbnail.buffer], ctx.files.thumbnail.name, {
          type: ctx.files.thumbnail.type,
        })
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
