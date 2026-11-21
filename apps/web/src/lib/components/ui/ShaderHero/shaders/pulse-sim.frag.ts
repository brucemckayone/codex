/**
 * Pulse wave simulation fragment shader (GLSL ES 3.0).
 *
 * 2D wave equation with ping-pong FBO — same physics as the ripple preset
 * but tuned for the 3D perspective display pass. Based on tomkh's wave
 * equation solver (https://www.shadertoy.com/view/Xsd3DB).
 *
 * Buffer format: vec4(height, previousHeight, 0, 0)
 * Uses 4-point Laplacian, configurable damping, Gaussian mouse impulse,
 * and edge damping to prevent boundary artifacts.
 *
 * Mouse coordinates are pre-mapped to heightmap UV space by the renderer
 * (via camera ray-plane intersection) so the sim stays 2D-simple.
 *
 * WP-1d R2b (Codex-1yd58): nothing moves the water but the pointer and the
 * sound. The logo attractor is gone: it pushed an oscillating force along
 * the logo's edge on every step, so the surface pulsed by itself (the
 * owner: "pulsing by itself... distracting"). The logo is now a still
 * relief in the display pass.
 *
 * Uniforms:
 *   uState         — ping-pong simulation texture
 *   uTexel         — 1.0 / simResolution
 *   uDamping       — per-step damping factor (default 0.98)
 *   uImpulseSize   — Gaussian radius for mouse impulse (default 0.04)
 *   uMouse         — mouse position in heightmap UV space (0..1)
 *   uMouseActive   — 1.0 if impulse should be applied, 0.0 otherwise
 *   uMouseStrength — impulse intensity (1.0 hover, larger for click)
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const PULSE_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDamping;
uniform float uImpulseSize;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;

${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

// Audio reactivity (0.0 when no audio active)

void main() {
  // Sample center and 4 neighbors
  vec4 center = texture(uState, v_uv);
  float hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).x;
  float hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).x;
  float hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).x;
  float hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).x;

  float current = center.x;
  float previous = center.y;

  // 4-point Laplacian stencil
  float laplacian = hN + hS + hE + hW - 4.0 * current;

  // 2D wave equation (Verlet integration, c^2 scaled for stability)
  float next = 2.0 * current - previous + 0.25 * laplacian;

  // Audio: reduce damping when loud (waves persist longer during loud passages)
  float effectiveDamping = mix(uDamping, min(uDamping + 0.02, 0.998), u_level);

  next *= effectiveDamping;

  // Audio: bass-driven radial pulse from center
  if (u_bass > 0.3) {
    float dist = length(v_uv - vec2(0.5));
    float ring = (1.0 - smoothstep(0.15, 0.25, dist)) * smoothstep(0.0, 0.1, dist);
    next += ring * u_bass * 0.08;
  }

  // Mouse impulse: Gaussian deposit at pre-mapped UV position
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = uImpulseSize;
    float impulse = uMouseStrength * 0.06 * exp(-dot(d, d) / (r * r));
    next += impulse;
  }

  // Stability clamp
  next = clamp(next, -3.0, 3.0);

  // Edge damping: prevent boundary reflection artifacts
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  next *= edge.x * edge.y;

  // Store: (nextHeight, currentHeight, 0, 0)
  fragColor = vec4(next, current, 0.0, 0.0);
}
`;
