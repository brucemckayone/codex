import {
  type CourseEntryResponse,
  createContentAccessService,
  type PlaybackProgressResponse,
  type StreamingUrlResponse,
  type UpdatePlaybackProgressResponse,
  verifyHlsToken,
} from '@codex/access';
import { CACHE_PRESETS } from '@codex/constants';
import {
  combineSubjects,
  type RateLimitSubjectResolver,
  rateLimit,
  trustedIpSubject,
} from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import {
  canEnterCourseParamsSchema,
  canViewParamsSchema,
  createIdParamsSchema,
  hlsProxyQuerySchema,
  hlsVariantParamsSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
  streamingUrlQuerySchema,
  withdrawnContentQuerySchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { resolveR2PublicBases, resolveR2Url } from './r2-public-urls';

const app = new Hono<HonoEnv>();

/**
 * Headers for every proxied playlist response (RFC 8216 §4 content type).
 *
 * `CACHE_PRESETS.fresh` (= `private, no-store`) because the body embeds
 * short-lived presigned URLs and a per-user HLS token: a copy on ANY disk —
 * a shared cache's or the viewer's own browser's — outlives the credential
 * inside it. Not merely per-viewer, per-REQUEST.
 *
 * NAMED RATHER THAN SPELLED OUT. These two routes are plain Hono handlers, not
 * `procedure()` calls, so they cannot declare `policy.cache` and must set the
 * header themselves. Using the preset is what keeps the value on the same
 * dial as every other response in the platform: the string is unchanged
 * (byte-identical to the literal this replaced), but the reasoning above now
 * sits beside the five siblings it is being chosen over, and a central change
 * to what `fresh` means reaches here instead of stopping at a local literal.
 */
const HLS_PLAYLIST_HEADERS = {
  'Content-Type': 'application/vnd.apple.mpegurl',
  'Cache-Control': CACHE_PRESETS.fresh,
} as const;

/**
 * Count against the HLS token the caller presented.
 *
 * These two routes carry no session: the video player authenticates with the
 * short-lived token in the query string, so `sessionSubject()` names nothing
 * and — when the player is reached through a worker hop — `trustedIpSubject()`
 * names nothing either. The token is the one subject this surface can ALWAYS
 * name, so keying on it is what keeps the limiter from permanently failing
 * open here. It is per-user and per-media, which is exactly the granularity a
 * segment-refresh budget wants. The middleware SHA-256s the value before it
 * reaches a bucket key or a log line.
 *
 * A random-token flood still mints a fresh bucket per request; the address
 * bucket beside it is what covers that, and the token is verified immediately
 * after, so a bogus one costs a signature check and a 403.
 */
const hlsTokenSubject = (): RateLimitSubjectResolver => (c) => {
  const token = c.req.query('token');
  return token ? { kind: 'credential', value: token } : null;
};

/**
 * Streaming rate-limit middleware for the raw HLS proxy routes. Built inline
 * (rather than at module load) so it can read the per-request env — mirrors
 * the `streaming` preset the `procedure()`-based `/stream` route declares.
 *
 * Mounted per-route rather than with `app.use`, so it does NOT double-charge
 * the procedure() routes in this file, which enforce their own declared preset
 * (Codex-kgrdp.9).
 */
const hlsStreamingRateLimit = createMiddleware<HonoEnv>((c, next) =>
  rateLimit({
    preset: 'streaming',
    binding: c.env.RATE_LIMIT_STREAMING,
    subject: combineSubjects(hlsTokenSubject(), trustedIpSubject()),
  })(c, next)
);

/**
 * GET /api/access/courses/:courseId/can-enter
 *
 * Entitlement gate for a course DASHBOARD / journey (SPEC §6.3). Returns whether
 * the authenticated user currently holds a LIVE course entitlement — a stored
 * grant OR a derived tier grant, never a stale `course_enrollments` row — so a
 * lapsed tier loses entry instantly (instant-revocation). Delegates to the
 * frozen `EntitlementResolver.canEnterCourse` on the access service.
 *
 * On a refusal it also names an open payment dispute that holds the user's
 * grant back (`disputeHold`, Codex-2hxff.60), so the course page shows the
 * dispute notice instead of Buy or Join.
 * @returns {CourseEntryResponse}
 */
app.get(
  '/courses/:courseId/can-enter',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - dashboard/library gate reads
    },
    input: {
      params: canEnterCourseParamsSchema,
    },
    handler: async (ctx): Promise<CourseEntryResponse> =>
      ctx.services.access.getCourseEntry(
        ctx.user.id,
        ctx.input.params.courseId
      ),
  })
);

/**
 * GET /api/access/content/:contentId/can-view
 *
 * Entitlement check gating whether the user may open a piece of content
 * ANYWHERE (SPEC §6.3) — the boolean the signed-stream gate is built on.
 * `auth: 'optional'` so an anonymous visitor resolves as `userId = null` and the
 * resolver decides public / free access; an authenticated caller resolves with
 * their id. Delegates to the frozen `EntitlementResolver.canView`.
 * @returns {{ canView: boolean }}
 */
app.get(
  '/content/:contentId/can-view',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min - public-facing gate read
    },
    input: {
      params: canViewParamsSchema,
    },
    handler: async (ctx): Promise<{ canView: boolean }> => {
      const canView = await ctx.services.access.canView(
        ctx.user?.id ?? null,
        ctx.input.params.contentId
      );
      return { canView };
    },
  })
);

/**
 * GET /api/access/content/:id/stream
 *
 * Generate signed streaming URL for content.
 * Protected by authenticated user policy with streaming rate limiting (60 req/min)
 * to prevent abuse while allowing legitimate HLS segment refreshes.
 *
 * Access verification done at service layer:
 * - Content's organizationId is fetched from database
 * - Access is decided by `decideContentAccess` (price, tier, followers, team,
 *   course-only), as for every other content read
 * - Works from both org subdomains and root domain (revelations.studio)
 *
 * `?include=body` also returns the content's body once access is granted (a row
 * never released is granted to no one, Codex-nacky): the body source for an entitled
 * reader of a gated piece, whose public row carries none (Codex-039vo). Only
 * the detail pages send it.
 * @returns {StreamingUrlResponse}
 */
app.get(
  '/content/:id/stream',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'streaming', // 60 req/min - allows HLS segment refreshes
      // `private, no-store`, as the HLS playlist routes: this response carries
      // a per-user HLS token, and with `include=body` a gated piece's body, so
      // no copy of IT may outlive the request on any disk. That covers this
      // response only: the detail page that renders the body sends its own
      // header, `private, no-store` too when it carries a gated body
      // (`detailPageCacheHeaders`, Codex-hyz1c).
      cache: 'fresh',
    },
    input: {
      params: createIdParamsSchema(),
      query: streamingUrlQuerySchema,
    },
    handler: async (ctx): Promise<StreamingUrlResponse> => {
      const { params, query } = ctx.input;

      // Service fetches content's organizationId and verifies access
      const result = await ctx.services.access.getStreamingUrl(
        ctx.user.id,
        { contentId: params.id, expirySeconds: query?.expirySeconds },
        { includeBody: query?.include === 'body' }
      );

      // `body` is undefined unless asked for, granted, and released; JSON
      // drops it.
      return {
        streamingUrl: result.streamingUrl,
        waveformUrl: result.waveformUrl,
        expiresAt: result.expiresAt.toISOString(),
        contentType: result.contentType,
        readyVariants: result.readyVariants,
        body: result.body,
      };
    },
  })
);

/**
 * GET /api/access/content/withdrawn?slug=…&(orgId=…|creatorId=…)
 *
 * An item that was published once, is not now, and that this reader still
 * has access to (a buyer, a course owner, a subscriber until their next
 * renewal), by its detail URL's key (Codex-ov2ii). The detail pages ask for it
 * when the public lookup misses for a signed-in reader, so an item withdrawn
 * from sale opens for whoever still has it instead of "Content not found".
 *
 * Every other case is a 404, the same one whether or not the item exists.
 * `private, no-store`: the answer is per reader, and nothing caches it.
 * @returns `{ content, held }`, the row's media with its R2 keys resolved (typed
 *   on the web as `WithdrawnContentItem`)
 */
app.get(
  '/content/withdrawn',
  procedure({
    policy: { auth: 'required', cache: 'fresh' },
    input: { query: withdrawnContentQuerySchema },
    handler: async (ctx) => {
      const { content, held } = await ctx.services.access.getWithdrawnContent(
        ctx.user.id,
        ctx.input.query
      );
      // Keys to CDN URLs, as the public list resolves them, so the page
      // draws the thumbnail and preview it drew on the storefront.
      return {
        content: resolveR2Url(content, resolveR2PublicBases(ctx.env)),
        held,
      };
    },
  })
);

/**
 * GET /api/access/content/:id/hls/master.m3u8?token=...
 *
 * Token-authenticated HLS MASTER playlist proxy (WP-14 / Codex-fc5oh.14).
 *
 * The short-lived HMAC token (minted by `getStreamingUrl`) IS the auth — no
 * session cookie, no CORS, no per-request DB access check. This route does NOT
 * use `procedure()` because it returns a RAW text body (the rewritten playlist)
 * with custom HLS headers, not the JSON envelope. It applies the same
 * `streaming` rate-limit preset as `/stream` so segment/manifest refreshes
 * stay bounded.
 *
 * The token payload carries `{ creatorId, mediaId, exp }`, so the R2 master
 * key is built without a DB round-trip. The service reads + rewrites the
 * playlist (all R2/rewrite logic stays in the service layer).
 *
 * On invalid/expired token → 403; on missing playlist object → 404.
 */
app.get('/content/:id/hls/master.m3u8', hlsStreamingRateLimit, async (c) => {
  const contentId = c.req.param('id');
  const queryResult = hlsProxyQuerySchema.safeParse({
    token: c.req.query('token'),
  });
  if (!queryResult.success) {
    return c.text('Missing streaming token', 403);
  }
  const { token } = queryResult.data;

  const payload = await verifyHlsToken(token, c.env.WORKER_SHARED_SECRET);
  if (!payload) {
    return c.text('Invalid or expired streaming token', 403);
  }

  const { service, cleanup } = createContentAccessService(c.env);
  try {
    const playlist = await service.getHlsMasterPlaylist({
      contentId,
      creatorId: payload.creatorId,
      mediaId: payload.mediaId,
      token,
    });
    if (playlist === null) {
      return c.text('Playlist not found', 404);
    }
    return c.body(playlist, 200, HLS_PLAYLIST_HEADERS);
  } finally {
    c.executionCtx.waitUntil(cleanup());
  }
});

/**
 * GET /api/access/content/:id/hls/:variant/index.m3u8?token=...
 *
 * Token-authenticated HLS VARIANT playlist proxy (WP-14). Reads the variant
 * playlist from R2 and rewrites each relative `segment_NNN.ts` URI to an
 * absolute SigV4-presigned R2 URL — segments then load direct R2 → client.
 *
 * `:variant` is validated against the canonical HLS rung enum so the proxy can
 * never build an arbitrary R2 key. Token TTL drives the presigned-segment
 * expiry, deriving the remaining lifetime from the token's `exp`.
 *
 * On invalid/expired token or bad variant → 403; on missing playlist → 404.
 */
app.get(
  '/content/:id/hls/:variant/index.m3u8',
  hlsStreamingRateLimit,
  async (c) => {
    const paramsResult = hlsVariantParamsSchema.safeParse({
      id: c.req.param('id'),
      variant: c.req.param('variant'),
    });
    const queryResult = hlsProxyQuerySchema.safeParse({
      token: c.req.query('token'),
    });
    if (!paramsResult.success || !queryResult.success) {
      return c.text('Invalid request', 403);
    }
    const { variant } = paramsResult.data;
    const { token } = queryResult.data;

    const payload = await verifyHlsToken(token, c.env.WORKER_SHARED_SECRET);
    if (!payload) {
      return c.text('Invalid or expired streaming token', 403);
    }

    // Presign segments for the remaining token lifetime (bounded to a minimum
    // floor so a near-expiry refresh still yields usable segment URLs).
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    const expirySeconds = Math.max(remaining, 60);

    const { service, cleanup } = createContentAccessService(c.env);
    try {
      const playlist = await service.getHlsVariantPlaylist({
        creatorId: payload.creatorId,
        mediaId: payload.mediaId,
        variant,
        expirySeconds,
      });
      if (playlist === null) {
        return c.text('Playlist not found', 404);
      }
      return c.body(playlist, 200, HLS_PLAYLIST_HEADERS);
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  }
);

/**
 * POST /api/access/content/:id/progress
 *
 * Save playback progress for video content.
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * Returns 204 No Content on success (no response body needed for update operations).
 * @returns {UpdatePlaybackProgressResponse}
 */
app.post(
  '/content/:id/progress',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - standard for API updates
    },
    input: {
      params: createIdParamsSchema(),
      body: savePlaybackProgressSchema.omit({ contentId: true }),
    },
    successStatus: 204, // No Content - update successful, no response body
    handler: async (ctx): Promise<UpdatePlaybackProgressResponse> => {
      const { params, body } = ctx.input;

      await ctx.services.access.savePlaybackProgress(ctx.user.id, {
        contentId: params.id,
        ...body,
      });

      return null; // 204 returns no body
    },
  })
);

/**
 * GET /api/access/content/:id/progress
 *
 * Get playback progress for video content.
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * @returns {PlaybackProgressResponse}
 */
app.get(
  '/content/:id/progress',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - standard for API reads
    },
    input: {
      params: createIdParamsSchema(),
    },
    handler: async (ctx): Promise<PlaybackProgressResponse> => {
      const { params } = ctx.input;

      const progress = await ctx.services.access.getPlaybackProgress(
        ctx.user.id,
        {
          contentId: params.id,
        }
      );

      if (!progress) {
        return { progress: null };
      }

      return {
        progress: {
          ...progress,
          updatedAt: progress.updatedAt.toISOString(),
        },
      };
    },
  })
);

/**
 * GET /api/access/user/library
 *
 * List user's purchased content with playback progress.
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * Complex database queries (purchases + content + media + playback) with pagination.
 * @returns {UserLibraryResponse}
 */
app.get(
  '/user/library',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - prevents pagination abuse
    },
    input: {
      query: listUserLibrarySchema,
    },
    handler: async (ctx) => {
      const result = await ctx.services.access.listUserLibrary(
        ctx.user.id,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

export default app;
