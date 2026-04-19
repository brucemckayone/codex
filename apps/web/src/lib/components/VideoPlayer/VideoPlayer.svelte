<!--
  @component VideoPlayer

  Full-featured video player with HLS streaming, progress tracking,
  and media-chrome controls.

  @prop {string} src - HLS manifest URL or direct video URL
  @prop {string} contentId - Content ID for progress tracking
  @prop {string} [contentTitle] - Content title; drives `<video aria-label>` so screen readers
    distinguish players on a page that contains more than one video. Ref 05 §"Media elements" §1.
  @prop {number} [initialProgress=0] - Resume position in seconds
  @prop {string} [poster] - Poster/thumbnail image URL
  @prop {Array<{ src; srclang; label; default? }>} [captions] - One `<track>` per language;
    exactly one should carry `default`. Ref 05 §"Media elements" §2.
  @prop {boolean} [cinemaMode=false] - Whether parent has activated cinema layout
  @prop {(cinema: boolean) => void} [oncinemachange] - Notify parent when cinema toggles
  @prop {string} [class] - Forward an additional class onto the wrapper root (R13)

  @example
  <VideoPlayer
    src={streamingUrl}
    contentId={content.id}
    contentTitle={content.title}
    initialProgress={progress.positionSeconds}
    poster={content.thumbnailUrl}
  />
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createHlsPlayer } from './hls';
  import { createProgressTracker } from './progress.svelte.ts';
  import { loadPlayerPreferences, savePlayerPreferences } from './preferences';
  import { AlertCircleIcon, CinemaIcon } from '$lib/components/ui/Icon';
  import './styles.css';

  import type Hls from 'hls.js';

  interface CaptionTrack {
    src: string;
    srclang: string;
    label: string;
    default?: boolean;
  }

  interface Props {
    src: string;
    contentId: string;
    contentTitle?: string;
    initialProgress?: number;
    poster?: string;
    /**
     * Caption tracks. Each entry renders one `<track kind="captions">`.
     * Exactly one entry should set `default: true` to auto-show that language.
     */
    captions?: CaptionTrack[];
    cinemaMode?: boolean;
    oncinemachange?: (cinema: boolean) => void;
    /** Forwarded onto the wrapper element. R13: callers can style/layout this root. */
    class?: string;
  }

  const {
    src,
    contentId,
    contentTitle,
    initialProgress = 0,
    poster,
    captions,
    cinemaMode = false,
    oncinemachange,
    class: className,
  }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let wrapperEl: HTMLDivElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let loading = $state(true);
  let errorMessage = $state('');

  // Playback & interaction state for premium controls
  let isPaused = $state(true);
  let isHovering = $state(false);
  let hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  let controlsVisible = $derived(isHovering);
  let showRemaining = $state(false);

  // Captions toggle — only meaningful when at least one caption track is present
  const hasCaptions = $derived(Array.isArray(captions) && captions.length > 0);
  let captionsEnabled = $state(false);

  // Volume state for animated icon
  let isMuted = $state(false);
  let volumeLevel = $state(1); // 0-1
  let volumeState = $derived<'off' | 'low' | 'high'>(
    isMuted || volumeLevel === 0 ? 'off' : volumeLevel < 0.5 ? 'low' : 'high'
  );

  let isFullscreen = $state(false);

  function toggleCinemaMode() {
    oncinemachange?.(!cinemaMode);
  }

  function toggleCaptions() {
    if (!videoEl || !hasCaptions) return;
    const tracks = videoEl.textTracks;
    const next = !captionsEnabled;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (track.kind === 'captions' || track.kind === 'subtitles') {
        track.mode = next ? 'showing' : 'disabled';
      }
    }
    captionsEnabled = next;
  }

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
    // Exit cinema mode when entering fullscreen — they're mutually exclusive
    if (isFullscreen && cinemaMode) {
      oncinemachange?.(false);
    }
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
    // Focus the wrapper so subsequent keyboard shortcuts are captured by the
    // scoped `onkeydown` — clicking `<video>` does not focus it natively.
    wrapperEl?.focus({ preventScroll: true });
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
      volumeLevel = prefs.volume;
      isMuted = prefs.muted;

      // Sync captions-enabled with the initially-active text track (if any)
      if (hasCaptions) {
        const tracks = videoEl.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          if ((t.kind === 'captions' || t.kind === 'subtitles') && t.mode === 'showing') {
            captionsEnabled = true;
            break;
          }
        }
      }

      // Track volume changes for animated icon + preferences
      videoEl.addEventListener('volumechange', () => {
        if (!videoEl) return;
        volumeLevel = videoEl.volume;
        isMuted = videoEl.muted;
        savePlayerPreferences({ volume: videoEl.volume, muted: videoEl.muted });
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
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  });

  onDestroy(() => {
    tracker.detach();
    clearHideTimer();
    if (seekIndicatorTimer) clearTimeout(seekIndicatorTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });

  /**
   * Keyboard shortcuts scoped to the player wrapper (ref 05 §"Media elements" §3).
   *
   * Attached via `onkeydown` on `.video-player-wrapper` rather than `<svelte:window>` so
   * space/arrows do NOT intercept interactions elsewhere on the page (e.g. pressing
   * space on an unrelated button must not toggle play).
   *
   * The tab-focusable time pill, mute button, etc. all live inside the wrapper, so the
   * handler fires when any player-owned element has focus. The wrapper also gets
   * `tabindex="-1"` so `togglePlay()` can programmatically focus it after a mouse click
   * on the `<video>` element — keeping shortcuts alive even when focus otherwise would
   * not have landed on a player descendant.
   */
  function handleKey(e: KeyboardEvent) {
    if (!videoEl || errorMessage) return;

    const target = e.target as HTMLElement | null;
    // Preserve the existing input/textarea/contentEditable guard — in case keyboard lands
    // on a form control embedded within a future caption editor / comment widget nested
    // inside the wrapper.
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        if (videoEl.paused) {
          videoEl.play();
        } else {
          videoEl.pause();
        }
        break;
      case 'ArrowLeft':
      case 'j':
      case 'J':
        e.preventDefault();
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        break;
      case 'ArrowRight':
      case 'l':
      case 'L':
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
      case 'c':
      case 'C':
        if (hasCaptions) {
          e.preventDefault();
          toggleCaptions();
        }
        break;
    }
  }
</script>

<!--
  The wrapper carries the scoped `onkeydown` (ref 05 §"Media elements" §3) plus
  hover tracking that drives `controlsVisible`. Svelte flags this combo on a
  `<div role="region">` via a11y_no_noninteractive_element_interactions; the
  handlers are intentional — keyboard shortcuts must fire when any focused
  descendant (time-pill button, mute, etc.) is inside this region so the
  shortcuts do not leak to the rest of the page. Focusable children inside the
  region put focus into the subtree; `tabindex="-1"` lets `focus()` target the
  wrapper after a mouse click on the <video> so subsequent keys are captured.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={wrapperEl}
  class="video-player-wrapper {className ?? ''}"
  class:video-player-wrapper--controls-visible={controlsVisible}
  class:video-player-wrapper--cinema={cinemaMode}
  role="region"
  aria-label="Video player"
  tabindex="-1"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onmousemove={handleMouseMove}
  ontouchstart={handleMouseEnter}
  onkeydown={handleKey}
>
  <!-- Loading + error status live region (ref 05 §"Media elements" §4).
       role=status implicitly aria-live=polite; error inner span escalates to assertive
       without interrupting the outer polite context. -->
  <div
    class="video-player-status"
    role="status"
    aria-live="polite"
    aria-busy={loading}
  >
    {#if loading && !errorMessage}
      <div class="video-player-loading">
        <span class="sr-only">Loading video…</span>
        <div class="video-player-loading-spinner" aria-hidden="true"></div>
      </div>
    {/if}

    {#if errorMessage}
      <div class="video-player-error">
        <AlertCircleIcon class="video-player-error-icon" />
        <p class="video-player-error-message" role="alert">{errorMessage}</p>
        <button class="video-player-error-retry" onclick={retry}>
          Try Again
        </button>
      </div>
    {/if}
  </div>

  {#if !errorMessage}
    <!-- Click on video to toggle play/pause; keyboard equivalents live on the wrapper. -->
    <media-controller
      hotkeys="noarrowleft noarrowright nospace nom nof"
      autohide="-1"
    >
      <video
        bind:this={videoEl}
        slot="media"
        aria-label={contentTitle ?? 'Video'}
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
        {#if captions && captions.length > 0}
          {#each captions as track (track.srclang)}
            <track
              kind="captions"
              src={track.src}
              srclang={track.srclang}
              label={track.label}
              default={track.default ?? false}
            />
          {/each}
        {/if}
      </video>

      <media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>

      <!-- Double-tap seek zones (touch devices). aria-hidden decorative overlay;
           CSS `pointer-events: none` by default, re-enabled only on coarse
           pointer. Double-tap is discoverable as a mobile convention — sighted
           screen-reader users have keyboard shortcuts (ArrowLeft/Right). -->
      <div class="video-player-tap-zone" ontouchend={handleVideoTap} aria-hidden="true">
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
          <button
            type="button"
            class="video-player-pill video-player-time-pill"
            onclick={() => (showRemaining = !showRemaining)}
            aria-label={showRemaining ? 'Show elapsed time' : 'Show remaining time'}
          >
            {#if showRemaining}
              <media-time-display remaining></media-time-display>
            {:else}
              <media-time-display showduration></media-time-display>
            {/if}
          </button>
          <div class="video-player-spacer"></div>
          <div class="video-player-pill video-player-config-pill">
            <media-playback-rate-button rates="0.5 1 1.5 2"></media-playback-rate-button>
            {#if hasCaptions}
              <span class="video-player-pill-divider"></span>
              <button
                class="video-player-captions-btn"
                onclick={toggleCaptions}
                aria-label={captionsEnabled ? 'Hide captions' : 'Show captions'}
                aria-pressed={captionsEnabled}
                title={captionsEnabled ? 'Hide captions (c)' : 'Show captions (c)'}
              >
                <span aria-hidden="true" class="video-player-captions-label">CC</span>
              </button>
            {/if}
            <span class="video-player-pill-divider"></span>
            <button
              class="video-player-cinema-btn"
              onclick={toggleCinemaMode}
              aria-label={cinemaMode ? 'Exit cinema mode' : 'Cinema mode'}
              aria-pressed={cinemaMode}
              title={cinemaMode ? 'Exit cinema mode' : 'Cinema mode'}
            >
              <CinemaIcon size={18} active={cinemaMode} />
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
            <!--
              Play ↔ Pause icon kept INLINE as a genuine exception.
              Rationale: the "d" attribute is transitioned between two path definitions to
              create a Disney-style morph (see styles.css .video-player-morph-path). IconBase
              cannot express per-path `d` transitions — extracting would forfeit the morph.
              Reference: ref 05 §"Media elements" refactor (iter-011).
            -->
            <svg
              class="video-player-play-icon"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                class="video-player-morph-path video-player-morph-path--left"
                fill="currentColor"
                d={isPaused
                  ? 'M 6,4 C 6,3 6,3 7,3 L 12,12 L 12,12 L 7,21 C 6,21 6,21 6,20 Z'
                  : 'M 5,5 C 5,4 5.5,4 6,4 L 10,4 C 10.5,4 11,4 11,5 L 11,19 C 11,20 10.5,20 10,20 L 6,20 C 5.5,20 5,20 5,19 Z'}
              />
              <path
                class="video-player-morph-path video-player-morph-path--right"
                fill="currentColor"
                d={isPaused
                  ? 'M 7,3 C 7,3 8,3.5 8.5,4 L 19,12 L 19,12 L 8.5,20 C 8,20.5 7,21 7,21 Z'
                  : 'M 13,5 C 13,4 13.5,4 14,4 L 18,4 C 18.5,4 19,4 19,5 L 19,19 C 19,20 18.5,20 18,20 L 14,20 C 13.5,20 13,20 13,19 Z'}
              />
            </svg>
          </button>

          <media-time-range class="video-player-time-range"></media-time-range>

          <div class="video-player-pill video-player-volume-pill">
            <button
              class="video-player-mute-btn"
              onclick={() => { if (videoEl) videoEl.muted = !videoEl.muted; }}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <!--
                Volume icon kept INLINE for the same reason as play/pause: the per-path
                opacity / transform / stroke-dash animations (Disney secondary action,
                staggered follow-through, mute-X arc) are wired to classes that swap
                `--active` state. Extracting to IconBase would forfeit the animation
                surface. A static VolumeIcon primitive exists for non-animated callers.
              -->
              <svg
                class="video-player-volume-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <!-- Speaker body — always visible -->
                <path class="video-player-vol-body" d="M11 5L6 9H2v6h4l5 4V5z" />
                <!-- Sound wave 1 (small arc) — visible when low or high -->
                <path
                  class="video-player-vol-wave1"
                  class:video-player-vol-wave--active={volumeState !== 'off'}
                  d="M15.54 8.46a5 5 0 0 1 0 7.07"
                />
                <!-- Sound wave 2 (large arc) — visible only when high -->
                <path
                  class="video-player-vol-wave2"
                  class:video-player-vol-wave--active={volumeState === 'high'}
                  d="M19.07 4.93a10 10 0 0 1 0 14.14"
                />
                <!-- Mute X — visible when off -->
                {#if volumeState === 'off'}
                  <line class="video-player-vol-mute-x" x1="23" y1="9" x2="17" y2="15" />
                  <line class="video-player-vol-mute-x" x1="17" y1="9" x2="23" y2="15" />
                {/if}
              </svg>
            </button>
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
