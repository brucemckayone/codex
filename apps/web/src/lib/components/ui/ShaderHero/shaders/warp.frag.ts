/**
 * Domain Warp fragment shader — Recursive FBM warping with bump-mapped lighting.
 *
 * Technique: fbm(p + fbm(p + fbm(p))) — fractal Brownian motion applied
 * recursively to its own UV domain, creating organic marble/cloud/lava textures.
 * Combined with bump-mapped lighting for 3D depth.
 *
 * Single-pass fragment shader. No FBOs needed.
 * CRITICAL: noise function is sin(p.x) * sin(p.y) — NOT hash-based value noise.
 * FBM with inter-octave rotation mat2(0.8, 0.6, -0.6, 0.8).
 *
 * Mouse interaction: parallax offset, time distortion, warp magnification near cursor.
 * Brand colors mapped from intermediate warp vectors (q, r).
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

// -- Hash for film grain (pseudo-random, screen-space) --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Noise: smooth periodic function (the key to the organic look) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation between octaves to break axis alignment --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

// FBM with 4 octaves, normalized by /0.9375
float fbm4(vec2 p) {
  float f = 0.0;
  f += 0.5000 * noise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * noise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * noise(p); p = octaveRot * p * 2.01;
  f += 0.0625 * noise(p);
  return f / 0.9375;
}

// FBM with 6 octaves, each remapped to 0..1, normalized by /0.96875
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

// -- Domain warping function: fbm(p + fbm(p + fbm(p))) --
float func(vec2 p, float time, float warpStr, out vec2 oq, out vec2 or2) {
  // Time-based sway
  p += 0.03 * sin(vec2(0.27, 0.23) * time + length(p) * vec2(4.1, 4.3));

  // First warp layer
  vec2 q = vec2(
    fbm4(p * 0.9),
    fbm4(p * 0.9 + vec2(7.8))
  );

  // Time modulate q
  q += 0.04 * sin(vec2(0.12, 0.14) * time + length(q));

  // Second warp layer
  vec2 r = vec2(
    fbm6(q * 3.0),
    fbm6(q * 3.0 + vec2(11.5))
  );

  // Export for color mapping
  oq = q;
  or2 = r;

  // Final evaluation
  float f = 0.5 + 0.5 * fbm4(p * 1.8 + r * 6.0);

  // Contrast shaping
  return mix(f, f * f * f * 3.5, f * abs(r.x));
}

void main() {
  float t = u_time * u_speed;

  // --- Mouse interaction: parallax offset ---
  vec2 p = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  p += (u_mouse - 0.5) * 1.5;

  // --- Mouse interaction: time distortion ---
  float localTime = t + u_mouse.x * 2.0;

  // --- Mouse interaction: warp magnification near cursor ---
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float mouseDist = distance(uv, u_mouse);
  float mouseWarp = smoothstep(0.4, 0.0, mouseDist) * 0.5;
  float effectiveWarp = u_warpStr * (1.0 + mouseWarp);

  // --- Evaluate the warped pattern ---
  vec2 q, r;
  float f = func(p, localTime, effectiveWarp, q, r);

  // --- Bump-mapped lighting via finite differences ---
  float eps = 2.0 / u_resolution.y;
  vec2 dq, dr;
  float fx = func(p + vec2(eps, 0.0), localTime, effectiveWarp, dq, dr);
  float fy = func(p + vec2(0.0, eps), localTime, effectiveWarp, dq, dr);

  vec3 nor = normalize(vec3(fx - f, 2.0 * eps, fy - f));

  // Light direction from configurable angle
  float angRad = u_lightAng * 3.14159265 / 180.0;
  vec3 lig = normalize(vec3(cos(angRad), 0.2, sin(angRad)));
  float dif = clamp(0.3 + 0.7 * dot(nor, lig), 0.0, 1.0);

  // --- Color mapping (4 layers using brand colors) ---
  vec3 color = mix(u_brandPrimary * 0.4, u_brandSecondary * 0.1, f);
  color = mix(color, vec3(0.9), dot(r, r));
  color = mix(color, u_brandAccent * 0.6, 0.2 + 0.5 * q.y * q.y);
  color = mix(color, u_brandPrimary * 0.8, 0.5 * smoothstep(1.2, 1.3, abs(r.x) + abs(r.y)));
  color = clamp(color * f * 2.0, 0.0, 1.0);

  // --- Lighting application ---
  vec3 lin = vec3(0.70, 0.90, 0.95) * (nor.y * 0.5 + 0.5)
           + vec3(0.15, 0.10, 0.05) * dif;
  color *= 1.2 * lin;

  // --- Invert + contrast ---
  color = mix(color, 1.0 - color, u_invert);
  color = 1.1 * color * color * u_contrast;

  // --- Post-processing ---

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap at 75%
  color = min(color, vec3(0.75));

  // Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
