/**
 * Ocean (Underwater Caustics + Sand Ripples) fragment shader.
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin×sin for sand irregularity — organic
 *    sand drift instead of diagonal interference
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR caustic emission (> 1.0) drives ACES to bright focused-light
 *    hotspots; old clip made all caustics look equally bright
 *  - Depth-aware water tint: deeper (sand low) → primary, shallower (sand
 *    high) → secondary/accent mix (mimics water column attenuation)
 *  - Bloom halo on brightest caustic peaks
 *  - Luminance-aware filmic grain
 */
export const OCEAN_FRAG = `#version 300 es
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
uniform float u_causticScale;
uniform float u_sandScale;
uniform float u_speed;
uniform float u_shadow;
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

float fbmNoise(vec2 p) {
  float f = valueNoise(p) * 0.5;
  p = octaveRot * p * 2.02;
  f += valueNoise(p) * 0.25;
  return f / 0.75;
}

float sandHeight(vec2 p, float t) {
  float ang = 0.4;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 warp = vec2(
    sin(dot(p, dir) * 2.0 + t * 0.3),
    cos(dot(p, dir.yx) * 1.5 + t * 0.2)
  ) * 0.3;
  vec2 wp = p + warp;

  float h = 0.0;
  h += sin(dot(wp, dir) * u_sandScale * 3.0 + t * 0.5) * 0.5;
  h += sin(dot(wp, dir * 1.7) * u_sandScale * 5.0 + t * 0.3) * 0.25;
  h += sin(dot(wp, vec2(-dir.y, dir.x)) * u_sandScale * 2.0 + t * 0.15) * 0.15;
  h += fbmNoise(wp * u_sandScale) * 0.3;

  return h * 0.5 + 0.5;
}

float caustic(vec2 uv, float t) {
  vec2 p = uv * u_causticScale;
  float c = 0.0;
  float freq = 1.0;
  for (int i = 0; i < 3; i++) {
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0));
    freq *= 2.0;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p;
  }
  return c / 3.0;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // Mouse ripple warp
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = mouseDist > 0.001 ? normalize(fragUV - mouseUV) : vec2(0.0);

  vec2 warp = vec2(0.0);
  warp += u_mouseActive * u_ripple * 0.015 *
    sin(mouseDist * 25.0 - t * 5.0) *
    exp(-mouseDist * 6.0) * mouseDir;
  warp += u_burst * 0.025 *
    sin(mouseDist * 18.0 - t * 8.0) *
    exp(-mouseDist * 3.0) * mouseDir;

  vec2 warpedUV = uv + warp;
  vec2 p = vec2(warpedUV.x * aspect, warpedUV.y);

  float sandH = sandHeight(p * u_sandScale, t);
  float c1 = caustic(p, t);
  float c2 = caustic(p, t + 0.5);
  float causticVal = (c1 + c2) * 0.5;

  vec2 lightDir = normalize(vec2(0.5, 0.7));
  float shadowSample = sandHeight((p + lightDir * 0.05) * u_sandScale, t);
  float shadowMask = smoothstep(0.0, 0.15, sandH - shadowSample);
  float shadowDarken = mix(1.0 - u_shadow, 1.0, shadowMask);

  // ── Sand: dark deep basin → warm primary where sand rises ──
  vec3 sandColor = mix(u_bgColor * 0.55, u_brandPrimary, sandH * 0.8 + 0.1);

  // ── Water column tint — depth-aware (deeper = more primary, shallower = secondary) ──
  float waterDepth = 1.0 - sandH;
  vec3 waterTint = mix(u_brandSecondary * 0.6, u_brandPrimary * 0.5, waterDepth);
  sandColor = mix(sandColor, sandColor + waterTint, 0.55);

  // ── Caustic: HDR emission so ACES tone-maps convergence to bright cores ──
  vec3 causticColor = mix(u_brandAccent, vec3(1.0), 0.25);
  float causticHot = causticVal * causticVal;
  vec3 color = sandColor + causticColor * causticHot * 1.4;

  color *= shadowDarken;

  // ── Bloom halo on brightest caustic peaks ──
  color += mix(u_brandSecondary, u_brandAccent, 0.6) * pow(causticVal, 4.0) * 0.35;

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
