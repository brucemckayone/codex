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
  import Waveform from './Waveform.svelte';
  import ImmersiveShaderPlayer from './ImmersiveShaderPlayer.svelte';

  import type Hls from 'hls.js';

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

  // Mini-player
  let miniMode = $state(false);

  // Immersive shader mode
  let showImmersive = $state(false);

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
  }

  function handlePause() {
    isPlaying = false;
  }

  function handleEnded() {
    isPlaying = false;
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
    if (!waveformUrl) return;
    try {
      const res = await fetch(waveformUrl);
      if (res.ok) {
        const json = await res.json();
        waveformData = Array.isArray(json) ? json : (json.data ?? json.peaks ?? null);
      }
    } catch {
      // Waveform load failure is non-critical — Waveform.svelte falls back to progress bar
    }
  }

  async function initPlayer() {
    if (!audioEl) return;

    loading = true;
    errorMessage = '';

    try {
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
    <div class="audio-player__body">
      <!-- Cover art -->
      {#if poster}
        <div class="audio-player__artwork">
          <img src={poster} alt="" class="audio-player__artwork-img" />
        </div>
      {/if}

      <div class="audio-player__main">
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
              onseek={handleSeek}
            />
          {/if}
        </div>

        <!-- Controls bar -->
        <div class="audio-player__controls">
          <button
            class="audio-player__btn audio-player__btn--play"
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
          />

          <!-- Playback speed -->
          <div class="audio-player__speed">
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
    </div>
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
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .audio-player__body {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .audio-player__artwork {
    flex-shrink: 0;
    width: 120px;
    height: 120px;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .audio-player__artwork-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .audio-player__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    justify-content: center;
  }

  .audio-player__waveform {
    width: 100%;
  }

  .audio-player__waveform-skeleton {
    height: var(--space-16, 64px);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .skeleton--waveform {
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary, var(--color-surface-secondary)) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .audio-player__controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .audio-player__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: none;
    border: none;
    color: var(--color-text);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background var(--transition-colors);
  }

  .audio-player__btn:hover {
    background: var(--color-surface-secondary);
  }

  .audio-player__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .audio-player__btn--play {
    padding: var(--space-2);
    background: var(--color-primary-500);
    color: var(--color-text-on-primary, #fff);
    border-radius: var(--radius-full);
  }

  .audio-player__btn--play:hover {
    background: var(--color-primary-600);
  }

  .audio-player__time {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .audio-player__spacer {
    flex: 1;
  }

  .audio-player__volume {
    width: 80px;
    accent-color: var(--color-primary-500);
  }

  .audio-player__speed {
    display: flex;
    gap: var(--space-1);
  }

  .audio-player__speed-btn {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    background: none;
    border: var(--border-width) var(--border-style) transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all var(--transition-colors);
  }

  .audio-player__speed-btn:hover {
    background: var(--color-surface-secondary);
  }

  .audio-player__speed-btn.active {
    color: var(--color-primary-500);
    border-color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }

  .audio-player__btn--immersive {
    padding: var(--space-2);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .audio-player__btn--immersive:hover {
    background: var(--color-primary-500);
    color: var(--color-text-on-primary, #fff);
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
      flex-direction: column;
    }

    .audio-player__artwork {
      width: 100%;
      height: 200px;
    }

    .audio-player__volume {
      display: none;
    }

    .audio-player__speed {
      display: none;
    }
  }
</style>
