/**
 * Library Collection
 *
 * TanStack DB collection for user's content library.
 * Supports optimistic playback progress updates.
 *
 * Features:
 * - Sub-ms client-side queries and filtering
 * - Optimistic updates for playback progress
 * - Automatic rollback on server errors
 */

import type { UserLibraryResponse } from '@codex/shared-types';
import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import {
  getUserLibrary,
  savePlaybackProgress,
} from '$lib/remote/library.remote';
import { queryClient } from './query-client';

/**
 * Library item type extracted from UserLibraryResponse
 */
export type LibraryItem = UserLibraryResponse['items'][number];

/**
 * Progress data type for library items
 */
export type LibraryProgress = NonNullable<LibraryItem['progress']>;

/**
 * Library Collection
 *
 * User's content library (purchased + free content).
 * Supports optimistic progress updates.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useLiveQuery, libraryCollection } from '$lib/collections';
 *
 *   const library = useLiveQuery((q) =>
 *     q.from({ item: libraryCollection })
 *      .orderBy(({ item }) => item.progress?.updatedAt, 'desc')
 *   );
 * </script>
 * ```
 */
export const libraryCollection = createCollection<LibraryItem, string>(
  queryCollectionOptions({
    queryKey: ['library'],

    // Load via remote function (pass empty object for optional params)
    queryFn: async () => {
      const result = await getUserLibrary({});
      return result?.items ?? [];
    },

    queryClient,
    getKey: (item) => item.content.id,

    /**
     * Handle optimistic updates
     * Called when collection.update() is used
     *
     * Flow:
     * 1. UI updates immediately (optimistic)
     * 2. This handler syncs to server
     * 3. If error, transaction rolls back automatically
     */
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      if (!mutation) return;

      const { key, modified } = mutation;

      // Only sync progress changes to server
      if (modified.progress) {
        try {
          await savePlaybackProgress({
            contentId: key as string,
            positionSeconds: modified.progress.positionSeconds,
            durationSeconds: modified.progress.durationSeconds,
          });
        } catch (error) {
          // Transaction automatically rolls back on error
          console.error('Failed to save progress:', error);
          throw error;
        }
      }
    },
  })
);

/**
 * Update playback progress (optimistic)
 *
 * UI updates immediately, syncs to server in background.
 * Automatically rolls back if server save fails.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { updateProgress } from '$lib/collections/library';
 *
 *   function handleTimeUpdate(e) {
 *     updateProgress(
 *       contentId,
 *       e.target.currentTime,
 *       e.target.duration
 *     );
 *   }
 * </script>
 * ```
 *
 * @param contentId - The content ID
 * @param positionSeconds - Current playback position in seconds
 * @param durationSeconds - Total duration in seconds
 */
export function updateProgress(
  contentId: string,
  positionSeconds: number,
  durationSeconds: number
): void {
  const completed =
    durationSeconds > 0 && positionSeconds / durationSeconds > 0.9;
  const percentComplete =
    durationSeconds > 0
      ? Math.round((positionSeconds / durationSeconds) * 100)
      : 0;

  libraryCollection.update(contentId, (draft) => {
    draft.progress = {
      positionSeconds,
      durationSeconds,
      completed,
      percentComplete,
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Mark content as completed
 *
 * @param contentId - The content ID to mark as completed
 * @param durationSeconds - Total duration (for calculating position)
 */
export function markAsCompleted(
  contentId: string,
  durationSeconds: number
): void {
  libraryCollection.update(contentId, (draft) => {
    draft.progress = {
      positionSeconds: durationSeconds,
      durationSeconds,
      completed: true,
      percentComplete: 100,
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Reset progress for content
 *
 * @param contentId - The content ID to reset
 */
export function resetProgress(contentId: string): void {
  libraryCollection.update(contentId, (draft) => {
    draft.progress = {
      positionSeconds: 0,
      durationSeconds: draft.progress?.durationSeconds ?? 0,
      completed: false,
      percentComplete: 0,
      updatedAt: new Date().toISOString(),
    };
  });
}
