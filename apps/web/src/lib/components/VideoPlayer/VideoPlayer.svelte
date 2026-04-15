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
  import { AlertCircleIcon, PlayIcon, PauseIcon } from '$lib/components/ui/Icon';
  import './styles.css';

  import type Hls from 'hls.js';

  interface Props {
    src: string;
    contentId: string;
    initialProgress?: number;
    poster?: string;
    captionsSrc?: string;
  }

  const { src, contentId, initialProgress = 0, poster, captionsSrc }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let loading = $state(true);
  let errorMessage = $state('');

  // Playback & interaction state for premium controls
  let isPaused = $state(true);
  let isHovering = $state(false);
  let hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  let showPlayOverlay = $derived(isPaused && !loading && !errorMessage);
  let controlsVisible = $derived(!isPaused && isHovering);

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
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });
</script>

<div
  class="video-player-wrapper"
  class:video-player-wrapper--controls-visible={controlsVisible}
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
    <!-- Large centered play/pause overlay -->
    <button
      class="video-player-overlay-btn"
      class:video-player-overlay-btn--visible={showPlayOverlay}
      class:video-player-overlay-btn--hover={isHovering && !isPaused}
      onclick={togglePlay}
      aria-label={isPaused ? 'Play video' : 'Pause video'}
    >
      {#if isPaused}
        <PlayIcon size={40} />
      {:else}
        <PauseIcon size={28} />
      {/if}
    </button>

    <media-controller
      hotkeys="noarrowleft noarrowright nospace nom nof"
      autohide="-1"
    >
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
      >
        {#if captionsSrc}<track kind="captions" src={captionsSrc} />{/if}
      </video>

      <media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>

      <!-- Controls container — slides up on hover during playback -->
      <div class="video-player-controls-container {controlsVisible ? 'video-player-controls-container--visible' : ''}">
      <!-- Progress bar — full width, above controls -->
      <media-time-range class="video-player-time-range"></media-time-range>

      <!-- Control bar — no play button (overlay handles it) -->
      <media-control-bar class="video-player-control-bar">
        <div class="video-player-volume-group">
          <media-mute-button></media-mute-button>
          <div class="video-player-volume-popover">
            <media-volume-range class="video-player-volume-range"></media-volume-range>
          </div>
        </div>
        <div class="video-player-spacer"></div>
        <media-time-display showduration notoggle></media-time-display>
        <media-playback-rate-button rates="0.5 1 1.5 2"></media-playback-rate-button>
        <media-fullscreen-button></media-fullscreen-button>
      </media-control-bar>
      </div>
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
    }
  }}
/>
