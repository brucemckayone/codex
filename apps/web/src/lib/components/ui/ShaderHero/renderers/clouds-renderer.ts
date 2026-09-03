/**
 * Clouds renderer — procedural sky with volumetric-looking clouds.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Two-layer FBM: ridged noise for the silhouette, smooth noise for the
 * interior. The pointer shifts the parallax; a click clears the sky near the
 * cursor. Brand colours: primary is the cloud body, secondary the zenith,
 * accent the ridge glow.
 *
 * This preset is a SKY, so `u_bgColor` is as likely to be light as dark. The
 * shader's colour section is written around that (see clouds.frag.ts); this
 * file's only part in it is uploading the palette unmodified.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { CloudsConfig, ShaderConfig } from '../shader-config';
import { CLOUDS_FRAG } from '../shaders/clouds.frag';
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
  'u_cover',
  'u_scale',
  'u_dark',
  'u_light',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type CloudsUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  cover: 0.2,
  speed: 0.03,
  scale: 1.1,
  dark: 0.5,
  light: 0.3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-parallax time constant (seconds), applied to the pointer position
 * and to its active weight.
 *
 * The old renderer uploaded `mouse.active ? 1 : 0` and snapped the position to
 * the centre on the same frame, so the whole sky lurched sideways the instant
 * the pointer crossed the canvas edge. Damping the weight fades the parallax
 * out instead.
 */
const MOUSE_TAU_SEC = 0.5;

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
 * large phase jump. Differentiating that unclamped spikes the rate and blows
 * the whole sky sideways exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createCloudsRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<CloudsUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Damped pointer state — position and active weight.
  let lerpedMouse = { x: 0.5, y: 0.5 };
  let lerpedActive = 0;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated pacing clock. Monotone — see u_clock in clouds.frag.ts. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, CLOUDS_FRAG);
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

      const cfg = config as CloudsConfig;
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
      // u_clock comment in clouds.frag.ts: beatPhase starts at 0 while u_time
      // does not, so crossfading the positions blows the sky backwards the
      // moment playback starts.
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

      // Time + resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      // Pointer state
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, lerpedActive);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the three stops have fixed structural roles
      // here — primary is the cloud body, secondary the zenith, accent the
      // ridge glow — so cycling them swaps the sky and the clouds. Audio moves
      // colour through u_centroid, which warms the zenith instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      gl.uniform1f(uniforms.u_cover, cfg.cover ?? DEFAULTS.cover);
      // No u_speed uniform: speed scales the CPU-integrated clock instead, so
      // the shader never sees it. Uploading a stripped uniform would be a
      // silent no-op and would imply the shader still reads it.
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_dark, cfg.dark ?? DEFAULTS.dark);
      gl.uniform1f(uniforms.u_light, cfg.light ?? DEFAULTS.light);
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
      // it running would resume the sky mid-wind.
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
