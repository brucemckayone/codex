/**
 * Access & Streaming Response Types
 *
 * Canonical home for content access, playback, and library response types.
 * Previously in @codex/shared-types — moved here for domain ownership.
 */

import type { PaginationMetadata, ProgressData } from '@codex/shared-types';

/**
 * Response for GET /api/access/content/:id/stream
 * Provides streaming URL for content playback
 */
export interface StreamingUrlResponse {
  streamingUrl: string;
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
      title: string;
      description: string;
      thumbnailUrl: string | null;
      contentType: string;
      durationSeconds: number;
    };
    purchase: {
      purchasedAt: string; // ISO 8601 timestamp
      priceCents: number;
    };
    progress: (ProgressData & { percentComplete: number }) | null;
  }>;
  pagination: PaginationMetadata;
}

/**
 * Response for POST /api/access/content/:id/progress
 * Returns null (204 No Content)
 */
export type UpdatePlaybackProgressResponse = null;
