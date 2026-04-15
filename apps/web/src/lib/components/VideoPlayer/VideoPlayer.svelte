<!--
  @component VideoPlayer

  Full-featured video player with HLS streaming, progress tracking,
  and media-chrome controls.

  @prop {string} src - HLS manifest URL or direct video URL
  @prop {string} contentId - Content ID for progress tracking
  @prop {number} [initialProgress=0] - Resume position in seconds
  @prop {string} [poster] - Poster/thumbnail image URL

  @example
  <VideoPlayer
    src={streamingUrl}
    contentId={content.id}
    initialProgress={progress.positionSeconds}
    poster={content.thumbnailUrl}
  />
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createHlsPlayer } from './hls';
  import { createProgressTracker } from './progress.svelte.ts';
  import { loadPlayerPreferences, savePlayerPreferences } from './preferences';
  import { AlertCircleIcon } from '$lib/components/ui/Icon';
  import './styles.css';

  import type Hls from 'hls.js';

  interface Props {
    src: string;
    contentId: string;
    initialProgress?: number;
    poster?: string;
    captionsSrc?: string;
    cinemaMode?: boolean;
    oncinemachange?: (cinema: boolean) => void;
  }

  const { src, contentId, initialProgress = 0, poster, captionsSrc, cinemaMode = false, oncinemachange }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let loading = $state(true);
  let errorMessage = $state('');

  // Playback & interaction state for premium controls
  let isPaused = $state(true);
  let isHovering = $state(false);
  let hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  let controlsVisible = $derived(isHovering);
  let showRemaining = $state(false);

  function toggleCinemaMode() {
    oncinemachange?.(!cinemaMode);
  }

  function handlePlay() {
    isPaused = false;
    scheduleHideControls();
  }

  function handlePause() {
    isPaused = true;
    clearHideTimer();
  }

  function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) {
      videoEl.play();
    } else {
      videoEl.pause();
    }
  }

  function handleMouseEnter() {
    isHovering = true;
    clearHideTimer();
  }

  function handleMouseLeave() {
    isHovering = false;
    if (!isPaused) {
      scheduleHideControls();
    }
  }

  function handleMouseMove() {
    isHovering = true;
    scheduleHideControls();
  }

  function scheduleHideControls() {
    clearHideTimer();
    hideControlsTimer = setTimeout(() => {
      isHovering = false;
    }, 2500);
  }

  function clearHideTimer() {
    if (hideControlsTimer) {
      clearTimeout(hideControlsTimer);
      hideControlsTimer = null;
    }
  }

  // Double-tap seek (mobile)
  let lastTapTime = 0;
  let lastTapSide: 'left' | 'right' | null = null;
  let seekIndicator = $state<'left' | 'right' | null>(null);
  let seekIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

  function handleVideoTap(e: MouseEvent | TouchEvent) {
    if (!videoEl) return;

    const target = e.target as HTMLElement;
    // Don't intercept taps on controls
    if (target.closest('.video-player-controls-container')) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in e ? e.changedTouches[0].clientX : e.clientX;
    const side = clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    const now = Date.now();

    if (now - lastTapTime < 300 && lastTapSide === side) {
      // Double tap — seek
      e.preventDefault();
      if (side === 'left') {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
      } else {
        videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
      }
      showSeekIndicator(side);
      lastTapTime = 0;
      lastTapSide = null;
    } else {
      lastTapTime = now;
      lastTapSide = side;
    }
  }

  function showSeekIndicator(side: 'left' | 'right') {
    seekIndicator = side;
    if (seekIndicatorTimer) clearTimeout(seekIndicatorTimer);
    seekIndicatorTimer = setTimeout(() => {
      seekIndicator = null;
    }, 600);
  }

  const tracker = createProgressTracker({
    getContentId: () => contentId,
    getMedia: () => videoEl ?? null,
  });

  function handleCanPlay() {
    loading = false;
  }

  function handleError() {
    if (!errorMessage) {
      errorMessage = 'Failed to load video. Please check your connection and try again.';
    }
    loading = false;
  }

  async function initPlayer() {
    if (!videoEl) return;

    loading = true;
    errorMessage = '';

    try {
      // Import media-chrome dynamically on the client
      await import('media-chrome');

      hlsInstance = await createHlsPlayer({
        media: videoEl,
        src,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
      });

      // Set initial progress (resume position)
      if (initialProgress > 0) {
        if (videoEl.readyState >= 1) {
          videoEl.currentTime = initialProgress;
        } else {
          videoEl.addEventListener(
            'loadedmetadata',
            () => {
              if (videoEl) videoEl.currentTime = initialProgress;
            },
            { once: true }
          );
        }
      }

      // Apply saved preferences
      const prefs = loadPlayerPreferences();
      videoEl.volume = prefs.volume;
      videoEl.muted = prefs.muted;
      videoEl.playbackRate = prefs.playbackRate;

      // Save preferences on change
      videoEl.addEventListener('volumechange', () => {
        if (videoEl) savePlayerPreferences({ volume: videoEl.volume, muted: videoEl.muted });
      });
      videoEl.addEventListener('ratechange', () => {
        if (videoEl) savePlayerPreferences({ playbackRate: videoEl.playbackRate });
      });

      tracker.attach();
    } catch {
      errorMessage = 'Failed to initialize video player.';
      loading = false;
    }
  }

  async function retry() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    await initPlayer();
  }

  onMount(() => {
    initPlayer();
  });

  onDestroy(() => {
    tracker.detach();
    clearHideTimer();
    if (seekIndicatorTimer) clearTimeout(seekIndicatorTimer);
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });
</script>

<div
  class="video-player-wrapper"
  class:video-player-wrapper--controls-visible={controlsVisible}
  class:video-player-wrapper--cinema={cinemaMode}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onmousemove={handleMouseMove}
  ontouchstart={handleMouseEnter}
>
  {#if loading}
    <div class="video-player-loading">
      <div class="video-player-loading-spinner" aria-label="Loading video"></div>
    </div>
  {/if}

  {#if errorMessage}
    <div class="video-player-error" role="alert">
      <AlertCircleIcon class="video-player-error-icon" />
      <p class="video-player-error-message">{errorMessage}</p>
      <button class="video-player-error-retry" onclick={retry}>
        Try Again
      </button>
    </div>
  {:else}
    <!-- Click on video to toggle play/pause -->
    <media-controller
      hotkeys="noarrowleft noarrowright nospace nom nof"
      autohide="-1"
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <video
        bind:this={videoEl}
        slot="media"
        crossorigin="anonymous"
        playsinline
        preload="metadata"
        poster={poster}
        oncanplay={handleCanPlay}
        onerror={handleError}
        onplay={handlePlay}
        onpause={handlePause}
        onclick={togglePlay}
      >
        {#if captionsSrc}<track kind="captions" src={captionsSrc} />{/if}
      </video>

      <media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>

      <!-- Double-tap seek zones (touch devices) -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="video-player-tap-zone" ontouchend={handleVideoTap} role="presentation">
        {#if seekIndicator === 'left'}
          <div class="video-player-seek-indicator video-player-seek-indicator--left">-10s</div>
        {/if}
        {#if seekIndicator === 'right'}
          <div class="video-player-seek-indicator video-player-seek-indicator--right">+10s</div>
        {/if}
      </div>

      <!-- Controls container — slides up from bottom on hover -->
      <div class="video-player-controls-container {controlsVisible ? 'video-player-controls-container--visible' : ''}">
        <!-- Row 2 (top): time pill + config pill -->
        <div class="video-player-controls-row video-player-controls-row--top">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="video-player-pill video-player-time-pill"
            role="button"
            tabindex="0"
            onclick={() => (showRemaining = !showRemaining)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showRemaining = !showRemaining; }}}
            aria-label={showRemaining ? 'Show elapsed time' : 'Show remaining time'}
          >
            {#if showRemaining}
              <media-time-display remaining></media-time-display>
            {:else}
              <media-time-display showduration></media-time-display>
            {/if}
          </div>
          <div class="video-player-spacer"></div>
          <div class="video-player-pill video-player-config-pill">
            <media-playback-rate-button rates="0.5 1 1.5 2"></media-playback-rate-button>
            <span class="video-player-pill-divider"></span>
            <button
              class="video-player-cinema-btn"
              onclick={toggleCinemaMode}
              aria-label={cinemaMode ? 'Exit cinema mode' : 'Cinema mode'}
              aria-pressed={cinemaMode}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                {#if cinemaMode}
                  <rect x="4" y="6" width="16" height="12" rx="2" />
                {:else}
                  <rect x="2" y="7" width="20" height="10" rx="2" />
                {/if}
              </svg>
            </button>
            <span class="video-player-pill-divider"></span>
            <media-fullscreen-button></media-fullscreen-button>
          </div>
        </div>

        <!-- Row 1 (bottom): play + progress bar + volume pill -->
        <div class="video-player-controls-row video-player-controls-row--bottom">
          <button
            class="video-player-play-btn"
            onclick={togglePlay}
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
              aria-hidden="true"
            >
              <path
                class="video-player-morph-path video-player-morph-path--left"
                d={isPaused
                  ? 'M 5,3 L 5,3 L 12,12 L 12,12 L 5,21 Z'
                  : 'M 5,4 L 5,4 L 10,4 L 10,4 L 10,20 L 5,20 Z'}
              />
              <path
                class="video-player-morph-path video-player-morph-path--right"
                d={isPaused
                  ? 'M 5,3 L 19,12 L 19,12 L 19,12 L 5,21 Z'
                  : 'M 14,4 L 19,4 L 19,4 L 19,20 L 19,20 L 14,20 Z'}
              />
            </svg>
          </button>

          <media-time-range class="video-player-time-range"></media-time-range>

          <div class="video-player-pill video-player-volume-pill">
            <media-mute-button></media-mute-button>
            <media-volume-range class="video-player-volume-range"></media-volume-range>
          </div>
        </div>
      </div>

      <!-- Persistent mini progress bar — always visible, fades when full controls show -->
      <media-time-range
        class="video-player-mini-progress {controlsVisible ? 'video-player-mini-progress--hidden' : ''}"
      ></media-time-range>
    </media-controller>
  {/if}
</div>

<svelte:window
  onkeydown={(e) => {
    if (!videoEl || errorMessage) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (videoEl.paused) {
          videoEl.play();
        } else {
          videoEl.pause();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        videoEl.muted = !videoEl.muted;
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          videoEl.closest('media-controller')?.requestFullscreen();
        }
        break;
      case 't':
      case 'T':
        e.preventDefault();
        toggleCinemaMode();
        break;
    }
  }}
/>
