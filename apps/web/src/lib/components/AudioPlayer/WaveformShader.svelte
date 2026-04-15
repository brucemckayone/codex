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
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import {
    compileShader,
    createProgram,
    createQuad,
    drawQuad,
    getUniforms,
  } from '$lib/components/ui/ShaderHero/webgl-utils';
  import type { AudioAnalysis } from './audio-analyser';

  interface Props {
    audioAnalysis?: AudioAnalysis | null;
    poster?: string | null;
    children?: Snippet;
  }

  const { audioAnalysis = null, poster = null, children }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();

  // ── Shader source ──

  const VERT = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0, 1);
    }
  `;

  // Flowing organic noise — simplex-like via value noise with smooth interpolation
  const FRAG = `#version 300 es
    precision mediump float;
    in vec2 v_uv;
    out vec4 fragColor;

    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform float u_amplitude;
    uniform float u_speed;

    // Simple hash-based noise
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f); // smoothstep

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float val = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 4; i++) {
        val += amp * noise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
      }
      return val;
    }

    void main() {
      vec2 uv = v_uv;
      float t = u_time * u_speed;

      // Flowing displacement
      float n1 = fbm(uv * 3.0 + vec2(t * 0.3, t * 0.2));
      float n2 = fbm(uv * 2.0 + vec2(-t * 0.2, t * 0.15) + n1 * 0.5);

      // Mix brand colours based on noise
      float blend = smoothstep(0.3, 0.7, n2);
      vec3 col = mix(u_color1, u_color2, blend);

      // Subtle brightness variation
      float brightness = 0.15 + n1 * 0.1 + u_amplitude * 0.08;

      // Vignette — darker at edges
      float vig = 1.0 - length((uv - 0.5) * vec2(1.8, 1.2)) * 0.5;
      vig = clamp(vig, 0.0, 1.0);

      fragColor = vec4(col * brightness * vig, 0.85);
    }
  `;

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
  let reducedMotion = false;

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

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    readBrandColours();

    if (reducedMotion || !initGL()) return;

    startTime = performance.now();
    resize();
    rafId = requestAnimationFrame(render);

    const observer = new ResizeObserver(() => {
      readBrandColours();
      resize();
    });
    if (containerEl) observer.observe(containerEl);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      if (gl && program) {
        gl.deleteProgram(program);
      }
    };
  });
</script>

<div
  class="waveform-shader"
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

  /* Blurred cover art — deepest layer */
  .waveform-shader__art {
    position: absolute;
    inset: -20px; /* extend beyond container to hide blur edges */
    background-image: var(--poster-url);
    background-size: cover;
    background-position: center;
    filter: blur(40px) brightness(0.3) saturate(1.2);
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
</style>
