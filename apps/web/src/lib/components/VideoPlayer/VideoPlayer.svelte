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
  import 'media-chrome';
  import { createHlsPlayer } from './hls';
  import { createProgressTracker } from './progress.svelte.ts';
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

  const tracker = createProgressTracker({
    getContentId: () => contentId,
    getVideo: () => videoEl ?? null,
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
      hlsInstance = await createHlsPlayer({
        video: videoEl,
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
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });
</script>

<div class="video-player-wrapper">
  {#if loading}
    <div class="video-player-loading">
      <div class="video-player-loading-spinner" aria-label="Loading video"></div>
    </div>
  {/if}

  {#if errorMessage}
    <div class="video-player-error" role="alert">
      <svg
        class="video-player-error-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p class="video-player-error-message">{errorMessage}</p>
      <button class="video-player-error-retry" onclick={retry}>
        Try Again
      </button>
    </div>
  {:else}
    <media-controller
      hotkeys="noarrowleft noarrowright nospace nom nof"
      autohide="2"
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
      >
        {#if captionsSrc}<track kind="captions" src={captionsSrc} />{/if}
      </video>

      <media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>

      <media-control-bar>
        <media-play-button></media-play-button>
        <media-mute-button></media-mute-button>
        <media-volume-range class="video-player-volume-range"></media-volume-range>
        <media-time-range></media-time-range>
        <media-time-display showduration></media-time-display>
        <media-playback-rate-button rates="0.5 1 1.5 2"></media-playback-rate-button>
        <media-fullscreen-button></media-fullscreen-button>
      </media-control-bar>
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
