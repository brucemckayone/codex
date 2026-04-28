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
  import { createPollConfig } from '$lib/components/ui/ShaderHero/use-poll-config';
  import type { ShaderRenderer, MouseState, AudioState } from '$lib/components/ui/ShaderHero/renderer-types';
  import { PlayIcon, PauseIcon, Volume2Icon, VolumeXIcon, XIcon } from '$lib/components/ui/Icon';
  import {
    createMediaKeyboardHandler,
    MediaLiveRegion,
  } from '$lib/components/media-a11y';

  interface Props {
    audioElement: HTMLAudioElement;
    shaderPreset: string;
    onclose: () => void;
    /** Content title — threads through to `aria-label` on the overlay landmark. */
    title?: string;
  }

  const { audioElement, shaderPreset, onclose, title = '' }: Props = $props();

  // Renderer/analyser failures currently exit via `onclose()`. Track a surfaced
  // error so the live region can announce it before the overlay unmounts.
  let rendererError = $state<string | null>(null);
  let rendererReady = $state(false);

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let overlayEl: HTMLDivElement | undefined = $state();
  let gl: WebGL2RenderingContext | null = null;
  let renderer: ShaderRenderer | null = null;
  let analyser: AudioAnalyserHandle | null = null;
  let animFrameId = 0;
  let startTime = 0;
  // Set true in onDestroy so async work resuming after an `await` can bail out
  // before touching `bind:this` refs that Svelte nulls on unmount.
  let cancelled = false;
  // Lazy-initialised in onMount once `shaderPreset` is captured. Amortises
  // getShaderConfig (forced style recalc) across ~30 frames per ShaderHero pattern.
  let pollConfig: (() => ShaderConfig) | null = null;
  let controlsVisible = $state(true);
  let controlsTimeout: ReturnType<typeof setTimeout> | null = null;

  // Audio state for UI — synced from audioElement events.
  // Initial values captured from prop; events keep them in sync thereafter.
  // svelte-ignore state_referenced_locally
  let isPlaying = $state(!audioElement.paused);
  // svelte-ignore state_referenced_locally
  let currentTime = $state(audioElement.currentTime);
  // svelte-ignore state_referenced_locally
  let duration = $state(audioElement.duration || 0);
  // svelte-ignore state_referenced_locally
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

    // Get audio analysis — pass through smoothed envelopes + beat pulse so
    // presets can choose raw vs. smoothed per-channel.
    let audioState: AudioState | undefined;
    if (analyser) {
      const a = analyser.getAnalysis();
      audioState = {
        bass: a.bass,
        mids: a.mids,
        treble: a.treble,
        amplitude: a.amplitude,
        bassSmooth: a.bassSmooth,
        midsSmooth: a.midsSmooth,
        trebleSmooth: a.trebleSmooth,
        amplitudeSmooth: a.amplitudeSmooth,
        beatPulse: a.beatPulse,
        active: a.active,
      };
    }

    // Build config with the immersive preset (not the org's hero preset).
    // Polled at ~30-frame cadence (see use-poll-config.ts) — getShaderConfig
    // forces a style recalc, so per-frame calls dominate render-loop cost.
    const config = pollConfig
      ? pollConfig()
      : getShaderConfig(null, shaderPreset as ShaderPresetId);

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
    if (!gl) {
      // Announce via live region before bailing out (ref 05 §"Media elements" §4).
      rendererError = 'WebGL 2 is unavailable. Exiting immersive mode.';
      setTimeout(() => onclose(), 1200);
      return;
    }

    // Load shader renderer
    const preset = shaderPreset as ShaderPresetId;
    pollConfig = createPollConfig(() => getShaderConfig(null, preset));
    renderer = await loadRenderer(preset);
    // Race guard: dynamic import is the long await — user may have closed the
    // overlay in the meantime, in which case canvasEl/gl have been nulled.
    if (cancelled || !canvasEl || !gl) return;
    if (!renderer) {
      rendererError = 'Unable to load shader preset. Exiting immersive mode.';
      setTimeout(() => onclose(), 1200);
      return;
    }

    // Init renderer
    resize();
    const ok = renderer.init(gl, canvasEl.width, canvasEl.height);
    if (!ok) {
      rendererError = 'Shader initialisation failed. Exiting immersive mode.';
      setTimeout(() => onclose(), 1200);
      return;
    }

    // Create audio analyser (lazy — first time only, reuses via WeakMap)
    try {
      analyser = createAudioAnalyser(audioElement);
      await analyser.resume();
    } catch {
      rendererError = 'Audio analyser failed to start. Visuals will play without audio reactivity.';
      // Not fatal — continue rendering.
    }
    if (cancelled) return;

    rendererReady = true;

    // Start render loop
    startTime = performance.now();
    animFrameId = requestAnimationFrame(renderFrame);

    // Fullscreen is requested by the parent's click handler (AudioPlayer.svelte)
    // because the Fullscreen API requires fresh transient activation, which is
    // gone by the time we reach this post-await branch.

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
    // Signal first so any pending awaits bail before touching nulled refs.
    cancelled = true;
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

  /**
   * Auto-focus the portal root on mount (ref 05 §"Media elements" §9). Because
   * the overlay is portaled under `document.body`, `wrapperEl?.contains(activeEl)`
   * can never succeed — so we opt out of containment check and lean on focus
   * being inside the overlay.
   */
  $effect(() => {
    if (overlayEl) {
      requestAnimationFrame(() => overlayEl?.focus());
    }
  });

  /**
   * Scoped keyboard handler for the portal overlay (ref 05 §"Media elements" §3
   * + §9). Escape closes, Space toggles play, Arrow keys seek.
   */
  const handleKey = createMediaKeyboardHandler({
    getMedia: () => audioElement,
    skipContainmentCheck: true,
    shortcuts: {
      playPause: () => {
        togglePlay();
        showControls();
      },
      mute: () => {
        toggleMute();
        showControls();
      },
      // Wrap `onclose` so the reactive prop isn't captured by the initial value.
      escape: () => onclose(),
      seekSecs: 10,
    },
  });

  /**
   * Keyboard contract for the seek slider (ref 05 §"Media elements" §"slider contract").
   * Slider child has role="slider" tabindex=0 — it needs its own arrow handler so
   * focused keyboard users can seek without deferring to the overlay-level shortcut.
   */
  function handleSeekKey(e: KeyboardEvent) {
    if (!duration || Number.isNaN(duration)) return;

    const fineStep = 1;
    const coarseStep = 5;

    switch (e.key) {
      case 'ArrowLeft': {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? fineStep : coarseStep;
        audioElement.currentTime = Math.max(0, audioElement.currentTime - step);
        showControls();
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? fineStep : coarseStep;
        audioElement.currentTime = Math.min(duration, audioElement.currentTime + step);
        showControls();
        break;
      }
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        audioElement.currentTime = 0;
        showControls();
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        audioElement.currentTime = duration;
        showControls();
        break;
    }
  }
</script>

<!--
  Portaled dialog (ref 05 §"Media elements" §9) — keydown lives on the portal
  node itself and auto-focus on mount makes keyboard shortcuts reachable.
  role="dialog" + aria-modal (instead of role="application") reflects the
  modal nature: Escape closes and focus is trapped on mount.
-->
<!--
  a11y_no_noninteractive_element_interactions is intentional: the overlay gets
  pointer + keyboard handlers because it IS the player surface. Click events
  now have a keyboard equivalent via `onkeydown={handleKey}` so we no longer
  suppress a11y_click_events_have_key_events.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="immersive"
  bind:this={overlayEl}
  use:portal
  tabindex="-1"
  onpointermove={handlePointerMove}
  onclick={handleClick}
  onkeydown={handleKey}
  role="dialog"
  aria-modal="true"
  aria-label={title ? `Immersive audio shader — ${title}` : 'Immersive audio shader player'}
>
  <canvas bind:this={canvasEl} class="immersive__canvas"></canvas>

  <!-- Live region for renderer loading/error — ref 05 §"Media elements" §4. -->
  <MediaLiveRegion
    loading={!rendererReady && !rendererError}
    error={rendererError}
    loadingLabel="Loading immersive shader…"
    class="immersive__status"
  />

  <!-- Controls overlay -->
  <div class="immersive__controls" class:visible={controlsVisible}>
    <!-- Close button -->
    <button type="button" class="immersive__close" onclick={onclose} aria-label="Exit immersive mode">
      <XIcon size={24} />
    </button>

    <!-- Bottom bar -->
    <div class="immersive__bar">
      <!--
        Seek slider — ref 05 §4 + §"Media elements" §6. Arrow keys seek ±5s
        (Shift = fine ±1s), Home/End = start/end. stopPropagation prevents
        the overlay-level handleKey from also seeking on the same keystroke.
      -->
      <div
        class="immersive__seek"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext="{formatTime(currentTime)} of {formatTime(duration)}"
        tabindex={0}
        onpointerdown={handleSeek}
        onkeydown={handleSeekKey}
      >
        <div class="immersive__seek-fill" style:width="{seekProgress}%"></div>
      </div>

      <div class="immersive__bar-inner">
        <button type="button" class="immersive__btn" onclick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
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

        <button type="button" class="immersive__btn" onclick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
          {#if isMuted}
            <VolumeXIcon size={20} />
          {:else}
            <Volume2Icon size={20} />
          {/if}
        </button>

        <button type="button" class="immersive__btn immersive__btn--close" onclick={onclose} aria-label="Exit">
          Exit
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .immersive {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 50);
    background: var(--color-neutral-950, #000);
    cursor: none;
    /* Remove programmatic-focus outline; :focus-visible below handles real keyboard focus. */
    outline: none;
  }

  .immersive:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(var(--border-width-thick) * -2);
  }

  .immersive:hover {
    cursor: default;
  }

  /* Portaled live region — visually out-of-flow; only SR sees it. */
  :global(.immersive__status) {
    position: absolute;
    inset: auto 0 auto 0;
    pointer-events: none;
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
    transition: opacity var(--duration-slow) var(--ease-default);
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
    background: var(--color-player-overlay);
    border: none;
    border-radius: var(--radius-full);
    color: var(--color-player-text);
    cursor: pointer;
    backdrop-filter: blur(var(--blur-md));
    transition: background var(--duration-fast) var(--ease-default);
  }

  .immersive__close:hover {
    background: var(--color-player-overlay-heavy);
  }

  .immersive__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .immersive__bar {
    margin-top: auto;
    background: linear-gradient(transparent, var(--color-player-overlay));
    padding: 0 var(--space-4) var(--space-4);
  }

  .immersive__seek {
    width: 100%;
    height: var(--space-1-5);
    background: var(--color-player-surface-hover);
    border-radius: var(--radius-xs);
    cursor: pointer;
    margin-bottom: var(--space-3);
    position: relative;
  }

  .immersive__seek:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .immersive__seek-fill {
    height: 100%;
    background: var(--color-brand-primary, var(--color-primary-500));
    border-radius: var(--radius-xs);
    transition: width var(--duration-fast) linear;
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
    background: var(--color-player-surface);
    border: none;
    border-radius: var(--radius-full);
    color: var(--color-player-text);
    cursor: pointer;
    backdrop-filter: blur(var(--blur-sm));
    transition: background var(--duration-fast) var(--ease-default);
  }

  .immersive__btn:hover {
    background: var(--color-player-surface-active);
  }

  .immersive__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .immersive__btn--close {
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .immersive__btn--close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .immersive__time {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .immersive__spacer {
    flex: 1;
  }

  /* Reduced-motion guard (ref 05 §"Media elements" §5). The shader canvas itself
     is animation regardless — we only silence control-surface transitions. */
  @media (prefers-reduced-motion: reduce) {
    .immersive__controls,
    .immersive__close,
    .immersive__btn,
    .immersive__seek-fill {
      transition: none;
    }
  }
</style>
