/**
 * Vortex fragment shader — Polar volumetric spirals.
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 3-stop cyclic palette replaces if/else hue wheel
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR core glow (secondary * exp + 0.5 → * 0.8) lets ACES render
 *    centre bright without clipping
 *  - Ring-edge highlights HDR-scaled for bright radial filaments
 *  - Bloom-adjacent halo on brightest spiral arms
 *  - Luminance-aware filmic grain
 */
export const VORTEX_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_speed;
uniform int u_density;
uniform float u_twist;
uniform float u_rings;
uniform float u_spiral;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Cyclic 3-stop palette (wraps at 1.0 → 0.0) --
// Use smooth triangular weights around the three color pivots.
vec3 cyclicPalette(float t) {
  t = fract(t);
  // Distance to each pivot on the unit circle (0, 1/3, 2/3)
  float d0 = min(t, 1.0 - t);               // distance to 0
  float d1 = min(abs(t - 0.333), 1.0 - abs(t - 0.333));
  float d2 = min(abs(t - 0.666), 1.0 - abs(t - 0.666));
  float w0 = smoothstep(0.333, 0.0, d0);
  float w1 = smoothstep(0.333, 0.0, d1);
  float w2 = smoothstep(0.333, 0.0, d2);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

void main() {
  float t = u_time * u_speed;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  uv += (u_mouse - 0.5) * 0.5;

  float r = length(uv);
  float theta = atan(uv.y, uv.x);
  theta += u_burstStrength * 3.0 * exp(-r * 2.0);

  vec3 acc = vec3(0.0);

  for (int i = 0; i < 60; i++) {
    if (i >= u_density) break;

    float d = float(i) / float(u_density - 1);

    float angle = d * 6.283 * u_twist + theta + t;
    float c = cos(angle), s = sin(angle);
    vec2 p = mat2(c, -s, s, c) * uv * (1.0 + d * 2.0);

    float cellSize = 1.0 / u_rings;
    vec2 cell = mod(p + 0.5 * cellSize, cellSize) - 0.5 * cellSize;
    float shape = length(cell);

    float sdfVal = smoothstep(0.2, 0.0, shape) + smoothstep(0.02, 0.0, abs(shape - 0.15));

    float spiralPhase = fract(theta / 6.283 * 3.0 + d * u_twist + t * 0.5);
    float spiralBright = smoothstep(0.35, 0.15, abs(spiralPhase - 0.5)) * u_spiral;

    // ── Smooth cyclic palette (branchless) ──
    float hue = theta / 6.283 + 0.5 + d * 0.5 + t * 0.2;
    vec3 layerColor = cyclicPalette(hue);

    // Ring-edge HDR highlight
    float ringEdge = smoothstep(0.03, 0.0, abs(fract(r * u_rings * 4.0) - 0.5));
    layerColor += mix(u_brandAccent, vec3(1.0), 0.35) * ringEdge * 0.6;

    float brightness = (sdfVal + spiralBright) * exp(-d * 3.0);
    acc += layerColor * brightness / float(u_density);
  }

  // Central core glow — slightly bumped for ACES
  acc += mix(u_brandSecondary, u_brandAccent, 0.3) * exp(-r * r * 4.0) * 0.8;

  // Bloom halo on brightest spiral arms
  float armLum = dot(acc, vec3(0.299, 0.587, 0.114));
  acc += pow(armLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.35;

  // ── Post-process ───────────────────────────────────────────
  vec3 color = aces(acc);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
