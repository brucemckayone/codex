/**
 * Flux renderer — magnetic field lines around a set of poles.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * The pointer acts as a movable pole — positive on hover, flipping polarity
 * on click through the burst ramp.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_poles` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { FluxConfig, ShaderConfig } from '../shader-config';
import { FLUX_FRAG } from '../shaders/flux.frag';
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
  'u_mouseActive',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_poles',
  'u_lineDensity',
  'u_lineWidth',
  'u_strength',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type FluxUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching shader-config.ts. */
const DEFAULTS = {
  poles: 3,
  lineDensity: 10.0,
  lineWidth: 1.0,
  strength: 1.5,
  speed: 0.1,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-pole time constant (seconds), applied to the pointer position and to
 * its active weight.
 *
 * The old renderer uploaded `mouse.active ? 1 : 0` and snapped the position to
 * the centre on the same frame. A pole appearing or vanishing instantly
 * reconfigures the entire field in one frame — the single most jarring motion
 * this preset had, and it fired every time the pointer crossed the canvas
 * edge. Damping the weight fades the pole in and out instead.
 */
const MOUSE_TAU_SEC = 0.35;

/**
 * Idle pacing rate, in clock-units per second.
 *
 * 1.0 so that, with the speed setting applied to the integration rate, the
 * clock equals `u_time * speed` at idle and the poles wander at the pace the
 * old orbit had.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing, so one frame after a long pause can show a
 * large phase jump. Differentiating that unclamped spikes the rate and darts
 * every pole exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createFluxRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<FluxUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Damped pointer state — position and active weight.
  let lerpedMouse = { x: 0.5, y: 0.5 };
  let lerpedActive = 0;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated pacing clock. Monotone — see u_clock in flux.frag.ts. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, FLUX_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      lerpedActive = 0;

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

      const cfg = config as FluxConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping, position and weight together.
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;
      lerpedActive += ((mouse.active ? 1 : 0) - lerpedActive) * k;

      // Integrate the pacing clock by blending RATES, never positions. See the
      // u_clock comment in flux.frag.ts: beatPhase starts at 0 while u_time
      // does not, so crossfading the positions rewinds every pole along its
      // path the moment playback starts.
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
      gl.uniform1f(uniforms.u_mouseActive, lerpedActive);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the four-stop ramp encodes field magnitude,
      // so cycling the stops fights the structural cue they exist to give.
      // Audio moves colour through u_centroid, which slides the ramp position.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      gl.uniform1i(uniforms.u_poles, cfg.poles ?? DEFAULTS.poles);
      gl.uniform1f(
        uniforms.u_lineDensity,
        cfg.lineDensity ?? DEFAULTS.lineDensity
      );
      gl.uniform1f(uniforms.u_lineWidth, cfg.lineWidth ?? DEFAULTS.lineWidth);
      gl.uniform1f(uniforms.u_strength, cfg.strength ?? DEFAULTS.strength);
      // No u_speed uniform: speed scales the CPU-integrated clock instead, so
      // the shader never sees it. Uploading a stripped uniform would be a
      // silent no-op and would imply the shader still reads it.
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
      lerpedActive = 0;
      // Rewind the integrated clock: reset() means "start fresh", and leaving
      // it running would resume the poles mid-wander.
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
