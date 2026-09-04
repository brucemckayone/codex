/**
 * Gyroid renderer — Organic gyroid volumetric with space inversion.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * This renderer previously did not accept an `audio` argument at all — the
 * parameter was absent from the signature, so the preset sat inert while music
 * played. It now carries the full audio block.
 *
 * `u_clock` is a monotone accumulator whose **rate** crossfades between
 * wall-clock and the musical clock. Blending the rate rather than the value
 * matters: `u_beatPhase` starts at zero when the analyser is created, so
 * `mix(u_time * k, u_beatPhase, u_audioActive)` would step the clock by however
 * far wall-time had run and snap the structure to a different orientation on
 * the first beat.
 *
 * Mouse rotates the view, damped frame-rate-independently.
 * Click burst creates a brightness pulse + thickness increase.
 * Configurable: scale1, scale2, speed, density, thickness.
 * Uses ACES tonemapping for richer colour (deviation from Reinhard).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { GyroidConfig, ShaderConfig } from '../shader-config';
import { GYROID_FRAG } from '../shaders/gyroid.frag';
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
  'u_scale1',
  'u_scale2',
  'u_density',
  'u_thickness',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type GyroidUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  scale1: 5.23,
  scale2: 10.76,
  speed: 0.2,
  density: 3.5,
  thickness: 0.03,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds). Was `* 0.04` per *frame*, which
 * converges twice as fast at 120Hz as at 60Hz; 0.04/frame at 60fps is a tau of
 * about 0.4s.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Clock units per second at `speed` 1.0.
 *
 * The shader turns `u_clock` into a bounded `driftAxis` rotation rather than a
 * raw angle, so the clock has to run considerably faster than the old
 * `u_time * u_speed` to produce comparable *visible* movement: `driftAxis` has
 * a peak rate of 0.062 per unit t. At the default speed of 0.2 this gives a
 * clock rate of 1.0/s and a peak rotation rate of 1.6 * 0.062 = 0.099 rad/s,
 * against the old constant 0.2 rad/s.
 */
const CLOCK_PER_SPEED = 5.0;

/**
 * Clamp on the differentiated musical clock. `beatPhase` advances at 0.35..1.5
 * per second by design; the clamp guards the single frame where the analyser
 * first appears and the difference against a stale sample is large.
 */
const MAX_BEAT_RATE = 2.0;

export function createGyroidRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<GyroidUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth rotation
  let lerpedMouse = { x: 0.5, y: 0.5 };

  /** Monotone pacing clock — see the file header. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevPhase = -1;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, GYROID_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      clock = 0;
      prevPhase = -1;

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

      const cfg = config as GyroidConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Pacing clock: blend the rate, never the value.
      const restRate = (cfg.speed ?? DEFAULTS.speed) * CLOCK_PER_SPEED;
      const beatRate =
        prevPhase < 0
          ? restRate
          : Math.min(
              MAX_BEAT_RATE,
              Math.max(0, (a.beatPhase - prevPhase) / dt)
            );
      prevPhase = a.beatPhase;
      clock += (restRate + (beatRate - restRate) * a.active) * dt;

      // Frame-rate-independent mouse damping.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);
      gl.uniform1f(uniforms.u_clock, clock);

      // Brand colours left as the configured palette rather than routed
      // through computeImmersiveColours(): this shader derives its whole depth
      // ramp from the three stops, so cycling them fights the depth cue. Audio
      // moves colour here via the u_centroid palette-phase walk instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults — all floats
      gl.uniform1f(uniforms.u_scale1, cfg.scale1 ?? DEFAULTS.scale1);
      gl.uniform1f(uniforms.u_scale2, cfg.scale2 ?? DEFAULTS.scale2);
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(uniforms.u_thickness, cfg.thickness ?? DEFAULTS.thickness);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Vignette reads as a frame around a hero but as a tunnel in fullscreen
      // immersive mode, so it fades along the audio ramp rather than being
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
      lerpedMouse = { x: 0.5, y: 0.5 };
      clock = 0;
      prevPhase = -1;
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
