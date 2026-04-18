/**
 * Progress Sync Manager
 *
 * Handles background synchronization of playback progress to the server.
 * Call initProgressSync(userId) once in the root layout.
 *
 * Sync triggers:
 * - Every 2 minutes while page is visible
 * - When page becomes visible (tab switch)
 * - Before page unload
 */

import { browser } from '$app/environment';
import { getUnsyncedProgress, syncProgressToServer } from './progress';

let syncInterval: ReturnType<typeof setInterval> | null = null;
let initializedForUser: string | null = null;

/** Server sync runs every 2 minutes — local saves remain frequent (30s in VideoPlayer) */
const SYNC_INTERVAL_MS = 120_000;

/**
 * Start the sync interval
 */
function startSync(): void {
  if (syncInterval) return;
  syncInterval = setInterval(syncProgressToServer, SYNC_INTERVAL_MS);
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
 * Handle page hide
 *
 * Uses `pagehide` rather than `beforeunload` — critical for enabling
 * the browser back/forward cache (bfcache). Chrome/Safari skip bfcache
 * entirely if ANY beforeunload listener is registered, even an empty
 * one. `pagehide` fires on both real unload AND bfcache entry, and does
 * not prevent bfcache. The `persisted` flag tells us which case we're
 * in: when true, the page is going into bfcache (will return) so skip
 * the sync; when false, it's a real navigation/close so sendBeacon fires.
 *
 * Uses navigator.sendBeacon() for reliable delivery during real unload.
 * sendBeacon is fire-and-forget and guaranteed to be queued by the
 * browser even as the page terminates, unlike async fetch which may
 * be cancelled.
 */
function handlePageHide(event: PageTransitionEvent): void {
  // Don't sync when entering bfcache — the page isn't unloading, it's
  // being preserved. When the user navigates back, we'll still have the
  // progress data; the next visibilitychange will sync if needed.
  if (event.persisted) return;

  const unsynced = getUnsyncedProgress();
  if (unsynced.length === 0) return;

  const payload = unsynced.map(
    ({ contentId, positionSeconds, durationSeconds }) => ({
      contentId,
      positionSeconds,
      durationSeconds,
    })
  );

  if (navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: 'application/json',
    });
    const queued = navigator.sendBeacon('/api/progress-beacon', blob);
    if (queued) return;
  }

  // Fallback: attempt async sync (may not complete during unload)
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
 *     initProgressSync(userId);
 *   });
 * </script>
 * ```
 */
export function initProgressSync(userId: string): void {
  if (!browser) return;
  if (initializedForUser === userId) return;

  // Clean up previous user's sync if switching users
  if (initializedForUser) {
    cleanupProgressSync();
  }

  initializedForUser = userId;

  // Listen for visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Listen for page hide (real unload OR bfcache entry). Using
  // `pagehide` instead of `beforeunload` keeps bfcache enabled.
  window.addEventListener('pagehide', handlePageHide);

  // Start syncing — progress will sync on first interval tick (2 min),
  // visibility change, or beforeunload. No immediate sync needed on init.
  startSync();
}

/**
 * Cleanup progress sync
 *
 * Call this to stop syncing (e.g., on user logout).
 */
export function cleanupProgressSync(): void {
  if (!browser) return;

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  stopSync();
  initializedForUser = null;
}

/**
 * Force an immediate sync
 *
 * Useful for syncing after important actions like completing a video.
 */
export async function forceSync(): Promise<void> {
  await syncProgressToServer();
}
