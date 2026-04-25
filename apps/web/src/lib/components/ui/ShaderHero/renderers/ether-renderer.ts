/**
 * Ether renderer — Raymarched volumetric light (nimitz 2014).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse parallax shifts the view origin, lerped smoothly (0.04 rate).
 * Configurable: rotationSpeed, complexity (3-8 steps), glow, scale, zoom.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 *
 * Audio-reactive immersive mode follows the pattern established by ripple, but
 * adapted for a single-pass raymarched shader — there is no simulation FBO to
 * inject impulses into. Instead:
 *   - A "wanderer" virtual light focal point follows a noise-perturbed
 *     Lissajous path. Passed to the shader as a uniform and used to bias the
 *     raymarch origin (so the volumetric structure drifts with it) AND to
 *     seed an additive radial glow term.
 *   - `bassSmooth` drives a slow global glow lift + shader-side UV-breath
 *     warping inside the raymarch loop (sub-sonic pressure).
 *   - `midsSmooth` sparkles on the shader's highlight term.
 *   - `trebleSmooth` amplifies aberration and the bloom/highlight boost.
 *   - `amplitudeSmooth` lifts the saturation pump (pre-ACES) + base brightness.
 *   - `beatPulse` adds a short-lived overall brightness splash on onsets.
 *   - `wandererFade` eases 0→1 on audio start, 1→0 on pause — gates all
 *     audio-reactive boosts so the scene doesn't pop.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { EtherConfig, ShaderConfig } from '../shader-config';
import { ETHER_FRAG } from '../shaders/ether.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ── Wanderer tunables (mirror ripple-renderer.ts) ──────────────
/** Wanderer path base frequencies — irrational ratio, never exactly repeats. */
const WANDERER_FREQ_X = 0.13;
const WANDERER_FREQ_Y = 0.19;
/** Slow phase-drift rates — reshape the Lissajous curve over ~minute timescales. */
const WANDERER_DRIFT_RATE_X = 0.017;
const WANDERER_DRIFT_RATE_Y = 0.023;
/** Base path radius (fraction of canvas half-width). Audio amplitude expands this. */
const WANDERER_BASE_RADIUS = 0.14;
const WANDERER_RADIUS_GAIN = 0.05;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5; // higher = faster fade-in/out (units per second)

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_rotSpeed',
  'u_complexity',
  'u_glow',
  'u_scale',
  'u_zoom',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_aberration',
  // Audio-reactive uniforms
  'u_wanderer',
  'u_bassSmooth',
  'u_midsSmooth',
  'u_trebleSmooth',
  'u_amplitudeSmooth',
  'u_beatPulse',
  'u_audioActive',
] as const;

type EtherUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the prototype. */
const DEFAULTS = {
  rotSpeed: 0.4,
  complexity: 6,
  glow: 0.5,
  scale: 2.0,
  zoom: 5.0,
  intensity: 0.4,
  grain: 0.02,
  vignette: 0.2,
  aberration: 0.003,
} as const;

export function createEtherRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<EtherUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth parallax
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  /** Last render time — used for frame-rate-independent fades. */
  let lastRenderTime = 0;

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Gates all audio-reactive visual boosts so the shader doesn't pop.
   */
  let wandererFade = 0;

  /**
   * Wanderer position — noise-perturbed Lissajous. Smooth everywhere, never
   * exactly repeats. The inner sin(drift) term reshapes the curve slowly so
   * consecutive orbits don't trace the same path. Returns 0..1 UV space.
   */
  function wandererPosition(
    time: number,
    amplitudeSmooth: number
  ): { x: number; y: number } {
    const radius =
      WANDERER_BASE_RADIUS + WANDERER_RADIUS_GAIN * amplitudeSmooth;
    const driftX = Math.sin(time * WANDERER_DRIFT_RATE_X) * 2.0;
    const driftY = Math.sin(time * WANDERER_DRIFT_RATE_Y + 1.3) * 1.7;
    const x = 0.5 + radius * Math.sin(time * WANDERER_FREQ_X + driftX);
    const y = 0.5 + radius * Math.cos(time * WANDERER_FREQ_Y + driftY);
    return { x, y };
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, ETHER_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      // Reset lerped mouse to center
      lerpedMouse = { x: 0.5, y: 0.5 };
      lastRenderTime = 0;
      wandererFade = 0;

      return true;
    },

    render(
      gl: WebGL2RenderingContext,
      time: number,
      mouse: MouseState,
      config: ShaderConfig,
      width: number,
      height: number,
      audio?: AudioState
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as EtherConfig;
      const bassSmooth = audio?.bassSmooth ?? 0;
      const midsSmooth = audio?.midsSmooth ?? 0;
      const trebleSmooth = audio?.trebleSmooth ?? 0;
      const amplitudeSmooth = audio?.amplitudeSmooth ?? 0;
      const beatPulse = audio?.beatPulse ?? 0;
      const audioActive = audio?.active ?? false;

      // Frame-rate-independent dt — used for the wanderer fade.
      const dt =
        lastRenderTime === 0 ? 1 / 60 : Math.min(0.1, time - lastRenderTime);
      lastRenderTime = time;

      // Ease wanderer fade toward 1 (audio playing) or 0 (paused).
      const fadeTarget = audioActive ? 1 : 0;
      wandererFade +=
        (fadeTarget - wandererFade) * Math.min(1, dt * WANDERER_FADE_RATE);

      // Lerp mouse for smooth parallax
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      // Wanderer position (UV 0..1) — feeds both focal-point shift and
      // additive glow in the shader.
      const wanderer = wandererPosition(time, amplitudeSmooth);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);

      // Immersive colour cycling when audio is active — smoothed amplitude
      // so palette phase doesn't jitter.
      const colours = audioActive
        ? computeImmersiveColours(time, cfg.colors, amplitudeSmooth)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config. Rotation speed drifts very gently with
      // smoothed amplitude (not raw) so loud passages feel more alive without
      // jitter on transients.
      gl.uniform1f(
        uniforms.u_rotSpeed,
        (cfg.rotationSpeed ?? DEFAULTS.rotSpeed) + amplitudeSmooth * 0.12
      );
      gl.uniform1i(
        uniforms.u_complexity,
        cfg.complexity ?? DEFAULTS.complexity
      );
      // Glow lifts visibly with smoothed bass — deeper low-frequency presence.
      // Expanded from the old raw `bass * 0.1` to a larger envelope on
      // bassSmooth, gated by the wanderer fade.
      gl.uniform1f(
        uniforms.u_glow,
        (cfg.glow ?? DEFAULTS.glow) * (1.0 + bassSmooth * 0.45 * wandererFade)
      );
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audioActive ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      // Treble pushes aberration up — keeps the baseline tunable value but
      // adds edge colour fringing on bright high-frequency passages.
      gl.uniform1f(
        uniforms.u_aberration,
        (cfg.aberration ?? DEFAULTS.aberration) *
          (1.0 + trebleSmooth * 1.5 * wandererFade)
      );

      // Audio-reactive uniforms
      gl.uniform2f(uniforms.u_wanderer, wanderer.x, wanderer.y);
      gl.uniform1f(uniforms.u_bassSmooth, bassSmooth);
      gl.uniform1f(uniforms.u_midsSmooth, midsSmooth);
      gl.uniform1f(uniforms.u_trebleSmooth, trebleSmooth);
      gl.uniform1f(uniforms.u_amplitudeSmooth, amplitudeSmooth);
      gl.uniform1f(uniforms.u_beatPulse, beatPulse);
      gl.uniform1f(uniforms.u_audioActive, wandererFade);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // No simulation state to reset for single-pass presets.
      lerpedMouse = { x: 0.5, y: 0.5 };
      lastRenderTime = 0;
      wandererFade = 0;
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (program) {
        gl.deleteProgram(program);
        program = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      uniforms = null;
    },
  };
}
