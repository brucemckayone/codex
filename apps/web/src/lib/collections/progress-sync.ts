/**
 * Progress Sync Manager
 *
 * Handles background synchronization of playback progress to the server.
 * Call initProgressSync() once in the root layout.
 *
 * Sync triggers:
 * - Every 30 seconds while page is visible
 * - When page becomes visible (tab switch)
 * - Before page unload
 */

import { browser } from '$app/environment';
import { syncProgressToServer } from './progress';

let syncInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

/**
 * Start the sync interval
 */
function startSync(): void {
  if (syncInterval) return;
  syncInterval = setInterval(syncProgressToServer, 30000);
}

/**
 * Stop the sync interval
 */
function stopSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Handle visibility change
 */
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    // Page became visible - sync and start interval
    syncProgressToServer();
    startSync();
  } else {
    // Page hidden - stop interval and do final sync
    stopSync();
    syncProgressToServer();
  }
}

/**
 * Handle before unload
 */
function handleBeforeUnload(): void {
  // Best-effort sync before page closes
  // Note: This is not guaranteed to complete for async operations
  syncProgressToServer();
}

/**
 * Initialize progress sync
 *
 * Call this once in root layout. Safe to call multiple times.
 *
 * Usage:
 * ```svelte
 * <!-- src/routes/+layout.svelte -->
 * <script>
 *   import { onMount } from 'svelte';
 *   import { initProgressSync } from '$lib/collections/progress-sync';
 *
 *   onMount(() => {
 *     initProgressSync();
 *   });
 * </script>
 * ```
 */
export function initProgressSync(): void {
  if (!browser || initialized) return;
  initialized = true;

  // Listen for visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Listen for page unload
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Start syncing
  startSync();

  // Initial sync
  syncProgressToServer();
}

/**
 * Cleanup progress sync
 *
 * Call this to stop syncing (e.g., on user logout).
 */
export function cleanupProgressSync(): void {
  if (!browser) return;

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  stopSync();
  initialized = false;
}

/**
 * Force an immediate sync
 *
 * Useful for syncing after important actions like completing a video.
 */
export async function forceSync(): Promise<void> {
  await syncProgressToServer();
}
