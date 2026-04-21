/**
 * Geode (Agate Cross-Section) fragment shader.
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin×sin for band warping
 *  - 4-step band palette (bg → primary → secondary → primary*0.8) built via
 *    mix chain instead of per-pixel if/else branching
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR crystal specular (> 1.0) so ACES maps sparkle to bright glints
 *  - Bloom halo around crystal cavity
 *  - Luminance-aware filmic grain
 */
export const GEODE_FRAG = `#version 300 es
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
uniform int u_bands;
uniform float u_warp;
uniform float u_cavity;
uniform float u_speed;
uniform float u_sparkle;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
}

// -- iq value noise --
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    f += amp * valueNoise(p);
    total += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return total > 0.0 ? f / total : 0.0;
}

vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float minDist2 = 8.0;
  float cellId = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.4 * sin(u_time * u_speed * 0.5 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        cellId = hash(n + g);
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  return vec2(minDist2 - minDist, cellId);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- 4-step band palette via mix chain (no per-pixel branching) --
// idx 0: bg, 1: primary, 2: secondary, 3: primary*0.8
vec3 bandPalette(int idx) {
  // GLSL doesn't guarantee constant-index optimization on all drivers,
  // so use array indexing for branch-free lookup.
  vec3 palette[4] = vec3[4](u_bgColor * 1.3, u_brandPrimary, u_brandSecondary, u_brandPrimary * 0.8);
  return palette[idx];
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float angle = t * 0.5 + u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  vec2 warpedP = p + u_warp * 0.3 * vec2(fbm(p * 3.0 + t * 0.2), fbm(p * 3.0 + 100.0 + t * 0.15));
  float dist = length(warpedP);
  float normDist = clamp(dist / 0.8, 0.0, 1.0);

  vec3 color;

  if (normDist < u_cavity) {
    // ── Crystal cavity ──
    vec2 vor = voronoi(warpedP * 12.0);
    float edge = vor.x;
    float id = vor.y;

    // Per-cell variation on accent
    vec3 crystalCol = u_brandAccent * (0.75 + 0.5 * id);

    // Bright crack edges
    float edgeLine = 1.0 - smoothstep(0.0, 0.08, edge);
    crystalCol = mix(crystalCol, mix(u_brandAccent, vec3(1.0), 0.6), edgeLine * 0.6);

    // Mouse-driven specular with HDR emission
    vec3 lightDir = normalize(vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5));
    vec3 normal = normalize(vec3(dFdx(edge) * 10.0, dFdy(edge) * 10.0, 1.0));
    float spec = pow(max(dot(normal, lightDir), 0.0), 16.0) * u_sparkle;
    // HDR scale so ACES turns glints bright-white
    crystalCol += spec * u_mouseActive * 2.5;

    color = crystalCol;
  } else {
    // ── Mineral bands (branch-free palette lookup) ──
    float bandF = normDist * float(u_bands);
    float bandIdx = floor(bandF);
    float bandFrac = fract(bandF);

    float fw = fwidth(bandF);
    float edgeSmooth = smoothstep(0.5 - fw, 0.5 + fw, bandFrac);

    int idx = int(mod(bandIdx, 4.0));
    int nextIdx = int(mod(bandIdx + 1.0, 4.0));

    vec3 bandColor = bandPalette(idx);
    vec3 nextColor = bandPalette(nextIdx);

    float variation = 0.85 + 0.3 * hash(vec2(bandIdx, 0.0));
    float nextVariation = 0.85 + 0.3 * hash(vec2(bandIdx + 1.0, 0.0));
    bandColor *= variation;
    nextColor *= nextVariation;

    color = mix(bandColor, nextColor, edgeSmooth);
    color *= smoothstep(1.0, 0.7, normDist);
  }

  // ── Bloom halo around cavity boundary (catches spec glints bleeding out) ──
  float cavityProx = smoothstep(u_cavity + 0.04, u_cavity - 0.04, normDist);
  float sparkleLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(sparkleLum * cavityProx, 2.0) * u_brandAccent * 0.4;

  // ── Post-process ───────────────────────────────────────────
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
