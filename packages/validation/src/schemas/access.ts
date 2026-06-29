import { z } from 'zod';
import {
  nonNegativeIntSchema,
  positiveIntSchema,
  uuidSchema,
} from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';
import { hlsVariantSchema } from './transcoding';

/**
 * Validation schemas for content access endpoints
 *
 * Design principles:
 * - Pure validation (no DB dependency)
 * - Clear error messages for API responses
 * - Sensible defaults (10 minute expiry, page 1, limit 20)
 * - Bounds checking (expiry: 5 minutes to 2 hours, page max 1000)
 * - Imperative error message pattern: "Must be..."
 */

export const getStreamingUrlSchema = z.object({
  contentId: uuidSchema,
  expirySeconds: z
    .number()
    .int('Must be a whole number')
    .min(300, 'Must be at least 5 minutes (300 seconds)')
    .max(7200, 'Must be 2 hours or less (7200 seconds)')
    .optional()
    .default(600), // 10 min default — mirrors DEFAULT_STREAMING_URL_TTL_SECONDS
  // in @codex/access/ContentAccessService. Bounds post-revocation exposure:
  // presigned URLs cannot be invalidated once issued, so this is the maximum
  // window during which a cancelled/revoked user can still stream.
});

export const savePlaybackProgressSchema = z.object({
  contentId: uuidSchema,
  positionSeconds: nonNegativeIntSchema,
  durationSeconds: positiveIntSchema,
  completed: z.boolean().optional().default(false),
});

export const getPlaybackProgressSchema = z.object({
  contentId: uuidSchema,
});

/**
 * Query schema for the token-authenticated HLS playlist proxy routes
 * (`GET /content/:id/hls/master.m3u8` and `.../:variant/index.m3u8`).
 *
 * The short-lived HMAC token IS the auth (no session cookie / CORS), so it is
 * required. Kept loose (non-empty string) — structural + signature + expiry
 * validation happens in `verifyHlsToken` (@codex/access), which fails closed
 * to 403, not 400.
 */
export const hlsProxyQuerySchema = z.object({
  token: z.string().min(1, 'Must provide a streaming token'),
});

/**
 * Route-params schema for the HLS variant playlist proxy. `variant` is bounded
 * to the canonical HLS quality rungs (reuses `hlsVariantSchema`) so the proxy
 * can never be coerced into building an arbitrary R2 key path.
 */
export const hlsVariantParamsSchema = z.object({
  id: uuidSchema,
  variant: hlsVariantSchema,
});

export type HlsProxyQuery = z.infer<typeof hlsProxyQuerySchema>;
export type HlsVariantParams = z.infer<typeof hlsVariantParamsSchema>;

/**
 * Response schema for GET /api/access/content/:id/stream.
 *
 * Mirrors `StreamingUrlResponse` in `@codex/access/types.ts`. Kept here as a
 * Zod schema so route handlers and clients can validate the wire shape
 * without duplicating the variant enum — `readyVariants` reuses
 * `hlsVariantSchema` from the transcoding schema.
 *
 * `readyVariants` is optional: absent when the media item has no transcoding
 * outputs yet (pre-transcode fallback) or for non-media (written) content.
 * When present, clients can surface a manual quality picker over HLS.js's
 * default auto-adaptive behaviour.
 */
export const streamingUrlResponseSchema = z.object({
  streamingUrl: z.string().nullable(),
  waveformUrl: z.string().nullable(),
  expiresAt: z.string(),
  contentType: z.string(),
  readyVariants: z.array(hlsVariantSchema).optional(),
});

export type StreamingUrlResponseSchema = z.infer<
  typeof streamingUrlResponseSchema
>;

export const listUserLibrarySchema = paginationSchema.extend({
  organizationId: uuidSchema.optional(),
  filter: z
    .enum(['all', 'in_progress', 'completed', 'not_started'])
    .optional()
    .default('all'),
  sortBy: z.enum(['recent', 'title', 'duration']).optional().default('recent'),
  // Values match DB content.contentType column
  contentType: z
    .enum(['all', 'video', 'audio', 'written'])
    .optional()
    .default('all'),
  accessType: z
    .enum([
      'all',
      'purchased',
      'membership',
      'subscription',
      'free',
      'followers',
    ])
    .optional()
    .default('all'),
  search: z.string().max(200).optional().default(''),
});

// Type exports
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
export type SavePlaybackProgressInput = z.infer<
  typeof savePlaybackProgressSchema
>;
export type GetPlaybackProgressInput = z.infer<
  typeof getPlaybackProgressSchema
>;
export type ListUserLibraryInput = z.infer<typeof listUserLibrarySchema>;
