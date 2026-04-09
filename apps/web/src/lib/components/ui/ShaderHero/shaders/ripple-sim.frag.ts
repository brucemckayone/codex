/**
 * Water Ripple simulation fragment shader (GLSL ES 3.0).
 *
 * 2D wave equation with ping-pong FBO.
 * Buffer format: vec4(height, previousHeight, 0, 0)
 * Uses 4-point Laplacian, damping, Gaussian mouse impulse, and edge reflection.
 *
 * Uniforms:
 *   uState         — ping-pong simulation texture
 *   uTexel         — 1.0 / simResolution
 *   uWaveSpeed     — wave propagation speed (default 0.8)
 *   uDamping       — per-frame damping factor (default 0.995)
 *   uRippleSize    — Gaussian radius for mouse impulse (default 0.03)
 *   uMouse         — mouse position normalized 0..1
 *   uMouseActive   — 1.0 if mouse is over canvas, 0.0 otherwise
 *   uMouseStrength — impulse strength (1.0 hover, larger for click)
 */
export const RIPPLE_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uWaveSpeed;
uniform float uDamping;
uniform float uRippleSize;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;

void main() {
  // Sample center and 4 neighbors
  vec4 center = texture(uState, v_uv);
  float hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).x;
  float hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).x;
  float hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).x;
  float hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).x;

  float current = center.x;
  float previous = center.y;

  // Laplacian (4-point stencil)
  float laplacian = hN + hS + hE + hW - 4.0 * current;

  // 2D wave equation
  float c2 = uWaveSpeed * uWaveSpeed * 0.25;  // scaled for stability
  float next = 2.0 * current - previous + c2 * laplacian;

  // Damping
  next *= uDamping;

  // Mouse impulse: Gaussian deposit
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = uRippleSize;
    float impulse = uMouseStrength * 0.015 * exp(-dot(d, d) / (r * r));
    next += impulse;
  }

  // Clamp for stability
  next = clamp(next, -2.0, 2.0);

  // Edge reflection: dampen near boundaries
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  next *= edge.x * edge.y;

  // Store: (nextHeight, currentHeight, 0, 0)
  fragColor = vec4(next, current, 0.0, 0.0);
}
`;
