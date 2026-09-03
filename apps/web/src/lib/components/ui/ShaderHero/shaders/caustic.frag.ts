/**
 * Caustic fragment shader — Underwater light patterns (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 3-stop palette (bg → primary → secondary → accent) via smoothstep
 *    weights; no per-pixel branching
 *  - ACES filmic tone map — preserves highlight hierarchy so brightest
 *    convergence rays actually read as brighter than secondary rays
 *    (old min(x, 0.75) clipped all hot rays to the same ceiling)
 *  - Bloom-adjacent highlight boost on the hottest convergence lines
 *  - Subtle cool (primary-tinted) background gradient — "underwater" feel
 *  - Luminance-aware film grain
 *
 * ## 2026-09 pass: audio, branchless palette, divide guard
 *
 * Caustics are converging light, which makes them one of the most natural
 * audio subjects in the set: everything worth modulating is a LIGHT-side term,
 * so audio never has to touch geometry and can never introduce a jolt.
 *
 * - Shimmer paces on the CPU-integrated musical clock, so the water surface
 *   moves with the track and stills between phrases.
 * - Bass drives convergence brightness; beats flash the hottest rays.
 * - Treble sparkles on convergence lines only, where it reads as light on
 *   water rather than noise on the screen.
 * - Timbre slides the palette position, so colour tracks WHAT is playing.
 *
 * Two pre-existing defects fixed:
 *
 * 1. The header claimed "no per-pixel branching", but causticPalette had two
 *    `if` returns. Now genuinely branchless — two nested mixes over the same
 *    smoothstep weights, which is both cheaper and honest.
 * 2. `causticPattern` divided by `float(u_iterations)`. That comes from a brand
 *    token, so a 0 produced a divide-by-zero, NaN, and a black frame with no
 *    error anywhere. Clamped at the division.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const CAUSTIC_FRAG = `#version 300 es
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
uniform float u_scale;
uniform int u_iterations;
/**
 * Monotone shimmer clock, integrated on the CPU (see caustic-renderer.ts) and
 * already scaled by speed. Replaces u_time * u_speed so the caustic pattern
 * advances with the music rather than at a fixed rate.
 */
uniform float u_clock;
uniform float u_brightness;
uniform float u_ripple;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

const mat2 iterRot = mat2(0.8, 0.6, -0.6, 0.8);

// -- Core caustic function: iterative sin/cos warp, accumulate convergence --
float causticPattern(vec2 uv, float t) {
  vec2 p = uv * u_scale;
  float c = 0.0;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_iterations) break;
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0) * u_brightness);
    freq *= 2.0;
    p = iterRot * p;
  }
  // u_iterations comes from a brand token, so 0 is reachable — and dividing by
  // it yields NaN, which renders as a black frame with nothing logged.
  return c / float(max(u_iterations, 1));
}

// -- Smooth 4-stop palette: bg → primary → secondary → accent --
vec3 causticPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = u_bgColor * 0.5;
  vec3 c1 = u_brandPrimary;
  vec3 c2 = u_brandSecondary;
  vec3 c3 = u_brandAccent;
  // Branchless: each mix hands off to the next as its weight saturates, which
  // reproduces the old three-way branch exactly at the stop boundaries.
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.333, t));
  c = mix(c, c2, smoothstep(0.333, 0.666, t));
  return mix(c, c3, smoothstep(0.666, 1.0, t));
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // Shimmer advances on the integrated musical clock, never on a positional
  // crossfade — beatPhase starts at zero while u_time does not, so blending
  // the two positions would run the caustic warp backwards on audio start.
  float t = u_clock;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 uv = v_uv;
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);

  // Mouse ripple — localized pattern disturbance
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = (mouseDist > 0.001) ? normalize(fragUV - mouseUV) : vec2(0.0);
  uv += u_mouseActive * u_ripple * 0.02
      * sin(mouseDist * 30.0 - t * 5.0)
      * exp(-mouseDist * 8.0)
      * mouseDir;

  // Click burst — propagating ring
  if (u_burst > 0.01) {
    float burstRing = sin(mouseDist * 20.0 - t * 8.0) * exp(-mouseDist * 4.0);
    uv += u_burst * 0.03 * burstRing * mouseDir;
  }

  // Two-layer caustic accumulation for smoother patterns
  float c1 = causticPattern(uv, t);
  float c2 = causticPattern(uv, t + 0.5);
  float c = (c1 + c2) * 0.5;

  // Normalize — clamped in [0,1] feeds palette
  float cNorm = clamp(c, 0.0, 1.0);

  // ── Smooth palette lookup ───────────────────────────────────
  // Timbre slides the sampled position along the ramp, so bright material
  // pushes the caustics toward the accent stop and dark material back toward
  // the water body. Colour then tracks what is playing, not how loud it is.
  vec3 color = causticPalette(clamp(cNorm + audioHueShift(0.18), 0.0, 1.0));

  // ── Bloom-adjacent highlight boost on hot convergence rays ──
  // Convergence > 0.75 reads as "focused light" — give it emission >> 1
  // so ACES tone-maps it to a bright core rather than flat white.
  //
  // Beats widen the hot band by lowering its threshold, which reads as the
  // light focusing rather than as anything moving. A caustic's convergence is
  // the one place a transient belongs.
  float hotEdge = 0.75 - beatHit(1.5) * 0.18;
  float hotMask = smoothstep(hotEdge, 1.0, cNorm);
  color += mix(u_brandSecondary, u_brandAccent, 0.5) * hotMask
         * (1.2 + beatHit(1.5) * 0.8);

  // Treble sparkle, confined to convergence lines — off them it would read as
  // dirt on the screen rather than light on water.
  float sparkle = hash(gl_FragCoord.xy * 1.9 + fract(u_time * 4.3) * 71.0);
  sparkle = pow(sparkle, 14.0) * u_treble * u_audioActive;
  color += sparkle * mix(u_brandAccent, vec3(1.0), 0.65)
         * smoothstep(0.45, 0.9, cNorm) * 3.0;

  // ── Underwater background gradient (cool, primary-tinted) ──
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgCool = mix(
    u_bgColor + u_brandPrimary * 0.04,   // centre: bg with gentle cool lift
    u_bgColor * 0.75,                      // edges: deeper
    smoothstep(0.0, 1.4, r2)
  );

  // ── Post-process ────────────────────────────────────────────
  color = aces(color);                     // ACES (replaces min(x, 0.75))
  color = mix(bgCool, color, u_intensity); // underwater bg instead of flat
  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  // Luminance-aware grain
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
