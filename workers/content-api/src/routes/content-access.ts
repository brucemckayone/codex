import {
  createContentAccessService,
  type PlaybackProgressResponse,
  type StreamingUrlResponse,
  type UpdatePlaybackProgressResponse,
  verifyHlsToken,
} from '@codex/access';
import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import {
  createIdParamsSchema,
  getStreamingUrlSchema,
  hlsProxyQuerySchema,
  hlsVariantParamsSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

const app = new Hono<HonoEnv>();

/**
 * Headers for every proxied playlist response (RFC 8216 §4 content type).
 * `private, no-store` because the body embeds short-lived presigned URLs / a
 * per-user token — it must never be cached by shared caches.
 */
const HLS_PLAYLIST_HEADERS = {
  'Content-Type': 'application/vnd.apple.mpegurl',
  'Cache-Control': 'private, no-store',
} as const;

/**
 * Streaming rate-limit middleware for the raw HLS proxy routes. Built inline
 * (rather than at module load) so it can read `RATE_LIMIT_KV` from the
 * per-request env — mirrors the `streaming` preset the `procedure()`-based
 * `/stream` route uses.
 */
const hlsStreamingRateLimit = createMiddleware<HonoEnv>((c, next) =>
  rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.streaming,
  })(c, next)
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
 * - User access verified via purchase OR organization membership
 * - Works from both org subdomains and root domain (revelations.studio)
 * @returns {StreamingUrlResponse}
 */
app.get(
  '/content/:id/stream',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'streaming', // 60 req/min - allows HLS segment refreshes
    },
    input: {
      params: createIdParamsSchema(),
      query: getStreamingUrlSchema.pick({ expirySeconds: true }),
    },
    handler: async (ctx): Promise<StreamingUrlResponse> => {
      const { params, query } = ctx.input;

      // Service fetches content's organizationId and verifies access
      const result = await ctx.services.access.getStreamingUrl(ctx.user.id, {
        contentId: params.id,
        expirySeconds: query?.expirySeconds,
      });

      return {
        streamingUrl: result.streamingUrl,
        waveformUrl: result.waveformUrl,
        expiresAt: result.expiresAt.toISOString(),
        contentType: result.contentType,
        readyVariants: result.readyVariants,
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
