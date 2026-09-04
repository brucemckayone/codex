/**
 * Julia renderer — Animated Julia set fractal with cosine palette.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## The pacing clock
 *
 * The shader's `c` orbit used to be driven by `u_time * u_speed`, and the
 * renderer added `amplitude * 0.15` to the speed and `bass * 0.05` to the zoom
 * — raw, per-frame band values on a rate and on geometry, which reads as
 * jitter rather than music.
 *
 * `u_clock` is now a monotone accumulator whose **rate** crossfades between
 * wall-clock and the musical clock. Blending the rate rather than the value
 * matters: `u_beatPhase` starts at zero when the analyser is created, so
 * `mix(u_time * k, u_beatPhase, u_audioActive)` would step the clock by however
 * far wall-time had run and snap the fractal to a different shape on the first
 * beat. Rates cannot do that.
 *
 * Mouse shifts `c` directly for fractal exploration, damped
 * frame-rate-independently. Click kicks `c` outward along its own radius.
 * Configurable: zoom, speed, iterations (int), radius, saturation.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { JuliaConfig, ShaderConfig } from '../shader-config';
import { JULIA_FRAG } from '../shaders/julia.frag';
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
  'u_zoom',
  'u_iterations',
  'u_radius',
  'u_saturation',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type JuliaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  zoom: 1.3,
  speed: 0.33,
  iterations: 75,
  radius: 0.79,
  saturation: 0.5,
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
 * Clamp on the differentiated musical clock. `beatPhase` advances at 0.35..1.5
 * per second by design; the clamp guards the single frame where the analyser
 * first appears and the difference against a stale sample is large.
 */
const MAX_BEAT_RATE = 2.0;

export function createJuliaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<JuliaUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth c exploration
  let lerpedMouse = { x: 0.5, y: 0.5 };

  /** Monotone pacing clock — see the file header. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevPhase = -1;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, JULIA_FRAG);
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

      const cfg = config as JuliaConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Pacing clock: blend the rate, never the value.
      const restRate = cfg.speed ?? DEFAULTS.speed;
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
      gl.uniform1f(uniforms.u_clock, clock);

      // Burst strength (radial c kick + brightness pulse)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours left as the configured palette rather than routed
      // through computeImmersiveColours(): the cosine-palette vectors are built
      // from all four stops, so cycling them shifts pa/pb/pd together and the
      // fractal's colour structure smears. Audio moves colour here via the
      // u_centroid hue walk and the u_treble banding term instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Zoom is the static configured value — the audio breath on it lives in
      // the shader, gated on the slow u_energy envelope. It used to get raw
      // per-frame `bass` here, which read as a shudder.
      gl.uniform1f(uniforms.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      // CRITICAL: u_iterations is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_iterations,
        Math.round(cfg.iterations ?? DEFAULTS.iterations)
      );
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(
        uniforms.u_saturation,
        cfg.saturation ?? DEFAULTS.saturation
      );
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
