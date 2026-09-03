/**
 * Flux fragment shader — magnetic field lines around a set of poles.
 *
 * ## What this preset is
 *
 * Iso-contours of the scalar potential of several point charges. What the eye
 * reads is the CONFIGURATION: how many poles there are, where they sit, and
 * how densely the lines pack between them. Brightening a field does very
 * little; rearranging one is striking. That is the audio target here.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** The poles orbited at a constant angular rate,
 * `angle = t * (0.3 + fi * 0.1)`, with the orbit radius on a single
 * `sin(t * 0.2)` — the textbook mechanical sweep, and the speed slider
 * multiplied its frequency so turning speed up turned drift into a lurch.
 * Poles now sit in fixed angular slots (so a 3-pole configuration still reads
 * as a triangle rather than a cluster) and WANDER around them on `drift2()`:
 * three incommensurate low-frequency components per axis, peak positional rate
 * 0.062 * 8 * 0.375 = 0.186 units per unit clock, so 0.0186 units/s at the
 * default speed of 0.1, against roughly 0.015 units/s for the old orbit —
 * same pace, no turnaround for the eye to latch onto, and an effectively
 * unbounded period. The pointer pole also snapped:
 * `u_mouseActive` arrived as a hard 1 or 0, so the whole field reconfigured in
 * one frame when the pointer left. It is a damped 0..1 now.
 *
 * **Audio.** Previously `speed + amplitude * 0.2` off the raw per-frame
 * amplitude, which reads as jitter. Now:
 *
 *  - `u_beatSeed` re-rolls a bounded kick on every pole's position at each
 *    onset, so the field REORGANISES on the beat. Direction is re-rolled,
 *    magnitude is fixed at 0.08 in a frame that spans about 3.5 units, and the
 *    seed is slewed over 250ms upstream so each re-roll is a glide;
 *  - `u_bass` (smoothed; designated for body and thickness) sets line width;
 *  - `u_energy` (4s time constant) sets line density, at a deliberately small
 *    depth: `linePhase` is `potential * density`, and the potential reaches
 *    about 14, so a large density swing would scroll the lines rather than
 *    compress them;
 *  - `u_treble` sparkles along the lines, `u_beatPulse` blooms them,
 *    `u_centroid` slides the palette, `u_flux` rides the grain.
 *
 * **Cost.** The mouse pole was the loop's last iteration behind an if/else, so
 * every pole paid for a branch only one of them needed; it is hoisted out. The
 * charge sign became arithmetic rather than a ternary, `length()` became
 * `dot()` (the field magnitude only ever wanted the square, so four `sqrt`
 * calls were pure waste), the per-pole slot divide is hoisted, and the palette
 * lost its three-way if/else chain for nested `smootherstep` mixes.
 *
 * **Colour.** The non-line fill was a flat `* 0.18`, which renders a light
 * brand background as dark grey. It now lifts toward the background's own
 * value as the palette gets lighter, and the tonemap gains back the 0.804 that
 * ACES costs a light background.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const FLUX_FRAG = `#version 300 es
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
uniform int u_poles;
uniform float u_lineDensity;
uniform float u_lineWidth;
uniform float u_strength;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see flux-renderer.ts).
 *
 * Already scaled by the preset's speed setting, which is why there is no
 * u_speed uniform any more: speed multiplies the integration RATE rather than
 * the elapsed time, so changing it cannot retroactively teleport the poles to
 * a different point on their path.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

const float TWO_PI = 6.28318530718;

/** Upper bound on the pole count. The active count is u_poles. */
const int MAX_POLES = 6;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Smooth 4-stop field-magnitude ramp: bg to primary to secondary to accent.
 *
 * Was a three-way if/else chain on t. Nested smootherstep mixes are
 * branch-free and C2-continuous, so the ramp has no visible seam where the
 * old branches met.
 */
vec3 fluxPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(u_bgColor, u_brandPrimary, smootherstep(0.0, 0.36, t));
  c = mix(c, u_brandSecondary, smootherstep(0.30, 0.70, t));
  return mix(c, u_brandAccent, smootherstep(0.64, 1.0, t));
}

void main() {
  // Integrated by the renderer, never derived here. Deriving it as
  // mix(u_time * k, u_beatPhase, u_audioActive) would sweep it BACKWARDS as
  // the audio ramp eased in, because beatPhase starts at zero when the
  // analyser is created while u_time may already be at 60s — every pole would
  // rewind along its path at the moment playback started.
  float clock = u_clock;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  int poleCount = max(u_poles, 1);
  // Hoisted: this divide used to run once per pole.
  float slotStep = TWO_PI / float(poleCount);

  // Per-onset reshuffle of the configuration. The seed is re-rolled on each
  // onset and slewed over 250ms upstream, so a re-roll glides; the magnitude
  // is bounded so no beat can throw a pole across the frame.
  float seedAng = u_beatSeed * TWO_PI;
  float seedKick = 0.08 * u_audioActive;

  // Line geometry. Bass thickens (body and weight); the slow envelope packs
  // the lines, at low depth because linePhase multiplies the potential and a
  // large density swing scrolls the whole pattern instead of compressing it.
  float lineWidth = u_lineWidth * audioLift(u_bass, 0.35);
  float lineDensity = u_lineDensity * audioLift(u_energy, 0.15);

  float potential = 0.0;
  float fieldMag = 0.0;

  for (int i = 0; i < MAX_POLES; i++) {
    if (i >= poleCount) break;

    float fi = float(i);
    float slot = fi * slotStep;

    // Fixed angular slot, plus bounded non-repeating wander, plus the beat
    // kick. The slot is what keeps the configuration legible; the wander is
    // what replaces the old constant-rate orbit.
    vec2 anchor = vec2(cos(slot), sin(slot)) * 0.45;
    vec2 wander = drift2(clock * 8.0, fi * 13.0 + 3.0) * 0.375;
    vec2 kick = vec2(cos(seedAng + slot), sin(seedAng + slot)) * seedKick;
    vec2 polePos = anchor + wander + kick;

    // Alternating polarity, branch-free: mod(fi, 2) is 0 or 1, so this is
    // +strength then -strength. Was a ternary.
    float charge = u_strength * (1.0 - 2.0 * mod(fi, 2.0));

    vec2 d = uv - polePos;
    // Only the SQUARE of the distance is ever used, so the old length() call
    // was a sqrt whose result was immediately squared again.
    float d2 = max(dot(d, d), 4.0e-4);
    potential += charge * atan(d.y, d.x);
    fieldMag += abs(charge) / d2;
  }

  // Pointer pole, outside the loop. It used to be the loop's final iteration
  // behind an if/else, so all the real poles carried a branch none of them
  // needed. u_mouseActive is a damped 0..1 in the renderer, so the field eases
  // back when the pointer leaves instead of reconfiguring in one frame.
  if (u_mouseActive > 0.002) {
    vec2 polePos = (u_mouse * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
    // Click flips the pointer pole's polarity — smoothly, via the burst ramp.
    float charge = u_strength * mix(1.0, -1.0, smoothstep(0.0, 0.5, u_burst)) * u_mouseActive;
    vec2 d = uv - polePos;
    float d2 = max(dot(d, d), 4.0e-4);
    potential += charge * atan(d.y, d.x);
    fieldMag += abs(charge) / d2;
  }

  // Field lines via fract + fwidth anti-aliasing.
  float phaseArg = potential * lineDensity / TWO_PI;
  float linePhase = fract(phaseArg);
  float fw = fwidth(phaseArg) * lineWidth;
  float lineMask = smoothstep(0.5 - fw, 0.5, linePhase) - smoothstep(0.5, 0.5 + fw, linePhase);
  lineMask += smoothstep(fw, 0.0, linePhase) + smoothstep(1.0 - fw, 1.0, linePhase);
  lineMask = clamp(lineMask, 0.0, 1.0);

  float logField = clamp(log(1.0 + fieldMag) / 3.0, 0.0, 1.0);

  // Timbre slides the ramp position; every brand stop stays intact.
  vec3 gradientColor = fluxPalette(logField + audioHueShift(0.15));

  // u_bgColor is a brand slot and may be light. A flat 0.18 fill renders a
  // white background as dark grey, so the floor lifts with the palette.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float lightBg = smoothstep(0.42, 0.76, bgLum);
  float fillFloor = mix(0.18, 0.88, lightBg);

  // HDR line emission — fill lifted, lines scaled so ACES renders them as
  // luminous filaments rather than clipping them flat.
  vec3 color = gradientColor * mix(fillFloor, 1.6, lineMask);

  // Bloom on the brightest lines, which are the ones near a pole. Beats widen
  // the halo — light side, so a transient never moves a pole.
  float lineLum = lineMask * logField;
  color += pow(lineLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * (0.35 + beatHit(1.5) * 0.35);

  // Treble sparkle, on the lines only. High-frequency content is spatially
  // high-frequency too, so it belongs on a per-pixel term; masking by
  // lineMask keeps it from reading as dirt on the empty field.
  float sparkle = hash(gl_FragCoord.xy * 1.6 + fract(u_time * 3.7) * 61.0);
  sparkle = pow(sparkle, 10.0) * u_treble * u_audioActive;
  color += sparkle * mix(u_brandAccent, vec3(1.0), 0.6) * lineMask * 2.0;

  // ── Post-process ──────────────────────────────────────────
  //
  // ACES maps an input of 1.0 to 0.804, so a light brand background could
  // never render at its own value. Gain that back in proportion to how light
  // the palette is; at lightBg = 0 the multiplier is exactly 1.0 and the dark
  // look is bit-identical.
  //
  // White point 1.6, matching the line emission scale above, rather than 1.0.
  // A full gain leaves headroom only to an input of about 1.13, and a line on
  // a light palette reaches 1.57 — so lines and fill would both clip to white
  // and the field would read as blank. This is the same failure measured on
  // clouds, where the full-gain form cut within-cloud contrast by 47%.
  const float ACES_WHITE = 0.8862;   // aces(1.6)
  color = clamp(aces(color) * mix(1.0, 1.0 / ACES_WHITE, lightBg), 0.0, 1.0);

  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Luminance-aware grain. Spectral flux is noisy by construction — right for
  // grain, wrong for anything structural.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum) * (1.0 + u_flux * 0.5 * u_audioActive);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
