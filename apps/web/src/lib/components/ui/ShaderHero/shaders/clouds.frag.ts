/**
 * Clouds fragment shader — Procedural sky with volumetric-looking clouds.
 *
 * Shadertoy-grade polish pass:
 *  - ACES filmic tone map replaces min(x, 0.75) clip — bright cloud tops
 *    now roll off gracefully instead of flattening
 *  - HDR cloud-top emission: light colour * 1.6 drives ACES to sunlit-white
 *    in the brightest regions; old approach used additive light that maxed
 *    at ~1.3 and then got clipped to 0.75
 *  - Bloom halo on brightest cloud peaks (pow(brightness, 2.5) accent)
 *  - Richer sky gradient: bgColor (horizon) → primary tint (lower mid) →
 *    secondary (upper) — replaces the 2-stop gradient
 *  - Ridge-glow reinterpreted: warmer at high ridges, cool at low,
 *    using Fresnel-like rim weight
 *  - Luminance-aware filmic grain
 *
 * 2D Simplex noise + ridged/smooth FBM preserved — that part is correct.
 */
export const CLOUDS_FRAG = `#version 300 es
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
uniform float u_cover;
uniform float u_speed;
uniform float u_scale;
uniform float u_dark;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289v3((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float ridgedNoise(vec2 p) { return 1.0 - abs(snoise(p)); }

float cloudShape(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;
  vec2 drift = vec2(t * 0.6, t * 0.3);
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    f += amp * ridgedNoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.3;
  }
  return f / totalAmp;
}

float cloudDensity(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;
  vec2 drift = vec2(t * 0.4, t * 0.2);
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    f += amp * snoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.2;
  }
  return (f / totalAmp) * 0.5 + 0.5;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // ── Richer sky gradient: horizon → primary hint → secondary top ──
  vec3 skyColor;
  if (uv.y < 0.45) {
    skyColor = mix(u_bgColor, mix(u_bgColor, u_brandPrimary, 0.3), uv.y / 0.45);
  } else {
    skyColor = mix(mix(u_bgColor, u_brandPrimary, 0.3), u_brandSecondary, (uv.y - 0.45) / 0.55);
  }

  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;
  vec2 windShift = u_mouseActive * vec2(
    (u_mouse.x - 0.5) * 0.3,
    (u_mouse.y - 0.5) * 0.15
  );
  p += windShift * t * 10.0;

  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float clearMask = 1.0 - u_burst * exp(-mouseDist * mouseDist * 10.0);

  float shape = cloudShape(p, t);
  float density = cloudDensity(p * 1.5, t * 0.7);
  float cloud = shape * density;
  cloud = smoothstep(u_cover, u_cover + 0.3, cloud);
  cloud *= clearMask;

  // ── Cloud colouring ────────────────────────────────────────
  // Dark undersides (depth/density-driven)
  vec3 cloudDarkColor = u_brandPrimary * (1.0 - u_dark) * 0.8;
  // Bright tops — HDR-scaled so ACES renders as sunlit-white
  vec3 cloudLightColor = mix(u_brandPrimary, vec3(1.0), 0.6) * (1.0 + u_light) * 1.6;

  float brightness = density * 0.7 + 0.3;
  vec3 cloudColor = mix(cloudDarkColor, cloudLightColor, brightness);

  // Ridge glow with accent (warmer at tall ridges)
  float ridgeGlow = pow(shape, 3.0) * 0.7;
  cloudColor += u_brandAccent * ridgeGlow;

  vec3 color = mix(skyColor, cloudColor, cloud);

  // ── Bloom halo on brightest cloud peaks ────────────────────
  float cloudLum = cloud * brightness;
  color += pow(cloudLum, 2.5) * mix(u_brandSecondary, u_brandAccent, 0.4) * 0.35;

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
