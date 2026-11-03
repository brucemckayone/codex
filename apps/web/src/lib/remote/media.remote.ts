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

import {
  deleteMediaInputSchema,
  mediaQuerySchema,
  updateMediaItemSchema,
} from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { forwardClientErrors } from '$lib/server/forward-client-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Media List Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List the creator's media: the library (search, status groups, usage, the
 * sorts, 24 a page) and the pickers.
 *
 * Its args ARE content-api's `mediaQuerySchema` (Codex-a6ofh.1.6), so the two
 * cannot drift: the hand copy this replaced lagged the API by a search, two
 * status groups, the usage filter and two sorts, and capped nothing the API
 * refuses. Media is personal (decision 1A), so there is no organizationId.
 * `search` must reach here gated (`gateSearchQuery`, Codex-k618q).
 */
export const listMedia = query(mediaQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return api.media.list(searchParams);
});

/**
 * The whole library in four numbers (Codex-a6ofh.1.6): `{ total, totalBytes,
 * failed, stopped }`, for the library header and its needs-attention line.
 * The paged list cannot give them: its total is its filter's.
 */
export const getMediaSummary = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.media.summary();
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
 * Update media item metadata: the drawer's title and description, saved on
 * blur. A 4xx keeps its status (404: deleted meanwhile; 429: too many saves),
 * so the drawer can say which, rather than every refusal reading as an
 * outage the creator retries forever (Codex-a6ofh.1.7).
 */
export const updateMedia = command(updateMediaSchema, async ({ id, data }) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  return forwardClientErrors(() => api.media.update(id, data));
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete Media Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a media item (soft delete; support can restore it for 30 days).
 *
 * `usage` is the fingerprint `getMediaUsage` returned for the list the dialog
 * showed. The worker refuses with 409 `MEDIA_IN_USE` (something published
 * uses it) or `MEDIA_USAGE_CHANGED` (the uses moved since that read), and
 * `forwardClientErrors` keeps those codes: without it, every 4xx reached the
 * browser as a bare 500 and the dialog could only log it (Codex-6sbn1).
 */
export const deleteMedia = command(
  deleteMediaInputSchema,
  async ({ id, usage }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    await forwardClientErrors(() => api.media.delete(id, usage));
    return { success: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Media Usage Query (Codex-6sbn1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a media item is used: the library chip's popover and the delete
 * dialog. The worker never caches it (it is the delete's guard), and the
 * dialog refreshes it on every open, so a read the popover still holds is
 * never what a delete trusts. A 4xx keeps its status (429 = wait a minute).
 */
export const getMediaUsage = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.media.usage(id));
});

// ─────────────────────────────────────────────────────────────────────────────
// Media Drawer (Codex-a6ofh.1.7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One media item, for the library's detail drawer, which re-reads it on every
 * open. A 4xx keeps its status: 404 is another creator's id, or a deleted one.
 */
export const getMediaItem = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.media.get(id));
});

/**
 * A signed preview of the creator's own media (Codex-a6ofh.1.5): a command,
 * not a query, because each call mints a 15-minute token, so a cached one
 * would expire under the player. Minted only when the creator presses Play.
 * A 422 (`MEDIA_NOT_READY`) keeps its status.
 */
export const getMediaPreview = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.media.preview(id));
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
