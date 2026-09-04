/**
 * Gyroid fragment shader — Organic gyroid volumetric with space inversion.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** The old march rotated space *inside* the loop:
 *
 * ```glsl
 * float ct = cos(t), st = sin(t);          // t = u_time * u_speed
 * p.xz = mat2(ct, -st, st, ct) * p.xz;     // 80x per pixel
 * ```
 *
 * That is a constant-rate whole-frame spin at 0.2 rad/s — the mechanical
 * rotation the brief bans, and the one the owner called out. It is now a
 * bounded `driftAxis` rotation of +-1.6 rad with a peak rate of 0.099 rad/s
 * (2x calmer, and with no turnaround the eye can lock onto). The level-set
 * `bias`, which shifts the gyroid's silhouette, was a single `sin(t * 0.3)`
 * and is now a `driftAxis` too — the same motion, without the metronome.
 *
 * **Motion kept.** Mouse rotation of the view direction is untouched at its
 * full +-90 / +-45 degree range. It is the viewer's own control and, through
 * the space inversion, it swings the structure's silhouette hard — exactly the
 * class the brief says to strengthen rather than tame.
 *
 * **The rotation left the loop entirely.** For a rotation acting only on xz,
 * `M * (ro + rd * s) == M*ro + (M*rd) * s`. So rotating the *ray* once before
 * the march is algebraically identical to rotating every sample inside it. That
 * deletes 80 `mat2` products (480 ALU) and 160 transcendentals per pixel, with
 * no change to the image whatsoever. This is the single largest saving in the
 * file and it was free.
 *
 * **Audio.** Previously none — the renderer did not even accept an `audio`
 * argument. Now: the drift and bias are paced by the musical clock, `u_bass`
 * thickens the primary surface (an outline response), `u_treble` thickens only
 * the fine second gyroid (high-frequency signal on high-frequency structure),
 * `u_energy` opens the depth palette, `u_beatPulse` pulses brightness on the
 * same channel as a click, and `u_centroid` walks the palette phase.
 *
 * **Cost.** 80 steps to 56. The step size and the density kernel are both
 * scaled by 80/56, which holds `kernel / step` at 1.25 — identical shell
 * sampling to before — while the per-pixel dither decorrelates *which* shells
 * each pixel misses. Today every pixel misses shells at the same depths, which
 * is precisely the visible banding; dithered, the same 1.25 samples per
 * crossing read as fine noise that the film grain already masks. Also removed:
 * 160 divides (`/scale` in `sdGyroid`, now a reciprocal passed in), 80 divides
 * (`u_density / 80.0` hoisted), and 56 divides (the palette's normalising
 * divide, replaced by a partition of unity).
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

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
uniform float u_density;
uniform float u_thickness;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Pacing clock, integrated in the renderer: wall-clock rate while silent, the
 * musical clock's rate while audio plays, crossfaded as a RATE so the drift
 * never jumps. \`u_speed\` scales it renderer-side and is no longer a uniform.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Was 80. See the file header for the sampling-ratio argument. */
const int MARCH_STEPS = 56;
const float INV_MARCH_STEPS = 1.0 / float(MARCH_STEPS);

/**
 * Step size and density kernel, both scaled from the original 0.04 / 0.05 by
 * 80/56. That preserves two things at once: the total marched distance
 * (0.04 * 80 == 0.0571 * 56 == 3.2) and the kernel/step ratio of 1.25, which
 * is how many samples a shell crossing receives.
 */
const float STEP_SIZE = 0.04 * 80.0 / float(MARCH_STEPS);
const float SHELL_KERNEL = 0.05 * 80.0 / float(MARCH_STEPS);

/**
 * Density normaliser. Deliberately the original 80 and not \`MARCH_STEPS\`:
 * samples per shell crossing is unchanged, so normalising by the new step
 * count would brighten every surface by 80/56.
 */
const float DENSITY_NORM = 1.0 / 80.0;

/** Peak drift rotation, radians. Peak rate is 1.6 * 0.062 = 0.099 rad/s. */
const float ROT_AMPLITUDE = 1.6;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 ACESFilm(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * \`invScale\` is passed in rather than computed as \`/ scale\`: this is called
 * twice per march step, so the two reciprocals hoist to two per pixel instead
 * of 112.
 */
float sdGyroid(vec3 p, float scale, float invScale, float thickness, float bias) {
  p *= scale;
  return abs(dot(sin(p), cos(p.zxy)) - bias) * invScale - thickness;
}

/**
 * Monotone 3-stop depth palette with no divide.
 *
 * The old form summed three \`smoothstep\` weights and divided by the total,
 * because smoothstepped ramps are not a partition of unity. Two nested
 * \`smootherstep\` mixes are — trivially, since a mix always sums to 1 — and
 * they are C2, so the depth gradient has no crease where stops meet.
 * \`spread\` widens the middle stop under the slow audio envelope.
 */
vec3 depthPalette(float t, float spread) {
  float lo = 0.55 - spread * 0.15;
  float hi = 0.45 + spread * 0.15;
  vec3 c = mix(u_brandPrimary, u_brandSecondary, smootherstep(0.0, lo, t));
  return mix(c, u_brandAccent, smootherstep(hi, 1.0, t));
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.5));

  // ── Pointer follow ──────────────────────────────────────────────
  // Kept at full range. Through the space inversion below, rotating the view
  // swings the whole structure's silhouette, so this is the strongest outline
  // control the viewer has.
  float mx = (u_mouse.x - 0.5) * 3.14159;
  float my = (u_mouse.y - 0.5) * 1.5708;

  float cy = cos(mx), sy = sin(mx);
  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

  float cx = cos(my), sx = sin(my);
  rd.yz = mat2(cx, -sx, sx, cx) * rd.yz;

  // ── Drift rotation, applied to the RAY, not to every sample ─────
  // Algebraically identical to rotating p inside the march (see header), so
  // this is a pure saving: 80 mat2 products and 160 transcendentals removed.
  float rot = driftAxis(u_clock, 3.3) * ROT_AMPLITUDE;
  float cr = cos(rot), sr = sin(rot);
  mat2 R = mat2(cr, -sr, sr, cr);
  ro.xz = R * ro.xz;
  rd.xz = R * rd.xz;

  // Level-set offset. Shifts which surface of the gyroid family is drawn, so
  // it deforms the silhouette — good motion, previously a single sine.
  float bias = driftAxis(u_clock * 0.5, 9.0) * 0.22;

  // Bass thickens the primary surface; treble thickens only the fine second
  // gyroid (scale2 is roughly 2x scale1, so it carries the small detail).
  // One-sided lifts, so silence is exactly the resting geometry.
  float thk = u_thickness * audioLift(u_bass, 0.30) + u_burstStrength * 0.02;
  float thk2 = thk * 0.5 * audioLift(u_treble, 0.35);

  // Hoisted reciprocals — see sdGyroid.
  float inv1 = 1.0 / u_scale1;
  float inv2 = 1.0 / u_scale2;

  // Slow envelope opens the palette; timbre walks its phase.
  float spread = u_energy * u_audioActive;
  float hueShift = audioHueShift(0.14);

  // Energy lifts density as a macro swell, and a click still flashes it.
  float dens0 = u_density * DENSITY_NORM
    * audioLift(u_energy, 0.22)
    * (1.0 + u_burstStrength * 3.0);

  // Per-pixel dither on the march offset. This is what makes 56 steps look
  // like 80: the shell misses stop happening at the same depths on every pixel.
  float dither = hash(gl_FragCoord.xy + fract(u_time * 0.37));

  vec3 acc = vec3(0.0);
  float accAlpha = 0.0;

  for (int i = 0; i < MARCH_STEPS; i++) {
    if (accAlpha > 0.95) break;

    float fi = float(i) + dither;
    vec3 p = ro + rd * fi * STEP_SIZE;

    // Space inversion — the effect itself. The one divide left in the loop.
    p = p * 2.5 / (dot(p, p) + 0.001);

    float g1 = sdGyroid(p, u_scale1, inv1, thk, bias);
    float g2 = sdGyroid(p, u_scale2, inv2, thk2, bias * 0.5);
    float s = min(g1, g2);

    float dens = smoothstep(SHELL_KERNEL, 0.0, abs(s)) * dens0;

    // HDR headroom for ACES.
    dens *= 1.3;

    vec3 col = depthPalette(fi * INV_MARCH_STEPS + hueShift, spread);

    acc += col * dens * (1.0 - accAlpha);
    accAlpha += dens * (1.0 - accAlpha);
  }

  // ── Composite ───────────────────────────────────────────────────
  // Background at full strength, weighted only by the structure's own
  // coverage. The old form was \`u_bgColor * 0.3 * (1.0 - accAlpha)\`, which
  // darkened the background by a fixed 70% — invisible on a dark brand, but on
  // a light one it rendered a mid-grey field instead of the creator's colour.
  vec3 bgGlow = u_brandSecondary * exp(-dot(uv, uv) * 2.0) * 0.2;
  vec3 color = (u_bgColor + bgGlow) * (1.0 - accAlpha) + acc;

  // Bloom on the brightest surfaces; beats widen the halo.
  float gyroidLum = dot(acc, vec3(0.299, 0.587, 0.114));
  color += pow(gyroidLum, 2.3)
    * mix(u_brandSecondary, u_brandAccent, 0.5)
    * (0.3 + beatHit(1.5) * 0.4);

  // Treble sparkle on the lit structure only, or it reads as screen dirt.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(u_time * 3.1) * 91.0);
  sparkle = pow(sparkle, 12.0) * u_treble * u_audioActive;
  color += sparkle * mix(u_brandAccent, vec3(1.0), 0.6) * min(gyroidLum, 1.0) * 2.2;

  // ── Post-process ──────────────────────────────────────────
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
