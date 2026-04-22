/**
 * Access & Streaming Response Types
 *
 * Canonical home for content access, playback, and library response types.
 * Previously in @codex/shared-types — moved here for domain ownership.
 */

import type { PaginationMetadata, ProgressData } from '@codex/shared-types';

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
}

/**
 * Response for GET /api/access/content/:id/progress
 * Returns current playback progress or null if not started
 */
export interface PlaybackProgressResponse {
  progress: ProgressData | null;
}

/**
 * Response for GET /api/access/user/library
 * Returns user's library with content and purchase information
 */
export interface UserLibraryResponse {
  items: Array<{
    content: {
      id: string;
      slug: string;
      title: string;
      description: string;
      thumbnailUrl: string | null;
      contentType: string;
      durationSeconds: number;
      organizationSlug: string | null;
    };
    /** Access type: 'purchased' = bought, 'membership' = org member access, 'subscription' = active subscription */
    accessType: 'purchased' | 'membership' | 'subscription';
    purchase: {
      purchasedAt: string; // ISO 8601 timestamp
      priceCents: number;
    } | null;
    progress: (ProgressData & { percentComplete: number }) | null;
  }>;
  pagination: PaginationMetadata;
}

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;
