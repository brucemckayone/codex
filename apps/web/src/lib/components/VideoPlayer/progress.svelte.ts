/**
 * Progress Tracker (Svelte 5 Runes)
 *
 * Reactively tracks media playback progress and syncs it
 * to the local progress collection. The collection handles
 * background sync to the server.
 *
 * Save triggers:
 * - Every 30 seconds while playing
 * - On pause
 * - On visibility change (tab hidden)
 * - On beforeunload (writes to localStorage — synchronous, survives page close)
 */

import { browser } from '$app/environment';
import { updateLocalProgress } from '$lib/collections/progress';

const SAVE_INTERVAL_MS = 30_000;

interface ProgressTrackerOptions {
  getContentId: () => string;
  getMedia: () => HTMLMediaElement | null;
}

export function createProgressTracker(options: ProgressTrackerOptions) {
  const { getContentId, getMedia } = options;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Write the element's current position to the local progress collection.
   *
   * `contentId` may be given EXPLICITLY because a player instance can outlive
   * the item it is playing. On in-course navigation the parent swaps `src` and
   * `contentId` on the SAME component instance, so by the time the outgoing
   * media is flushed `getContentId()` already answers with the INCOMING item —
   * saving then files the old item's position against the new item and
   * corrupts its resume point. Any caller handing one item off to another
   * passes the OUTGOING id.
   */
  function save(contentId?: string): void {
    const video = getMedia();
    if (!video || !video.duration || Number.isNaN(video.duration)) return;

    updateLocalProgress(
      contentId ?? getContentId(),
      video.currentTime,
      video.duration
    );
  }

  function startInterval(): void {
    if (intervalId) return;
    intervalId = setInterval(save, SAVE_INTERVAL_MS);
  }

  function stopInterval(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function handlePlay(): void {
    startInterval();
  }

  function handlePause(): void {
    stopInterval();
    save();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      save();
    }
  }

  function handleBeforeUnload(): void {
    save();
  }

  function handleEnded(): void {
    stopInterval();
    save();
  }

  function attach(): void {
    const video = getMedia();
    if (!video) return;

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    if (browser) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // If already playing, start interval
    if (!video.paused) {
      startInterval();
    }
  }

  /**
   * Stop listening and flush one last save.
   *
   * @param flushAs - Content id the final save belongs to. Pass the OUTGOING
   *   item's id when detaching because the player is being handed to a new
   *   item (see `save`); omit it for a plain teardown.
   */
  function detach(flushAs?: string | null): void {
    const video = getMedia();
    if (video) {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    }

    if (browser) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
    stopInterval();

    // Final save on detach
    save(flushAs ?? undefined);
  }

  return {
    attach,
    detach,
    save,
  };
}
