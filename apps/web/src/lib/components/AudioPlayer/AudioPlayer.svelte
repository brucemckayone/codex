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
  import { AlertCircleIcon, PlayIcon, PauseIcon, Volume2Icon, VolumeXIcon, MaximizeIcon } from '$lib/components/ui/Icon';
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
  }

  const {
    src,
    contentId,
    initialProgress = 0,
    waveformUrl = null,
    poster = null,
    title = '',
    shaderPreset = null,
  }: Props = $props();

  let audioEl: HTMLAudioElement | undefined = $state();
  let playerEl: HTMLDivElement | undefined = $state();
  let hlsInstance: Hls | null = null;
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

  // Immersive shader mode
  let showImmersive = $state(false);

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
    if (!waveformUrl || waveformLoaded) return;
    waveformLoaded = true;
    try {
      const res = await fetch(waveformUrl);
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
      // Destroy previous instance if re-initializing with a different src
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }

      hlsInstance = await createHlsPlayer({
        media: audioEl,
        src,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
      });

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

  async function retry() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    await initPlayer();
  }

  onMount(() => {
    initPlayer();
    loadWaveform();

    // Mini-player: IntersectionObserver on the main player container
    if (playerEl) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          miniMode = !entry.isIntersecting && isPlaying;
        },
        { threshold: 0 }
      );
      observer.observe(playerEl);
      return () => observer.disconnect();
    }
  });

  onDestroy(() => {
    tracker.detach();
    stopAnalysisLoop();
    if (analyserHandle) {
      analyserHandle.destroy();
      analyserHandle = null;
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });

  // Keep mini-mode in sync with play state
  $effect(() => {
    if (!isPlaying) {
      miniMode = false;
    }
  });

  const RATES = [0.5, 1, 1.5, 2] as const;
</script>

<!-- Hidden audio element -->
<audio
  bind:this={audioEl}
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

<div class="audio-player" bind:this={playerEl}>
  {#if errorMessage}
    <div class="audio-player__error" role="alert">
      <AlertCircleIcon size={24} />
      <p class="audio-player__error-message">{errorMessage}</p>
      <button class="audio-player__error-retry" onclick={retry}>
        Try Again
      </button>
    </div>
  {:else}
    <WaveformShader {audioAnalysis} {poster}>
      <div class="audio-player__body">
        <div class="audio-player__main">
          <!-- Play button (left-aligned overlay) -->
          <button
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
              class="audio-player__speed-current"
              onclick={cyclePlaybackRate}
              aria-label="Playback speed: {playbackRate}x — tap to change"
            >
              {playbackRate}x
            </button>
            <div class="audio-player__speed-options">
              {#each RATES as rate}
                <button
                  class="audio-player__speed-btn"
                  class:active={playbackRate === rate}
                  onclick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              {/each}
            </div>
          </div>

          <!-- Immersive mode (only when shader preset is set) -->
          {#if shaderPreset && shaderPreset !== 'none'}
            <button
              class="audio-player__btn audio-player__btn--immersive"
              onclick={() => { showImmersive = true; }}
              aria-label="Enter immersive mode"
              title="Immersive shader mode"
            >
              <MaximizeIcon size={18} />
            </button>
          {/if}
        </div>
      </div>
    </WaveformShader>
  {/if}
</div>

<!-- Mini-player (sticky bottom bar) -->
{#if miniMode}
  <div class="audio-mini-player" role="complementary" aria-label="Audio mini player">
    {#if poster}
      <img src={poster} alt="" class="audio-mini-player__art" />
    {/if}
    <span class="audio-mini-player__title">{title}</span>

    <button
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

    <div class="audio-mini-player__progress">
      <div
        class="audio-mini-player__progress-fill"
        style:width="{duration > 0 ? (currentTime / duration) * 100 : 0}%"
      ></div>
    </div>

    <button
      class="audio-mini-player__close"
      onclick={() => { miniMode = false; }}
      aria-label="Close mini player"
    >
      &times;
    </button>
  </div>
{/if}

<!-- Immersive shader player (fullscreen overlay) -->
{#if showImmersive && audioEl && shaderPreset && shaderPreset !== 'none'}
  <ImmersiveShaderPlayer
    audioElement={audioEl}
    {shaderPreset}
    onclose={() => { showImmersive = false; }}
  />
{/if}

<svelte:window
  onkeydown={(e) => {
    if (!audioEl || errorMessage) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        handleSeek(currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        handleSeek(currentTime + 10);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
    }
  }}
/>

<style>
  .audio-player {
    width: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
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
      hsl(0 0% 100% / 0.05) 25%,
      hsl(0 0% 100% / 0.1) 50%,
      hsl(0 0% 100% / 0.05) 75%
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
    border-top: 1px solid hsl(0 0% 100% / 0.1);
  }

  .audio-player__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: none;
    border: none;
    color: hsl(0 0% 100% / 0.8);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors), var(--transition-transform);
  }

  .audio-player__btn:hover {
    background: hsl(0 0% 100% / 0.1);
    color: #fff;
  }

  .audio-player__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Play button — left-aligned inside waveform area */
  .audio-player__btn--play {
    flex-shrink: 0;
    width: var(--space-12);
    height: var(--space-12);
    padding: 0;
    background: hsl(0 0% 100% / 0.15);
    color: #fff;
    border-radius: var(--radius-full);
    backdrop-filter: blur(8px);
    transition: var(--transition-colors), var(--transition-transform);
  }

  .audio-player__btn--play:hover {
    background: hsl(0 0% 100% / 0.25);
    transform: scale(1.05);
  }

  .audio-player__btn--play:active {
    transform: scale(0.95);
  }

  /* Shrink + fade when playing (Disney: secondary action) */
  .audio-player__btn--playing {
    width: var(--space-10);
    height: var(--space-10);
    opacity: 0.6;
  }

  .audio-player__btn--playing:hover {
    opacity: 1;
  }

  .audio-player__time {
    font-size: var(--text-sm);
    color: hsl(0 0% 100% / 0.7);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .audio-player__spacer {
    flex: 1;
  }

  /* Volume slider — brand fill, no thumb, expands on hover */
  .audio-player__volume {
    width: 80px;
    height: 4px;
    appearance: none;
    background: linear-gradient(
      to right,
      var(--color-brand-primary, var(--color-primary-500)) var(--volume-fill, 100%),
      hsl(0 0% 100% / 0.15) var(--volume-fill, 100%)
    );
    border-radius: var(--radius-full);
    outline: none;
    cursor: pointer;
    transition: height var(--duration-fast) var(--ease-out);
  }

  .audio-player__volume:hover {
    height: 6px;
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
    color: hsl(0 0% 100% / 0.7);
    padding: var(--space-1) var(--space-2);
    border: 1px solid hsl(0 0% 100% / 0.2);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-variant-numeric: tabular-nums;
    font-family: inherit;
  }

  .audio-player__speed-current:hover,
  .audio-player__speed:hover .audio-player__speed-current {
    color: #fff;
    background: hsl(0 0% 100% / 0.1);
    border-color: hsl(0 0% 100% / 0.3);
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
    max-width: 200px;
    opacity: 1;
  }

  .audio-player__speed-btn {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    background: none;
    border: 1px solid transparent;
    color: hsl(0 0% 100% / 0.5);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .audio-player__speed-btn:hover {
    background: hsl(0 0% 100% / 0.1);
    color: hsl(0 0% 100% / 0.8);
  }

  .audio-player__speed-btn.active {
    color: #fff;
    border-color: hsl(0 0% 100% / 0.3);
    font-weight: var(--font-medium);
  }

  .audio-player__btn--immersive {
    padding: var(--space-2);
    background: hsl(0 0% 100% / 0.1);
    border-radius: var(--radius-md);
  }

  .audio-player__btn--immersive:hover {
    background: var(--color-primary-500);
    color: #fff;
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
    color: var(--color-text-on-primary, #fff);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  /* Mini-player */
  .audio-mini-player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: var(--z-sticky, 40);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-lg);
    animation: slide-up 200ms ease-out;
  }

  @keyframes slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .audio-mini-player__art {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
  }

  .audio-mini-player__title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .audio-mini-player__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    background: var(--color-primary-500);
    color: var(--color-text-on-primary, #fff);
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    flex-shrink: 0;
  }

  .audio-mini-player__progress {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-surface-secondary);
  }

  .audio-mini-player__progress-fill {
    height: 100%;
    background: var(--color-primary-500);
    transition: width 200ms linear;
  }

  .audio-mini-player__close {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--text-lg);
    cursor: pointer;
    padding: var(--space-1);
    line-height: 1;
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
      width: 60px;
      height: 6px;
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
</style>
