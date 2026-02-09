/**
 * Library Remote Functions
 *
 * Server-side functions for user library and playback access.
 * Uses `query()` for cached reads and `command()` for mutations.
 *
 * The user library contains:
 * - Purchased content
 * - Free content the user has accessed
 * - Playback progress for each item
 */

import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// User Library Query
// ─────────────────────────────────────────────────────────────────────────────

const libraryQuerySchema = z
  .object({
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(100).optional(),
    sortBy: z.enum(['addedAt', 'title', 'lastPlayed']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .optional();

/**
 * Get user's library (purchased + free content)
 *
 * Usage:
 * ```svelte
 * {#await getUserLibrary()}
 *   <LibrarySkeleton />
 * {:then library}
 *   {#each library.data as item}
 *     <LibraryItem {item} />
 *   {/each}
 * {/await}
 * ```
 */
export const getUserLibrary = query(libraryQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.access.getUserLibrary(
    searchParams.toString() ? searchParams : undefined
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Streaming URL Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get streaming URL for content
 *
 * Returns a signed URL for accessing the content stream.
 * The URL is time-limited and tied to the user's session.
 *
 * Usage:
 * ```svelte
 * {#await getStreamingUrl(contentId)}
 *   <VideoPlayerSkeleton />
 * {:then { url, expiresAt }}
 *   <VideoPlayer src={url} />
 * {/await}
 * ```
 */
export const getStreamingUrl = query(z.string().uuid(), async (contentId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.access.getStreamingUrl(contentId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Playback Progress Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized progress data returned from getPlaybackProgress
 */
export interface NormalizedProgress {
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string | null;
}

/**
 * Get playback progress for content
 *
 * Returns normalized progress data (unwraps the API response).
 *
 * Usage:
 * ```svelte
 * {#await getPlaybackProgress(contentId)}
 *   <!-- Default to start -->
 * {:then progress}
 *   <VideoPlayer startAt={progress.positionSeconds} />
 * {/await}
 * ```
 */
export const getPlaybackProgress = query(
  z.string().uuid(),
  async (contentId): Promise<NormalizedProgress> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const response = await api.access.getProgress(contentId);
      // Unwrap the progress from the response
      if (response?.progress) {
        return {
          positionSeconds: response.progress.positionSeconds,
          durationSeconds: response.progress.durationSeconds,
          completed: response.progress.completed,
          updatedAt: response.progress.updatedAt,
        };
      }
      // No progress saved yet
      return {
        positionSeconds: 0,
        durationSeconds: 0,
        completed: false,
        updatedAt: null,
      };
    } catch {
      // Return default progress if none exists or on error
      return {
        positionSeconds: 0,
        durationSeconds: 0,
        completed: false,
        updatedAt: null,
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Save Playback Progress Command
// ─────────────────────────────────────────────────────────────────────────────

const saveProgressSchema = z.object({
  contentId: z.string().uuid(),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().positive(),
});

/**
 * Save playback progress (command for mutations)
 *
 * Automatically calculates completion status (>90% = completed).
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { savePlaybackProgress } from '$lib/remote/library.remote';
 *
 *   function handleTimeUpdate(event) {
 *     const { currentTime, duration } = event.target;
 *     // Debounce this in practice
 *     savePlaybackProgress({
 *       contentId,
 *       positionSeconds: currentTime,
 *       durationSeconds: duration
 *     });
 *   }
 * </script>
 * ```
 */
export const savePlaybackProgress = command(
  saveProgressSchema,
  async (data) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    // Calculate completion status (90% threshold)
    const completed =
      data.durationSeconds > 0 &&
      data.positionSeconds / data.durationSeconds > 0.9;

    return api.access.saveProgress(data.contentId, {
      positionSeconds: data.positionSeconds,
      durationSeconds: data.durationSeconds,
      completed,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Batched Progress Query (for library list)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batched progress fetch for library items
 *
 * When rendering a library list with progress indicators,
 * use this to avoid n+1 queries.
 */
export const getPlaybackProgressBatch = query.batch(
  z.string().uuid(),
  async (_contentIds) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    // Fetch library which includes progress for each item
    const library = await api.access.getUserLibrary();

    // Create lookup map for progress data
    const progressMap = new Map<
      string,
      { positionSeconds: number; durationSeconds: number; completed: boolean }
    >();

    if (library?.items) {
      for (const item of library.items) {
        if (item.progress) {
          progressMap.set(item.content.id, {
            positionSeconds: item.progress.positionSeconds ?? 0,
            durationSeconds: item.progress.durationSeconds ?? 0,
            completed: item.progress.completed ?? false,
          });
        }
      }
    }

    // Return resolver function
    return (contentId: string) =>
      progressMap.get(contentId) ?? {
        positionSeconds: 0,
        durationSeconds: 0,
        completed: false,
      };
  }
);
