/**
 * Fracture fragment shader — Space subdivided by animated half-plane cuts.
 *
 * ## What changed and why
 *
 * **Motion.** Each cut's angle was `baseAngle + t * rate`, with `rate` a
 * per-cut hash and `t` wall clock. Every cut therefore swept through all
 * angles forever at its own constant rate — the mechanical sweep, applied to
 * the one thing in this preset the eye actually tracks. The angle is now a
 * bounded drift around the base angle: three incommensurate components whose
 * sum has an analytically bounded derivative and an effectively unbounded
 * period, so the shards breathe without ever completing a revolution and
 * without a turnaround the eye can time.
 *
 * The click used to add up to a full turn to every cut and then unwind it as
 * the burst decayed — a lurch out and a lurch home. It now advances a monotone
 * accumulator, so a click permanently re-deals the pattern, which is what the
 * interaction was always described as doing.
 *
 * Pointer influence on the cut angles is kept at full strength: it deforms the
 * shard outlines directly, which is exactly the motion this pass preserves.
 *
 * **Cost.** The shadow pass re-ran the whole cut loop from scratch, so
 * `getCutLine` was evaluated twice per cut — 9 extra calls, each three
 * `hashFloat` (three sines) plus a sine/cosine pair. The cut lines are
 * identical for both samples, so both dot products are now taken against one
 * line: 27 sines and 9 sine/cosine pairs per pixel removed, and the power-of-
 * two cell weight is computed once instead of twice (and as `exp2`, not
 * `pow(2.0, i)`).
 *
 * **Audio.** Beat and treble land on the shard edges — edge glow, lead width,
 * rim glint. Nothing audio-driven touches a cut angle: that would jerk the
 * geometry, which is the defect being removed, not a feature.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const FRACTURE_FRAG = `#version 300 es
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
uniform int u_cuts;
uniform float u_border;
uniform float u_shadow;
uniform float u_fill;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock for the cut-angle drift, integrated on the CPU (see
 * fracture-renderer.ts). Already scaled by the preset speed setting, which is
 * why there is no u_speed uniform any more: speed multiplies the integration
 * RATE, so changing it cannot retroactively rescale the angles the cuts have
 * already drifted to.
 */
uniform float u_clock;
/**
 * Monotone accumulated re-deal. Each click adds to this, and each cut reads it
 * through its own hash multiplier, so a click rotates every cut by a different
 * amount and the pattern never returns to where it was.
 */
uniform float u_shatter;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/**
 * Peak drift excursion of a cut angle, in radians.
 *
 * driftAxis has a peak rate of 0.062 per unit clock, so at this amplitude the
 * angle moves at most 0.078 rad per unit clock — against the renderer's 0.8/s
 * idle rate, 0.062 rad/s. Well inside the drift band, and applied to an
 * outline rather than to a camera.
 */
const float CUT_SWAY = 1.25;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hashFloat(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec2 hashVec2(float n) {
  return vec2(hashFloat(n), hashFloat(n + 57.3));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/** One cutting line: a point on it and its unit normal. */
void getCutLine(int i, float clock, vec2 mouseInfl, out vec2 pt, out vec2 norm) {
  float seed = float(i) * 13.37;
  pt = hashVec2(seed) * 0.6 + 0.2;
  float baseAngle = hashFloat(seed + 7.0) * 6.28318;
  float angle = baseAngle
    + driftAxis(clock, seed * 0.37) * CUT_SWAY
    + dot(mouseInfl, vec2(cos(baseAngle), sin(baseAngle))) * 0.5
    + u_shatter * hashFloat(seed + 23.0);
  norm = vec2(cos(angle), sin(angle));
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);

  vec2 mouseInfl = u_mouseActive * (u_mouse - vec2(0.5)) * 2.0;

  // ── Cut the plane and its shadow-offset copy in ONE pass ───────────
  // The cut lines are the same for both samples, so evaluating both dot
  // products against one line halves the hash work this shader spends.
  vec2 sOff = vec2(u_shadow, -u_shadow);
  float cellId = 0.0;
  float sCellId = 0.0;
  float minEdge = 1.0;
  float sEdge = 1.0;

  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;
    vec2 pt, nm;
    getCutLine(i, u_clock, mouseInfl, pt, nm);
    pt.x *= aspect;
    float w = exp2(float(i));

    float d = dot(p - pt, nm);
    cellId += step(0.0, d) * w;
    minEdge = min(minEdge, abs(d));

    float sd = dot(p + sOff - pt, nm);
    sCellId += step(0.0, sd) * w;
    sEdge = min(sEdge, abs(sd));
  }

  // ── Cell colour ────────────────────────────────────────────────────
  vec3 palette[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);
  float cs = hashFloat(cellId * 17.31 + 0.5);
  int idx = clamp(int(floor(cs * 3.0)), 0, 2);
  vec3 cellColor = palette[idx];

  // Per-cell tint shift, so cells sharing a palette slot still differ. Timbre
  // pushes the shift further toward the next stop on bright material, which
  // moves colour without moving an edge.
  float tintHash = hashFloat(cellId * 31.7 + 3.0);
  float tintDepth = 0.25 + audioHueShift(0.2);
  vec3 tinted = mix(
    cellColor,
    mix(cellColor, palette[(idx + 1) % 3], 0.4),
    clamp(tintHash * tintDepth, 0.0, 1.0)
  );
  tinted *= 0.92 + tintHash * 0.2;

  // HDR cell emission for ACES headroom. The slow envelope lifts it, so a
  // busy passage reads as a brighter pane rather than as flicker.
  cellColor = tinted * 1.25 * audioLift(u_energy, 0.16);

  // ── Border (anti-aliased) ──────────────────────────────────────────
  float fw = fwidth(minEdge);
  float borderMask = 1.0 - smoothstep(u_border - fw, u_border + fw, minEdge);

  // ── Shadow ─────────────────────────────────────────────────────────
  float shadowMask = (sCellId != cellId) ? 1.0 : 0.0;
  shadowMask *= smoothstep(0.0, u_shadow * 2.0, u_shadow * 2.0 - sEdge);
  shadowMask = clamp(shadowMask, 0.0, 0.5);

  // Interior gradient — brighter farther from an edge, which fakes polygon
  // depth without shading.
  float interior = smoothstep(0.0, 0.08, minEdge);
  vec3 interiorTint = cellColor * (0.85 + 0.3 * interior);

  // ── Lead and shadow colour, luminance-aware ────────────────────────
  // u_bgColor may be light. A light brand needs the lead pushed further down
  // to still read as a drawn line, while a dark one is already dark enough
  // that keeping some colour in it looks better than crushing it to black.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float onLight = smootherstep(0.25, 0.8, bgLum);
  vec3 leadColor = u_bgColor * mix(0.40, 0.14, onLight);
  vec3 shadowColor = u_bgColor * mix(0.30, 0.55, onLight);

  // ── Composite ──────────────────────────────────────────────────────
  vec3 color = mix(u_bgColor, interiorTint, u_fill);
  color = mix(color, shadowColor, shadowMask);
  color = mix(color, leadColor, borderMask);

  // ── Edge response ──────────────────────────────────────────────────
  // Beats, treble and clicks all land here, just outside the lead. Outline
  // light is the response the brief asks for on this kind of preset; the cut
  // angles stay untouched by audio so the geometry can never snap.
  float rimSpan = u_border * (2.6 + u_treble * u_audioActive * 1.4);
  float rim = 1.0 - smoothstep(u_border, rimSpan, minEdge);
  color += rim * mix(u_brandAccent, vec3(1.0), 0.45)
         * (beatHit(1.5) * 0.55 + u_treble * u_audioActive * 0.12 + u_burst * 0.3);

  // ── Post-process ───────────────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  // Vignette frames a hero but reads as a tunnel in fullscreen immersive
  // mode, so it fades out with the audio ramp rather than switching off.
  color *= clamp(1.0 - dot(vc, vc) * u_vignette * (1.0 - u_audioActive), 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
