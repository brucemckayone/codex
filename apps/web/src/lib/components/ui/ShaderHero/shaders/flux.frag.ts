/**
 * Flux fragment shader — Magnetic dipole field lines.
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 4-stop palette via smoothstep weights replaces 3-way
 *    if/else chain
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR field-line emission (* 1.6) lets ACES render bright field
 *    lines as luminous filaments
 *  - Fill background brightened (0.12 → 0.18) so non-line pixels
 *    aren't near-black
 *  - Bloom halo on brightest lines near poles
 *  - Luminance-aware filmic grain
 */
export const FLUX_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_poles;
uniform float u_lineDensity;
uniform float u_lineWidth;
uniform float u_strength;
uniform float u_speed;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Smooth 4-stop gradient (bg → primary → secondary → accent)
vec3 fluxPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.333) return mix(u_bgColor, u_brandPrimary, smoothstep(0.0, 0.333, t));
  if (t < 0.666) return mix(u_brandPrimary, u_brandSecondary, smoothstep(0.333, 0.666, t));
  return mix(u_brandSecondary, u_brandAccent, smoothstep(0.666, 1.0, t));
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  float potential = 0.0;
  float fieldMag = 0.0;

  for (int i = 0; i < 6; i++) {
    if (i >= u_poles + 1) break;

    vec2 polePos;
    float charge;

    if (i < u_poles) {
      float fi = float(i);
      float angle = t * (0.3 + fi * 0.1) + fi * TWO_PI / float(u_poles);
      float radius = 0.4 + 0.2 * sin(t * 0.2 + fi * 1.7);
      polePos = vec2(cos(angle), sin(angle)) * radius;
      charge = (mod(fi, 2.0) < 0.5) ? u_strength : -u_strength;
    } else {
      polePos = (u_mouse * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
      float mouseCharge = u_strength * mix(1.0, -1.0, smoothstep(0.0, 0.5, u_burst));
      charge = mouseCharge * u_mouseActive;
    }

    vec2 d = uv - polePos;
    float dist = length(d);
    float safeDist = max(dist, 0.02);
    potential += charge * atan(d.y, d.x);
    fieldMag += abs(charge) / (safeDist * safeDist);
  }

  // Field lines via fract + fwidth anti-aliasing
  float linePhase = fract(potential * u_lineDensity / TWO_PI);
  float fw = fwidth(potential * u_lineDensity / TWO_PI) * u_lineWidth;
  float lineMask = smoothstep(0.5 - fw, 0.5, linePhase) - smoothstep(0.5, 0.5 + fw, linePhase);
  lineMask += smoothstep(fw, 0.0, linePhase) + smoothstep(1.0 - fw, 1.0, linePhase);
  lineMask = clamp(lineMask, 0.0, 1.0);

  float logField = clamp(log(1.0 + fieldMag) / 3.0, 0.0, 1.0);

  // Smooth palette (branch-free)
  vec3 gradientColor = fluxPalette(logField);

  // HDR line emission — fill brightened + lines scaled for ACES glow
  vec3 color = gradientColor * mix(0.18, 1.6, lineMask);

  // Bloom halo on brightest lines
  float lineLum = lineMask * logField;
  color += pow(lineLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.35;

  // ── Post-process ──────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
