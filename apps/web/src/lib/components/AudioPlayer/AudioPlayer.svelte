<!--
  @component AudioPlayer

  Dedicated audio player with waveform visualization, custom controls,
  and a sticky mini-player. Uses HLS.js for streaming and the shared
  progress tracker for server-synced playback position.

  @prop {string} src - HLS manifest URL (signed R2)
  @prop {string} contentId - Content ID for progress tracking
  @prop {number} [initialProgress=0] - Resume position in seconds
  @prop {string | null} [waveformUrl] - Signed URL to waveform.json
  @prop {string | null} [poster] - Cover art / thumbnail URL
  @prop {string} [title] - Content title (for mini-player)
-->
<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import { createProgressTracker } from '$lib/components/VideoPlayer/progress.svelte.ts';
  import { refreshStreamingUrl } from '$lib/remote/library.remote';
  import { AlertCircleIcon, PlayIcon, PauseIcon, Volume2Icon, VolumeXIcon, MaximizeIcon } from '$lib/components/ui/Icon';
  import {
    createMediaKeyboardHandler,
    MediaLiveRegion,
  } from '$lib/components/media-a11y';
  import { createAudioAnalyser } from './audio-analyser';
  import Waveform from './Waveform.svelte';
  import WaveformShader from './WaveformShader.svelte';
  import { getThumbnailUrl } from '$lib/utils/image';
  import ImmersiveShaderPlayer from './ImmersiveShaderPlayer.svelte';

  import type Hls from 'hls.js';
  import type { AudioAnalysis, AudioAnalyserHandle } from './audio-analyser';

  interface Props {
    src: string;
    contentId: string;
    initialProgress?: number;
    waveformUrl?: string | null;
    poster?: string | null;
    title?: string;
    shaderPreset?: string | null;
    /**
     * ISO 8601 timestamp when `src` / `waveformUrl` are expected to expire.
     * Both URLs are signed in the same access call so share an expiry.
     * Optional; omission falls back to reactive 403 recovery only.
     */
    expiresAt?: string | null;
  }

  const {
    src,
    contentId,
    initialProgress = 0,
    waveformUrl = null,
    poster = null,
    title = '',
    shaderPreset = null,
    expiresAt = null,
  }: Props = $props();

  let audioEl: HTMLAudioElement | undefined = $state();
  let playerEl: HTMLDivElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let hlsCleanup: (() => void) | null = null;
  /**
   * Track the most recent waveform URL we loaded so a mid-session URL
   * refresh re-fetches against the freshly signed URL instead of the
   * expired original.
   */
  let currentWaveformUrl: string | null = waveformUrl ?? null;
  /**
   * The playhead a rebuild restores — a 403's refresh, or a Retry after the
   * stream failed — as `hls.ts` read it before its destroy reset the
   * element to 0 (mirrors VideoPlayer). Until it lands the progress tracker
   * saves this place, never the reset 0. `null` once it has landed.
   */
  let resumePoint: number | null = null;
  /** Drops a build's wait for its stream's metadata (`landPlace`). */
  let unland: (() => void) | null = null;
  /** What that wait will land when nothing was kept (`keepPending`). */
  let pendingFallback = 0;
  let pendingResume = false;
  /**
   * The next rebuild plays on: a failure, or a dropped build, interrupted
   * audio the listener was playing (`fail`, `keepPending`).
   */
  let playOnNext = false;
  /** A 403 killed the old stream while a renewal's ask was out. */
  let lapsedMidAsk = false;
  /**
   * A renewal or Retry built this stream and it has played nothing yet. A
   * 403 now is a refusal, not an expiry (its link is seconds old): asking
   * again would loop refresh → 403 until the rate limit.
   */
  let freshUnframed = false;
  /**
   * When the signed URL the player is actually using expires (mirrors
   * VideoPlayer): a re-sign of the same item replaces the `expiresAt` prop
   * without the player switching to its `src`, so the renewal timer reads
   * this, never the prop.
   */
  let liveExpiresAt: string | null | undefined = null;
  /** `MediaError.MEDIA_ERR_NETWORK`, spelled out: jsdom has no `MediaError`. */
  const MEDIA_ERR_NETWORK = 2;
  /**
   * The item whose renewal or Retry ask is out (`asking`). Tied to the item:
   * a slow ask for the item the viewer left must not swallow the next
   * item's own 403 or Try Again.
   */
  let refreshingFor: string | null = null;

  /** This item's renewal or Retry ask is out. */
  function asking() {
    return refreshingFor !== null && refreshingFor === initializedContentId;
  }
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let loading = $state(true);
  let errorMessage = $state('');

  // Playback state
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let isMuted = $state(false);
  let playbackRate = $state(1);

  // Waveform data
  let waveformData: number[] | null = $state(null);
  let waveformLoaded = $state(false);

  /**
   * The src we last handed to a player, and the content id it belongs to.
   *
   * Deliberately plain `let`, not `$state`: the src-change `$effect` below
   * both reads and writes these, and a reactive read would re-trigger the
   * effect on its own write.
   *
   * `initializedContentId` is what makes an in-course item change
   * distinguishable from a re-signed URL for the SAME item — the two need
   * opposite handling (hard stop + reload vs. seamless source swap).
   */
  let initializedSrc: string | null = null;
  let initializedContentId: string | null = null;
  /**
   * Monotonic token claimed by every path that builds a player (`initPlayer`,
   * `handleUrlExpired`, `retry`). Each awaits at least once, so a build that
   * was in flight when the user navigated would otherwise install the OLD
   * item's stream on top of the new one. A stale continuation destroys the
   * handle it built instead of adopting it.
   */
  let initToken = 0;
  /**
   * Non-reactive mirror of `audioEl`. Svelte nulls `bind:this` refs while
   * unmounting, and `onDestroy` is not guaranteed to run first, so the release
   * path keeps its own handle — otherwise "stop the audio" would silently
   * become a no-op exactly when it matters.
   */
  let mediaEl: HTMLAudioElement | null = null;

  // Mini-player
  let miniMode = $state(false);

  // Immersive shader mode. When content has no preset assigned (or 'none'),
  // fall back to 'nebula' so every audio piece is immersive-capable — all 25
  // presets are audio-reactive, so there's no UX reason to hide the entry.
  let showImmersive = $state(false);
  const resolvedShaderPreset = $derived(
    shaderPreset && shaderPreset !== 'none' ? shaderPreset : 'nebula'
  );

  // Audio analysis for waveform reactivity
  let analyserHandle: AudioAnalyserHandle | null = null;
  let audioAnalysis: AudioAnalysis | null = $state(null);
  let analysisRafId = 0;

  function startAnalysisLoop() {
    if (!analyserHandle || analysisRafId) return;
    function tick() {
      if (!analyserHandle) return;
      audioAnalysis = analyserHandle.getAnalysis();
      analysisRafId = requestAnimationFrame(tick);
    }
    analysisRafId = requestAnimationFrame(tick);
  }

  function stopAnalysisLoop() {
    if (analysisRafId) {
      cancelAnimationFrame(analysisRafId);
      analysisRafId = 0;
    }
    // Set active to false so waveform can decay
    if (audioAnalysis) {
      audioAnalysis = { ...audioAnalysis, active: false };
    }
  }

  const tracker = createProgressTracker({
    getContentId: () => contentId,
    getMedia: () => audioEl ?? null,
    getResumePoint: () => resumePoint,
  });

  /** A failed or expired stream's place, for the rebuild to restore. */
  function keepPlace(at: number) {
    if (Number.isFinite(at) && at > 0) resumePoint = at;
  }

  /**
   * The stream failed: say why, and stop everything that would act on the
   * dead stream (mirrors VideoPlayer). The mirror is set to paused and the
   * renewal timer stops, so nothing rebuilds and plays it unasked; what the
   * listener wanted, and a first place that had not landed, are kept for
   * Retry. The mini-player and the immersive view step aside, since the
   * error card and its Retry live in the main player.
   */
  function fail(message: string) {
    keepPending();
    playOnNext ||= isPlaying;
    teardownRefresh();
    isPlaying = false;
    stopAnalysisLoop();
    miniMode = false;
    showImmersive = false;
    errorMessage = message;
    loading = false;
  }

  /**
   * Give a freshly built stream its place once it knows its length: the
   * place a rebuild kept (`resumePoint`), else `fallback` (the saved
   * progress). Every build path ends here, so a kept place is always
   * consumed and never left to freeze later saves (mirrors VideoPlayer).
   *
   * @param resume - Carry on playing. A rebuild's destroy paused the element
   *   without a `pause` event, so nothing else would restart the audio.
   */
  function landPlace(fallback: number, resume: boolean) {
    unland?.();
    unland = null;
    const el = audioEl;
    if (!el) return;
    const land = () => {
      unland = null;
      const at = resumePoint ?? fallback;
      resumePoint = null;
      if (at > 0) el.currentTime = at;
      if (!resume) return;
      el.play().catch(() => {
        isPlaying = !el.paused;
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
   * place and its play-on, before a failure or a rebuild drops that wait
   * (mirrors VideoPlayer).
   */
  function keepPending() {
    if (!unland) return;
    if (resumePoint === null) keepPlace(pendingFallback);
    playOnNext ||= pendingResume;
  }

  /**
   * Stop the live stream for a rebuild, and say whether the listener was
   * listening. `isPlaying` is read first: hls.js may already have destroyed
   * the stream, which pauses the element without a `pause` event, so the
   * mirror still holds what the listener wanted (or `fail` kept it). It is
   * then set to the truth, and the renewal timer stops with the stream.
   */
  function stopForRebuild(): boolean {
    keepPending();
    const wasPlaying = isPlaying || playOnNext;
    playOnNext = false;
    teardownHls();
    teardownRefresh();
    isPlaying = !(audioEl?.paused ?? true);
    if (!isPlaying) stopAnalysisLoop();
    return wasPlaying;
  }

  function formatTime(seconds: number): string {
    if (!seconds || Number.isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function togglePlay() {
    if (!audioEl) return;
    // Focus the wrapper so scoped `onkeydown` captures subsequent shortcuts —
    // clicking a control otherwise leaves focus on the button only.
    playerEl?.focus({ preventScroll: true });
    if (audioEl.paused) {
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  }

  function toggleMute() {
    if (!audioEl) return;
    audioEl.muted = !audioEl.muted;
    isMuted = audioEl.muted;
  }

  function handleVolumeChange(e: Event) {
    if (!audioEl) return;
    const input = e.target as HTMLInputElement;
    const val = parseFloat(input.value);
    audioEl.volume = val;
    volume = val;
    if (val > 0 && audioEl.muted) {
      audioEl.muted = false;
      isMuted = false;
    }
  }

  function setPlaybackRate(rate: number) {
    if (!audioEl) return;
    audioEl.playbackRate = rate;
    playbackRate = rate;
  }

  function cyclePlaybackRate() {
    const idx = RATES.indexOf(playbackRate as (typeof RATES)[number]);
    const next = RATES[(idx + 1) % RATES.length];
    setPlaybackRate(next);
  }

  function handleSeek(time: number) {
    if (!audioEl) return;
    audioEl.currentTime = Math.max(0, Math.min(time, duration));
  }

  function handleTimeUpdate() {
    if (!audioEl) return;
    currentTime = audioEl.currentTime;
  }

  function handleDurationChange() {
    if (!audioEl) return;
    if (!Number.isNaN(audioEl.duration)) {
      duration = audioEl.duration;
    }
  }

  function handlePlay() {
    // A play under the error card (media keys, a script) is refused: it would
    // re-arm the renewal, which then clears the card and plays unasked. The
    // card's Try Again is the way back.
    if (errorMessage) {
      audioEl?.pause();
      return;
    }
    isPlaying = true;
    // Lazily create audio analyser on first play (requires user gesture for AudioContext)
    if (audioEl && !analyserHandle) {
      analyserHandle = createAudioAnalyser(audioEl);
      analyserHandle.resume();
    }
    startAnalysisLoop();
    scheduleRefresh();
  }

  function handlePause() {
    isPlaying = false;
    stopAnalysisLoop();
    // Paused audio never renews its link (owner cost rule; see VideoPlayer).
    teardownRefresh();
  }

  function handleEnded() {
    isPlaying = false;
    stopAnalysisLoop();
    teardownRefresh();
  }

  function handleCanPlay() {
    loading = false;
    freshUnframed = false;
  }

  function handleError() {
    const live = hlsInstance && audioEl;
    if (live) keepPlace(audioEl?.currentTime ?? 0);
    const network = audioEl?.error?.code === MEDIA_ERR_NETWORK;
    const message = network
      ? 'Failed to load audio. Please check your connection and try again.'
      : 'This audio could not be played. Please try again.';
    fail(errorMessage || message);
    // A decode or MSE failure reaches the element before hls.js, which only
    // notices on its next append. Destroy the instance here rather than
    // orphan it on the element (mirrors VideoPlayer).
    if (live) teardownHls();
    // hls.ts may already have destroyed the instance on its fatal path; our
    // local reference is what the src-change effect branches on, so null it
    // rather than let a later swap call loadSource() on a dead instance.
    hlsInstance = null;
    initializedSrc = null;
  }

  async function loadWaveform() {
    // Use the local `currentWaveformUrl` so handleUrlExpired can re-fetch
    // the waveform against a fresh signed URL after a refresh.
    const url = currentWaveformUrl;
    if (!url || waveformLoaded) return;
    waveformLoaded = true;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const raw: number[] | null = Array.isArray(json)
          ? json
          : (json.data ?? json.peaks ?? null);
        if (!raw) {
          waveformData = null;
          return;
        }

        // Audiowaveform v2: interleaved [min, max, min, max, ...] pairs (8/16-bit signed)
        // Convert to normalised 0-1 amplitude per sample
        if (json.version === 2 || (raw.length > 1 && raw[0] < 0)) {
          const maxVal = (json.bits ?? 8) === 16 ? 32768 : 128;
          const normalised: number[] = [];
          for (let i = 0; i < raw.length; i += 2) {
            const absMin = Math.abs(raw[i]);
            const absMax = Math.abs(raw[i + 1] ?? raw[i]);
            normalised.push(Math.max(absMin, absMax) / maxVal);
          }
          waveformData = normalised;
        } else {
          waveformData = raw;
        }
      }
    } catch {
      // Waveform load failure is non-critical — Waveform.svelte falls back to progress bar
    }
  }

  /**
   * Build the stream for the `src` prop, at the place a rebuild kept or the
   * saved progress.
   *
   * @param resume - Carry on playing once it lands (a Retry on audio the
   *   listener was playing).
   */
  async function initPlayer(resume = false) {
    if (!audioEl || !src) return;

    // Guard: skip re-init if src hasn't changed (prevents duplicate init on reactive prop updates)
    if (initializedSrc === src) return;
    initializedSrc = src;
    liveExpiresAt = expiresAt;
    initializedContentId = contentId;
    mediaEl = audioEl;
    const token = ++initToken;

    loading = true;
    errorMessage = '';
    // This build's `resume` says what plays; an earlier failure's wish is spent.
    playOnNext = false;
    freshUnframed = false;

    try {
      teardownHls();

      const handle = await createHlsPlayer({
        media: audioEl,
        src,
        onError: streamFailed,
        onUrlExpired: (at) => {
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
      landPlace(initialProgress, resume);

      tracker.attach();
    } catch {
      fail('Failed to initialise audio player.');
    }
  }

  /**
   * Tear down the current HLS.js instance and any Safari error listener.
   * `hlsCleanup` is the callback returned from `createHlsPlayer` — a no-op
   * on the HLS.js branch and a `removeEventListener` on Safari native.
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
    // Null our reference so the src-change effect rebuilds instead of
    // calling loadSource() on a dead instance.
    hlsInstance = null;
    initializedSrc = null;
  }

  /**
   * Build this item's stream on a freshly signed URL, at the place the
   * rebuild kept: a renewal's and a Retry's shared second half. The link is
   * asked for BEFORE `stop` ends the live stream, so a renewal that cannot
   * ask leaves a still-good link playing. Audio and waveform share an expiry
   * (both signed in the same `getStreamingUrl` access call), so the waveform
   * is fetched again on its new URL. A newer build that claimed the element
   * meanwhile wins.
   *
   * @param stop - Ends the live stream; says whether to play on.
   */
  async function buildFresh(stop: () => boolean) {
    const token = ++initToken;
    const fresh = await refreshStreamingUrl(contentId);
    if (!audioEl || token !== initToken) return;
    const resume = stop();
    initializedSrc = fresh.streamingUrl;
    liveExpiresAt = fresh.expiresAt;
    loading = true;
    errorMessage = '';
    const handle = await createHlsPlayer({
      media: audioEl,
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
    landPlace(0, resume);
    tracker.attach();
    currentWaveformUrl = fresh.waveformUrl;
    waveformLoaded = false;
    waveformData = null;
    void loadWaveform();
  }

  /**
   * Hard-stop the media element and drop its source.
   *
   * `teardownHls()` alone is NOT enough. On the native branch (`attachNative`
   * in hls.ts, which assigns `media.src` directly — taken whenever MSE is
   * unavailable, and for plain non-HLS URLs) there is no HLS.js instance to
   * destroy, so the element keeps its source and keeps playing. That is the
   * "previous track carries on" half of Codex-1g5lh.12, and it survives even a
   * `{#key}` remount because a detached element with a live `src` can keep
   * buffering.
   *
   * `removeAttribute` rather than `src = ''`: an empty string resolves against
   * the document URL and makes the element fetch the PAGE as media, which
   * fires a spurious `error`. Removing the attribute leaves the element in
   * NETWORK_EMPTY with no error. `load()` then aborts any in-flight fetch and
   * resets currentTime/duration.
   */
  function releaseMedia() {
    const el = audioEl ?? mediaEl;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  /**
   * Signed-URL expiry recovery — mirrors VideoPlayer: rebuild where the
   * stream stood, playing on if it was.
   *
   * @param at - Where the expired stream stood, as `hls.ts` read it before
   *   its destroy reset the element; the pre-emptive timer passes nothing,
   *   and the element, still playing, says it live.
   */
  async function handleUrlExpired(at?: number) {
    // A 403's stream is already dead, so its place is kept first, even while
    // a renewal's ask is out (mirrors VideoPlayer).
    if (at !== undefined) keepPlace(at);
    if (asking()) {
      if (at !== undefined) lapsedMidAsk = true;
      return;
    }
    if (freshUnframed) {
      fail('This could not be loaded. Please try again.');
      teardownHls();
      return;
    }
    refreshingFor = initializedContentId;
    lapsedMidAsk = false;
    const item = initializedContentId;
    let stopped = false;
    try {
      await buildFresh(() => {
        stopped = true;
        // The timer's renewal ran while the audio played on.
        if (at === undefined) keepPlace(audioEl?.currentTime ?? 0);
        return stopForRebuild();
      });
    } catch {
      // The listener moved on to another item, whose build owns the element.
      if (item !== initializedContentId) return;
      // A timer's renewal that could not ask leaves its link playing out its
      // last minute, and that link's 403 asks again — unless it died meanwhile.
      if (at === undefined && !stopped && !lapsedMidAsk) return;
      fail('Playback link expired and could not be refreshed. Please try again.');
      // On the native path the old link still plays for up to a minute;
      // nothing may play on under the error card.
      audioEl?.pause();
    } finally {
      if (refreshingFor === item) refreshingFor = null;
    }
  }

  /**
   * Pre-emptive renewal 60s before the link in use expires, armed only while
   * the audio plays (`handlePlay` arms it, `handlePause` clears it). Skips
   * when the expiry is unknown or inside the margin — the reactive 403 path
   * handles those cases.
   */
  function scheduleRefresh() {
    teardownRefresh();
    if (!liveExpiresAt || !audioEl || audioEl.paused) return;
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
    // Most often Retry fires because the URL expired; refresh first so
    // Retry doesn't immediately 403 again. Either way the rebuilt stream
    // resumes where the failed one stopped (`resumePoint`), never at 0, and
    // plays on if the listener was listening.
    // One at a time: a second press would spend the first one's play-on.
    if (asking()) return;
    refreshingFor = initializedContentId;
    const item = initializedContentId;
    const resume = stopForRebuild();
    try {
      await buildFresh(() => resume);
    } catch {
      // The listener moved on to another item, whose build owns the element.
      if (item !== initializedContentId) return;
      // Refresh endpoint itself failed — reset the init guard and try the
      // original src path; transient network blips may self-heal. It lands
      // the kept place too.
      initializedSrc = null;
      await initPlayer(resume);
    } finally {
      if (refreshingFor === item) refreshingFor = null;
    }
  }

  onMount(() => {
    initPlayer();
    loadWaveform();

    // Mini-player: IntersectionObserver on the main player container.
    // Show when the main player leaves the viewport while playback started;
    // hide when the main player is back in view. Pausing from the mini-player
    // MUST NOT dismiss it — the user needs a visible resume target.
    if (playerEl) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            miniMode = false;
          } else if (isPlaying) {
            miniMode = true;
          }
          // else: off-screen + paused — leave miniMode untouched so a paused
          // mini-player stays visible for resume.
        },
        { threshold: 0 }
      );
      observer.observe(playerEl);
      return () => observer.disconnect();
    }
  });

  /**
   * React to `src` / `contentId` prop changes.
   *
   * THE in-course navigation fix (Codex-1g5lh.12). The in-course player route
   * (`/journeys/[journeySlug]/practice/[contentSlug]`) keeps the SAME component
   * instance across sessions — SvelteKit reuses the page and its children when
   * only the route params change — so moving to the next session updates
   * `src` + `contentId` on a live player. `initPlayer()` ran once in `onMount`
   * and nothing re-ran it, so the previous track kept playing and the new
   * manifest was never loaded. (`VideoPlayer` has had this effect all along;
   * `AudioPlayer` never got it.)
   *
   * Two cases, deliberately handled differently:
   *
   *   1. `contentId` changed → a DIFFERENT item. Hard stop: flush the outgoing
   *      item's position under the OUTGOING id, detach the tracker, destroy
   *      HLS.js, pause and release the element, reset the UI, then load the
   *      new manifest from the top. Nothing about the old item survives.
   *   2. `contentId` is the same → the same item re-signed: the page's
   *      access load re-ran (every tab return and the org version poll do
   *      it, and so does a follow or subscribe). A live stream is LEFT
   *      ALONE: it renews its own link, and hls.js 1.6.15's `loadSource()`
   *      would restart it at 0:00, paused (see VideoPlayer). Only an errored
   *      player is rebuilt, at the place it kept.
   *
   * Only `src`, `contentId` and `audioEl` are reactive reads here.
   * `errorMessage` is read only inside `untrack`: tracked, every error would
   * re-run this effect, and after a mid-session URL refresh `initializedSrc`
   * no longer matches the (stale) `src` prop — the rebuild would then reload
   * the expired URL.
   */
  $effect(() => {
    // Tracked reads first, then `untrack` — the swap below touches plenty of
    // `$state` (analysis frame, loading, errorMessage) and must not make any
    // of it a dependency of this effect.
    const nextSrc = src;
    const nextContentId = contentId;
    const el = audioEl;
    if (typeof window === 'undefined') return;
    if (!el || !nextSrc) return;
    if (nextSrc === initializedSrc) return;

    untrack(() => {
      const sameItem =
        initializedContentId !== null && initializedContentId === nextContentId;

      if (sameItem && (asking() || !errorMessage)) {
        initializedSrc = nextSrc;
        return;
      }

      if (!sameItem) {
        // Attribute the final save to the item that was actually playing — the
        // props already answer with the incoming one. Detaching BEFORE the pause
        // in `releaseMedia` also stops the tracker's own `pause` handler from
        // re-saving the old position under the new id.
        tracker.detach(initializedContentId);
        resetPlaybackState();
      }

      teardownHls();
      teardownRefresh();
      releaseMedia();
      initializedSrc = null;
      void initPlayer();
    });
  });

  /**
   * Clear everything that describes the OUTGOING item so the incoming one
   * doesn't inherit its waveform, playhead, duration or immersive overlay.
   * Volume / mute / rate are user preferences and deliberately survive.
   */
  function resetPlaybackState() {
    stopAnalysisLoop();
    if (analyserHandle) {
      analyserHandle.destroy();
      analyserHandle = null;
    }
    audioAnalysis = null;
    isPlaying = false;
    currentTime = 0;
    duration = 0;
    resumePoint = null;
    miniMode = false;
    showImmersive = false;
    waveformData = null;
    waveformLoaded = false;
    errorMessage = '';
  }

  /**
   * React to `waveformUrl` prop changes. Parents update this after a
   * server-side access-re-run returns a freshly signed bundle; keeping
   * the local cached copy in sync lets `loadWaveform` and
   * `handleUrlExpired` work against the latest URL.
   */
  $effect(() => {
    const next = waveformUrl ?? null;
    if (next === currentWaveformUrl) return;
    currentWaveformUrl = next;
    waveformLoaded = false;
    waveformData = null;
    if (typeof window !== 'undefined' && next) {
      void loadWaveform();
    }
  });

  onDestroy(() => {
    // Flush against the id the element's media actually belongs to, not
    // whatever the props answer with at teardown time.
    tracker.detach(initializedContentId);
    stopAnalysisLoop();
    teardownRefresh();
    if (analyserHandle) {
      analyserHandle.destroy();
      analyserHandle = null;
    }
    teardownHls();
    // A detached media element with a live `src` can keep playing/buffering,
    // so stop it explicitly — `teardownHls()` only covers the HLS.js branch.
    releaseMedia();
    initializedSrc = null;
    initializedContentId = null;
  });

  const RATES = [0.5, 1, 1.5, 2] as const;

  /**
   * Keyboard shortcuts scoped to the player wrapper (ref 05 §"Media elements" §3).
   * Attached via `onkeydown` on `.audio-player` — NOT `<svelte:window>` — so
   * Space / Arrow / m don't hijack every `<button>` on the page.
   */
  const mediaKeys = createMediaKeyboardHandler({
    getWrapper: () => playerEl,
    getMedia: () => audioEl ?? null,
    shortcuts: {
      playPause: togglePlay,
      mute: toggleMute,
      seekSecs: 10,
    },
  });

  /** Under the error card the keys are the card's: Space reaches Try Again. */
  function handleKey(e: KeyboardEvent) {
    if (errorMessage) return;
    mediaKeys(e);
  }
</script>

<!-- Hidden audio element.
     aria-label per ref 05 §"Media elements" §1 — threads through the `title` prop
     so screen readers can distinguish players on pages with more than one. -->
<audio
  bind:this={audioEl}
  aria-label={title || 'Audio'}
  crossorigin="anonymous"
  preload="metadata"
  ontimeupdate={handleTimeUpdate}
  ondurationchange={handleDurationChange}
  onplay={handlePlay}
  onpause={handlePause}
  onended={handleEnded}
  oncanplay={handleCanPlay}
  onerror={handleError}
></audio>

<!--
  Wrapper carries scoped `onkeydown` (ref 05 §"Media elements" §3) so shortcuts
  only fire when a player-owned element has focus; `tabindex="-1"` lets us
  programmatically focus the wrapper after a mouse click on a control.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="audio-player"
  bind:this={playerEl}
  role="region"
  aria-label={title ? `Audio player — ${title}` : 'Audio player'}
  tabindex="-1"
  onkeydown={handleKey}
>
  <!-- Loading + error status live region per ref 05 §"Media elements" §4.
       Render chrome (icon, retry) inside so sighted users see a consistent panel
       while AT gets a stable role=status landmark. -->
  <MediaLiveRegion
    loading={loading && !errorMessage}
    error={errorMessage || null}
    loadingLabel="Loading audio…"
  >
    {#if errorMessage}
      <div class="audio-player__error">
        <AlertCircleIcon size={24} />
        <p class="audio-player__error-message">{errorMessage}</p>
        <button type="button" class="audio-player__error-retry" onclick={retry}>
          Try Again
        </button>
      </div>
    {/if}
  </MediaLiveRegion>

  {#if !errorMessage}
    <WaveformShader {audioAnalysis} {poster}>
      <div class="audio-player__body">
        <div class="audio-player__main">
          <!-- Play button (left-aligned overlay) -->
          <button
            type="button"
            class="audio-player__btn audio-player__btn--play"
            class:audio-player__btn--playing={isPlaying}
            onclick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            disabled={loading}
          >
            {#if isPlaying}
              <PauseIcon size={20} />
            {:else}
              <PlayIcon size={20} />
            {/if}
          </button>

          <!-- Waveform / seek bar -->
          <div class="audio-player__waveform">
            {#if loading}
              <div class="audio-player__waveform-skeleton">
                <div class="skeleton skeleton--waveform"></div>
              </div>
            {:else}
              <Waveform
                data={waveformData}
                {currentTime}
                {duration}
                playing={isPlaying}
                onseek={handleSeek}
                {audioAnalysis}
              />
            {/if}
          </div>
        </div>

        <!-- Controls bar (inside immersive area) -->
        <div class="audio-player__controls">
          <span class="audio-player__time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div class="audio-player__spacer"></div>

          <!-- Volume -->
          <button
            type="button"
            class="audio-player__btn"
            onclick={toggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {#if isMuted || volume === 0}
              <VolumeXIcon size={18} />
            {:else}
              <Volume2Icon size={18} />
            {/if}
          </button>
          <input
            type="range"
            id="audio-player-volume"
            name="volume"
            class="audio-player__volume"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            oninput={handleVolumeChange}
            aria-label="Volume"
            style:--volume-fill="{(isMuted ? 0 : volume) * 100}%"
          />

          <!-- Playback speed — tap to cycle (mobile), hover to expand (desktop) -->
          <div class="audio-player__speed" role="group" aria-label="Playback speed">
            <button
              type="button"
              class="audio-player__speed-current"
              onclick={cyclePlaybackRate}
              aria-label="Playback speed: {playbackRate}x — tap to change"
            >
              {playbackRate}x
            </button>
            <div class="audio-player__speed-options">
              {#each RATES as rate}
                <button
                  type="button"
                  class="audio-player__speed-btn"
                  class:active={playbackRate === rate}
                  onclick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              {/each}
            </div>
          </div>

          <!-- Immersive mode — always available; falls back to 'nebula' when
               content has no preset assigned. -->
          <button
            type="button"
            class="audio-player__btn audio-player__btn--immersive"
            onclick={() => {
              showImmersive = true;
              // Fullscreen API requires fresh transient activation — must be
              // requested synchronously from a user gesture, not from the
              // overlay's onMount (which runs after several awaits).
              document.documentElement.requestFullscreen().catch(() => {});
            }}
            aria-label="Enter immersive mode"
            title="Immersive shader mode"
          >
            <MaximizeIcon size={18} />
          </button>
        </div>
      </div>
    </WaveformShader>
  {/if}
</div>

<!-- Mini-player (floating card, bottom-centered, clears MobileBottomNav) -->
{#if miniMode}
  <div class="audio-mini-player" role="complementary" aria-label="Audio mini player">
    <div class="audio-mini-player__card">
      <WaveformShader {audioAnalysis} {poster} class="audio-mini-player__shader">
        <div class="audio-mini-player__inner">
          {#if poster}
            <!-- 3rem art: sm, whichever size the caller passed. -->
            <img src={getThumbnailUrl(poster, 'sm')} alt="" class="audio-mini-player__art" />
          {/if}

          <div class="audio-mini-player__body">
            <div class="audio-mini-player__row">
              <span class="audio-mini-player__title">{title}</span>
              <span class="audio-mini-player__time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div class="audio-mini-player__waveform">
              <Waveform
                data={waveformData}
                {currentTime}
                {duration}
                playing={isPlaying}
                onseek={handleSeek}
                {audioAnalysis}
              />
            </div>
          </div>

          <button
            type="button"
            class="audio-mini-player__btn"
            onclick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {#if isPlaying}
              <PauseIcon size={18} />
            {:else}
              <PlayIcon size={18} />
            {/if}
          </button>
        </div>
      </WaveformShader>

      <button
        type="button"
        class="audio-mini-player__close"
        onclick={() => { miniMode = false; }}
        aria-label="Close mini player"
      >
        &times;
      </button>
    </div>
  </div>
{/if}

<!-- Immersive shader player (fullscreen overlay) -->
{#if showImmersive && audioEl}
  <ImmersiveShaderPlayer
    audioElement={audioEl}
    shaderPreset={resolvedShaderPreset}
    {title}
    onclose={() => { showImmersive = false; }}
  />
{/if}

<style>
  .audio-player {
    width: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    /* Remove the default tabindex="-1" focus ring so focus-visible only shows
       when keyboard users actually focus controls — not when togglePlay()
       programmatically focuses the wrapper. */
    outline: none;
  }

  .audio-player:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Immersive body — all content sits over the shader background */
  .audio-player__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
  }

  /* Main area: play button + waveform side by side */
  .audio-player__main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .audio-player__waveform {
    flex: 1;
    min-width: 0;
  }

  .audio-player__waveform-skeleton {
    height: var(--waveform-height, var(--space-24, 96px));
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .skeleton--waveform {
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--color-player-surface) 25%,
      var(--color-player-surface) 50%,
      var(--color-player-surface) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Controls inside the immersive area — light text on dark bg */
  .audio-player__controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--color-player-border);
  }

  .audio-player__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: none;
    border: none;
    color: var(--color-player-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors), var(--transition-transform);
  }

  .audio-player__btn:hover {
    background: var(--color-player-surface);
    color: var(--color-player-text);
  }

  .audio-player__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .audio-player__btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  /* Play button — left-aligned inside waveform area */
  .audio-player__btn--play {
    flex-shrink: 0;
    width: var(--space-12);
    height: var(--space-12);
    padding: 0;
    background: var(--color-player-surface);
    color: var(--color-player-text);
    border-radius: var(--radius-full);
    backdrop-filter: blur(var(--blur-md));
    transition: var(--transition-colors), var(--transition-transform);
  }

  .audio-player__btn--play:hover {
    background: var(--color-player-surface-hover);
    transform: scale(1.05);
  }

  .audio-player__btn--play:active {
    transform: scale(0.95);
  }

  .audio-player__btn--play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Shrink + fade when playing (Disney: secondary action) */
  .audio-player__btn--playing {
    width: var(--space-10);
    height: var(--space-10);
    opacity: var(--opacity-60);
  }

  .audio-player__btn--playing:hover {
    opacity: 1;
  }

  .audio-player__time {
    font-size: var(--text-sm);
    color: var(--color-player-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .audio-player__spacer {
    flex: 1;
  }

  /* Volume slider — brand fill, no thumb, expands on hover */
  .audio-player__volume {
    width: var(--space-20);
    height: var(--space-1);
    appearance: none;
    background: linear-gradient(
      to right,
      var(--color-brand-primary, var(--color-primary-500)) var(--volume-fill, 100%),
      var(--color-player-surface) var(--volume-fill, 100%)
    );
    border-radius: var(--radius-full);
    outline: none;
    cursor: pointer;
    transition: height var(--duration-fast) var(--ease-out);
  }

  .audio-player__volume:hover {
    height: var(--space-1-5);
  }

  .audio-player__volume:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .audio-player__volume::-webkit-slider-thumb {
    appearance: none;
    width: 0;
    height: 0;
  }

  .audio-player__volume::-moz-range-thumb {
    width: 0;
    height: 0;
    border: none;
    background: transparent;
  }

  .audio-player__volume::-webkit-slider-runnable-track {
    height: inherit;
    border-radius: var(--radius-full);
    background: transparent;
  }

  .audio-player__volume::-moz-range-track {
    height: inherit;
    background: transparent;
    border-radius: var(--radius-full);
    border: none;
  }

  .audio-player__speed {
    position: relative;
    display: flex;
    align-items: center;
  }

  .audio-player__speed-current {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-player-text-muted);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-player-border);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-variant-numeric: tabular-nums;
    font-family: inherit;
  }

  .audio-player__speed-current:hover,
  .audio-player__speed:hover .audio-player__speed-current {
    color: var(--color-player-text);
    background: var(--color-player-surface);
    border-color: var(--color-player-surface-active);
  }

  .audio-player__speed-current:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .audio-player__speed-options {
    display: flex;
    gap: var(--space-1);
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    transition: max-width var(--duration-slow) var(--ease-out),
                opacity var(--duration-normal) var(--ease-out);
  }

  .audio-player__speed:hover .audio-player__speed-options,
  .audio-player__speed:focus-within .audio-player__speed-options {
    /* 200px = 50 × --space-unit; no --space-50 token exists. */
    max-width: calc(var(--space-24) * 2);
    opacity: 1;
  }

  .audio-player__speed-btn {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    background: none;
    border: var(--border-width) solid transparent;
    color: var(--color-player-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .audio-player__speed-btn:hover {
    background: var(--color-player-surface);
    color: var(--color-player-text-secondary);
  }

  .audio-player__speed-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .audio-player__speed-btn.active {
    color: var(--color-player-text);
    border-color: var(--color-player-surface-active);
    font-weight: var(--font-medium);
  }

  .audio-player__btn--immersive {
    padding: var(--space-2);
    background: var(--color-player-surface);
    border-radius: var(--radius-md);
  }

  .audio-player__btn--immersive:hover {
    background: var(--color-player-surface-hover);
    color: var(--color-player-text);
  }

  .audio-player__btn--immersive:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .audio-player__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
    text-align: center;
    color: var(--color-player-text-secondary);
  }

  .audio-player__error-message {
    font-size: var(--text-sm);
    color: var(--color-error-500);
  }

  .audio-player__error-retry {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    background: var(--color-primary-500);
    color: var(--color-text-on-primary, var(--color-player-text));
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .audio-player__error-retry:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Mini-player — floating, bottom-centered card.
     Clears MobileBottomNav (height var(--space-16)) on mobile; sits closer to
     the viewport edge on desktop where no bottom nav competes for space. */
  .audio-mini-player {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--space-16) + var(--space-3) + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-sticky, 40);
    padding-inline: var(--space-3);
    display: flex;
    justify-content: center;
    pointer-events: none;
    animation: slide-up var(--duration-fast) var(--ease-out);
  }

  /* Desktop: MobileBottomNav is not rendered — drop the clearance. */
  @media (--breakpoint-md) {
    .audio-mini-player {
      bottom: var(--space-4);
      padding-inline: var(--space-4);
    }
  }

  .audio-mini-player__card {
    position: relative;
    pointer-events: auto;
    width: 100%;
    max-width: calc(var(--space-24) * 9); /* ~864px — matches content-detail width rhythm */
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    isolation: isolate;
  }

  /* Shader fills the card; card rounding clips the canvas.
     Mirrors the main player — no border on the shader surface. */
  .audio-mini-player__card :global(.audio-mini-player__shader) {
    border-radius: inherit;
  }

  /* Flex row of art + body + play button, sitting over the shader. */
  .audio-mini-player__inner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    /* Leave room for the absolutely-positioned close button on the right. */
    padding-right: var(--space-10);
  }

  @keyframes slide-up {
    from { transform: translateY(calc(100% + var(--space-16))); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .audio-mini-player__art {
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-md);
    object-fit: cover;
    flex-shrink: 0;
  }

  /* Body: stacks title-row above the compact waveform. */
  .audio-mini-player__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .audio-mini-player__row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .audio-mini-player__title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    /* Player-surface text tokens — shader background is coloured/dark, so
       mirror .audio-player__body's contrast treatment (see main player). */
    color: var(--color-player-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .audio-mini-player__time {
    font-size: var(--text-xs);
    color: var(--color-player-text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  /* Compact waveform — override --waveform-height so the shared Waveform
     component renders at mini scale. The component reads --waveform-height
     from its ancestor, so a local custom property is all that's needed. */
  .audio-mini-player__waveform {
    --waveform-height: var(--space-8);
    width: 100%;
  }

  .audio-mini-player__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    padding: 0;
    background: var(--color-primary-500);
    color: var(--color-text-on-primary, var(--color-player-text));
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    flex-shrink: 0;
    transition: var(--transition-colors), var(--transition-transform);
  }

  .audio-mini-player__btn:hover {
    background: var(--color-primary-600, var(--color-primary-500));
    transform: scale(1.05);
  }

  .audio-mini-player__btn:active {
    transform: scale(0.95);
  }

  .audio-mini-player__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Close button — positioned over the shader, top-right of card.
     Uses player-surface tokens so it remains legible on the coloured,
     animated background. */
  .audio-mini-player__close {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    z-index: 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    background: none;
    border: none;
    color: var(--color-player-text-secondary);
    font-size: var(--text-xl);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
    flex-shrink: 0;
  }

  .audio-mini-player__close:hover {
    color: var(--color-player-text);
    background: var(--color-player-surface);
  }

  .audio-mini-player__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Responsive */
  @media (max-width: 640px) {
    .audio-player__body {
      padding: var(--space-3);
      gap: var(--space-2);
    }

    /* Wrap controls to a second row on mobile */
    .audio-player__controls {
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    /* Volume gets wider on mobile for easier touch */
    .audio-player__volume {
      width: var(--space-16);
      height: var(--space-1-5);
    }

    /* On mobile: cycle button only, hide expanded options (no hover) */
    .audio-player__speed-options {
      display: none;
    }

    .audio-player__speed-current {
      min-height: var(--space-8);
      min-width: var(--space-10);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Larger touch targets */
    .audio-player__btn {
      min-width: var(--space-10);
      min-height: var(--space-10);
    }

    .audio-player__speed-btn {
      min-height: var(--space-8);
      padding: var(--space-1) var(--space-3);
    }
  }

  /* Reduced-motion guards — ref 05 §"Media elements" §5.
     motion.css collapses --duration-* tokens under prefers-reduced-motion, but
     @keyframes content (shimmer infinite, slide-up) still runs unless guarded. */
  @media (prefers-reduced-motion: reduce) {
    /* Shimmer: keep a subtle signal, don't silence (loading must stay visible). */
    .skeleton--waveform {
      animation-duration: 3s;
    }

    /* Slide-up: drop the transform, just appear. */
    .audio-mini-player {
      animation: none;
    }

    /* Play-button scale transforms are "spring" feedback — no transform under reduce. */
    .audio-player__btn--play:hover,
    .audio-player__btn--play:active,
    .audio-mini-player__btn:hover,
    .audio-mini-player__btn:active {
      transform: none;
    }
  }
</style>
