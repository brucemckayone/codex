/**
 * Gyroid fragment shader — Organic gyroid volumetric with space inversion.
 *
 * Shadertoy-grade polish pass:
 *  - Removed redundant min(x, 0.75) + final clamp(color, 0, 0.75) that was
 *    neutralizing the ACES tone-map the shader already had (same class of
 *    bug found in vapor — good ACES gated by a hard clip downstream)
 *  - Smooth 3-stop depth palette via smoothstep weights replaces 3-way
 *    if/else chain — branchless in the 80-step raymarch
 *  - HDR accumulation scaled up (density 1x → 1.3x) so ACES has range
 *  - Bloom-adjacent highlight boost on brightest gyroid surfaces
 *  - Luminance-aware filmic grain
 */
export const GYROID_FRAG = `#version 300 es
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
uniform float u_scale1;
uniform float u_scale2;
uniform float u_speed;
uniform float u_density;
uniform float u_thickness;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 ACESFilm(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float sdGyroid(vec3 p, float scale, float thickness, float bias) {
  p *= scale;
  return abs(dot(sin(p), cos(p.zxy)) - bias) / scale - thickness;
}

// -- Smooth 3-stop depth palette (no branching) --
vec3 depthPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

void main() {
  float t = u_time * u_speed;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.5));

  float mx = (u_mouse.x - 0.5) * 3.14159;
  float my = (u_mouse.y - 0.5) * 1.5708;

  float cy = cos(mx), sy = sin(mx);
  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

  float cx = cos(my), sx = sin(my);
  rd.yz = mat2(cx, -sx, sx, cx) * rd.yz;

  vec3 acc = vec3(0.0);
  float accAlpha = 0.0;
  float stepSize = 0.04;
  float bias = sin(t * 0.3) * 0.2;

  for (int i = 0; i < 80; i++) {
    if (accAlpha > 0.95) break;

    vec3 p = ro + rd * float(i) * stepSize;
    float depth = float(i) / 80.0;

    float ct = cos(t), st = sin(t);
    p.xz = mat2(ct, -st, st, ct) * p.xz;

    p = p * 2.5 / (dot(p, p) + 0.001);

    float thk = u_thickness + u_burstStrength * 0.02;
    float g1 = sdGyroid(p, u_scale1, thk, bias);
    float g2 = sdGyroid(p, u_scale2, thk * 0.5, bias * 0.5);
    float s = min(g1, g2);

    float dens = smoothstep(0.05, 0.0, abs(s)) * u_density / 80.0;
    dens *= 1.3;   // HDR headroom for ACES

    // Smooth palette (branchless)
    vec3 col = depthPalette(depth);

    dens *= 1.0 + u_burstStrength * 3.0;

    acc += col * dens * (1.0 - accAlpha);
    accAlpha += dens * (1.0 - accAlpha);
  }

  // Background glow
  vec3 bgGlow = u_brandSecondary * exp(-dot(uv, uv) * 2.0) * 0.2;
  vec3 color = u_bgColor * 0.3 * (1.0 - accAlpha) + bgGlow * (1.0 - accAlpha) + acc;

  // Bloom boost on brightest gyroid surfaces
  float gyroidLum = dot(acc, vec3(0.299, 0.587, 0.114));
  color += pow(gyroidLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ──────────────────────────────────────────
  // ACES — no more redundant 0.75 clip (was neutralizing the tone-map)
  color = ACESFilm(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
