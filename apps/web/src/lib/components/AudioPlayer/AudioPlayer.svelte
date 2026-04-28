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
  import { onMount, onDestroy } from 'svelte';
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
  let lastCurrentTime = 0;
  let refreshInFlight = false;
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

  // Track initialized src to prevent duplicate init on prop change
  let initializedSrc = $state('');

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
  });

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
      audioEl.play();
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
    isPlaying = true;
    // Lazily create audio analyser on first play (requires user gesture for AudioContext)
    if (audioEl && !analyserHandle) {
      analyserHandle = createAudioAnalyser(audioEl);
      analyserHandle.resume();
    }
    startAnalysisLoop();
  }

  function handlePause() {
    isPlaying = false;
    stopAnalysisLoop();
  }

  function handleEnded() {
    isPlaying = false;
    stopAnalysisLoop();
  }

  function handleCanPlay() {
    loading = false;
  }

  function handleError() {
    if (!errorMessage) {
      errorMessage = 'Failed to load audio. Please check your connection and try again.';
    }
    loading = false;
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

  async function initPlayer() {
    if (!audioEl || !src) return;

    // Guard: skip re-init if src hasn't changed (prevents duplicate init on reactive prop updates)
    if (initializedSrc === src) return;
    initializedSrc = src;

    loading = true;
    errorMessage = '';

    try {
      teardownHls();

      const handle = await createHlsPlayer({
        media: audioEl,
        src,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
        onUrlExpired: () => {
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;

      // Set initial progress (resume position)
      if (initialProgress > 0) {
        if (audioEl.readyState >= 1) {
          audioEl.currentTime = initialProgress;
        } else {
          audioEl.addEventListener(
            'loadedmetadata',
            () => {
              if (audioEl) audioEl.currentTime = initialProgress;
            },
            { once: true }
          );
        }
      }

      tracker.attach();
    } catch {
      errorMessage = 'Failed to initialise audio player.';
      loading = false;
    }
  }

  /**
   * Tear down the current HLS.js instance and any Safari error listener.
   * `hlsCleanup` is the callback returned from `createHlsPlayer` — a no-op
   * on the HLS.js branch and a `removeEventListener` on Safari native.
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
   * Signed-URL expiry recovery — mirrors VideoPlayer. Audio and waveform
   * share an expiry (both signed in the same `getStreamingUrl` access
   * call), so a single refresh swaps both URLs.
   */
  async function handleUrlExpired() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      if (audioEl && Number.isFinite(audioEl.currentTime)) {
        lastCurrentTime = audioEl.currentTime;
      }
      teardownHls();
      const fresh = await refreshStreamingUrl(contentId);
      if (!audioEl) return;
      initializedSrc = fresh.streamingUrl;
      loading = true;
      errorMessage = '';
      const handle = await createHlsPlayer({
        media: audioEl,
        src: fresh.streamingUrl,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
        onUrlExpired: () => {
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      if (lastCurrentTime > 0) {
        const resumeAt = lastCurrentTime;
        if (audioEl.readyState >= 1) {
          audioEl.currentTime = resumeAt;
        } else {
          audioEl.addEventListener(
            'loadedmetadata',
            () => {
              if (audioEl) audioEl.currentTime = resumeAt;
            },
            { once: true }
          );
        }
      }
      // Waveform URL shares the same signature lifecycle — refetch it so
      // the waveform keeps rendering after expiry.
      currentWaveformUrl = fresh.waveformUrl;
      waveformLoaded = false;
      waveformData = null;
      void loadWaveform();
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
   * Pre-emptive refresh 60s before `expiresAt`. Skips when unset / past —
   * the reactive 403 path handles those cases.
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
    // Most often Retry fires because the URL expired; refresh first so
    // Retry doesn't immediately 403 again.
    teardownHls();
    try {
      const fresh = await refreshStreamingUrl(contentId);
      if (!audioEl) return;
      initializedSrc = fresh.streamingUrl;
      loading = true;
      errorMessage = '';
      const handle = await createHlsPlayer({
        media: audioEl,
        src: fresh.streamingUrl,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
        onUrlExpired: () => {
          void handleUrlExpired();
        },
      });
      hlsInstance = handle.hls;
      hlsCleanup = handle.cleanup;
      currentWaveformUrl = fresh.waveformUrl;
      waveformLoaded = false;
      waveformData = null;
      void loadWaveform();
      scheduleRefresh();
    } catch {
      // Refresh endpoint itself failed — reset the init guard and try the
      // original src path; transient network blips may self-heal.
      initializedSrc = '';
      await initPlayer();
    }
  }

  onMount(() => {
    initPlayer();
    loadWaveform();
    scheduleRefresh();

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

  /**
   * React to `expiresAt` prop changes — reschedule the pre-emptive refresh
   * so the next cycle fires relative to the new expiry, not the old one.
   */
  $effect(() => {
    void expiresAt;
    if (typeof window === 'undefined') return;
    scheduleRefresh();
  });

  onDestroy(() => {
    tracker.detach();
    stopAnalysisLoop();
    teardownRefresh();
    if (analyserHandle) {
      analyserHandle.destroy();
      analyserHandle = null;
    }
    teardownHls();
  });

  const RATES = [0.5, 1, 1.5, 2] as const;

  /**
   * Keyboard shortcuts scoped to the player wrapper (ref 05 §"Media elements" §3).
   * Attached via `onkeydown` on `.audio-player` — NOT `<svelte:window>` — so
   * Space / Arrow / m don't hijack every `<button>` on the page.
   */
  const handleKey = createMediaKeyboardHandler({
    getWrapper: () => playerEl,
    getMedia: () => audioEl ?? null,
    shortcuts: {
      playPause: togglePlay,
      mute: toggleMute,
      seekSecs: 10,
    },
  });
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
            <img src={poster} alt="" class="audio-mini-player__art" />
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
    background: var(--color-primary-500);
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
    color: var(--color-text-secondary);
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
