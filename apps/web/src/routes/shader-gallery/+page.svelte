<!--
  @component Shader Gallery — DEV ONLY

  A review harness for the 41 ShaderHero presets. Exists because the two
  production surfaces are both awkward for reviewing shaders as a set: the
  brand editor shows one preset at a time behind a save cycle, and the
  immersive player needs uploaded audio content on a real org.

  It deliberately uses the REAL `loadRenderer` and the REAL
  `createAudioAnalyser` rather than reimplementing either. A harness that
  reimplements the thing it is testing tells you about the harness.

  Not linked from anywhere and guarded on `dev`, so it cannot ship.

  Audio: pick any local file. Every preset receives the same `AudioState` the
  immersive player supplies, so what you see here is what plays there.
-->
<script lang="ts">
  import { dev } from '$app/environment';
  import { onMount } from 'svelte';
  import {
    createAudioAnalyser,
    type AudioAnalyserHandle,
  } from '$lib/components/AudioPlayer/audio-analyser';
  import { HERO_FX_PRESETS } from '$lib/brand-editor/hero-fx-presets';
  import { loadRenderer } from '$lib/components/ui/ShaderHero/load-renderer';
  import {
    getShaderConfig,
    type ShaderPresetId,
  } from '$lib/components/ui/ShaderHero/shader-config';
  import type {
    AudioState,
    MouseState,
    ShaderRenderer,
  } from '$lib/components/ui/ShaderHero/renderer-types';

  /** The three presets the owner asked to be left alone. */
  const PROTECTED = new Set(['suture', 'flow', 'ripple']);

  const presets = HERO_FX_PRESETS.filter((p) => p.id !== 'none');

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let active = $state<string>('vapor');
  let status = $state('starting…');
  let audioName = $state<string | null>(null);
  let playing = $state(false);

  /** Live audio readout, so the reactivity is visible and not just felt. */
  let meters = $state({
    bass: 0,
    mids: 0,
    treble: 0,
    level: 0,
    energy: 0,
    flux: 0,
    centroid: 0,
    beat: 0,
    phase: 0,
    onsets: 0,
  });

  let gl: WebGL2RenderingContext | null = null;
  let renderer: ShaderRenderer | null = null;
  let analyser: AudioAnalyserHandle | null = null;
  let raf = 0;
  let start = 0;
  const mouse: MouseState = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };

  async function select(id: string) {
    active = id;
    status = `loading ${id}…`;
    if (!gl) return;
    renderer?.destroy(gl);
    renderer = await loadRenderer(id as ShaderPresetId);
    if (!renderer || !canvasEl) {
      status = `${id}: no renderer`;
      return;
    }
    const ok = renderer.init(gl, canvasEl.width, canvasEl.height);
    // init() returning false is how a preset reports a missing extension
    // (EXT_color_buffer_float on the FBO presets). Surfacing it beats a
    // black canvas with no explanation.
    status = ok ? id : `${id}: init FAILED (missing WebGL extension?)`;
    // Reset the clock per preset so integrated clocks start from zero rather
    // than inheriting the previous preset's accumulated phase.
    start = performance.now();
  }

  function resize() {
    if (!canvasEl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvasEl.getBoundingClientRect();
    canvasEl.width = Math.round(r.width * dpr);
    canvasEl.height = Math.round(r.height * dpr);
    if (gl && renderer) renderer.resize(gl, canvasEl.width, canvasEl.height);
  }

  onMount(() => {
    if (!dev || !canvasEl) return;

    gl = canvasEl.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) {
      status = 'WebGL 2 unavailable';
      return;
    }

    resize();
    window.addEventListener('resize', resize);
    void select(active);
    start = performance.now();

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!gl || !renderer || !canvasEl) return;

      // Frame-rate-independent burst decay, matching ShaderHero.svelte.
      if (mouse.burstStrength > 0.01) mouse.burstStrength *= 0.92;
      else mouse.burstStrength = 0;

      let audio: AudioState | undefined;
      if (analyser) {
        const a = analyser.getAnalysis();
        audio = { ...a };
        meters = {
          bass: a.bassSmooth,
          mids: a.midsSmooth,
          treble: a.trebleSmooth,
          level: a.amplitudeSmooth,
          energy: a.energy,
          flux: a.flux,
          centroid: a.centroid,
          beat: a.beatPulse,
          phase: a.beatPhase,
          onsets: a.onsetCount,
        };
      }

      const elapsed = (performance.now() - start) / 1000;
      const cfg = getShaderConfig(null, active as ShaderPresetId);
      renderer.render(
        gl,
        elapsed,
        mouse,
        cfg,
        canvasEl.width,
        canvasEl.height,
        audio
      );
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (gl && renderer) renderer.destroy(gl);
      analyser?.destroy();
    };
  });

  function onPointer(e: PointerEvent) {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    // Shader convention is y-up; pointer events are y-down.
    mouse.y = 1 - (e.clientY - r.top) / r.height;
    mouse.active = true;
  }

  async function pickAudio(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !audioEl) return;
    audioName = file.name;
    audioEl.src = URL.createObjectURL(file);
    // The analyser must be created from a user gesture, and only once per
    // element — createMediaElementSource throws on a second call. It caches
    // by element internally, so this is safe to call again after a re-pick.
    analyser ??= createAudioAnalyser(audioEl);
    await analyser.resume();
    await audioEl.play();
    playing = true;
  }

  function fmt(v: number) {
    return v.toFixed(2);
  }
</script>

<svelte:head><title>Shader Gallery (dev)</title></svelte:head>

{#if !dev}
  <p class="guard">This page is development-only.</p>
{:else}
  <div class="wrap">
    <canvas
      bind:this={canvasEl}
      onpointermove={onPointer}
      onpointerleave={() => (mouse.active = false)}
      onpointerdown={() => (mouse.burstStrength = 1)}
    ></canvas>

    <div class="bar">
      <span class="status">{status}</span>

      <label class="file">
        {audioName ?? 'Load audio…'}
        <input type="file" accept="audio/*" onchange={pickAudio} />
      </label>

      {#if playing}
        <button
          type="button"
          onclick={() => {
            if (!audioEl) return;
            if (audioEl.paused) void audioEl.play();
            else audioEl.pause();
          }}>play / pause</button
        >
      {/if}

      {#if analyser}
        <span class="meters">
          bass {fmt(meters.bass)} · mids {fmt(meters.mids)} · treble {fmt(
            meters.treble
          )} · energy {fmt(meters.energy)} · flux {fmt(meters.flux)} · centroid
          {fmt(meters.centroid)} · beat {fmt(meters.beat)} · phase {fmt(
            meters.phase
          )} · onsets {meters.onsets}
        </span>
      {/if}
    </div>

    <div class="grid">
      {#each presets as p (p.id)}
        <button
          type="button"
          class:on={active === p.id}
          class:protected={PROTECTED.has(p.id)}
          title={PROTECTED.has(p.id) ? 'protected — not modified' : p.description}
          onclick={() => select(p.id)}
        >
          {p.label}
        </button>
      {/each}
    </div>

    <p class="hint">
      Move the pointer over the canvas to test follow-motion; click for a burst.
      Presets marked with a dot are the three left untouched.
    </p>
  </div>

  <!-- eslint-disable-next-line -->
  <audio bind:this={audioEl} hidden onended={() => (playing = false)}></audio>
{/if}

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  canvas {
    width: 100%;
    height: 60vh;
    display: block;
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    touch-action: none;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .status {
    font-weight: var(--font-semibold);
    min-width: 12ch;
  }

  .meters {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .file {
    cursor: pointer;
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .file input {
    display: none;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: var(--space-2);
  }

  .grid button,
  .bar button {
    padding: var(--space-2);
    font-size: var(--text-xs);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
  }

  .grid button.on {
    border-color: var(--color-primary-500);
    background: var(--color-surface-secondary);
    font-weight: var(--font-semibold);
  }

  .grid button.protected::after {
    content: ' ●';
    color: var(--color-text-muted);
  }

  .hint,
  .guard {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
