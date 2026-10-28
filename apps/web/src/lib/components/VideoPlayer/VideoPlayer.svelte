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
  import { onMount, onDestroy, untrack } from 'svelte';
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
   * The content id `lastInitialisedSrc` belongs to. This is what separates a
   * DIFFERENT item (in-course navigation: hard stop, reload from the top) from
   * the SAME item re-signed (follow / subscribe unlock: swap the manifest under
   * the playhead). Both arrive as a bare `src` change, and they need opposite
   * handling — see the src-change `$effect`.
   */
  let lastInitialisedContentId: string | null = null;
  /**
   * Monotonic token claimed by every path that builds a player (`initPlayer`,
   * `handleUrlExpired`, `retry`). Each awaits at least once, so a build that
   * was still in flight when the viewer navigated would otherwise install the
   * OLD item's stream on top of the new one. A stale continuation destroys the
   * handle it built instead of adopting it.
   */
  let initToken = 0;
  /**
   * Non-reactive mirror of `videoEl`. Svelte nulls `bind:this` refs while
   * unmounting and `onDestroy` is not guaranteed to run first, so the release
   * path keeps its own handle — otherwise "stop the video" would silently
   * become a no-op exactly when it matters.
   */
  let mediaEl: HTMLVideoElement | null = null;
  /**
   * Preserve playback position across a rebuild: a 403's refresh-and-reload,
   * or a Retry after the stream failed. Destroying the HLS instance resets
   * the video element to 0, so the place is taken from `hls.ts` (`at`, read
   * before its destroy) and given to the rebuilt player once it knows its
   * length (`landPlace`). Until then the progress tracker saves this
   * place, never the reset 0, so a paid viewer keeps their resume point.
   * `null` once it has landed.
   */
  let resumePoint: number | null = null;
  /** Drops a build's wait for its stream's metadata (`landPlace`). */
  let unland: (() => void) | null = null;
  /** What that wait will land when nothing was kept (`keepPending`). */
  let pendingFallback = 0;
  let pendingResume = false;
  /**
   * The next rebuild plays on: a failure, or a dropped build, interrupted a
   * film the viewer was watching (`fail`, `keepPending`).
   */
  let playOnNext = false;
  /** A 403 killed the old stream while a renewal's ask was out. */
  let lapsedMidAsk = false;
  /**
   * A renewal or Retry built this stream and it has shown no frame yet. A
   * 403 now is a refusal, not an expiry (its link is seconds old): asking
   * again would loop refresh → 403 until the rate limit.
   */
  let freshUnframed = false;
  /**
   * When the signed URL the player is actually using expires. The
   * `expiresAt` prop describes the `src` prop, which a re-sign of the same
   * item replaces without the player switching to it (the src-change
   * effect), so a refresh records its own expiry here and the renewal timer
   * reads this, never the prop.
   */
  let liveExpiresAt: string | null | undefined = null;
  /** The element the one-time setup (`wireElement`) has run on. */
  let wiredEl: HTMLVideoElement | null = null;
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
  /** `MediaError.MEDIA_ERR_NETWORK`, spelled out: jsdom has no `MediaError`. */
  const MEDIA_ERR_NETWORK = 2;
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
    // A play under the error card (media keys, picture-in-picture) is
    // refused: it would re-arm the renewal, which then clears the card and
    // plays unasked. The card's Try Again is the way back.
    if (errorMessage) {
      videoEl?.pause();
      return;
    }
    isPaused = false;
    hasStartedPlayback = true;
    scheduleHideControls();
    scheduleRefresh();
  }

  function handlePause() {
    isPaused = true;
    clearHideTimer();
    // A paused film never renews its link: a forgotten tab would otherwise
    // ask every ~9 minutes for good (owner cost rule). Playing again arms it,
    // and a link that lapsed meanwhile comes back as a 403 the helper turns
    // into a renewal.
    teardownRefresh();
  }

  function togglePlay() {
    if (!videoEl) return;
    // Focus the wrapper so subsequent keyboard shortcuts are captured by the
    // scoped `onkeydown` — clicking `<video>` does not focus it natively.
    wrapperEl?.focus({ preventScroll: true });
    if (videoEl.paused) {
      videoEl.play().catch(() => {});
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
    getResumePoint: () => resumePoint,
  });

  /** A failed or expired stream's place, for the rebuild to restore. */
  function keepPlace(at: number) {
    if (Number.isFinite(at) && at > 0) resumePoint = at;
  }

  /**
   * The stream failed: say why, and stop everything that would act on the
   * dead stream. The element stopped without a `pause` event, so the mirror
   * is set to paused here and the renewal timer stops: left armed, it would
   * rebuild and play the film unasked minutes later. What the viewer wanted
   * is kept for Retry, and so is a first place that had not landed yet, so
   * Retry never starts a paid film at 0:00.
   */
  function fail(message: string) {
    keepPending();
    playOnNext ||= !isPaused;
    teardownRefresh();
    isPaused = true;
    errorMessage = message;
    loading = false;
  }

  /**
   * Give a freshly built stream its place once it knows its length: the
   * place a rebuild kept (`resumePoint`), else `fallback` (the saved
   * progress). Every build path ends here, so a kept place is always
   * consumed and never left to freeze later saves.
   *
   * @param resume - Carry on playing. A rebuild's destroy paused the element
   *   without a `pause` event, so nothing else would restart the film.
   */
  function landPlace(fallback: number, resume: boolean) {
    unland?.();
    unland = null;
    const el = videoEl;
    if (!el) return;
    const land = () => {
      unland = null;
      const at = resumePoint ?? fallback;
      resumePoint = null;
      if (at > 0) el.currentTime = at;
      if (!resume) return;
      el.play().catch(() => {
        isPaused = el.paused;
      });
    };
    if (el.readyState >= 1) {
      land();
      return;
    }
    pendingFallback = fallback;
    pendingResume = resume;
    el.addEventListener('loadedmetadata', land, { once: true });
    unland = () => el.removeEventListener('loadedmetadata', land);
  }

  /**
   * Keep what a build that has not landed yet was to give its stream, its
   * place and its play-on, before a failure or a rebuild drops that wait.
   * Without it, a stream that 403s or fails before its first metadata
   * would be rebuilt at 0:00, paused.
   */
  function keepPending() {
    if (!unland) return;
    if (resumePoint === null) keepPlace(pendingFallback);
    playOnNext ||= pendingResume;
  }

  /**
   * Stop the live stream for a rebuild, and say whether the viewer was
   * watching. `isPaused` is read first: hls.js may already have destroyed
   * the stream, which pauses the element without a `pause` event, so the
   * mirror still holds what the viewer wanted (or `fail` kept it). It is
   * then set to the truth, and the renewal timer stops with the stream.
   */
  function stopForRebuild(): boolean {
    keepPending();
    const wasPlaying = !isPaused || playOnNext;
    playOnNext = false;
    teardownHls();
    teardownRefresh();
    isPaused = videoEl?.paused ?? true;
    return wasPlaying;
  }

  /**
   * The setup a stream needs on its element once: media-chrome, the saved
   * preferences and their listeners. Every build path awaits it, so a Retry
   * after a failed first load (a chunk that did not arrive) still gets the
   * controls and the preferences.
   */
  async function wireElement(el: HTMLVideoElement) {
    await import('media-chrome');
    if (wiredEl === el) return;
    wiredEl = el;

    const prefs = loadPlayerPreferences();
    el.volume = prefs.volume;
    el.muted = prefs.muted;
    el.playbackRate = prefs.playbackRate;
    volumeLevel = prefs.volume;
    isMuted = prefs.muted;

    // Track volume changes for animated icon + preferences. Icon state
    // updates eagerly (every event) so the UI stays in lock-step with
    // the slider; the localStorage write is debounced 250ms so a drag
    // collapses into one save instead of up to 60 per second.
    el.addEventListener('volumechange', () => {
      volumeLevel = el.volume;
      isMuted = el.muted;
      if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
      volumeSaveTimer = setTimeout(() => {
        savePlayerPreferences({ volume: el.volume, muted: el.muted });
      }, 250);
    });
    el.addEventListener('ratechange', () => {
      savePlayerPreferences({ playbackRate: el.playbackRate });
    });
  }

  function handleCanPlay() {
    loading = false;
    clearBuffering();
  }

  /**
   * Backstop for a missed `canplay`. `loadeddata` fires once the first frame
   * is decoded (readyState ≥ HAVE_CURRENT_DATA). `canplay` is the primary
   * signal that lifts the loading curtain, but it can be dropped on HLS.js/MSE
   * source swaps and media-error recovery — without this fallback the branded
   * gradient can sit over a ready (or playing) video indefinitely.
   */
  function handleLoadedData() {
    loading = false;
    freshUnframed = false;
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
    // Frames are actively rendering — initial load is definitively over.
    // Clearing `loading` here (not just `buffering`) is the last-resort
    // backstop against a missed `canplay`/`loadeddata` leaving the skeleton
    // stranded over a playing video.
    loading = false;
    clearBuffering();
  }

  function handleError() {
    const live = hlsInstance && videoEl;
    if (live) keepPlace(videoEl?.currentTime ?? 0);
    const network = videoEl?.error?.code === MEDIA_ERR_NETWORK;
    const message = network
      ? 'Failed to load video. Please check your connection and try again.'
      : 'This video could not be played. Please try again.';
    fail(errorMessage || message);
    // A decode or MSE failure reaches the element before hls.js, which only
    // notices on its next append. Destroy the instance here: orphaned, it
    // would stay bound to the element a Retry's instance then owns, and its
    // own recovery would take it back.
    if (live) teardownHls();
    // Null the HLS reference — the instance may already have been destroyed
    // by hls.ts's fatal-error path, but the local reference is what the
    // src-change $effect checks. Without this, navigating to a working video
    // on the same component instance would take the `loadSource()` fast path
    // on a dead instance and silently drop the new URL.
    hlsInstance = null;
    lastInitialisedSrc = null;
  }

  /**
   * Hard-stop the media element and drop its source.
   *
   * `teardownHls()` is NOT sufficient. On the native branch (`attachNative` in
   * hls.ts assigns `media.src` directly — taken whenever MSE is unavailable,
   * and for plain non-HLS URLs) there is no HLS.js instance to destroy, so the
   * element keeps its source and keeps playing. A detached element with a live
   * `src` can keep buffering too, so unmount needs this as much as a source
   * swap does.
   *
   * `removeAttribute` rather than `src = ''`: an empty string resolves against
   * the document URL, so the element would fetch the PAGE as media and fire a
   * spurious `error`. Removing the attribute leaves it in NETWORK_EMPTY.
   */
  function releaseMedia() {
    const el = videoEl ?? mediaEl;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
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

  /**
   * Build the stream for the `src` prop, at the place a rebuild kept or the
   * saved progress.
   *
   * @param resume - Carry on playing once it lands (a Retry on a film the
   *   viewer was watching).
   */
  async function initPlayer(resume = false) {
    if (!videoEl) return;

    loading = true;
    errorMessage = '';
    hasStartedPlayback = false;
    // This build's `resume` says what plays; an earlier failure's wish is spent.
    playOnNext = false;
    freshUnframed = false;
    clearBuffering();
    lastInitialisedSrc = src;
    liveExpiresAt = expiresAt;
    lastInitialisedContentId = contentId;
    mediaEl = videoEl;
    const token = ++initToken;

    try {
      await wireElement(videoEl);

      const handle = await createHlsPlayer({
        media: videoEl,
        src,
        onError: streamFailed,
        onUrlExpired: (at) => {
          // HLS.js path: instance has already been destroyed by hls.ts.
          // Safari path: `<video>` is still attached. Either way we need a
          // fresh URL + a new player instance pointing at it.
          void handleUrlExpired(at);
        },
      });
      if (token !== initToken) {
        // A newer item claimed the element while we were awaiting.
        handle.cleanup();
        handle.hls?.destroy();
        return;
      }
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      void attachQualityListeners();
      landPlace(initialProgress, resume);

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

      tracker.attach();
    } catch {
      fail('Failed to initialize video player.');
    }
  }

  /**
   * Tear down the current HLS.js instance (if any) AND the media-element
   * error listener on the Safari native path. Called from `retry`,
   * `handleUrlExpired`, the src-change effect, and `onDestroy` so the
   * instance/listener are never orphaned.
   */
  function teardownHls() {
    unland?.();
    unland = null;
    if (hlsCleanup) {
      hlsCleanup();
      hlsCleanup = null;
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  /** `hls.ts` gave up on the stream; it has destroyed the instance itself. */
  function streamFailed(msg: string, _kind: unknown, at: number) {
    keepPlace(at);
    fail(msg);
    // Null our reference so the src-change $effect rebuilds instead of
    // calling loadSource() on a dead instance.
    hlsInstance = null;
    lastInitialisedSrc = null;
  }

  /**
   * Build this item's stream on a freshly signed URL, at the place the
   * rebuild kept: a renewal's and a Retry's shared second half. The link is
   * asked for BEFORE `stop` ends the live stream, so a renewal that cannot
   * ask leaves a still-good link playing. A newer build that claimed the
   * element meanwhile wins, and this one is dropped.
   *
   * @param stop - Ends the live stream; says whether to play on.
   */
  async function buildFresh(stop: () => boolean) {
    const token = ++initToken;
    const fresh = await refreshStreamingUrl(contentId);
    if (!videoEl || token !== initToken) return;
    const resume = stop();
    lastInitialisedSrc = fresh.streamingUrl;
    liveExpiresAt = fresh.expiresAt;
    loading = true;
    errorMessage = '';
    await wireElement(videoEl);
    const handle = await createHlsPlayer({
      media: videoEl,
      src: fresh.streamingUrl,
      onError: streamFailed,
      onUrlExpired: (at) => {
        void handleUrlExpired(at);
      },
    });
    if (token !== initToken) {
      handle.cleanup();
      handle.hls?.destroy();
      return;
    }
    hlsInstance = handle.hls;
    hlsCleanup = handle.cleanup;
    freshUnframed = true;
    void attachQualityListeners();
    landPlace(0, resume);
    tracker.attach();
  }

  /**
   * Refresh the signed URL and rebuild the stream where it stood, playing
   * on if it was — the viewer should only see a brief buffering blip.
   * Guarded by `refreshInFlight` so concurrent 403s don't stampede the
   * access worker.
   *
   * @param at - Where the expired stream stood, as `hls.ts` read it before
   *   its destroy reset the element; the pre-emptive timer passes nothing,
   *   and the element, still playing, says it live.
   */
  async function handleUrlExpired(at?: number) {
    // A 403's stream is already dead, so its place is kept first, even while
    // a renewal's ask is out: the timer's renewal keeps the old stream until
    // its answer, and a laptop that wakes past the link's end hits both.
    if (at !== undefined) keepPlace(at);
    if (refreshInFlight) {
      if (at !== undefined) lapsedMidAsk = true;
      return;
    }
    if (freshUnframed) {
      fail('This could not be loaded. Please try again.');
      teardownHls();
      return;
    }
    refreshInFlight = true;
    lapsedMidAsk = false;
    const item = lastInitialisedContentId;
    let stopped = false;
    try {
      await buildFresh(() => {
        stopped = true;
        // The timer's renewal ran while the film played on.
        if (at === undefined) keepPlace(videoEl?.currentTime ?? 0);
        return stopForRebuild();
      });
    } catch {
      // The viewer moved on to another item, whose build owns the element.
      if (item !== lastInitialisedContentId) return;
      // A timer's renewal that could not ask leaves its link playing out its
      // last minute, and that link's 403 asks again — unless it died meanwhile.
      if (at === undefined && !stopped && !lapsedMidAsk) return;
      fail('Playback link expired and could not be refreshed. Please try again.');
      // On the native path the old link still plays for up to a minute;
      // nothing may play on under the error card.
      videoEl?.pause();
    } finally {
      refreshInFlight = false;
    }
  }

  /**
   * Pre-emptive renewal: refresh the link in use 60s before it expires, and
   * only while the film plays (`handlePlay` arms it, `handlePause` clears
   * it), so a paused tab never asks. Skips when the expiry is unknown or
   * already inside the margin; the reactive 403 path still catches those.
   * 60s is enough margin for a slow-network refresh to finish before the
   * existing URL dies.
   */
  function scheduleRefresh() {
    teardownRefresh();
    if (!liveExpiresAt || !videoEl || videoEl.paused) return;
    const expiresMs = Date.parse(liveExpiresAt);
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
    // Either way the rebuilt stream resumes where the failed one stopped
    // (`resumePoint`), never at 0, and plays on if the viewer was watching.
    // One at a time: a second press would spend the first one's play-on.
    if (refreshInFlight) return;
    refreshInFlight = true;
    const item = lastInitialisedContentId;
    const resume = stopForRebuild();
    try {
      await buildFresh(() => resume);
    } catch {
      // The viewer moved on to another item, whose build owns the element.
      if (item !== lastInitialisedContentId) return;
      // Refresh endpoint itself unreachable — fall back to the original
      // src; the network blip that caused the error may have already
      // recovered. It lands the kept place too.
      await initPlayer(resume);
    } finally {
      refreshInFlight = false;
    }
  }

  onMount(() => {
    initPlayer();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  });

  /**
   * React to `src` / `contentId` prop changes.
   *
   * Two different events arrive as a `src` change and they need opposite
   * handling (Codex-1g5lh.12) — `contentId` is the discriminator:
   *
   *   1. SAME `contentId`, new `src` — the same item re-signed, because the
   *      page's access load re-ran: every tab return and the org layout's
   *      version poll re-run it (`await parent()`), and so does a follow or
   *      subscribe. A live stream is LEFT ALONE: it renews its own link, and
   *      swapping it would restart it, because hls.js 1.6.15's
   *      `loadSource()` re-creates the MediaSource for a new URL, which puts
   *      the element back at 0:00, paused, with no `pause` event. Only an
   *      errored player is rebuilt, at the place it kept.
   *   2. DIFFERENT `contentId` — a different item, i.e. in-course navigation
   *      between two sessions on the SAME component instance (SvelteKit reuses
   *      the page and its children when only the route params change). The
   *      outgoing video must STOP, not carry on into the new one: flush its
   *      position under the OUTGOING id, detach the tracker, destroy HLS.js,
   *      pause and release the element, then load the new source from the top.
   *
   * Before the split, case 2 took the `loadSource()` fast path: the element was
   * never paused and the tracker kept writing the old playhead against the new
   * item's id.
   *
   * `errorMessage` is read only inside `untrack` — tracked, it would re-run
   * this effect on every error, and after a mid-session URL refresh
   * `lastInitialisedSrc` no longer matches the (stale) `src` prop, so the
   * rebuild would reload the expired URL.
   */
  $effect(() => {
    // Tracked reads first, then `untrack` — the swap below writes plenty of
    // `$state` and none of it should become a dependency of this effect.
    const nextSrc = src;
    const nextContentId = contentId;
    const el = videoEl;
    if (typeof window === 'undefined') return;
    if (!el || !nextSrc) return;
    if (nextSrc === lastInitialisedSrc) return;

    untrack(() => {
      const sameItem =
        lastInitialisedContentId !== null &&
        lastInitialisedContentId === nextContentId;

      if (sameItem && (refreshInFlight || !errorMessage)) {
        lastInitialisedSrc = nextSrc;
        return;
      }

      if (!sameItem) {
        // The props already answer with the incoming item, so name the
        // outgoing one explicitly. Detaching before the pause in
        // `releaseMedia` also stops the tracker's own `pause` handler from
        // re-saving the old position under the new id.
        tracker.detach(lastInitialisedContentId);
        // A place kept for a rebuild belonged to the outgoing item.
        resumePoint = null;
      }

      teardownHls();
      teardownRefresh();
      releaseMedia();
      lastInitialisedSrc = null;
      void initPlayer();
    });
  });

  /**
   * An error hides `<media-controller>`, which is what fullscreen shows, and
   * the error card sits outside it. Leave fullscreen so the viewer sees the
   * card and its Retry, not a black screen.
   */
  $effect(() => {
    if (!errorMessage || typeof document === 'undefined') return;
    const full = document.fullscreenElement;
    if (full && wrapperEl?.contains(full)) {
      document.exitFullscreen().catch(() => {});
    }
  });

  onDestroy(() => {
    // Flush against the id the element's media actually belongs to, not
    // whatever the props answer with at teardown time.
    tracker.detach(lastInitialisedContentId);
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
    // A detached media element with a live `src` can keep playing/buffering,
    // so stop it explicitly — `teardownHls()` only covers the HLS.js branch.
    releaseMedia();
    lastInitialisedSrc = null;
    lastInitialisedContentId = null;
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
          videoEl.play().catch(() => {});
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
          document.exitFullscreen().catch(() => {});
        } else {
          videoEl.closest('media-controller')?.requestFullscreen().catch(() => {});
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
  {/if}

  <!-- Click on video to toggle play/pause; keyboard equivalents live on the wrapper.
       Kept mounted through an error, only hidden: a Retry rebuilds the stream on
       this very <video> (`retry`), and the progress tracker keeps listening to
       it. Unmounted, Retry found no element and did nothing. -->
  <media-controller
    hotkeys="noarrowleft noarrowright nospace nom nof"
    autohide="-1"
    hidden={Boolean(errorMessage)}
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
      onloadeddata={handleLoadedData}
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
</div>
