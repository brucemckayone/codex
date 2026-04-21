/**
 * Waves fragment shader — Gerstner ocean surface.
 *
 * Shadertoy-grade polish pass:
 *  - ACES filmic tone map replaces min(x, 0.75); specular sun highlight
 *    now emits > 1.0 and tone-maps to a proper glinting hotspot instead
 *    of a clipped matte disc
 *  - Richer sky gradient: primary at horizon → accent-tinted at zenith,
 *    passed through fresnel for realistic oblique reflections
 *  - Subsurface scatter brightened + warmed with accent injection
 *  - Foam: accent + white mix with HDR multiplier so whitecaps feel
 *    cinematic (old accent * 0.5-ish was tinted but dim)
 *  - Depth-tinted water body (brandPrimary → deeper tint via waveH)
 *  - Luminance-aware grain
 *
 * Gerstner physics (iterative height solve, finite-diff normals, 5-wave
 * superposition) preserved from original — that part is already correct.
 */
export const WAVES_FRAG = `#version 300 es
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
uniform float u_height;
uniform float u_speed;
uniform float u_chop;
uniform float u_foam;
uniform float u_depth;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

mat2 getWindRotation() {
  float angle = u_mouseActive * (u_mouse.x - 0.5) * 1.5;
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

vec3 gerstnerDisplacement(vec2 pos, float t) {
  mat2 windRot = getWindRotation();
  vec3 result = vec3(0.0);
  float Q = clamp(u_chop, 0.0, 1.0);

  vec2 d1 = windRot * normalize(vec2(1.0, 0.3));
  float f1 = 1.0, a1 = 0.25 * u_height;
  float phase1 = dot(d1, pos) * f1 + t * 1.0;
  result.z += a1 * sin(phase1);
  result.xy += Q * a1 * d1 * cos(phase1);

  vec2 d2 = windRot * normalize(vec2(0.8, -0.5));
  float f2 = 1.8, a2 = 0.15 * u_height;
  float phase2 = dot(d2, pos) * f2 + t * 1.2;
  result.z += a2 * sin(phase2);
  result.xy += Q * a2 * d2 * cos(phase2);

  vec2 d3 = windRot * normalize(vec2(-0.3, 1.0));
  float f3 = 2.6, a3 = 0.10 * u_height;
  float phase3 = dot(d3, pos) * f3 + t * 0.9;
  result.z += a3 * sin(phase3);
  result.xy += Q * a3 * d3 * cos(phase3);

  vec2 d4 = windRot * normalize(vec2(0.5, 0.8));
  float f4 = 3.2, a4 = 0.06 * u_height;
  float phase4 = dot(d4, pos) * f4 + t * 1.4;
  result.z += a4 * sin(phase4);
  result.xy += Q * a4 * d4 * cos(phase4);

  vec2 d5 = windRot * normalize(vec2(-0.7, -0.4));
  float f5 = 4.1, a5 = 0.04 * u_height;
  float phase5 = dot(d5, pos) * f5 + t * 0.8;
  result.z += a5 * sin(phase5);
  result.xy += Q * a5 * d5 * cos(phase5);

  return result;
}

float getWaveHeight(vec2 pos, float t) {
  vec2 p = pos;
  for (int i = 0; i < 4; i++) {
    vec3 disp = gerstnerDisplacement(p, t);
    p = pos - disp.xy;
  }
  return gerstnerDisplacement(p, t).z;
}

vec3 getNormal(vec2 pos, float t) {
  float eps = 0.01;
  float hL = getWaveHeight(pos - vec2(eps, 0.0), t);
  float hR = getWaveHeight(pos + vec2(eps, 0.0), t);
  float hD = getWaveHeight(pos - vec2(0.0, eps), t);
  float hU = getWaveHeight(pos + vec2(0.0, eps), t);
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  vec2 pos = vec2(uv.x * aspect, uv.y) * 4.0;

  float waveH = getWaveHeight(pos, t);

  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float splashDist = distance(fragUV, mouseUV);
  float splash = u_burst * 0.3 * sin(splashDist * 30.0 - u_time * 8.0) * exp(-splashDist * 5.0);
  waveH += splash;

  vec3 normal = getNormal(pos, t);

  // Fresnel (Schlick)
  vec3 viewDir = normalize(vec3(0.0, 1.0, 0.5));
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  fresnel = mix(0.02, 1.0, fresnel);

  // ── Sky gradient: horizon primary → zenith accent-tinted ────
  float skyT = normal.y * 0.5 + 0.5;
  vec3 skyHorizon = mix(u_bgColor * 1.4, u_brandPrimary * 0.9, 0.6);
  vec3 skyZenith = mix(u_brandPrimary, u_brandAccent, 0.35) * 1.1;
  vec3 skyColor = mix(skyHorizon, skyZenith, skyT);

  // ── Water body: depth-tinted primary ────────────────────────
  vec3 deepWater = u_bgColor * 0.55;
  vec3 waterBody = mix(deepWater, u_brandPrimary, clamp(waveH * 2.0 + 0.5, 0.0, 1.0));

  vec3 color = mix(waterBody, skyColor, fresnel * 0.45);

  // ── Subsurface scatter (brighter + warmer) ──────────────────
  float sss = pow(max(dot(viewDir, -normal), 0.0), 3.0) * u_depth;
  color += mix(u_brandSecondary, u_brandAccent, 0.4) * sss * 1.0;

  // ── Specular sun highlight — HDR emission (> 1.0) ──────────
  // Old: vec3(1.0) * spec * 0.8 maxed at 0.8, clipped flat. New: 4.0
  // lets ACES tone-map the highlight to a proper glint.
  vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
  vec3 halfVec = normalize(sunDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
  color += mix(vec3(1.0), u_brandAccent, 0.15) * spec * 4.0;

  // ── Foam with HDR whitecaps ─────────────────────────────────
  float foamMask = smoothstep(0.15, 0.35, waveH) * u_foam;
  foamMask *= hash(pos * 30.0 + t * 2.0) * 0.5 + 0.5;
  color += mix(u_brandAccent, vec3(1.0), 0.4) * foamMask * 1.6;

  // ── Bloom-adjacent highlight boost ──────────────────────────
  float lumSig = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(clamp(lumSig - 0.6, 0.0, 2.0), 2.0) * u_brandAccent * 0.25;

  // ── Post-process ────────────────────────────────────────────
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
