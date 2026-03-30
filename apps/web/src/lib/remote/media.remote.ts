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

import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

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
// Upload Media File Command (fallback for local dev without presigned URLs)
// ─────────────────────────────────────────────────────────────────────────────

const uploadMediaSchema = z.object({
  mediaId: z.string().uuid(),
  file: z.instanceof(File),
});

/**
 * Upload a media file to R2 via the content-api worker.
 *
 * Used as a fallback when presigned URLs are unavailable (local dev).
 * In production, the client PUTs directly to the presigned R2 URL instead.
 */
export const uploadMedia = command(
  uploadMediaSchema,
  async ({ mediaId, file }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    return api.media.upload(mediaId, file);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Media Command
// ─────────────────────────────────────────────────────────────────────────────

const updateMediaSchema = z.object({
  id: z.string().uuid(),
  data: z.object({
    status: z
      .enum(['uploading', 'uploaded', 'transcoding', 'ready', 'failed'])
      .optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    width: z.number().int().min(1).max(7680).optional(),
    height: z.number().int().min(1).max(4320).optional(),
  }),
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
// Transcoding Status Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get transcoding status and progress for a media item
 * Used by MediaCard to poll progress during transcoding
 */
export const getTranscodingStatus = query(
  z.string().uuid(),
  async (mediaId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    return api.media.transcodingStatus(mediaId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Complete Upload Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark upload as complete and trigger transcoding
 *
 * Called after the client finishes uploading to the presigned R2 URL.
 */
export const completeUpload = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  return api.media.uploadComplete(id);
});
