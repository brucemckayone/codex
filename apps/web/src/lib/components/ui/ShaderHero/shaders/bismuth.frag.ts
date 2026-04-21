/**
 * Bismuth (Crystal Terraces) fragment shader.
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin×sin for terrace heightfield
 *  - Smooth 3-stop iridescent palette (primary → secondary → accent) via
 *    smoothstep weights; no branching
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR edge-glow emission lets ACES tone-map crystal edges to bright glints
 *  - Bloom halo on brightest terrace edges
 *  - Luminance-aware filmic grain
 */
export const BISMUTH_FRAG = `#version 300 es
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
uniform int u_terraces;
uniform float u_warp;
uniform float u_iridescence;
uniform float u_speed;
uniform float u_edge;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

// -- Smooth 3-stop iridescent palette (no branch) --
vec3 iridescent(float angle, float strength) {
  float t = clamp(angle * strength, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 3.0;

  float angle = u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  vec2 pAnim = p + vec2(t * 0.3, t * 0.2);

  vec2 warpOffset = u_warp * 0.4 * vec2(
    fbm(pAnim * 2.0 + 10.0),
    fbm(pAnim * 2.0 + 20.0)
  );
  vec2 pWarped = pAnim + warpOffset;

  float heightSmooth = fbm(pWarped);
  heightSmooth = clamp(heightSmooth * 0.5 + 0.5, 0.0, 1.0);

  float N = float(u_terraces);
  float heightStepped = floor(heightSmooth * N) / N;

  float dHdx = dFdx(heightStepped);
  float dHdy = dFdy(heightStepped);
  float edgeMask = length(vec2(dHdx, dHdy)) * 40.0;
  edgeMask = clamp(edgeMask, 0.0, 1.0);

  float gx = dFdx(heightSmooth);
  float gy = dFdy(heightSmooth);
  vec3 normal = normalize(vec3(gx * 8.0, gy * 8.0, 1.0));

  float mx = u_mouseActive > 0.5 ? u_mouse.x : 0.5;
  float my = u_mouseActive > 0.5 ? u_mouse.y : 0.5;
  vec3 viewDir = normalize(vec3(mx - 0.5, my - 0.5, 0.5));

  float angleFactor = 1.0 - abs(dot(normal, viewDir));

  vec3 iriColor = iridescent(angleFactor, u_iridescence);

  float depthFade = 0.4 + 0.6 * heightStepped;
  vec3 faceColor = mix(u_bgColor, iriColor, depthFade);

  // HDR edge-glow with accent so ACES renders crystal edges as bright
  vec3 edgeColor = mix(u_brandAccent, vec3(1.0), 0.25) * (1.0 + 0.7 * angleFactor) * 1.8;
  vec3 color = mix(faceColor, edgeColor, edgeMask * u_edge);

  // Bloom halo on brightest edges
  float edgeLum = edgeMask * u_edge * (0.5 + 0.5 * angleFactor);
  color += pow(edgeLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.4;

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
