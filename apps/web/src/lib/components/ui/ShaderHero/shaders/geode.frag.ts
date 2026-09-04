/**
 * Geode (Agate Cross-Section) fragment shader.
 *
 * ## What changed and why
 *
 * **Motion.** The whole slab rotated at a constant rate: `angle = t * 0.5`
 * with `t = u_time * u_speed`. Slow — a full turn took about three and a half
 * minutes at the shipped speed — but a constant yaw off wall clock is exactly
 * the whole-frame rotation this pass removes, and over the half-minute a
 * visitor spends on a hero it reads as a steady mechanical tilt. It is now a
 * bounded drift: three incommensurate components summing to at most 0.55 rad
 * of excursion, so the slab rocks in place and never completes a revolution.
 * The click used to add `u_burst * 0.5` to that angle and then unwind it as
 * the burst decayed; it now advances a monotone accumulator, so a click nudges
 * the slab and the slab stays nudged.
 *
 * The band-warp field scrolled linearly (`fbm(p * 3.0 + t * 0.2)`), which
 * walked the whole agate pattern off frame given long enough. It now wanders
 * on a bounded drift, so the bands undulate in place.
 *
 * The crystal cells in the cavity all jittered at one shared frequency with
 * only their phase hashed, so the whole cavity pulsed in lockstep. Each cell
 * now has a hashed rate too — one extra multiply-add, no extra trigonometry —
 * so the cavity shimmers instead of breathing as one.
 *
 * **Cost.** The two domain-warp `fbm` calls dropped from three octaves to two.
 * The warp is a low-frequency displacement scaled by 0.3 before use, so the
 * third octave contributed under 5% of an offset the band quantiser rounds
 * away; that removes 8 of the 24 value-noise taps this shader ran per pixel
 * outside the cavity. `bandPalette` also stopped constructing a local
 * `vec3[4]` on each of its two calls per pixel.
 *
 * **Colour.** Band stop 0 was `u_bgColor * 1.3`, which on a light brand is
 * above 1.0 and clips to white after tone mapping — the outermost band
 * vanished. It is now luminance-aware: a dark background is lifted, a light
 * one is darkened, so the band structure survives either.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const GEODE_FRAG = `#version 300 es
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
uniform int u_bands;
uniform float u_warp;
uniform float u_cavity;
uniform float u_sparkle;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock for the slab drift, the warp wander and the crystal
 * jitter, integrated on the CPU (see geode-renderer.ts). Already scaled by the
 * preset speed setting, which is why there is no u_speed uniform any more.
 */
uniform float u_clock;
/**
 * Monotone accumulated tilt in radians. Separate from u_clock because it
 * carries the click surge: that must add to a rotation RATE, never to a
 * rotation angle, or the slab counter-rotates as the burst decays.
 */
uniform float u_tilt;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/**
 * Peak excursion of the slab drift, in radians.
 *
 * driftAxis peaks at 0.062 per unit clock, so this amplitude moves the slab at
 * most 0.034 rad per unit clock — against the renderer's 0.8/s idle rate,
 * 0.027 rad/s. That is the same order as the constant yaw it replaces, so the
 * preset feels no faster; the difference is that it is bounded and never
 * repeats.
 */
const float TILT_SWAY = 0.55;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
}

/** Value-noise lattice hash in -1..1. */
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

/**
 * Two-octave value-noise FBM for the domain warp.
 *
 * The warp is a low-frequency displacement scaled by 0.3 before use, so a
 * third octave contributes 0.125/0.875 of an already small offset — under 5%,
 * which the band quantiser rounds away. Dropping it removes four value-noise
 * taps per call, and this is called twice per pixel.
 */
float fbm2(vec2 p) {
  float f = valueNoise(p) * 0.5;
  p = octaveRot * p * 2.02;
  return (f + valueNoise(p) * 0.25) / 0.75;
}

/**
 * Crystal cell structure in the cavity: F2 - F1 and the nearest cell's id.
 *
 * Each cell's jitter has its own hashed RATE as well as its own hashed phase.
 * With a single shared frequency the entire cavity reached its extremes at the
 * same instant, which reads as the cavity breathing rather than as facets
 * catching the light independently.
 */
vec2 voronoi(vec2 p, float clock) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float minDist2 = 8.0;
  float cellId = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 rate = 0.35 + o * 0.5;
      o = 0.5 + 0.4 * sin(clock * rate + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        cellId = hash(n + g);
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  return vec2(minDist2 - minDist, cellId);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Cyclic 4-stop band palette: ground, primary, secondary, shaded primary.
 *
 * Built from step-weighted mixes rather than a local vec3[4]. The array form
 * was constructed fresh on each of the two calls per pixel; drivers that do
 * not promote a function-local array to constant memory paid twelve vector
 * writes to serve two lookups.
 *
 * \`ground\` is passed in already luminance-corrected — see the call site.
 */
vec3 bandPalette(float idx, vec3 ground) {
  float s1 = step(0.5, idx);
  float s2 = step(1.5, idx);
  float s3 = step(2.5, idx);
  vec3 c = mix(ground, u_brandPrimary, s1);
  c = mix(c, u_brandSecondary, s2);
  return mix(c, u_brandPrimary * 0.8, s3);
}

void main() {
  float clock = u_clock;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  // Bounded rock plus the monotone click tilt. No constant yaw.
  float angle = driftAxis(clock, 5.1) * TILT_SWAY + u_tilt;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  // The warp field wanders on a bounded drift instead of scrolling linearly,
  // so the bands undulate in place rather than translating off frame. The
  // slow envelope widens the warp — a macro signal, so it never twitches.
  vec2 warpWander = drift2(clock, 9.3) * 0.9;
  float warpAmt = u_warp * 0.3 * audioLift(u_energy, 0.2);
  vec2 warpedP = p + warpAmt * vec2(
    fbm2(p * 3.0 + warpWander),
    fbm2(p * 3.0 + 100.0 + warpWander.yx)
  );
  float dist = length(warpedP);
  float normDist = clamp(dist / 0.8, 0.0, 1.0);

  // Cavity radius breathes on the SLOW envelope only. This is the one term
  // that moves an outline, so it cannot come from a band — a per-note radius
  // would pump the whole silhouette.
  float cavity = u_cavity * audioLift(u_energy, 0.14);

  // Ground stop for the outermost band. The old value was u_bgColor * 1.3,
  // which on a light brand exceeds 1.0 and clips to white after tone mapping,
  // erasing the band. Lift a dark background, darken a light one.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float onLight = smootherstep(0.3, 0.75, bgLum);
  vec3 ground = u_bgColor * mix(1.35, 0.72, onLight);

  vec3 color;

  if (normDist < cavity) {
    // ── Crystal cavity ──
    vec2 vor = voronoi(warpedP * 12.0, clock);
    float edge = vor.x;
    float id = vor.y;

    vec3 crystalCol = u_brandAccent * (0.75 + 0.5 * id);

    // Bright crack edges. A beat brightens them: the cracks are the cavity's
    // outline, which is where the brief wants a transient to land.
    float edgeLine = 1.0 - smoothstep(0.0, 0.08, edge);
    crystalCol = mix(
      crystalCol,
      mix(u_brandAccent, vec3(1.0), 0.6),
      edgeLine * (0.6 + beatHit(1.5) * 0.3)
    );

    // Pointer-driven specular. Kept at full strength — relighting a crystal by
    // moving the pointer is the one motion the viewer causes directly.
    vec3 lightDir = normalize(vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5));
    vec3 normal = normalize(vec3(dFdx(edge) * 10.0, dFdy(edge) * 10.0, 1.0));
    float spec = pow(max(dot(normal, lightDir), 0.0), 16.0) * u_sparkle;
    crystalCol += spec * u_mouseActive * 2.5;

    // Treble is spatially high-frequency as well as spectrally, so it goes on
    // a fine per-pixel glitter inside the cavity and nowhere else.
    float glitter = hash(gl_FragCoord.xy * 1.9 + fract(u_time * 3.7) * 63.0);
    glitter = pow(glitter, 12.0) * u_treble * u_audioActive;
    crystalCol += glitter * mix(u_brandAccent, vec3(1.0), 0.7) * 2.2;

    color = crystalCol;
  } else {
    // ── Mineral bands ──
    float bandF = normDist * float(u_bands);
    float bandIdx = floor(bandF);
    float bandFrac = fract(bandF);

    float fw = fwidth(bandF);
    float edgeSmooth = smoothstep(0.5 - fw, 0.5 + fw, bandFrac);

    float idx = mod(bandIdx, 4.0);
    float nextIdx = mod(bandIdx + 1.0, 4.0);

    vec3 bandColor = bandPalette(idx, ground);
    vec3 nextColor = bandPalette(nextIdx, ground);

    bandColor *= 0.85 + 0.3 * hash(vec2(bandIdx, 0.0));
    nextColor *= 0.85 + 0.3 * hash(vec2(bandIdx + 1.0, 0.0));

    color = mix(bandColor, nextColor, edgeSmooth);
    color *= smoothstep(1.0, 0.7, normDist);

    // Timbre warms or cools the bands around a neutral centre, so the mineral
    // temperature tracks what the music sounds like. Colour only — the band
    // boundaries themselves never move under audio.
    color = audioTint(color, mix(color, u_brandSecondary, 0.6), u_centroid, 0.35);
  }

  // ── Bloom halo around the cavity boundary ──────────────────────────
  float cavityProx = smoothstep(cavity + 0.04, cavity - 0.04, normDist);
  float sparkleLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(sparkleLum * cavityProx, 2.0) * u_brandAccent
         * (0.4 + beatHit(1.8) * 0.25 + u_burst * 0.3);

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
