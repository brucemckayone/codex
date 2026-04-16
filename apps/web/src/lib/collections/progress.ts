/**
 * Progress Collection (localStorage-backed)
 *
 * Stores playback progress locally for offline support.
 * Syncs to server in background when online.
 *
 * Benefits:
 * - User closes tab mid-video → progress not lost
 * - Network failure → progress still saved locally
 * - Resume on any device → syncs when online
 * - Instant UI → no network delay for progress bar
 */

import { VIDEO_PROGRESS } from '@codex/constants';
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import { browser } from '$app/environment';
import { logger } from '$lib/observability';
import {
  getPlaybackProgress,
  savePlaybackProgress,
} from '$lib/remote/library.remote';

/**
 * Playback progress data structure
 */
export interface PlaybackProgress {
  contentId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  percentComplete: number;
  updatedAt: string;
  syncedAt: string | null; // null = not yet synced to server
}

/**
 * Progress Collection
 *
 * localStorage-backed collection for offline playback progress.
 * Automatically persists to localStorage and syncs across tabs.
 *
 * Usage:
 * ```typescript
 * import { progressCollection, updateLocalProgress } from '$lib/collections/progress';
 *
 * // Update progress (writes to localStorage immediately)
 * updateLocalProgress(contentId, currentTime, duration);
 *
 * // Read progress
 * const progress = progressCollection.get(contentId);
 * ```
 */
export const progressCollection = browser
  ? createCollection<PlaybackProgress, string>(
      localStorageCollectionOptions({
        storageKey: 'codex-playback-progress',
        getKey: (item) => item.contentId,
      })
    )
  : undefined;

/**
 * Update progress (writes to localStorage immediately)
 *
 * This is instant - no network call. Progress is synced to server
 * in background via syncProgressToServer().
 *
 * @param contentId - The content ID
 * @param positionSeconds - Current playback position in seconds
 * @param durationSeconds - Total duration in seconds
 */
export function updateLocalProgress(
  contentId: string,
  positionSeconds: number,
  durationSeconds: number
): void {
  if (!progressCollection) return;
  const now = new Date().toISOString();
  // Round to integers — the server schema requires whole numbers,
  // and video.currentTime / video.duration return floats.
  const pos = Math.round(positionSeconds);
  const dur = Math.round(durationSeconds);
  const completed = dur > 0 && pos / dur >= VIDEO_PROGRESS.COMPLETION_THRESHOLD;
  const percentComplete = dur > 0 ? Math.round((pos / dur) * 100) : 0;

  const existing = progressCollection.state.get(contentId);

  if (existing) {
    progressCollection.update(contentId, (draft) => {
      draft.positionSeconds = pos;
      draft.durationSeconds = dur;
      draft.completed = completed;
      draft.percentComplete = percentComplete;
      draft.updatedAt = now;
      draft.syncedAt = null; // Mark as unsynced
    });
  } else {
    progressCollection.insert({
      contentId,
      positionSeconds: pos,
      durationSeconds: dur,
      completed,
      percentComplete,
      updatedAt: now,
      syncedAt: null,
    });
  }
}

/**
 * Get all unsynced progress entries
 */
export function getUnsyncedProgress(): PlaybackProgress[] {
  if (!progressCollection) return [];
  const all: PlaybackProgress[] = [];
  progressCollection.state.forEach((value) => {
    if (!value.syncedAt) {
      all.push(value);
    }
  });
  return all;
}

/**
 * Sync unsynced progress to server
 *
 * Call this periodically or on page visibility change.
 * Failed syncs will be retried on next call.
 */
export async function syncProgressToServer(): Promise<void> {
  if (!browser || !progressCollection) return;

  const unsynced = getUnsyncedProgress();

  for (const progress of unsynced) {
    try {
      await savePlaybackProgress({
        contentId: progress.contentId,
        positionSeconds: progress.positionSeconds,
        durationSeconds: progress.durationSeconds,
      });

      // Mark as synced
      progressCollection.update(progress.contentId, (draft) => {
        draft.syncedAt = new Date().toISOString();
      });
    } catch (error) {
      logger.error('Failed to sync progress', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Will retry next sync
    }
  }
}

/**
 * Merge server progress with local on page load
 *
 * Conflict resolution: Newer timestamp wins.
 *
 * @param contentId - The content ID to merge
 * @returns The merged progress (local or server, whichever is newer)
 */
export async function mergeServerProgress(
  contentId: string
): Promise<PlaybackProgress | null> {
  if (!progressCollection) return null;
  const local = progressCollection.state.get(contentId) ?? null;

  try {
    const server = await getPlaybackProgress(contentId);

    if (server.positionSeconds === 0 && !server.updatedAt) {
      // No meaningful server progress, keep local
      return local;
    }

    if (!local) {
      // No local progress, use server
      const progress: PlaybackProgress = {
        contentId,
        positionSeconds: server.positionSeconds,
        durationSeconds: server.durationSeconds,
        completed: server.completed,
        percentComplete:
          server.durationSeconds > 0
            ? Math.round(
                (server.positionSeconds / server.durationSeconds) * 100
              )
            : 0,
        updatedAt: server.updatedAt ?? new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      };
      progressCollection.insert(progress);
      return progress;
    }

    // Both exist - prefer local if it has unsynced changes
    if (!local.syncedAt) {
      // Local has unsaved changes, keep local (will sync later)
      return local;
    }

    // Local is synced, server might have updates from another device
    // Use server values if position is further
    if (server.positionSeconds > local.positionSeconds) {
      progressCollection.update(contentId, (draft) => {
        draft.positionSeconds = server.positionSeconds;
        draft.durationSeconds = server.durationSeconds;
        draft.completed = server.completed;
        draft.percentComplete =
          server.durationSeconds > 0
            ? Math.round(
                (server.positionSeconds / server.durationSeconds) * 100
              )
            : 0;
        draft.updatedAt = server.updatedAt ?? new Date().toISOString();
        draft.syncedAt = new Date().toISOString();
      });
      return progressCollection.state.get(contentId) ?? null;
    }

    return local;
  } catch {
    // Offline - return local
    return local;
  }
}

/**
 * Get progress for a content item
 *
 * @param contentId - The content ID
 * @returns The progress or null if not found
 */
export function getProgress(contentId: string): PlaybackProgress | null {
  if (!progressCollection) return null;
  return progressCollection.state.get(contentId) ?? null;
}

/**
 * Clear progress for a content item
 *
 * @param contentId - The content ID to clear
 */
export function clearProgress(contentId: string): void {
  if (!progressCollection) return;
  progressCollection.delete(contentId);
}

/**
 * Clear all local progress
 */
export function clearAllProgress(): void {
  if (!progressCollection) return;
  progressCollection.state.forEach((_, key) => {
    progressCollection.delete(key);
  });
}
