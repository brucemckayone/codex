/**
 * Domain Warp fragment shader — Recursive FBM warping with bump-mapped lighting.
 *
 * Shadertoy-grade polish pass:
 *  - sin×sin noise PRESERVED per original "CRITICAL" note — that's what gives
 *    warp its signature organic marble/cloud texture; it's baked into the
 *    aesthetic rather than incidental
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - Brand-derived sky light replaces hardcoded vec3(0.70, 0.90, 0.95) —
 *    warp now inherits brand palette lighting instead of a blue bias that
 *    clashed with non-cyan brands
 *  - HDR highlight boost lifts bright warp cores pre-tone-map
 *  - Bloom-adjacent accent injection on brightest regions
 *  - Luminance-aware filmic grain
 *
 * Domain-warp structure (fbm(p + fbm(p + fbm(p)))) unchanged.
 */
export const WARP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_warpStr;
uniform int u_detail;
uniform float u_speed;
uniform float u_lightAng;
uniform float u_contrast;
uniform float u_invert;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Preserved: sin×sin noise (iq warp convention)
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm4(vec2 p) {
  float f = 0.0;
  f += 0.5000 * noise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * noise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * noise(p); p = octaveRot * p * 2.01;
  f += 0.0625 * noise(p);
  return f / 0.9375;
}

float fbm6(vec2 p) {
  float f = 0.0;
  f += 0.500000 * (0.5 + 0.5 * noise(p)); p = octaveRot * p * 2.02;
  f += 0.250000 * (0.5 + 0.5 * noise(p)); p = octaveRot * p * 2.03;
  f += 0.125000 * (0.5 + 0.5 * noise(p)); p = octaveRot * p * 2.01;
  f += 0.062500 * (0.5 + 0.5 * noise(p)); p = octaveRot * p * 2.04;
  f += 0.031250 * (0.5 + 0.5 * noise(p)); p = octaveRot * p * 2.01;
  f += 0.015625 * (0.5 + 0.5 * noise(p));
  return f / 0.96875;
}

float func(vec2 p, float time, float warpStr, out vec2 oq, out vec2 or2) {
  p += 0.03 * sin(vec2(0.27, 0.23) * time + length(p) * vec2(4.1, 4.3));
  vec2 q = vec2(fbm4(p * 0.9), fbm4(p * 0.9 + vec2(7.8)));
  q += 0.04 * sin(vec2(0.12, 0.14) * time + length(q));
  vec2 r = vec2(fbm6(q * 3.0), fbm6(q * 3.0 + vec2(11.5)));
  oq = q;
  or2 = r;
  float f = 0.5 + 0.5 * fbm4(p * 1.8 + r * 6.0);
  return mix(f, f * f * f * 3.5, f * abs(r.x));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;

  vec2 p = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  p += (u_mouse - 0.5) * 1.5;

  float localTime = t + u_mouse.x * 2.0;

  vec2 uv = gl_FragCoord.xy / u_resolution;
  float mouseDist = distance(uv, u_mouse);
  float mouseWarp = smoothstep(0.4, 0.0, mouseDist) * 0.5;
  float effectiveWarp = u_warpStr * (1.0 + mouseWarp);

  vec2 q, r;
  float f = func(p, localTime, effectiveWarp, q, r);

  float eps = 2.0 / u_resolution.y;
  vec2 dq, dr;
  float fx = func(p + vec2(eps, 0.0), localTime, effectiveWarp, dq, dr);
  float fy = func(p + vec2(0.0, eps), localTime, effectiveWarp, dq, dr);

  vec3 nor = normalize(vec3(fx - f, 2.0 * eps, fy - f));

  float angRad = u_lightAng * 3.14159265 / 180.0;
  vec3 lig = normalize(vec3(cos(angRad), 0.2, sin(angRad)));
  float dif = clamp(0.3 + 0.7 * dot(nor, lig), 0.0, 1.0);

  // ── Colour mapping (4 layers using brand) ──
  vec3 color = mix(u_brandPrimary * 0.4, u_brandSecondary * 0.15, f);
  color = mix(color, mix(u_brandAccent, vec3(1.0), 0.6), dot(r, r));
  color = mix(color, u_brandAccent * 0.7, 0.2 + 0.5 * q.y * q.y);
  color = mix(color, u_brandPrimary * 0.9, 0.5 * smoothstep(1.2, 1.3, abs(r.x) + abs(r.y)));
  color = clamp(color * f * 2.2, 0.0, 2.0);   // raise clamp ceiling for HDR tone-map

  // ── Brand-derived sky light (was hardcoded vec3(0.70, 0.90, 0.95)) ──
  // Mix bg + primary for the cool "sky" term, accent for warm rim.
  vec3 skyLight = mix(u_bgColor + u_brandPrimary * 0.2, u_brandSecondary * 1.1, 0.4);
  vec3 rimLight = u_brandAccent * 0.7;
  vec3 lin = skyLight * (nor.y * 0.5 + 0.5) + rimLight * dif * 0.2;
  color *= 1.3 * lin;

  // Invert + contrast
  color = mix(color, 1.0 - color, u_invert);
  color = 1.1 * color * color * u_contrast;

  // ── Bloom boost on brightest cores ──
  float warpLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(warpLum, 2.4) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ────────────────────────────────────────────
  color = aces(color);                       // ACES (replaces min(x, 0.75))
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
