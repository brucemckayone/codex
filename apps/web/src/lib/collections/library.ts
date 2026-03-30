/**
 * Library Collection
 *
 * TanStack DB collection for user's content library.
 * localStorage-backed for local-first persistence.
 *
 * Features:
 * - Instant load from localStorage on page refresh (no loading flash)
 * - Reconciled with server on staleness detection or explicit refresh
 * - Optimistic progress updates (visual state only — server sync via progressCollection)
 */

import type { UserLibraryResponse } from '@codex/access';
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import { browser } from '$app/environment';
import { logger } from '$lib/observability';
import { getUserLibrary } from '$lib/remote/library.remote';

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
 * localStorage-backed: survives page refresh, no loading flash on return visits.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useLiveQuery, libraryCollection } from '$lib/collections';
 *
 *   let { data } = $props();  // From +page.server.ts
 *
 *   const library = useLiveQuery(
 *     (q) => q.from({ item: libraryCollection })
 *          .orderBy(({ item }) => item.progress?.updatedAt, 'desc'),
 *     undefined,
 *     { ssrData: data.library?.items }  // SSR fallback
 *   );
 * </script>
 * ```
 */
export const libraryCollection = browser
  ? createCollection<LibraryItem, string>(
      localStorageCollectionOptions({
        storageKey: 'codex-library',
        getKey: (item) => item.content.id,
      })
    )
  : undefined;

/**
 * Fetch library from server and reconcile with localStorage collection.
 *
 * Called by invalidateCollection('library') when the server-side version
 * bumps (e.g. a purchase completes on another device).
 */
export async function loadLibraryFromServer(): Promise<void> {
  if (!libraryCollection) return;
  try {
    const result = await getUserLibrary({});
    const freshItems = result?.items ?? [];

    // Track existing keys to detect removals (access revoked, etc.)
    const existingKeys = new Set<string>();
    for (const key of libraryCollection.state.keys()) existingKeys.add(key);

    // Upsert all fresh items
    for (const item of freshItems) {
      const key = item.content.id;
      if (existingKeys.has(key)) {
        libraryCollection.update(key, () => item);
      } else {
        libraryCollection.insert(item);
      }
      existingKeys.delete(key);
    }

    // Remove items no longer in library
    for (const key of existingKeys) {
      libraryCollection.delete(key);
    }
  } catch (error) {
    logger.error('Failed to refresh library from server', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update playback progress (optimistic local update)
 *
 * Writes to localStorage immediately — no network call.
 * Server sync is handled by progressCollection + progress-sync.ts.
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
  if (!libraryCollection) return;
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
  if (!libraryCollection) return;
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
  if (!libraryCollection) return;
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
