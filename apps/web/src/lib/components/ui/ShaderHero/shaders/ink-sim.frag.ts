/**
 * Ink Dispersion simulation fragment shader (GLSL ES 3.0).
 *
 * 3-channel advection-diffusion on a 512x512 ping-pong FBO.
 * RGB = concentrations of primary / secondary / accent brand-colored ink
 * spreading through liquid via Laplacian diffusion + curl noise advection.
 *
 * Uniforms:
 *   uState         — ping-pong simulation texture (RGB = ink concentrations)
 *   uTexel         — 1.0 / simResolution
 *   uDiffusion     — diffusion rate multiplier (0.5-3.0)
 *   uAdvection     — curl noise flow strength (0.0-2.0)
 *   uDropSize      — Gaussian radius of ink deposits (0.02-0.10)
 *   uEvaporation   — per-frame decay multiplier (0.990-0.999)
 *   uCurl          — curl noise frequency (5-40)
 *   uTime          — elapsed time in seconds
 *   uMouse         — mouse position normalized 0..1
 *   uMouseActive   — 1.0 if mouse is over canvas, 0.0 otherwise
 *   uMouseStrength — impulse strength
 *   uInkChannel    — which channel to deposit (0=R, 1=G, 2=B)
 *   uDropPos       — ambient drop position (-10 if none)
 *   uDropChannel   — channel for ambient drop
 */
export const INK_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDiffusion;
uniform float uAdvection;
uniform float uDropSize;
uniform float uEvaporation;
uniform float uCurl;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform float uInkChannel;
uniform vec2 uDropPos;
uniform float uDropChannel;

// ── Inline value noise (no built-in noise in GLSL ES 3.0) ──────────
// Hash-based smooth noise suitable for curl computation via finite differences.
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic Hermite for smooth derivatives
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ── Curl noise: velocity = (dN/dy, -dN/dx) via finite differences ───
vec2 curlNoise(vec2 p) {
  float eps = 0.5;
  float n0 = valueNoise(p + vec2(0.0, eps));
  float n1 = valueNoise(p - vec2(0.0, eps));
  float n2 = valueNoise(p + vec2(eps, 0.0));
  float n3 = valueNoise(p - vec2(eps, 0.0));
  return vec2((n0 - n1), -(n2 - n3)) / (2.0 * eps);
}

// ── Gaussian deposit helper ─────────────────────────────────────────
vec3 deposit(vec2 pos, float channel, float strength) {
  vec2 d = v_uv - pos;
  float r = uDropSize;
  float g = strength * exp(-dot(d, d) / (r * r));
  vec3 ink = vec3(0.0);
  if (channel < 0.5) ink.r = g;
  else if (channel < 1.5) ink.g = g;
  else ink.b = g;
  return ink;
}

void main() {
  // ── 1. Sample center + 4 neighbors (per channel) ─────────────────
  vec3 center = texture(uState, v_uv).rgb;
  vec3 hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).rgb;
  vec3 hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).rgb;
  vec3 hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).rgb;

  // ── 2. Laplacian diffusion per channel ────────────────────────────
  vec3 laplacian = hN + hS + hE + hW - 4.0 * center;
  vec3 diffused = center + uDiffusion * 0.2 * laplacian;

  // ── 3. Curl noise advection ───────────────────────────────────────
  // Animate noise domain slowly so the flow field evolves
  vec2 noiseCoord = v_uv * uCurl + uTime * 0.15;
  vec2 vel = curlNoise(noiseCoord) * uAdvection * 0.004;

  // Sample state at reverse-advected position
  vec2 advectedUV = clamp(v_uv - vel, vec2(0.0), vec2(1.0));
  vec3 advected = texture(uState, advectedUV).rgb;

  // ── 4. Blend diffusion and advection ──────────────────────────────
  vec3 result = mix(diffused, advected, 0.4);

  // ── 5. Per-frame evaporation ──────────────────────────────────────
  result *= uEvaporation;

  // ── 6. Mouse ink injection ────────────────────────────────────────
  if (uMouseActive > 0.5) {
    result += deposit(uMouse, uInkChannel, uMouseStrength * 0.4);
  }

  // ── 7. Ambient drop injection ─────────────────────────────────────
  if (uDropPos.x > -5.0) {
    result += deposit(uDropPos, uDropChannel, 0.6);
  }

  // ── 8. Clamp + edge damping ───────────────────────────────────────
  result = clamp(result, vec3(0.0), vec3(2.0));

  // Edge damping: smoothstep fade near boundaries
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  result *= edge.x * edge.y;

  fragColor = vec4(result, 1.0);
}
`;
