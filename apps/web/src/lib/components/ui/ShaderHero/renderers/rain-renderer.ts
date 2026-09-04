/**
 * Rain renderer — Raindrops on glass (single-pass).
 *
 * Single-pass: BigWings "Heartfelt" layered-grid technique, no FBOs.
 * Tiled grid drops with SDF bodies + trails + refraction of brand-coloured
 * background through each drop. Mouse creates a wiper effect.
 * Lerped mouse (0.04 rate) for smooth wiper motion.
 * Configurable: density, speed, size, refraction, blur.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { RAIN_FRAG } from '../shaders/rain.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

interface RainCfg {
  density?: number;
  speed?: number;
  size?: number;
  refraction?: number;
  blur?: number;
  intensity?: number;
  grain?: number;
  vignette?: number;
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    bg: [number, number, number];
  };
}

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
  'u_size',
  'u_refraction',
  'u_blur',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type RainUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  density: 0.6,
  speed: 1.0,
  size: 1.0,
  refraction: 0.3,
  blur: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Pacing rate with no audio, in clock-units/sec — matches the old wall-clock feel. */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock. The render loop pauses while the
 * analyser clamps its own dt, so one frame after a long pause can show a large
 * phase jump — unclamped that spikes the rate and lurches the scene once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createRainRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<RainUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  // Internal lerped mouse state for smooth wiper
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, RAIN_FRAG);
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

      const cfg = config as unknown as RainCfg;
      const amp = audio?.amplitude ?? 0;

      // Lerp mouse for smooth wiper
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Integrate the pacing clock by blending RATES, never positions.
      // beatPhase starts at zero while u_time does not, so a positional
      // crossfade sweeps the clock backwards the moment audio starts.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
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

      // Time + resolution + mouse
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Immersive colour cycling when audio is active
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(
        uniforms.u_speed,
        (cfg.speed ?? DEFAULTS.speed) + amp * 0.15
      );
      gl.uniform1f(uniforms.u_size, cfg.size ?? DEFAULTS.size);
      gl.uniform1f(
        uniforms.u_refraction,
        cfg.refraction ?? DEFAULTS.refraction
      );
      gl.uniform1f(uniforms.u_blur, cfg.blur ?? DEFAULTS.blur);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );

      // Draw to screen (no FBO)
      gl.uniform1f(uniforms.u_clock, clock);
      uploadAudioUniforms(gl, uniforms, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      clock = 0;
      prevBeatPhase = -1;
      // No simulation state to reset for single-pass presets.
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
