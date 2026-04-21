/**
 * Curl Noise Tendrils fragment shader (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - ACES filmic tone map replaces min(x, 0.7) clip
 *  - Array-indexed 5-stop palette (bg → primary → secondary → accent →
 *    white) replaces 4-way if/else chain
 *  - HDR tendril emission (* 1.3 scalar on the density→colour mapping)
 *    gives ACES headroom so bright tendrils glow white-hot
 *  - Bloom halo on densest tendril regions
 *  - Luminance-aware filmic grain
 *
 * 3D curl-noise advection + backward Euler preserved — that's the
 * mathematical heart and doesn't need fixing.
 */
export const TENDRILS_FRAG = `#version 300 es
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
uniform float u_scale;
uniform float u_speed;
uniform int u_steps;
uniform float u_curl;
uniform float u_fade;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash31(i);
  float b = hash31(i + vec3(1, 0, 0));
  float c = hash31(i + vec3(0, 1, 0));
  float d = hash31(i + vec3(1, 1, 0));
  float e = hash31(i + vec3(0, 0, 1));
  float f1 = hash31(i + vec3(1, 0, 1));
  float g = hash31(i + vec3(0, 1, 1));
  float h = hash31(i + vec3(1, 1, 1));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3d(vec3 p) {
  float f = 0.0;
  f += 0.500 * noise3(p); p.xy = octaveRot * p.xy * 2.02; p.z *= 1.03;
  f += 0.250 * noise3(p); p.xy = octaveRot * p.xy * 2.03; p.z *= 1.04;
  f += 0.125 * noise3(p);
  return f / 0.875;
}

vec2 curlNoise(vec2 p, float t) {
  float eps = 0.01;
  vec3 p3 = vec3(p, t);
  float dPdy = (fbm3d(p3 + vec3(0, eps, 0)) - fbm3d(p3 - vec3(0, eps, 0))) / (2.0 * eps);
  float dPdx = (fbm3d(p3 + vec3(eps, 0, 0)) - fbm3d(p3 - vec3(eps, 0, 0))) / (2.0 * eps);
  return vec2(dPdy, -dPdx) * u_curl;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Array-indexed 5-stop density palette --
vec3 tendrilPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 stops[5] = vec3[5](u_bgColor, u_brandPrimary, u_brandSecondary, u_brandAccent, vec3(1.0));
  float scaled = t * 4.0;
  int idx = int(floor(scaled));
  idx = clamp(idx, 0, 3);
  float f = fract(scaled);
  return mix(stops[idx], stops[idx + 1], f);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec2 mouseUv = (u_mouse - 0.5) * 2.0;
  mouseUv.x *= u_resolution.x / u_resolution.y;

  vec2 pos = uv * u_scale;
  float density = 0.0;
  float dt = 0.15;

  for (int i = 0; i < 7; i++) {
    if (i >= u_steps) break;

    vec2 vel = curlNoise(pos, t);

    vec2 toMouse = pos - mouseUv * u_scale;
    float mouseDist = length(toMouse);
    float mouseFalloff = exp(-mouseDist * mouseDist * 4.0);
    vec2 perp = vec2(-toMouse.y, toMouse.x);
    vel += (perp * 0.8 + normalize(toMouse + 0.001) * 0.2) * mouseFalloff * u_curl * 0.5;

    pos -= vel * dt;

    float n = fbm3d(vec3(pos, t * 0.5));
    float band = 1.0 - smoothstep(0.0, 0.08, abs(n - 0.5));
    float weight = 1.0 - float(i) / float(u_steps);
    density += band * weight;
  }
  density /= float(u_steps);
  density = clamp(density * u_fade * 2.0, 0.0, 1.0);

  // Branch-free 5-stop palette, HDR-scaled for ACES
  vec3 color = tendrilPalette(density) * 1.3;

  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    float burstDist = dot(uv - burstUv, uv - burstUv);
    float burst = u_burstStrength * exp(-burstDist * 6.0);
    color += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.8;
  }

  // Bloom halo on densest tendrils
  color += pow(density, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

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
