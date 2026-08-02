/**
 * Access & Streaming Response Types
 *
 * Canonical home for content access, playback, and library response types.
 * Previously in @codex/shared-types — moved here for domain ownership.
 */

import type { ProgressData } from '@codex/shared-types';

/**
 * Response for GET /api/access/content/:id/stream
 *
 * `streamingUrl` is null for written content (articles) — access is still
 * verified, but there is no media stream to sign. The client uses a null
 * streamingUrl together with a successful response as a "has access, body
 * unlocks" signal.
 */
export interface StreamingUrlResponse {
  streamingUrl: string | null;
  waveformUrl: string | null;
  expiresAt: string; // ISO 8601 timestamp
  contentType: string;
  /**
   * HLS quality variants that finished transcoding for this media item
   * (e.g. `['1080p', '720p', '480p', '360p']`). Omitted when the media has
   * no transcoding output (pre-transcode, or written content). The client
   * uses this to render a manual quality picker over HLS.js's adaptive
   * bitrate default — the actual variant URLs stay inside the HLS master
   * playlist, so this array is purely a menu-population signal.
   */
  readyVariants?: string[];
}

/**
 * Response for GET /api/access/content/:id/progress
 * Returns current playback progress or null if not started
 */
export interface PlaybackProgressResponse {
  progress: ProgressData | null;
}

/**
 * Response for GET `/api/access/user/library`.
 *
 * RE-EXPORTED from the service that produces it rather than re-declared here.
 * This file used to hand-declare a parallel copy, and the two drifted badly:
 * the copy listed `accessType: 'purchased' | 'membership' | 'subscription'`
 * long after the service started returning `'free'` and `'followers'` too, and
 * it never gained the `journeys` provenance field. TypeScript could not catch
 * it — the service's richer object is structurally assignable to the narrower
 * declaration, so nothing cross-checked them, and every frontend consumer
 * (which imports this barrel, not the service internals) was typed against
 * values the API had stopped restricting itself to.
 *
 * Deriving it makes that class of drift impossible rather than merely fixed.
 */
export type {
  UserLibraryItem,
  UserLibraryResponse,
} from './services/content-access/library';

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;
