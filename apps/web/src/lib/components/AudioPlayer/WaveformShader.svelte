<!--
  @component WaveformShader

  Lightweight WebGL2 shader background for the audio player waveform.
  Renders flowing organic noise (simplex-based) in the org's brand colours.
  Subtly alive at all times; audio-reactive when playing.

  Layer stack: [blurred cover art CSS] → [this shader canvas] → [waveform canvas]

  @prop {AudioAnalysis | null} audioAnalysis - Frequency data for reactivity
  @prop {string | null} poster - Cover art URL for blurred background
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import {
    createProgram,
    createQuad,
    drawQuad,
    getUniforms,
  } from '$lib/components/ui/ShaderHero/webgl-utils';
  import { WAVEFORM_FLOW_VERT } from '$lib/components/ui/ShaderHero/shaders/waveform-flow.vert';
  import { WAVEFORM_FLOW_FRAG } from '$lib/components/ui/ShaderHero/shaders/waveform-flow.frag';
  import type { AudioAnalysis } from './audio-analyser';

  interface Props {
    audioAnalysis?: AudioAnalysis | null;
    poster?: string | null;
    children?: Snippet;
    /** Forward additional class onto the root wrapper. R13 composition seam. */
    class?: string;
  }

  const {
    audioAnalysis = null,
    poster = null,
    children,
    class: className,
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();

  // ── Shader source (extracted to shaders/waveform-flow.*.ts per /shader-preset-pipeline) ──
  const VERT = WAVEFORM_FLOW_VERT;
  const FRAG = WAVEFORM_FLOW_FRAG;

  const UNIFORM_NAMES = [
    'u_time',
    'u_resolution',
    'u_color1',
    'u_color2',
    'u_amplitude',
    'u_speed',
  ] as const;

  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;
  let rafId = 0;
  let startTime = 0;
  // Reactive reduced-motion (Ref 05 §Media §8). Mid-session toggles pause/resume
  // the rAF render without remount. CSS block below is the belt-and-braces layer
  // so the canvas hides visually too (Codex-8bhqd).
  let reducedMotion = $state(false);
  let reducedMotionMq: MediaQueryList | null = null;
  function onReducedMotionChange(e: MediaQueryListEvent) {
    reducedMotion = e.matches;
  }

  // Smoothed amplitude for organic feel
  let smoothAmp = 0;

  // ── Read brand colours from CSS ──
  let color1: [number, number, number] = [0.76, 0.25, 0.16]; // fallback terracotta
  let color2: [number, number, number] = [0.3, 0.33, 0.39]; // fallback secondary

  function readBrandColours() {
    if (!containerEl) return;
    const s = getComputedStyle(containerEl);
    const primary = s.getPropertyValue('--color-brand-primary').trim() || s.getPropertyValue('--color-primary-500').trim();
    const secondary = s.getPropertyValue('--color-brand-secondary').trim() || s.getPropertyValue('--color-neutral-600').trim();
    if (primary) color1 = hexToGl(primary);
    if (secondary) color2 = hexToGl(secondary);
  }

  function hexToGl(hex: string): [number, number, number] {
    if (!hex.startsWith('#')) return [0.5, 0.5, 0.5];
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }

  function initGL() {
    if (!canvasEl) return false;
    gl = canvasEl.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) return false;

    program = createProgram(gl, VERT, FRAG);
    if (!program) return false;

    uniforms = getUniforms(gl, program, UNIFORM_NAMES);
    quad = createQuad(gl);
    return true;
  }

  function resize() {
    if (!gl || !canvasEl || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x for perf
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    gl.viewport(0, 0, canvasEl.width, canvasEl.height);
  }

  function render() {
    if (!gl || !program || !uniforms || !quad) return;

    // Smooth the amplitude
    const targetAmp = audioAnalysis?.active ? (audioAnalysis.amplitude ?? 0) : 0;
    smoothAmp += (targetAmp - smoothAmp) * 0.1;

    const t = (performance.now() - startTime) / 1000;

    gl.useProgram(program);
    quad.bind(program);

    gl.uniform1f(uniforms.u_time, t);
    gl.uniform2f(uniforms.u_resolution, canvasEl!.width, canvasEl!.height);
    gl.uniform3f(uniforms.u_color1, ...color1);
    gl.uniform3f(uniforms.u_color2, ...color2);
    gl.uniform1f(uniforms.u_amplitude, smoothAmp);
    gl.uniform1f(uniforms.u_speed, 0.3 + smoothAmp * 0.2);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    drawQuad(gl);

    rafId = requestAnimationFrame(render);
  }

  let observer: ResizeObserver | null = null;
  let glInitialised = false;

  function stopRender() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function startRender() {
    if (rafId || reducedMotion) return;
    rafId = requestAnimationFrame(render);
  }

  onMount(() => {
    reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = reducedMotionMq.matches;
    reducedMotionMq.addEventListener('change', onReducedMotionChange);

    readBrandColours();

    // Init GL even when reduced-motion is on — the static frame isn't drawn but
    // the resources are ready to go if the user flips the setting.
    glInitialised = initGL();
    if (!glInitialised) return;

    startTime = performance.now();
    resize();

    if (!reducedMotion) startRender();

    observer = new ResizeObserver(() => {
      readBrandColours();
      resize();
    });
    if (containerEl) observer.observe(containerEl);
  });

  // Reactive: pause on reduced-motion, resume when it clears.
  $effect(() => {
    if (reducedMotion) {
      stopRender();
    } else if (glInitialised) {
      startRender();
    }
  });

  onDestroy(() => {
    stopRender();
    observer?.disconnect();
    observer = null;
    reducedMotionMq?.removeEventListener('change', onReducedMotionChange);
    reducedMotionMq = null;
    if (gl && program) {
      gl.deleteProgram(program);
    }
  });
</script>

<div
  class="waveform-shader {className ?? ''}"
  bind:this={containerEl}
  style:--poster-url={poster ? `url(${poster})` : 'none'}
>
  <div class="waveform-shader__art"></div>
  <canvas class="waveform-shader__canvas" bind:this={canvasEl}></canvas>
  <div class="waveform-shader__content">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>

<style>
  .waveform-shader {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-neutral-900);
  }

  /* Blurred cover art — deepest layer. Negative inset extends slightly beyond
     the container so the blur's soft edge is clipped by overflow: hidden rather
     than visible against the background. --space-5 (20px) matches the original
     inset exactly. Blur uses calc(var(--blur-xl) * 2) to preserve the 40px
     radius — the materials palette has --blur-xl (20px) and --blur-2xl (60px)
     but nothing at 40px. */
  .waveform-shader__art {
    position: absolute;
    inset: calc(-1 * var(--space-5));
    background-image: var(--poster-url);
    background-size: cover;
    background-position: center;
    filter: blur(calc(var(--blur-xl) * 2)) brightness(0.3) saturate(1.2);
    z-index: 0;
  }

  /* WebGL shader canvas — middle layer */
  .waveform-shader__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  /* Content overlay (waveform + controls) — top layer */
  .waveform-shader__content {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
  }

  /* Belt-and-braces reduced-motion (Codex-8bhqd).
     The JS subscription in the script halts the rAF loop; these rules remove
     the canvas entirely and freeze the blur filter so nothing shimmers even
     on the last painted frame. Ref 05 §Media §8. */
  @media (prefers-reduced-motion: reduce) {
    .waveform-shader__canvas {
      display: none;
    }
    .waveform-shader__art {
      filter: none;
    }
  }
</style>
