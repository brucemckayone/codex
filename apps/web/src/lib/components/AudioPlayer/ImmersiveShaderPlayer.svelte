<!--
  @component ImmersiveShaderPlayer

  Fullscreen overlay that renders a shader preset driven by audio frequency
  data. The shader responds in real-time to bass, mids, treble, and amplitude
  extracted from the audio element via the AudioAnalyser.

  Mouse interaction still works — hover/click drive both mouse and audio inputs.

  @prop {HTMLAudioElement} audioElement - The audio element to analyse
  @prop {string} shaderPreset - Shader preset ID to render
  @prop {() => void} onclose - Called when user exits immersive mode
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Action } from 'svelte/action';
  import { createAudioAnalyser, type AudioAnalyserHandle } from './audio-analyser';
  import { loadRenderer } from '$lib/components/ui/ShaderHero/load-renderer';
  import { getShaderConfig, type ShaderPresetId, type ShaderConfig } from '$lib/components/ui/ShaderHero/shader-config';
  import type { ShaderRenderer, MouseState, AudioState } from '$lib/components/ui/ShaderHero/renderer-types';
  import { PlayIcon, PauseIcon, Volume2Icon, VolumeXIcon, XIcon } from '$lib/components/ui/Icon';

  interface Props {
    audioElement: HTMLAudioElement;
    shaderPreset: string;
    onclose: () => void;
  }

  const { audioElement, shaderPreset, onclose }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let overlayEl: HTMLDivElement | undefined = $state();
  let gl: WebGL2RenderingContext | null = null;
  let renderer: ShaderRenderer | null = null;
  let analyser: AudioAnalyserHandle | null = null;
  let animFrameId = 0;
  let startTime = 0;
  let controlsVisible = $state(true);
  let controlsTimeout: ReturnType<typeof setTimeout> | null = null;

  // Audio state for UI
  let isPlaying = $state(!audioElement.paused);
  let currentTime = $state(audioElement.currentTime);
  let duration = $state(audioElement.duration || 0);
  let isMuted = $state(audioElement.muted);

  const mouse: MouseState = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };

  function formatTime(seconds: number): string {
    if (!seconds || Number.isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function togglePlay() {
    if (audioElement.paused) {
      audioElement.play();
    } else {
      audioElement.pause();
    }
  }

  function toggleMute() {
    audioElement.muted = !audioElement.muted;
    isMuted = audioElement.muted;
  }

  function handleSeek(e: PointerEvent) {
    if (!overlayEl) return;
    const seekBar = (e.target as HTMLElement).closest('.immersive__seek');
    if (!seekBar) return;
    const rect = seekBar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioElement.currentTime = pos * duration;
  }

  function showControls() {
    controlsVisible = true;
    if (controlsTimeout) clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      controlsVisible = false;
    }, 3000);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = 1 - (e.clientY - rect.top) / rect.height;
    mouse.active = true;
    showControls();
  }

  function handleClick() {
    mouse.burstStrength = 1.0;
    showControls();
  }

  // Audio element event listeners
  function onPlay() { isPlaying = true; }
  function onPause() { isPlaying = false; }
  function onTimeUpdate() { currentTime = audioElement.currentTime; }
  function onDurationChange() {
    if (!Number.isNaN(audioElement.duration)) {
      duration = audioElement.duration;
    }
  }

  function resize() {
    if (!canvasEl || !gl) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    canvasEl.width = w;
    canvasEl.height = h;
    gl.viewport(0, 0, w, h);
    renderer?.resize(gl, w, h);
  }

  function renderFrame() {
    if (!gl || !renderer || !canvasEl) return;

    const time = (performance.now() - startTime) / 1000;
    const w = canvasEl.width;
    const h = canvasEl.height;

    // Decay mouse burst
    if (mouse.burstStrength > 0.01) {
      mouse.burstStrength *= 0.85;
    } else {
      mouse.burstStrength = 0;
    }

    // Get audio analysis
    let audioState: AudioState | undefined;
    if (analyser) {
      const analysis = analyser.getAnalysis();
      audioState = {
        bass: analysis.bass,
        mids: analysis.mids,
        treble: analysis.treble,
        amplitude: analysis.amplitude,
        active: analysis.active,
      };
    }

    // Build config from defaults (no CSS vars in fullscreen overlay)
    const config = getShaderConfig();

    renderer.render(gl, time, mouse, config, w, h, audioState);
    animFrameId = requestAnimationFrame(renderFrame);
  }

  onMount(async () => {
    if (!canvasEl) return;

    // Create WebGL context
    gl = canvasEl.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    // Load shader renderer
    const preset = shaderPreset as ShaderPresetId;
    renderer = await loadRenderer(preset);
    if (!renderer) {
      onclose();
      return;
    }

    // Init renderer
    resize();
    const ok = renderer.init(gl, canvasEl.width, canvasEl.height);
    if (!ok) {
      onclose();
      return;
    }

    // Create audio analyser (lazy — first time only, reuses via WeakMap)
    analyser = createAudioAnalyser(audioElement);
    await analyser.resume();

    // Start render loop
    startTime = performance.now();
    animFrameId = requestAnimationFrame(renderFrame);

    // Try fullscreen
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen denied — fixed overlay fallback is fine
    }

    // Event listeners
    audioElement.addEventListener('play', onPlay);
    audioElement.addEventListener('pause', onPause);
    audioElement.addEventListener('timeupdate', onTimeUpdate);
    audioElement.addEventListener('durationchange', onDurationChange);
    window.addEventListener('resize', resize);

    // Auto-hide controls after 3s
    controlsTimeout = setTimeout(() => {
      controlsVisible = false;
    }, 3000);
  });

  onDestroy(() => {
    cancelAnimationFrame(animFrameId);

    if (gl && renderer) {
      renderer.destroy(gl);
    }

    // Don't destroy analyser — it's reusable via WeakMap

    audioElement.removeEventListener('play', onPlay);
    audioElement.removeEventListener('pause', onPause);
    audioElement.removeEventListener('timeupdate', onTimeUpdate);
    audioElement.removeEventListener('durationchange', onDurationChange);
    window.removeEventListener('resize', resize);

    if (controlsTimeout) clearTimeout(controlsTimeout);

    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });

  const seekProgress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

  /**
   * Portal action — moves the element to document.body so it escapes
   * the org-main stacking context (created by view-transition-name).
   */
  const portal: Action = (node) => {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  };
</script>

<div
  class="immersive"
  bind:this={overlayEl}
  use:portal
  onpointermove={handlePointerMove}
  onclick={handleClick}
  role="application"
  aria-label="Immersive audio shader player"
>
  <canvas bind:this={canvasEl} class="immersive__canvas"></canvas>

  <!-- Controls overlay -->
  <div class="immersive__controls" class:visible={controlsVisible}>
    <!-- Close button -->
    <button class="immersive__close" onclick={onclose} aria-label="Exit immersive mode">
      <XIcon size={24} />
    </button>

    <!-- Bottom bar -->
    <div class="immersive__bar">
      <!-- Seek bar -->
      <div
        class="immersive__seek"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabindex={0}
        onpointerdown={handleSeek}
      >
        <div class="immersive__seek-fill" style:width="{seekProgress}%"></div>
      </div>

      <div class="immersive__bar-inner">
        <button class="immersive__btn" onclick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {#if isPlaying}
            <PauseIcon size={22} />
          {:else}
            <PlayIcon size={22} />
          {/if}
        </button>

        <span class="immersive__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div class="immersive__spacer"></div>

        <button class="immersive__btn" onclick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
          {#if isMuted}
            <VolumeXIcon size={20} />
          {:else}
            <Volume2Icon size={20} />
          {/if}
        </button>

        <button class="immersive__btn immersive__btn--close" onclick={onclose} aria-label="Exit">
          Exit
        </button>
      </div>
    </div>
  </div>
</div>

<svelte:window
  onkeydown={(e) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onclose();
        break;
      case ' ':
        e.preventDefault();
        togglePlay();
        showControls();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audioElement.currentTime = Math.max(0, audioElement.currentTime - 10);
        showControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        audioElement.currentTime = Math.min(duration, audioElement.currentTime + 10);
        showControls();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        showControls();
        break;
    }
  }}
/>

<style>
  .immersive {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 50);
    background: #000;
    cursor: none;
  }

  .immersive:hover {
    cursor: default;
  }

  .immersive__canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .immersive__controls {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 0;
    transition: opacity 300ms ease;
    pointer-events: none;
  }

  .immersive__controls.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .immersive__close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: var(--radius-full);
    color: #fff;
    cursor: pointer;
    backdrop-filter: blur(8px);
    transition: background 200ms ease;
  }

  .immersive__close:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  .immersive__bar {
    margin-top: auto;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    padding: 0 var(--space-4) var(--space-4);
  }

  .immersive__seek {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    cursor: pointer;
    margin-bottom: var(--space-3);
    position: relative;
  }

  .immersive__seek-fill {
    height: 100%;
    background: var(--color-primary-500, #6366f1);
    border-radius: 3px;
    transition: width 200ms linear;
  }

  .immersive__bar-inner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .immersive__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    background: rgba(255, 255, 255, 0.15);
    border: none;
    border-radius: var(--radius-full);
    color: #fff;
    cursor: pointer;
    backdrop-filter: blur(4px);
    transition: background 200ms ease;
  }

  .immersive__btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .immersive__btn--close {
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .immersive__time {
    font-size: var(--text-sm);
    color: rgba(255, 255, 255, 0.8);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .immersive__spacer {
    flex: 1;
  }
</style>
