/**
 * Fracture fragment shader — Recursive polygon subdivision.
 *
 * Shadertoy-grade polish pass:
 *  - Array-indexed 3-color palette replaces 3-way if/else branch
 *  - Per-cell palette variation via hash-weighted mix (cells within the
 *    same palette slot still look subtly different — prevents uniform
 *    blocks of single colour)
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR cell emission (> 1.0) lets ACES render bright cells as luminous
 *  - Subtle specular-like highlight on cell interior (gradient from
 *    nearest edge) gives polygonal depth without shading
 *  - Luminance-aware filmic grain
 */
export const FRACTURE_FRAG = `#version 300 es
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
uniform int u_cuts;
uniform float u_speed;
uniform float u_border;
uniform float u_shadow;
uniform float u_fill;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hashFloat(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec2 hashVec2(float n) {
  return vec2(hashFloat(n), hashFloat(n + 57.3));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void getCutLine(int i, float t, vec2 mouseInfl, out vec2 pt, out vec2 norm) {
  float seed = float(i) * 13.37;
  pt = hashVec2(seed) * 0.6 + 0.2;
  float baseAngle = hashFloat(seed + 7.0) * 6.28318;
  float animAngle = baseAngle + t * (hashFloat(seed + 11.0) * 2.0 - 1.0);
  animAngle += dot(mouseInfl, vec2(cos(baseAngle), sin(baseAngle))) * 0.5;
  animAngle += u_burst * hashFloat(seed + 23.0) * 6.28318;
  norm = vec2(cos(animAngle), sin(animAngle));
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);

  vec2 mouseInfl = u_mouseActive * (u_mouse - vec2(0.5)) * 2.0;

  float cellId = 0.0;
  float minEdge = 1.0;

  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;
    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);
    pt.x *= aspect;
    float d = dot(p - pt, nm);
    cellId += step(0.0, d) * pow(2.0, float(i));
    minEdge = min(minEdge, abs(d));
  }

  // ── Array-indexed palette (branch-free) ───────────────────
  vec3 palette[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);
  float cs = hashFloat(cellId * 17.31 + 0.5);
  int idx = int(floor(cs * 3.0));
  idx = clamp(idx, 0, 2);
  vec3 cellColor = palette[idx];

  // Per-cell tint shift — cells in same palette slot still differ subtly
  float tintHash = hashFloat(cellId * 31.7 + 3.0);
  vec3 tinted = mix(cellColor, mix(cellColor, palette[(idx + 1) % 3], 0.4), tintHash * 0.25);
  tinted *= 0.92 + tintHash * 0.2;

  // HDR cell emission for ACES headroom
  cellColor = tinted * 1.25;

  // ── Border (anti-aliased) ─────────────────────────────────
  float fw = fwidth(minEdge);
  float borderMask = 1.0 - smoothstep(u_border - fw, u_border + fw, minEdge);

  // ── Shadow (offset re-cut) ────────────────────────────────
  vec2 sOff = vec2(u_shadow, -u_shadow);
  float sCellId = 0.0;
  float sEdge = 1.0;

  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;
    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);
    pt.x *= aspect;
    float d = dot((p + sOff) - pt, nm);
    sCellId += step(0.0, d) * pow(2.0, float(i));
    sEdge = min(sEdge, abs(d));
  }

  float shadowMask = (sCellId != cellId) ? 1.0 : 0.0;
  shadowMask *= smoothstep(0.0, u_shadow * 2.0, u_shadow - sEdge + u_shadow);
  shadowMask = clamp(shadowMask, 0.0, 0.5);

  // Subtle interior gradient — brighter farther from edge (fakes polygon depth)
  float interior = smoothstep(0.0, 0.08, minEdge);
  vec3 interiorTint = cellColor * (0.85 + 0.3 * interior);

  // ── Composite ─────────────────────────────────────────────
  vec3 color = mix(u_bgColor, interiorTint, u_fill);
  color = mix(color, u_bgColor * 0.3, shadowMask);
  color = mix(color, u_bgColor * 0.4, borderMask);

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
