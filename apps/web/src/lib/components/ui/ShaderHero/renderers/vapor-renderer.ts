/**
 * Vapor renderer — Volumetric dot noise clouds with ACES tonemapping.
 *
 * ## Reference implementation
 *
 * This is the worked example for wiring a single-pass preset into the shared
 * audio substrate. The pattern is four lines of integration:
 *
 *  1. Spread `AUDIO_UNIFORM_NAMES` into `UNIFORM_NAMES`.
 *  2. Hold one `createAudioFade()` and one `createDeltaClock()` per renderer.
 *  3. Resolve once per frame: `const a = audioFade.update(audio, dt)`.
 *  4. `uploadAudioUniforms(gl, uniforms, a)` after `gl.useProgram`.
 *
 * Nothing else is required. In particular there are **no new config keys** —
 * audio is runtime state, not brand configuration, so `shader-config.ts`,
 * `css-injection.ts` and the brand editor are untouched.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse shifts camera viewing angle, damped frame-rate-independently.
 * Click creates a brightness pulse. Brand colours map to depth:
 * primary near, secondary mid, accent far.
 * Configurable: density, speed, scale, warmth, glow.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, VaporConfig } from '../shader-config';
import { VAPOR_FRAG } from '../shaders/vapor.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_density',
  'u_speed',
  'u_scale',
  'u_warmth',
  'u_glow',
  'u_intensity',
  'u_grain',
  'u_vignette',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type VaporUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  density: 1.0,
  speed: 1.5,
  scale: 5.0,
  warmth: 0.5,
  glow: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds) — how long the view takes to mostly
 * reach the pointer.
 *
 * This was `lerped += (target - lerped) * 0.04` applied per *frame*, which
 * converges twice as fast on a 120Hz display as on 60Hz. `ShaderHero.svelte`
 * documents fixing exactly that bug for `burstStrength`, but the fix never
 * reached the renderers. Expressed as a tau and driven by dt, the feel is now
 * identical at any refresh rate. 0.04/frame at 60fps ≈ tau of 0.4s.
 */
const MOUSE_TAU_SEC = 0.4;

export function createVaporRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<VaporUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth camera movement
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, VAPOR_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      // Reset lerped mouse to center
      lerpedMouse = { x: 0.5, y: 0.5 };

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

      const cfg = config as VaporConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent mouse damping.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time & resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);

      // Burst strength (click brightness pulse)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors. Left as the configured palette rather than routed
      // through computeImmersiveColours(): this shader already derives its
      // whole depth ramp from the three brand stops, so cycling them fights
      // the depth cue. Audio moves colour here via u_centroid warmth instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // All float uniforms — no int uniforms in this preset
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_warmth, cfg.warmth ?? DEFAULTS.warmth);
      gl.uniform1f(uniforms.u_glow, cfg.glow ?? DEFAULTS.glow);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Vignette reads as a frame around a hero, but as a tunnel in fullscreen
      // immersive mode — so it fades out with the audio ramp rather than being
      // switched off, which would pop on the first beat.
      gl.uniform1f(
        uniforms.u_vignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );

      uploadAudioUniforms(gl, uniforms, a);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // Reset lerped mouse to center for smooth restart.
      lerpedMouse = { x: 0.5, y: 0.5 };
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
