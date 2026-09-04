/**
 * Aurora (Aurora Borealis) renderer — single-pass, no FBOs.
 *
 * Layered curtains of light whose silhouette is the effect. There is no
 * camera: all motion is internal flow or pointer follow.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_layers` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { AuroraConfig, ShaderConfig } from '../shader-config';
import { AURORA_FRAG } from '../shaders/aurora.frag';
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
  'u_layers',
  'u_speed',
  'u_height',
  'u_spread',
  'u_shimmer',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type AuroraUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  layers: 5,
  speed: 0.1,
  height: 0.4,
  spread: 0.25,
  shimmer: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-follow time constant (seconds), applied to BOTH the pointer position
 * and its active weight.
 *
 * The old renderer uploaded `mouse.active ? 1 : 0` and snapped the position to
 * the centre on the same frame, so the pointer leaving the canvas moved every
 * band centre by up to 0.15 in uv-y instantly — a visible jolt in the one
 * motion the viewer causes directly. Damping the weight as well as the
 * position means the aurora settles back rather than jumping.
 */
const MOUSE_TAU_SEC = 0.45;

/**
 * Idle pacing rate, in clock-units per second.
 *
 * 1.0 because `u_clock` is NOT scaled by the speed setting for this preset
 * (see the u_clock comment in aurora.frag.ts): at idle the clock therefore
 * equals `u_time`, and the silent look is unchanged from before.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing, so one frame after a long pause can show a
 * large phase jump. Differentiating that unclamped spikes the rate and jerks
 * the curtains exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createAuroraRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<AuroraUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Damped pointer state — position and active weight.
  let lerpedMouse = { x: 0.5, y: 0.5 };
  let lerpedActive = 0;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated pacing clock. Monotone — see u_clock in aurora.frag.ts. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, AURORA_FRAG);
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

      const cfg = config as AuroraConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping.
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;
      lerpedActive += ((mouse.active ? 1 : 0) - lerpedActive) * k;

      // Integrate the pacing clock by blending RATES, never positions. See the
      // u_clock comment in aurora.frag.ts: beatPhase starts at 0 while u_time
      // does not, so crossfading the two positions sweeps the clock backwards
      // the moment playback starts.
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
      clock +=
        dt * (IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, lerpedActive);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the three stops are this preset's
      // elevation ramp, so cycling them fights the parallax cue they exist to
      // give. Audio moves colour through u_centroid, which slides the ramp
      // position and leaves every stop recognisable.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // CRITICAL: u_layers is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_layers,
        Math.round(cfg.layers ?? DEFAULTS.layers)
      );
      // Speed still means "how fast the curtains travel sideways", exactly as
      // before. It is NOT folded into u_clock: at the default of 0.1 that
      // would have slowed the flame and fringe shimmer tenfold.
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(uniforms.u_spread, cfg.spread ?? DEFAULTS.spread);
      gl.uniform1f(uniforms.u_shimmer, cfg.shimmer ?? DEFAULTS.shimmer);
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

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      /* Single-pass: no FBOs to resize */
    },

    reset(_gl: WebGL2RenderingContext): void {
      lerpedMouse = { x: 0.5, y: 0.5 };
      lerpedActive = 0;
      // Rewind the integrated clock: reset() means "start fresh", and leaving
      // it running would resume the curtains mid-travel.
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
