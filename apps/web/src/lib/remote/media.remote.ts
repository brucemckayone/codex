/**
 * Media Remote Functions
 *
 * Server-side functions for media management using SvelteKit Remote Functions.
 * Uses `query()` for cached reads and `command()` for mutations.
 *
 * These functions use the existing server API client, which handles:
 * - URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 */

import { updateMediaItemSchema } from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Media List Query
// ─────────────────────────────────────────────────────────────────────────────

const mediaListQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(12),
  status: z
    .enum(['uploading', 'uploaded', 'transcoding', 'ready', 'failed'])
    .optional(),
  mediaType: z.enum(['video', 'audio']).optional(),
  sortBy: z.enum(['createdAt', 'uploadedAt', 'title']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

/**
 * List media items with pagination and filtering
 *
 * Usage:
 * ```svelte
 * <script>
 *   const media = await listMedia({ page: 1, limit: 12 });
 * </script>
 * ```
 */
export const listMedia = query(mediaListQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit));
  if (params.organizationId)
    searchParams.set('organizationId', params.organizationId);
  if (params.status) searchParams.set('status', params.status);
  if (params.mediaType) searchParams.set('mediaType', params.mediaType);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.media.list(searchParams.toString() ? searchParams : undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Media Command
// ─────────────────────────────────────────────────────────────────────────────

const createMediaSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  mediaType: z.enum(['video', 'audio']),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().min(1),
});

/**
 * Create a new media item
 *
 * Returns the created media item with presigned upload URL.
 * The r2Key is generated server-side (creator-scoped via paths.ts SSOT).
 */
export const createMedia = command(createMediaSchema, async (data) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  return api.media.create(data as Record<string, unknown>);
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Media Command
// ─────────────────────────────────────────────────────────────────────────────

const updateMediaSchema = z.object({
  id: z.string().uuid(),
  // Content-api's own: it refuses any other field.
  data: updateMediaItemSchema,
});

/**
 * Update media item metadata
 */
export const updateMedia = command(updateMediaSchema, async ({ id, data }) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  return api.media.update(id, data);
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete Media Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a media item (soft delete)
 */
export const deleteMedia = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  await api.media.delete(id);
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// Live Status + Try Again (Codex-l2c48.7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ticket for the studio's live status socket (`$lib/client/media-status`).
 *
 * A command, not a query: each ticket is single-use, so a cached one would
 * be refused. A 4xx keeps its status and code (401 = the session ended,
 * 429 = back off), which is how the socket decides whether to try again.
 */
export const getMediaStatusTicket = command(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.media.statusTicket());
});

/**
 * The failed tile's Try again. A refusal (the state moved, no tries left,
 * rate limited) is a 4xx the tile reads; the outcome of the retry itself
 * arrives over the live socket.
 */
export const retryTranscoding = command(z.string().uuid(), async (mediaId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.media.retryTranscoding(mediaId));
});

// ─────────────────────────────────────────────────────────────────────────────
// Complete Upload Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark upload as complete and trigger transcoding
 *
 * Called after the client finishes uploading to the presigned R2 URL.
 */
/**
 * `durationSeconds` is optional because the measurement is allowed to fail: it
 * comes from a browser `loadedmetadata` read that can time out on a codec the
 * client cannot parse. A missing duration must never block the upload, so this
 * validates the value but does not require it.
 */
const completeUploadSchema = z.object({
  id: z.string().uuid(),
  durationSeconds: z.number().int().min(1).max(86400).optional(),
});

export const completeUpload = command(
  completeUploadSchema,
  async ({ id, durationSeconds }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    return api.media.uploadComplete(id, durationSeconds);
  }
);
