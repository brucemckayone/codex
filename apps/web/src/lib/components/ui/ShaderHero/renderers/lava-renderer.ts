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
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { LavaConfig, ShaderConfig } from '../shader-config';
import { LAVA_FRAG } from '../shaders/lava.frag';
import {
  createSinglePass,
  easePointer,
  restingPointer,
  setPalette,
} from './single-pass';

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

/** Per-frame share of the way the eased pointer moves toward the real one. */
const MOUSE_LERP = 0.04;

export function createLavaRenderer(): ShaderRenderer {
  const pass = createSinglePass(LAVA_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  // Eased for an organic feel; only its position is uploaded.
  let pointer = restingPointer();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!pass.init(gl)) return false;
      pointer = restingPointer();
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
      const u = pass.begin(gl, width, height);
      if (!u) return;

      const cfg = config as LavaConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      clock += dt * pace.rate(a, dt) * (cfg.speed ?? DEFAULTS.speed);

      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;
      easePointer(pointer, mouse, MOUSE_LERP);

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      setPalette(
        gl,
        u,
        audio?.active
          ? computeImmersiveColours(time, cfg.colors, amp)
          : cfg.colors
      );

      // Preset-specific config with defaults
      gl.uniform1f(u.u_crackScale, cfg.crackScale ?? DEFAULTS.crackScale);
      gl.uniform1f(u.u_crackWidth, cfg.crackWidth ?? DEFAULTS.crackWidth);
      gl.uniform1f(u.u_glow, (cfg.glow ?? DEFAULTS.glow) + bass * 0.1);
      gl.uniform1f(u.u_crust, cfg.crust ?? DEFAULTS.crust);
      gl.uniform1f(u.u_heat, cfg.heat ?? DEFAULTS.heat);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        u.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      gl.uniform1f(u.u_clock, clock);

      uploadAudioUniforms(gl, u, a);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // The integrated clock is state — rewind so reset() starts fresh
      // rather than resuming motion mid-phase.
      clock = 0;
      pace.reset();
      // Reset the eased pointer to the centre on preset change/reset.
      pointer = restingPointer();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
