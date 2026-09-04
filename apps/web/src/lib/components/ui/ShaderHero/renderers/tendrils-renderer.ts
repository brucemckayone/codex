/**
 * Tendrils (Curl Noise Tendrils) renderer — single-pass, no FBOs.
 *
 * Curl-noise advected UV with density accumulation along the advected path.
 * The divergence-free flow gives smooth, non-intersecting filaments; the
 * pointer adds a vortex, and a click flashes density at the cursor.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_steps` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TendrilsConfig } from '../shader-config';
import { TENDRILS_FRAG } from '../shaders/tendrils.frag';
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
  'u_scale',
  'u_steps',
  'u_curl',
  'u_fade',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type TendrilsUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  scale: 2.5,
  speed: 0.12,
  steps: 5,
  curl: 1.0,
  fade: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-follow time constant (seconds) for the vortex centre.
 *
 * This was `lerped += (target - lerped) * 0.04` applied per *frame*, so the
 * vortex chased the pointer twice as fast on a 120Hz display as on 60Hz.
 * 0.04/frame at 60fps is a tau of about 0.4s.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle pacing rate, in clock-units per second.
 *
 * 1.0 so that, with the speed setting applied to the integration rate, the
 * clock equals `u_time * speed` at idle and the silent look is unchanged from
 * before this integration existed.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing, so one frame after a long pause can show a
 * large phase jump. Differentiating that unclamped spikes the rate and snaps
 * the flow exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createTendrilsRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TendrilsUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped pointer state for a smooth vortex.
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated pacing clock. Monotone — see u_clock in tendrils.frag.ts. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, TENDRILS_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
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

      const cfg = config as TendrilsConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      // Integrate the pacing clock by blending RATES, never positions. See the
      // u_clock comment in tendrils.frag.ts: beatPhase starts at 0 while
      // u_time does not, so crossfading the positions sweeps the clock
      // backwards the moment playback starts and the flow reverses.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        // The first audio frame has no previous sample to difference against.
        musicalRate =
          prevBeatPhase < 0
            ? IDLE_CLOCK_RATE
            : Math.min(
                MAX_CLOCK_RATE,
                Math.max(0, (a.beatPhase - prevBeatPhase) / dt)
              );
        prevBeatPhase = a.beatPhase;
      } else {
        prevBeatPhase = -1;
      }
      const rate = IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active;
      clock += dt * rate * (cfg.speed ?? DEFAULTS.speed);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the five-stop density ramp is built from
      // these stops, so cycling them fights the density cue. Audio moves
      // colour through u_centroid, which slides the ramp position instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      // No u_speed uniform: speed scales the CPU-integrated clock instead, so
      // the shader never sees it. Uploading a stripped uniform would be a
      // silent no-op and would imply the shader still reads it.
      // CRITICAL: u_steps is int — use uniform1i, NOT uniform1f
      gl.uniform1i(uniforms.u_steps, Math.round(cfg.steps ?? DEFAULTS.steps));
      gl.uniform1f(uniforms.u_curl, cfg.curl ?? DEFAULTS.curl);
      gl.uniform1f(uniforms.u_fade, cfg.fade ?? DEFAULTS.fade);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_clock, clock);
      // Vignette reads as a frame around a hero but as a tunnel in fullscreen
      // immersive mode, so it fades with the audio ramp. Switching it off on
      // `audio.active` (the old behaviour) popped on the first beat.
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
      // Rewind the integrated clock: reset() means "start fresh", and leaving
      // it running would resume the flow mid-advection.
      clock = 0;
      prevBeatPhase = -1;
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
