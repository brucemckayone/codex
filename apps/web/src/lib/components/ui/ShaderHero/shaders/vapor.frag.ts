/**
 * Vapor fragment shader — Volumetric dot noise clouds with ACES tonemapping.
 *
 * Shadertoy-grade polish pass:
 *  - Removed the `min(x, 0.7)` clip and `clamp(color, 0.0, 0.7)` final
 *    clamp that was neutralizing the ACES tone-map the shader already had —
 *    now ACES output reaches its natural 0..1 range
 *  - Smooth 3-stop palette replaces the per-step if/else depth colour
 *    branch (no dynamic branch in the inner raymarch loop)
 *  - HDR glow multiplier bumped so ACES has headroom to roll off
 *  - Bloom-adjacent highlight boost on brightest composite regions
 *  - Palette-tinted dark background (was flat bg * 0.2)
 *  - Luminance-aware filmic grain
 *
 * Dot noise + raymarching preserved — that part was good.
 */
export const VAPOR_FRAG = `#version 300 es
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
uniform float u_density;
uniform float u_speed;
uniform float u_scale;
uniform float u_warmth;
uniform float u_glow;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

const mat3 G = mat3(
  0.618, 0.324, 0.0,
  0.0, 0.618, 0.324,
  0.324, 0.0, 0.618
);

float dotNoise(vec3 p) {
  return dot(cos(G * p), sin(1.6 * p * G));
}

vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Smooth 3-stop depth palette (no branch) --
vec3 depthPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec2 mouseOffset = (u_mouse - 0.5) * 0.3;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv + mouseOffset, 2.0));

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float stepSize = 0.08;

  for (int i = 0; i < 80; i++) {
    if (alpha > 0.95) break;

    vec3 p = ro + rd * float(i) * stepSize;
    p *= u_scale * 0.1;

    p.z += u_time * u_speed * 0.1;
    p.x += sin(u_time * u_speed * 0.05) * 0.5;

    float d = dotNoise(p) * 0.5 + 0.5;
    d = smoothstep(0.3, 0.7, d) * u_density;

    float depthFrac = float(i) / 80.0;

    // Smooth palette lookup — branchless in the hot loop
    vec3 layerColor = depthPalette(depthFrac);

    // Warmth shift
    layerColor = mix(layerColor, layerColor * vec3(1.15, 1.0, 0.88), u_warmth);

    // Accumulate with HDR headroom (was 0.15, bump for ACES rolloff)
    float a = d * (1.0 - alpha) * 0.18;
    color += layerColor * a * u_glow * 1.3;
    alpha += a;
  }

  // Click brightness pulse
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5) * 0.4;

  // Palette-tinted dark background (was flat bg * 0.2)
  vec3 bgTinted = mix(u_bgColor * 0.22, u_brandPrimary * 0.1, 0.4);
  color = mix(bgTinted, color, min(alpha + 0.1, 1.0));

  // Bloom halo on brightest composite regions
  float vaporLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(vaporLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ───────────────────────────────────────────
  // ACES — the 0.7 clip that was here previously neutralised the rolloff.
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
