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
  import { AlertCircleIcon, CinemaIcon, PlayIcon, SettingsIcon } from '$lib/components/ui/Icon';
  import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  } from '$lib/components/ui/DropdownMenu';
  import { refreshStreamingUrl } from '$lib/remote/library.remote';
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
    /**
     * ISO 8601 timestamp when `src` is expected to expire. Optional — when
     * provided, the player schedules a pre-emptive refresh 60s before expiry
     * so playback never hits a 403 in the first place. When omitted, the
     * player still recovers reactively via the 403 / MEDIA_ERR_NETWORK path.
     */
    expiresAt?: string | null;
    /**
     * HLS quality variants the transcoder produced for this media item
     * (e.g. `['1080p', '720p', '480p', '360p']`). When non-empty, the player
     * surfaces a manual quality picker that overrides HLS.js's default
     * adaptive bitrate behaviour. When null/empty, the menu stays hidden
     * and HLS.js continues to pick the level automatically.
     *
     * Note: this is a label-level signal — the actual variant URLs live
     * inside the HLS master manifest. We map label → HLS.js level index via
     * `hls.levels[i].height` at runtime.
     */
    readyVariants?: string[] | null;
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
    expiresAt,
    readyVariants = null,
  }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let wrapperEl: HTMLDivElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let hlsCleanup: (() => void) | null = null;
  /**
   * Track the src we last handed to HLS.js so the src-change `$effect` below
   * only reinitialises when the URL actually changes. Without this guard,
   * any unrelated prop change would tear down and re-create the HLS instance
   * mid-playback.
   */
  let lastInitialisedSrc: string | null = null;
  /**
   * Preserve playback position across a refresh-and-reload cycle. The 403
   * recovery path destroys the HLS instance, which resets the video element;
   * we capture the last known time right before teardown so the rebuilt
   * player can seek back to it.
   */
  let lastCurrentTime = 0;
  /**
   * Guard against concurrent refresh attempts. If a 403 fires while we're
   * already refreshing (e.g. races between multiple in-flight segments),
   * we'd otherwise trigger a cascade of redundant server calls.
   */
  let refreshInFlight = false;
  /** Pre-emptive refresh timer (browser setTimeout handle). */
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let loading = $state(true);
  let errorMessage = $state('');
  /**
   * Mid-playback buffering state. Distinct from `loading` (initial manifest +
   * segment load). Driven by the native `waiting`/`playing` events. A short
   * delay before flipping true prevents the gradient from flashing on
   * micro-stalls (quality switches, sub-400ms buffer dips) — same rationale
   * media-chrome uses for its own `loading-delay` default. Cleared on
   * `playing` or `canplay` so we never get stuck if the events interleave.
   */
  let buffering = $state(false);
  let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  const BUFFERING_DELAY_MS = 400;
  /**
   * Latch that arms the buffering detector. Between `canplay` (first frame
   * decodable) and first user `play`, HLS rapidly fires `waiting`/`playing`
   * while it fills the buffer — without this latch, those oscillations would
   * re-trigger the gradient overlay and cause visible flashing. Once the user
   * has actually played, buffering is a real mid-playback stall and the
   * gradient should show. Reset when `src` changes so a new video starts in
   * thumbnail state.
   */
  let hasStartedPlayback = $state(false);
  /**
   * Trailing-edge debounce for volume preference writes. The native
   * `volumechange` event fires at native input rate during slider drags
   * (can hit 60 Hz), which would thrash localStorage. 250ms is long enough
   * to coalesce a drag into one save and short enough that the user has
   * already let go before the write lands. Ratechange stays undebounced —
   * playback rate changes are discrete button clicks, not slider drags.
   */
  let volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Quality menu state.
   *
   * `manualLevel` is the user's explicit selection:
   *   -1 = Auto (HLS.js picks via adaptive bitrate)
   *    n = `hls.levels[n]` — a specific variant the user pinned.
   *
   * `autoLevel` is the level HLS.js *actually* picked when running in auto
   * mode, exposed via the LEVEL_SWITCHED event. We display it in parens on
   * the trigger (e.g. "Auto (720p)") so the user can see what they're
   * getting without opening the menu.
   *
   * `levelLabels` is a parallel array to `hls.levels[]` mapping each index
   * to a variant label pulled from `readyVariants`. Computed once on
   * MANIFEST_PARSED and stable for the lifetime of the HLS instance — the
   * master playlist doesn't change without a full rebuild.
   */
  let manualLevel = $state(-1);
  let autoLevel = $state<number>(-1);
  let levelLabels = $state<string[]>([]);
  let qualityMenuOpen = $state(false);

  /**
   * Normalise `readyVariants` once per prop change. The menu renders the
   * variants in a stable highest-to-lowest order: 1080p → 360p, then
   * `source` last (fallback / passthrough encode — usually largest file,
   * but not always highest *effective* resolution since it mirrors the
   * original upload).
   */
  const RESOLUTION_ORDER: Record<string, number> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
  };

  const sortedVariants = $derived.by<string[]>(() => {
    if (!readyVariants || readyVariants.length === 0) return [];
    return [...readyVariants]
      .filter((v) => v !== 'audio') // audio-only rung is irrelevant to the quality picker
      .sort((a, b) => {
        // 'source' always last — see comment above.
        if (a === 'source') return 1;
        if (b === 'source') return -1;
        return (RESOLUTION_ORDER[b] ?? 0) - (RESOLUTION_ORDER[a] ?? 0);
      });
  });

  /**
   * Map a variant label (e.g. "720p") to an HLS.js `levels[]` index by
   * matching `levels[i].height` to the label's numeric component. Returns
   * `null` if no match — the menu falls back to disabling the item so the
   * user sees it but can't select a non-existent level.
   *
   * `source` is mapped to the highest level by height, as a heuristic —
   * the transcoder tags the original-upload variant `source` without a
   * canonical height, so we stand in the top level.
   */
  function variantToLevelIndex(
    variant: string,
    levels: { height: number }[]
  ): number | null {
    if (variant === 'source') {
      if (levels.length === 0) return null;
      let best = 0;
      for (let i = 1; i < levels.length; i++) {
        if (levels[i].height > levels[best].height) best = i;
      }
      return best;
    }
    const height = RESOLUTION_ORDER[variant];
    if (!height) return null;
    const idx = levels.findIndex((l) => l.height === height);
    return idx === -1 ? null : idx;
  }

  /**
   * Human label for a given level index. Prefers the matching entry in
   * `levelLabels` (populated on MANIFEST_PARSED) — falls back to the raw
   * pixel height so the UI isn't blank while the map is still being built.
   */
  function labelForLevel(idx: number): string {
    if (idx < 0) return 'Auto';
    const label = levelLabels[idx];
    if (label) return label;
    const h = hlsInstance?.levels?.[idx]?.height;
    return h ? `${h}p` : 'Auto';
  }

  /**
   * Trigger label: "Auto (720p)" when running auto + HLS.js has picked a
   * level, "Auto" when auto with no pick yet, and the label alone when the
   * user has manually pinned a quality.
   */
  const qualityTriggerLabel = $derived.by<string>(() => {
    if (manualLevel === -1) {
      const auto = autoLevel >= 0 ? labelForLevel(autoLevel) : null;
      return auto ? `Auto (${auto})` : 'Auto';
    }
    return labelForLevel(manualLevel);
  });

  const showQualityMenu = $derived(sortedVariants.length > 0);

  /**
   * Commit the user's choice to HLS.js. Per HLS.js docs: `nextLevel = -1`
   * restores adaptive bitrate; `nextLevel = n` pins the next fragment load
   * to levels[n]. Using `nextLevel` (not `currentLevel`) avoids flushing
   * the already-buffered segments — the switch lands on the next fetch.
   */
  function selectQuality(level: number) {
    manualLevel = level;
    if (hlsInstance) {
      hlsInstance.nextLevel = level;
    }
    qualityMenuOpen = false;
  }

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
    hasStartedPlayback = true;
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

  // Double-tap seek (mobile) — unified input path.
  //
  // Decision (iter-09 audit): previously the video element had its own
  // `onclick={togglePlay}` while the tap-zone handled `ontouchend`. On
  // touch devices the browser synthesises a click ~300ms after touchend,
  // which could fire AFTER a double-tap if timing landed near the boundary
  // (double-tap called `preventDefault` on touchend, which suppresses that
  // touch's synthetic click — but the PREVIOUS tap's synthetic click had
  // already fired and reached the `<video>` underneath).
  //
  // Fix: remove `<video onclick>` entirely. The tap-zone now owns ALL
  // single-tap play/pause AND double-tap seek. On desktop the tap-zone
  // keeps `pointer-events: none` so clicks still reach media-chrome chrome
  // behind it — but the wrapper carries an explicit `onclick` on the
  // tap-zone for desktop single-click play/pause. One input path, zero
  // double-fire risk. `lastTapSide` still tracks tap position so the
  // double-tap direction is stable across the 300ms window.
  let lastTapTime = 0;
  let lastTapSide: 'left' | 'right' | null = null;
  let lastTouchEndAt = 0;
  let seekIndicator = $state<'left' | 'right' | null>(null);
  let seekIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

  function handleVideoTap(e: TouchEvent) {
    if (!videoEl) return;

    const target = e.target as HTMLElement;
    // Don't intercept taps on controls
    if (target.closest('.video-player-controls-container')) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = e.changedTouches[0].clientX;
    const side = clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    lastTouchEndAt = now;

    if (now - lastTapTime < 300 && lastTapSide === side) {
      // Double tap — seek. preventDefault suppresses the synthetic click
      // that would otherwise fire ~300ms later and cascade a play/pause
      // toggle on top of the seek.
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

  function handleTapZoneClick(e: MouseEvent) {
    // Skip the synthetic click that immediately follows a real touch.
    // Covers iOS + Android which dispatch a ghost click ~300ms after
    // touchend; if we let it through, a double-tap that called
    // preventDefault on touchend could still land a ghost click here from
    // the *previous* tap in the pair.
    if (Date.now() - lastTouchEndAt < 400) return;

    const target = e.target as HTMLElement;
    if (target.closest('.video-player-controls-container')) return;

    togglePlay();
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
    clearBuffering();
  }

  function clearBuffering() {
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
    buffering = false;
  }

  function handleWaiting() {
    /* Only treat as buffering AFTER the user has actually started playback.
       Between `canplay` and first `play`, HLS fires rapid waiting/playing
       oscillations while filling the buffer — arming the overlay there
       causes visible flashing. We're in thumbnail state at that point, so
       the overlay should stay hidden anyway. */
    if (loading || !hasStartedPlayback) return;
    if (bufferingTimer) clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => {
      buffering = true;
      bufferingTimer = null;
    }, BUFFERING_DELAY_MS);
  }

  function handlePlaying() {
    clearBuffering();
  }

  function handleError() {
    if (!errorMessage) {
      errorMessage = 'Failed to load video. Please check your connection and try again.';
    }
    loading = false;
    // Null the HLS reference — the instance may already have been destroyed
    // by hls.ts's fatal-error path, but the local reference is what the
    // src-change $effect checks. Without this, navigating to a working video
    // on the same component instance would take the `loadSource()` fast path
    // on a dead instance and silently drop the new URL.
    hlsInstance = null;
    lastInitialisedSrc = null;
  }

  /**
   * Wire up HLS.js events that drive the quality picker.
   *
   * We need two signals:
   *   1. MANIFEST_PARSED — all levels are known; build the level→label map
   *      from `hls.levels[*].height` so the trigger can display "720p"
   *      instead of raw pixel heights. Re-apply any user-pinned `manualLevel`
   *      here too, because a rebuild (post-URL-expiry, Retry) resets HLS.js
   *      back to auto and would quietly lose the user's choice otherwise.
   *   2. LEVEL_SWITCHED — HLS.js has committed to a new level. While the
   *      user is in auto mode, this is the rung they're actually getting.
   *
   * No-op on the Safari native path where `hlsInstance` is null — native
   * HLS doesn't expose per-level control, so there's no menu to drive.
   */
  async function attachQualityListeners() {
    if (!hlsInstance) {
      levelLabels = [];
      return;
    }
    const { default: HlsJs } = await import('hls.js');
    if (!hlsInstance) return; // instance may have been torn down while awaiting

    hlsInstance.on(HlsJs.Events.MANIFEST_PARSED, () => {
      if (!hlsInstance) return;
      levelLabels = hlsInstance.levels.map((l) => `${l.height}p`);
      // Re-apply user's pinned choice after a rebuild. hls.ts restarts from
      // `startLevel: -1` (auto), so this recreates the intent the user had
      // before the URL expired / retry fired.
      if (manualLevel !== -1 && manualLevel < hlsInstance.levels.length) {
        hlsInstance.nextLevel = manualLevel;
      }
    });

    hlsInstance.on(HlsJs.Events.LEVEL_SWITCHED, (_e, data) => {
      autoLevel = data.level;
    });
  }

  async function initPlayer() {
    if (!videoEl) return;

    loading = true;
    errorMessage = '';
    hasStartedPlayback = false;
    clearBuffering();
    lastInitialisedSrc = src;

    try {
      // Import media-chrome dynamically on the client
      await import('media-chrome');

      const handle = await createHlsPlayer({
        media: videoEl,
        src,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
          // hls.ts destroys the instance internally before calling onError —
          // null our reference so the src-change $effect takes the rebuild
          // path instead of calling loadSource() on a dead instance.
          hlsInstance = null;
          lastInitialisedSrc = null;
        },
        onUrlExpired: () => {
          // HLS.js path: instance has already been destroyed by hls.ts.
          // Safari path: `<video>` is still attached. Either way we need a
          // fresh URL + a new player instance pointing at it.
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      void attachQualityListeners();

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

      // Track volume changes for animated icon + preferences. Icon state
      // updates eagerly (every event) so the UI stays in lock-step with
      // the slider; the localStorage write is debounced 250ms so a drag
      // collapses into one save instead of up to 60 per second.
      videoEl.addEventListener('volumechange', () => {
        if (!videoEl) return;
        volumeLevel = videoEl.volume;
        isMuted = videoEl.muted;
        if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
        volumeSaveTimer = setTimeout(() => {
          if (!videoEl) return;
          savePlayerPreferences({ volume: videoEl.volume, muted: videoEl.muted });
        }, 250);
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

  /**
   * Tear down the current HLS.js instance (if any) AND the media-element
   * error listener on the Safari native path. Called from `retry`,
   * `handleUrlExpired`, the src-change effect, and `onDestroy` so the
   * instance/listener are never orphaned.
   */
  function teardownHls() {
    if (hlsCleanup) {
      hlsCleanup();
      hlsCleanup = null;
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  /**
   * Refresh the signed URL and reinitialise the player. Preserves
   * currentTime so playback resumes where it was — the user should only
   * see a brief buffering blip. Guarded by `refreshInFlight` so concurrent
   * 403s don't stampede the access worker.
   */
  async function handleUrlExpired() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      if (videoEl && Number.isFinite(videoEl.currentTime)) {
        lastCurrentTime = videoEl.currentTime;
      }
      teardownHls();
      const fresh = await refreshStreamingUrl(contentId);
      if (!videoEl) return;
      lastInitialisedSrc = fresh.streamingUrl;
      loading = true;
      errorMessage = '';
      const handle = await createHlsPlayer({
        media: videoEl,
        src: fresh.streamingUrl,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
          // hls.ts destroys the instance internally before calling onError —
          // null our reference so the src-change $effect takes the rebuild
          // path instead of calling loadSource() on a dead instance.
          hlsInstance = null;
          lastInitialisedSrc = null;
        },
        onUrlExpired: () => {
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      void attachQualityListeners();
      if (lastCurrentTime > 0) {
        const resumeAt = lastCurrentTime;
        if (videoEl.readyState >= 1) {
          videoEl.currentTime = resumeAt;
        } else {
          videoEl.addEventListener(
            'loadedmetadata',
            () => {
              if (videoEl) videoEl.currentTime = resumeAt;
            },
            { once: true }
          );
        }
      }
      scheduleRefresh();
    } catch {
      errorMessage =
        'Playback link expired and could not be refreshed. Please try again.';
      loading = false;
    } finally {
      refreshInFlight = false;
    }
  }

  /**
   * Pre-emptive refresh — schedule a URL refresh 60s before `expiresAt`.
   * Skips when `expiresAt` is unset or already past; the reactive 403 path
   * still catches those cases. 60s is enough margin for a slow-network
   * refresh to finish before the existing URL dies.
   */
  function scheduleRefresh() {
    teardownRefresh();
    if (!expiresAt) return;
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return;
    const refreshAt = expiresMs - 60_000;
    const delay = refreshAt - Date.now();
    if (delay <= 0) return;
    refreshTimer = setTimeout(() => {
      void handleUrlExpired();
    }, delay);
  }

  function teardownRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  async function retry() {
    // The Retry button most often fires because the URL expired, so
    // refresh it before reinitialising — otherwise Retry would 403 again.
    teardownHls();
    try {
      const fresh = await refreshStreamingUrl(contentId);
      if (!videoEl) return;
      lastInitialisedSrc = fresh.streamingUrl;
      loading = true;
      errorMessage = '';
      const handle = await createHlsPlayer({
        media: videoEl,
        src: fresh.streamingUrl,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
          // hls.ts destroys the instance internally before calling onError —
          // null our reference so the src-change $effect takes the rebuild
          // path instead of calling loadSource() on a dead instance.
          hlsInstance = null;
          lastInitialisedSrc = null;
        },
        onUrlExpired: () => {
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      void attachQualityListeners();
      scheduleRefresh();
    } catch {
      // Refresh endpoint itself unreachable — fall back to the original
      // src; the network blip that caused the error may have already
      // recovered.
      await initPlayer();
    }
  }

  onMount(() => {
    initPlayer();
    scheduleRefresh();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  });

  /**
   * React to `src` prop changes. Parents update `src` when the server-side
   * access flow re-runs (follow/subscribe unlock) and returns a freshly
   * signed URL. Without this effect the player would keep streaming the
   * old URL until unmounted.
   */
  $effect(() => {
    if (typeof window === 'undefined') return;
    if (!videoEl) return;
    if (!src) return;
    if (src === lastInitialisedSrc) return;
    // Belt-and-braces: any prior error forces a full rebuild, even if the
    // error handlers failed to null `hlsInstance` for some reason. Otherwise
    // a stuck-error state can stay visible after navigating to a new video.
    if (hlsInstance && !errorMessage) {
      lastInitialisedSrc = src;
      hlsInstance.loadSource(src);
      scheduleRefresh();
    } else {
      teardownHls();
      void initPlayer();
      scheduleRefresh();
    }
  });

  /**
   * React to `expiresAt` prop changes so the pre-emptive refresh timer
   * always fires relative to the latest expiry (not a stale one).
   */
  $effect(() => {
    void expiresAt;
    if (typeof window === 'undefined') return;
    scheduleRefresh();
  });

  onDestroy(() => {
    tracker.detach();
    clearHideTimer();
    teardownRefresh();
    if (seekIndicatorTimer) clearTimeout(seekIndicatorTimer);
    if (volumeSaveTimer) {
      clearTimeout(volumeSaveTimer);
      volumeSaveTimer = null;
    }
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }
    teardownHls();
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
    aria-busy={loading || buffering}
  >
    {#if !errorMessage}
      <!-- Single branded overlay for BOTH initial load AND mid-playback
           buffering — replaces media-chrome's default spinner. Kept in the DOM
           across state transitions so the gradient can softly crossfade to
           the <video>'s native poster (initial) or the last-rendered frame
           (buffering) underneath. Opacity animates over `--duration-slowest`,
           then `pointer-events: none` releases clicks to the controls. Inner
           animations pause when hidden so the compositor stops work. -->
      <div
        class="video-player-loading"
        class:video-player-loading--hidden={!loading && !buffering}
        aria-hidden={!loading && !buffering}
      >
        {#if loading}
          <span class="sr-only">Loading video…</span>
        {:else if buffering}
          <span class="sr-only">Buffering…</span>
        {/if}
        <div class="video-player-loading-gradient" aria-hidden="true"></div>
      </div>
    {/if}

    {#if errorMessage}
      <div class="video-player-error">
        <AlertCircleIcon class="video-player-error-icon" />
        <p class="video-player-error-message" role="alert">{errorMessage}</p>
        <button type="button" class="video-player-error-retry" onclick={retry}>
          Try Again
        </button>
      </div>
    {/if}
  </div>

  {#if !errorMessage}
    <!-- Thumbnail "ready to play" affordance. Lives between load-complete and
         first playback; fades in as the gradient fades out so both transitions
         share the same duration/easing for a continuous curtain-up feel. When
         hidden (loading OR playback has started), `pointer-events: none` lets
         clicks fall through to the tap-zone inside `<media-controller>`, which
         owns play/pause during playback. Keyboard users get the wrapper-level
         Space/ArrowKeys shortcuts, plus direct focus here when visible. -->
    <button
      type="button"
      class="video-player-play-overlay"
      class:video-player-play-overlay--hidden={loading || hasStartedPlayback}
      aria-label="Play video"
      tabindex={loading || hasStartedPlayback ? -1 : 0}
      onclick={togglePlay}
    >
      <span class="video-player-play-overlay-circle" aria-hidden="true">
        <PlayIcon class="video-player-play-overlay-icon" />
      </span>
    </button>

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
        onwaiting={handleWaiting}
        onplaying={handlePlaying}
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

      <!-- Unified tap/click zone. aria-hidden decorative overlay; owns ALL
           single-tap play/pause + double-tap seek. Single path prevents the
           iOS/Android synthetic click from racing a native click when the
           video element owned `onclick` directly (iter-09 audit, Codex-04ozt).
           Pointer-events are enabled on both coarse and fine pointers now that
           this zone carries the click handler — media-chrome controls still
           take priority via the `.closest('.video-player-controls-container')`
           guard inside handleTapZoneClick/handleVideoTap. Sighted SR users
           have keyboard shortcuts (Space/ArrowLeft/ArrowRight) scoped to the
           wrapper — ref 05 §"Media elements" §3 — so this overlay does NOT
           need its own key handlers. -->
      <div
        class="video-player-tap-zone"
        onclick={handleTapZoneClick}
        ontouchend={handleVideoTap}
        aria-hidden="true"
      >
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
                type="button"
                class="video-player-captions-btn"
                onclick={toggleCaptions}
                aria-label={captionsEnabled ? 'Hide captions' : 'Show captions'}
                aria-pressed={captionsEnabled}
                title={captionsEnabled ? 'Hide captions (c)' : 'Show captions (c)'}
              >
                <span aria-hidden="true" class="video-player-captions-label">CC</span>
              </button>
            {/if}
            {#if showQualityMenu}
              <span class="video-player-pill-divider"></span>
              <DropdownMenu
                bind:open={qualityMenuOpen}
                positioning={{ placement: 'top-end', gutter: 8 }}
              >
                <DropdownMenuTrigger
                  class="video-player-quality-btn"
                  aria-label="Video quality"
                  title="Video quality"
                >
                  <SettingsIcon size={18} />
                  <span class="video-player-quality-label">{qualityTriggerLabel}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent class="video-player-quality-menu">
                  <DropdownMenuItem
                    class={manualLevel === -1
                      ? 'video-player-quality-item video-player-quality-item--active'
                      : 'video-player-quality-item'}
                    onclick={() => selectQuality(-1)}
                  >
                    <span class="video-player-quality-item-label">Auto</span>
                    {#if autoLevel >= 0 && manualLevel === -1}
                      <span class="video-player-quality-item-sub">{labelForLevel(autoLevel)}</span>
                    {/if}
                  </DropdownMenuItem>
                  {#each sortedVariants as variant (variant)}
                    {@const idx = variantToLevelIndex(variant, hlsInstance?.levels ?? [])}
                    {#if idx !== null}
                      <DropdownMenuItem
                        class={manualLevel === idx
                          ? 'video-player-quality-item video-player-quality-item--active'
                          : 'video-player-quality-item'}
                        onclick={() => selectQuality(idx)}
                      >
                        <span class="video-player-quality-item-label">{variant}</span>
                      </DropdownMenuItem>
                    {/if}
                  {/each}
                </DropdownMenuContent>
              </DropdownMenu>
            {/if}
            <span class="video-player-pill-divider"></span>
            <button
              type="button"
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
            type="button"
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
              type="button"
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
