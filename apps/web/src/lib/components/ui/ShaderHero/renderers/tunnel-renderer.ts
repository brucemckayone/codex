/**
 * Tunnel renderer — Apollonian fractal tunnel flythrough.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## Forward travel is integrated here, not in the shader
 *
 * The shader used to derive its z position from `u_time * u_speed`, with
 * `u_burstStrength * 5.0` added on top. Two problems: the pace was wall-clock,
 * and a click *displaced* the camera 5 units and then dragged it back as the
 * burst decayed — a lurch out and a lurch home.
 *
 * Travel is now a monotone accumulator whose **rate** is what crossfades. That
 * matters more than it looks: `u_beatPhase` starts at zero when the analyser is
 * created, so `mix(u_time * k, u_beatPhase, u_audioActive)` — the pattern vapor
 * uses — steps the clock by however far wall-time had run. Vapor tolerates it
 * because a jump in a noise field reads as a dissolve; here it would teleport
 * the camera down the tunnel. Differentiating the musical clock and blending
 * *rates* means entering immersive mode changes the pace and nothing else.
 *
 * Mouse aims the camera, damped frame-rate-independently.
 * Click adds a forward surge (monotone — it never reverses) plus a bore/
 * brightness pulse.
 * Configurable: speed, fractal (int), radius, brightness, twist.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TunnelConfig } from '../shader-config';
import { TUNNEL_FRAG } from '../shaders/tunnel.frag';
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
  'u_fractal',
  'u_radius',
  'u_brightness',
  'u_twist',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_travel',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type TunnelUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  speed: 2.0,
  fractal: 6,
  radius: 2.0,
  brightness: 1.0,
  twist: 0.07,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds).
 *
 * Was `lerped += (target - lerped) * 0.04` applied per *frame*, which converges
 * twice as fast on a 120Hz display as on 60Hz. 0.04/frame at 60fps is a tau of
 * about 0.4s; expressed as a tau and driven by dt the feel is now identical at
 * any refresh rate.
 */
const MOUSE_TAU_SEC = 0.4;

/** World units of forward travel per second at `speed` 1.0. */
const TRAVEL_PER_SPEED = 0.3;

/**
 * Forward units a full-strength beat adds. Applied as a rate (scaled by dt) so
 * it integrates into the monotone travel rather than displacing the camera.
 */
const BEAT_SURGE = 2.2;

/** Forward units a full-strength click adds, likewise as a rate. */
const CLICK_SURGE = 3.5;

/**
 * Clamp on the differentiated musical clock. `beatPhase` advances at 0.35..1.5
 * per second by design; the clamp only guards the single frame where the
 * analyser first appears and the difference against a stale sample is huge.
 */
const MAX_BEAT_RATE = 2.0;

export function createTunnelRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TunnelUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth camera aim
  let lerpedMouse = { x: 0.5, y: 0.5 };

  /** Monotone forward distance. Never decreases — see the file header. */
  let travel = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevPhase = -1;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, TUNNEL_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      travel = 0;
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

      const cfg = config as TunnelConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      const speed = cfg.speed ?? DEFAULTS.speed;

      // ── Travel integration ────────────────────────────────────
      // Differentiate the musical clock, then blend the *rate* toward it. The
      // first sample has no predecessor, so it falls back to the rest rate.
      const restRate = speed * TRAVEL_PER_SPEED;
      const beatRate =
        prevPhase < 0
          ? restRate
          : Math.min(
              MAX_BEAT_RATE,
              Math.max(0, (a.beatPhase - prevPhase) / dt)
            );
      prevPhase = a.beatPhase;

      const rate = restRate + (beatRate - restRate) * a.active;
      const surge =
        a.beatPulse * a.active * BEAT_SURGE + mouse.burstStrength * CLICK_SURGE;
      travel += (rate + surge) * dt;

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
      gl.uniform1f(uniforms.u_travel, travel);

      // Burst strength (bore widening + brightness pulse)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours are left as the configured palette rather than routed
      // through computeImmersiveColours(): the tunnel derives its whole depth
      // ramp from the three stops, so cycling them fights the depth cue. Audio
      // moves colour here via the u_centroid palette-phase shift instead.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // CRITICAL: u_fractal is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_fractal,
        Math.round(cfg.fractal ?? DEFAULTS.fractal)
      );
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(
        uniforms.u_brightness,
        cfg.brightness ?? DEFAULTS.brightness
      );
      gl.uniform1f(uniforms.u_twist, cfg.twist ?? DEFAULTS.twist);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Vignette reads as a frame around a hero but as a tunnel-within-a-tunnel
      // in fullscreen immersive mode, so it fades out along the audio ramp
      // rather than being switched off, which would pop on the first beat.
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
      travel = 0;
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
