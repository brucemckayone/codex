/**
 * Progress Tracker (Svelte 5 Runes)
 *
 * Reactively tracks video playback progress and syncs it
 * to the local progress collection. The collection handles
 * background sync to the server.
 *
 * Save triggers:
 * - Every 30 seconds while playing
 * - On pause
 * - On visibility change (tab hidden)
 * - On beforeunload (writes to localStorage — synchronous, survives page close)
 */

import { updateLocalProgress } from '$lib/collections/progress';

const SAVE_INTERVAL_MS = 30_000;

export interface ProgressTrackerOptions {
  getContentId: () => string;
  getVideo: () => HTMLVideoElement | null;
}

export function createProgressTracker(options: ProgressTrackerOptions) {
  const { getContentId, getVideo } = options;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function save(): void {
    const video = getVideo();
    if (!video || !video.duration || Number.isNaN(video.duration)) return;

    updateLocalProgress(getContentId(), video.currentTime, video.duration);
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
    const video = getVideo();
    if (!video) return;

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // If already playing, start interval
    if (!video.paused) {
      startInterval();
    }
  }

  function detach(): void {
    const video = getVideo();
    if (video) {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    }

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    stopInterval();

    // Final save on detach
    save();
  }

  return {
    attach,
    detach,
    save,
  };
}
