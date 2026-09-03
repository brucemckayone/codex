/**
 * Lava renderer — Molten Voronoi crust with glowing cracks.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: lerped smoothly (0.04 rate) for organic feel.
 * Mouse hover widens cracks + increases glow. Click erupts accent.
 *
 * Configurable: crackScale, crackWidth, glow, speed, crust, heat.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { LavaConfig, ShaderConfig } from '../shader-config';
import { LAVA_FRAG } from '../shaders/lava.frag';
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
  'u_crackScale',
  'u_crackWidth',
  'u_glow',
  'u_clock',
  'u_crust',
  'u_heat',
  'u_intensity',
  'u_grain',
  'u_vignette',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type LavaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching shader-config.ts. */
const DEFAULTS = {
  crackScale: 4.0,
  crackWidth: 0.04,
  glow: 1.5,
  speed: 0.08,
  crust: 0.6,
  heat: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Pacing rate with no audio, in clock-units/sec — matches the old u_time * u_speed. */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock. The render loop pauses (hidden tab,
 * preset switch) while the analyser clamps its own dt rather than freezing, so
 * one frame after a long pause can show a large phase jump. Unclamped, that
 * spikes the rate and produces exactly one visible lurch.
 */
const MAX_CLOCK_RATE = 3.0;

export function createLavaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<LavaUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  // Internal lerped mouse state for smooth interaction
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, LAVA_FRAG);
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

      const cfg = config as LavaConfig;
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

      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Lerp mouse for smooth interaction
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(
        uniforms.u_crackScale,
        cfg.crackScale ?? DEFAULTS.crackScale
      );
      gl.uniform1f(
        uniforms.u_crackWidth,
        cfg.crackWidth ?? DEFAULTS.crackWidth
      );
      gl.uniform1f(uniforms.u_glow, (cfg.glow ?? DEFAULTS.glow) + bass * 0.1);
      gl.uniform1f(uniforms.u_crust, cfg.crust ?? DEFAULTS.crust);
      gl.uniform1f(uniforms.u_heat, cfg.heat ?? DEFAULTS.heat);
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
      // The integrated clock is state — rewind so reset() starts fresh
      // rather than resuming motion mid-phase.
      clock = 0;
      prevBeatPhase = -1;
      // Reset lerped mouse to center on preset change/reset.
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
