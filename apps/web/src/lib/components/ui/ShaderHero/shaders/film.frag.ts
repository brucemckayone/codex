/**
 * Film fragment shader — Oil film thin-film interference (iridescence).
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin(x)*sin(y) — organic thickness variation
 *    instead of checkerboard interference
 *  - Array-indexed 4-stop cyclic palette replaces if/else chain
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR specular (pow 16, * 0.3 → * 1.2) for proper iridescent glint
 *  - Bloom halo on brightest film highlights — soap-bubble rainbow glow
 *  - Luminance-aware filmic grain
 */
export const FILM_FRAG = `#version 300 es
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
uniform float u_filmScale;
uniform float u_filmSpeed;
uniform float u_bands;
uniform float u_shift;
uniform float u_ripple;
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

float fbm3(vec2 p) {
  float f = 0.0;
  f += 0.5000 * valueNoise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * valueNoise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * valueNoise(p);
  return f / 0.875;
}

// -- Cyclic 4-stop brand palette (array-indexed) --
vec3 brandPalette(float t) {
  t = fract(t);
  float segments = 4.0;
  float seg = t * segments;
  float f = fract(seg);
  f = f * f * (3.0 - 2.0 * f);
  vec3 stops[5] = vec3[5](
    u_bgColor, u_brandPrimary, u_brandSecondary, u_brandAccent, u_brandPrimary
  );
  int idx = int(floor(seg));
  idx = clamp(idx, 0, 3);
  return mix(stops[idx], stops[idx + 1], f);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_filmSpeed;

  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect;

  vec2 noiseCoord = uv * u_filmScale + vec2(t * 0.1, t * 0.07);
  float thickness = fbm3(noiseCoord) * 0.5 + 0.5;

  thickness += 0.1 * sin(uv.x * 3.0 + t * 0.3) * sin(uv.y * 2.5 + t * 0.2);

  vec2 center = aspect * 0.5;
  float centerDist = distance(uv, center);
  float maxDist = length(center);
  float fresnel = centerDist / maxDist;
  thickness += u_shift * fresnel * 0.3;

  vec2 mouseUV = u_mouse * aspect;
  float mouseDist = distance(uv, mouseUV);
  float mouseWave = u_ripple * sin(mouseDist * 20.0 - t * 4.0)
                  * smoothstep(0.5, 0.0, mouseDist)
                  * 0.15;
  thickness += mouseWave;

  if (u_burstStrength > 0.01) {
    float burstWave = sin(mouseDist * 15.0 - t * 6.0)
                    * u_burstStrength
                    * smoothstep(0.8, 0.0, mouseDist)
                    * 0.25;
    thickness += burstWave;
  }

  // Palette lookup (branch-free array index)
  float paletteIdx = thickness * u_bands;
  vec3 filmColor = brandPalette(paletteIdx);

  // Specular via surface normal approximation
  float dTdx = dFdx(thickness);
  float dTdy = dFdy(thickness);
  vec3 surfaceNormal = normalize(vec3(-dTdx * 8.0, -dTdy * 8.0, 1.0));
  vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
  float specular = pow(max(dot(surfaceNormal, lightDir), 0.0), 16.0);

  // HDR specular — ACES renders iridescent glint as near-white
  filmColor += mix(vec3(1.0), u_brandAccent, 0.2) * specular * 1.2;

  // Subtle iridescent brightness variation
  float iridescence = 0.85 + 0.15 * sin(thickness * 6.2831 * u_bands * 0.5 + t);
  filmColor *= iridescence;

  // Bloom halo on brightest film highlights
  float filmLum = dot(filmColor, vec3(0.299, 0.587, 0.114));
  filmColor += pow(filmLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ──────────────────────────────────────────
  filmColor = aces(filmColor);
  vec3 color = mix(u_bgColor, filmColor, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
