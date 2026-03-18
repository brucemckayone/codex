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
  mediaType: z.enum(['video', 'audio']),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().min(1),
  r2Key: z.string().min(1),
});

/**
 * Create a new media item
 *
 * Returns the created media item (with ID for subsequent upload).
 *
 * Usage:
 * ```svelte
 * <script>
 *   const result = await createMedia({
 *     title: 'My Video',
 *     mediaType: 'video',
 *     mimeType: 'video/mp4',
 *     fileSizeBytes: 1024000,
 *     r2Key: 'originals/abc/video.mp4',
 *   });
 * </script>
 * ```
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
