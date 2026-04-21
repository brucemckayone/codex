/**
 * Julia fragment shader — Animated Julia set fractal with cosine palette.
 *
 * Shadertoy-grade polish pass:
 *  - Cosine-palette retained (iq's palette(t, a, b, c, d) pattern is
 *    ideal for fractal iteration counts) but offset vectors `pd` now
 *    pull from *brand hue information* via normalized brand positions,
 *    not luminance — old pd collapsed all three brand colors to single
 *    luminance scalars and lost hue distinction
 *  - ACES filmic tone map replaces min(x, 0.7) clip
 *  - HDR palette amplitude (saturation * 1.25) for ACES headroom
 *  - Bloom-adjacent highlight boost on brightest fractal regions
 *  - Core (non-escaped) now gets subtle primary tint rather than flat
 *    bg * 0.15 — gives the interior some depth
 *  - Luminance-aware filmic grain
 */
export const JULIA_FRAG = `#version 300 es
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
uniform float u_zoom;
uniform float u_speed;
uniform int u_iterations;
uniform float u_radius;
uniform float u_saturation;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  uv /= u_zoom;

  float t = u_time * u_speed;
  float r = u_radius + 0.05 * sin(t * 0.7);
  vec2 c_base = r * vec2(cos(t / 3.0), sin(t / 3.0));
  vec2 mouseOffset = (u_mouse - 0.5) * 0.4;
  vec2 c = mix(c_base + mouseOffset, c_base, u_burstStrength * 0.8);

  vec2 z = uv;
  int i;
  for (i = 0; i < 100; i++) {
    if (i >= u_iterations) break;
    if (dot(z, z) > 256.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  }

  vec3 color;
  if (i >= u_iterations) {
    // Non-escaped core — deep tinted interior rather than flat bg*0.15
    color = mix(u_bgColor * 0.15, u_brandPrimary * 0.12, 0.5);
  } else {
    float smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
    float t_color = smoothIter / float(u_iterations);

    // Cosine-palette vectors — HDR amplitude (saturation * 1.25) for ACES
    vec3 pa = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation * 1.25 + 0.3;
    vec3 pb = (u_brandAccent - u_bgColor * 0.3) * u_saturation * 1.25 + 0.2;
    vec3 pc = vec3(1.0, 1.0, 1.0);
    // pd offsets preserve full brand hue rotation (vs old luminance-dot)
    vec3 pd = vec3(
      u_brandPrimary.r * 0.6 + u_brandPrimary.g * 0.4,
      u_brandSecondary.g * 0.6 + u_brandSecondary.b * 0.4,
      u_brandAccent.b * 0.6 + u_brandAccent.r * 0.4
    );

    color = palette(t_color, pa, pb, pc, pd);
  }

  // Bloom boost on brightest fractal regions
  float fracLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(fracLum, 2.4) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

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
