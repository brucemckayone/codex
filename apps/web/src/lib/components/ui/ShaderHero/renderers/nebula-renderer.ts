/**
 * Nebula renderer — layered volumetric cosmic dust clouds with a star field.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Brand stops map to depth (primary near, secondary mid, accent far), the
 * pointer drives stellar wind, and a click flashes a star at the cursor.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_depth` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { NebulaConfig, ShaderConfig } from '../shader-config';
import { NEBULA_FRAG } from '../shaders/nebula.frag';
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
  'u_scale',
  'u_depth',
  'u_wind',
  'u_stars',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type NebulaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  density: 0.8,
  speed: 0.12,
  scale: 2.0,
  depth: 8,
  wind: 0.5,
  stars: 0.3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds).
 *
 * This was `lerped += (target - lerped) * 0.04` applied per *frame*, which
 * converges twice as fast on a 120Hz display as on 60Hz — the pointer felt
 * different depending on the monitor. 0.04/frame at 60fps is a tau of ~0.4s.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle pacing rate, in clock-units per second, used when nothing is playing.
 *
 * Deliberately 1.0: the clock is multiplied by the preset's speed setting when
 * integrated, so at idle `u_clock` equals `u_time * speed` exactly and the
 * silent look is unchanged from before this integration existed.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but it is sampled
 * from a render loop that pauses (hidden tab, preset switch, reduced motion)
 * while the analyser clamps its own dt rather than freezing. One frame after a
 * long pause can therefore show a large phase jump, and differentiating that
 * unclamped would spike the rate and jerk the whole stack exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createNebulaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<NebulaUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth stellar wind.
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated pacing clock. Monotone — see u_clock in nebula.frag.ts. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, NEBULA_FRAG);
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

      const cfg = config as NebulaConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent mouse damping.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      // Integrate the pacing clock by blending RATES, never positions. See the
      // u_clock comment in nebula.frag.ts for why crossfading the positions is
      // wrong: beatPhase starts at 0 while u_time does not, so a positional
      // mix sweeps the clock backwards the moment playback starts.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        // The first audio frame has no previous sample to difference against;
        // fall back to the idle rate for that one frame rather than treating
        // the whole accumulated phase as a single frame's advance.
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

      // Burst strength (click star flash)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours are uploaded as configured rather than routed through
      // computeImmersiveColours(): the three stops ARE this preset's depth
      // ramp, so cycling them fights the depth cue the ramp exists to give.
      // Audio moves colour through u_centroid instead, which slides the ramp
      // position and leaves every stop recognisable.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      // No u_speed uniform: speed scales the CPU-integrated clock instead, so
      // the shader never sees it. Uploading a stripped uniform would be a
      // silent no-op and would imply the shader still reads it.
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1i(uniforms.u_depth, Math.round(cfg.depth ?? DEFAULTS.depth));
      gl.uniform1f(uniforms.u_wind, cfg.wind ?? DEFAULTS.wind);
      gl.uniform1f(uniforms.u_stars, cfg.stars ?? DEFAULTS.stars);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_clock, clock);
      // Vignette reads as a frame around a hero but as a tunnel in fullscreen
      // immersive mode, so it fades out with the audio ramp. Switching it off
      // on `audio.active` (the old behaviour) popped on the first beat.
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
      // Rewind the integrated clock: reset() means "start this preset fresh",
      // and leaving it running would resume the dust mid-drift at whatever
      // position the previous session reached.
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
