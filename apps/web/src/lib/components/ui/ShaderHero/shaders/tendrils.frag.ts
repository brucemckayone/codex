/**
 * Curl Noise Tendrils fragment shader (GLSL ES 3.0).
 *
 * ## What this preset is
 *
 * Filaments traced by advecting each pixel backwards through a
 * divergence-free flow and accumulating where the path crosses a level set of
 * a noise field. The subject is the filament's OUTLINE — its thickness and how
 * it braids — so that is where audio belongs. There is no camera.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** Nothing here was a camera move: the flow is the effect, and the
 * pointer vortex is the one motion the viewer causes, so both are kept. What
 * was wrong was the pointer damping — `lerped += (target - lerped) * 0.04`
 * applied per FRAME, which converges twice as fast on a 120Hz display as on
 * 60Hz. It is a time constant now. The flow's own clock is integrated on the
 * CPU and paced by the music, so the tendrils settle when a track stops
 * instead of running on wall time.
 *
 * **Audio.** Previously `speed + amplitude * 0.15` and `curl + bass * 0.1`,
 * both off raw per-frame values, which reads as jitter. Now:
 *
 *  - `u_bass` (smoothed; the shared vocabulary designates it for body and
 *    thickness) sets the filament half-width — the silhouette itself;
 *  - `u_energy` (4s time constant) scales the curl, so the braid loosens and
 *    tightens across a section rather than per note;
 *  - `u_beatSeed` re-rolls the DIRECTION of a bounded domain offset on each
 *    onset, so the field reshuffles on the beat instead of only pulsing;
 *  - `u_treble` adds per-pixel sparkle on the brightest filaments;
 *  - `u_beatPulse` blooms them, `u_centroid` slides the density palette,
 *    `u_flux` rides the grain.
 *
 * **Cost.** This is by a wide margin the most expensive preset of the five —
 * more than an order of magnitude above nebula, which the brief flagged as the
 * perf case. The potential field dominated: central differences meant FOUR
 * three-octave FBM evaluations per step (each 3 trilinear value-noise lookups
 * at 8 hashes apiece), plus one for the density — 15 noise lookups and 120
 * hash evaluations per step, so 75 and 600 per pixel at the default 5 steps.
 *
 * Forward differences need three potential evaluations rather than four, and
 * the potential drops to two octaves because its third produced vortices
 * smaller than one advection step, which the march immediately smoothed away.
 * The density field keeps all three octaves, since that is what the eye reads.
 * Result: 9 noise lookups and 72 hashes per step — 45 and 360 per pixel, 40%
 * fewer, and the count is deterministic rather than data-dependent so that is
 * exact rather than a mean.
 *
 * Also: a per-pixel jitter on the step length hides the five-step lattice that
 * would otherwise show as faint contour rings; the pointer term lost one of
 * its two `sqrt` calls per step by reusing a single squared distance for the
 * falloff, the swirl and the radial term; and the two per-step divides (the
 * step weight and the final normalisation) are hoisted to none.
 *
 * **Colour.** The density ramp runs bg to primary to secondary to accent to
 * white, so the brand stops are a structural cue and are NOT cycled. The
 * tonemap now gains back the 0.804 that ACES costs a light background.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const TENDRILS_FRAG = `#version 300 es
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
uniform float u_scale;
uniform int u_steps;
uniform float u_curl;
uniform float u_fade;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see tendrils-renderer.ts).
 *
 * Already scaled by the preset's speed setting, which is why there is no
 * u_speed uniform any more: speed multiplies the integration RATE rather than
 * the elapsed time, so changing it cannot retroactively rescale the slice of
 * the potential field the flow has already advected through.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Upper bound on the advection march. The active count is u_steps. */
const int MAX_STEPS = 7;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash31(i);
  float b = hash31(i + vec3(1, 0, 0));
  float c = hash31(i + vec3(0, 1, 0));
  float d = hash31(i + vec3(1, 1, 0));
  float e = hash31(i + vec3(0, 0, 1));
  float f1 = hash31(i + vec3(1, 0, 1));
  float g = hash31(i + vec3(0, 1, 1));
  float h = hash31(i + vec3(1, 1, 1));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

/** Three octaves — the DENSITY field, which is what the eye reads. */
float fbmDensity(vec3 p) {
  float f = 0.500 * noise3(p); p.xy = octaveRot * p.xy * 2.02; p.z *= 1.03;
  f += 0.250 * noise3(p); p.xy = octaveRot * p.xy * 2.03; p.z *= 1.04;
  f += 0.125 * noise3(p);
  return f / 0.875;
}

/**
 * Two octaves — the POTENTIAL field, whose only job is to advect.
 *
 * Its third octave generated vortices smaller than one 0.15 advection step,
 * so the march smoothed them straight back out; paying 8 hash evaluations
 * three times per step for detail that never survives is the single largest
 * waste in this preset.
 */
float fbmPotential(vec3 p) {
  float f = 0.500 * noise3(p); p.xy = octaveRot * p.xy * 2.02; p.z *= 1.03;
  f += 0.250 * noise3(p);
  return f / 0.750;
}

/**
 * Divergence-free 2D velocity: the curl of a scalar potential.
 *
 * Central differences need four potential evaluations. Forward differences
 * need three, and the half-cell bias that introduces is invisible in a field
 * that only advects — it shifts the whole flow by 0.005 units, which is a
 * thirtieth of one advection step.
 */
vec2 curlNoise(vec2 p, float t) {
  const float eps = 0.01;
  const float invEps = 100.0;
  vec3 p3 = vec3(p, t);
  float f0 = fbmPotential(p3);
  float fx = fbmPotential(p3 + vec3(eps, 0.0, 0.0));
  float fy = fbmPotential(p3 + vec3(0.0, eps, 0.0));
  return vec2(fy - f0, f0 - fx) * invEps * u_curl;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Array-indexed 5-stop density palette --
vec3 tendrilPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 stops[5] = vec3[5](u_bgColor, u_brandPrimary, u_brandSecondary, u_brandAccent, vec3(1.0));
  float scaled = t * 4.0;
  int idx = int(floor(scaled));
  idx = clamp(idx, 0, 3);
  float f = fract(scaled);
  return mix(stops[idx], stops[idx + 1], f);
}

void main() {
  // Integrated by the renderer, never derived here. Deriving it as
  // mix(u_time * k, u_beatPhase, u_audioActive) would sweep it BACKWARDS as
  // the audio ramp eased in, because beatPhase starts at zero when the
  // analyser is created while u_time may already be at 60s — the flow would
  // reverse at the exact moment playback started.
  float clock = u_clock;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // ── Audio conditioning, all hoisted above the march ───────────

  // Filament half-width — the silhouette. u_bass is the smoothed band, which
  // the shared vocabulary designates for body, weight and thickness.
  float halfWidth = 0.08 * audioLift(u_bass, 0.3);

  // Curl strength from the slow macro envelope, so the braid loosens across a
  // musical section rather than per note.
  float curlGain = audioLift(u_energy, 0.22);

  // Bounded domain offset whose DIRECTION is re-rolled on each onset, so the
  // field reshuffles on the beat instead of only pulsing. The seed is slewed
  // over 250ms upstream, which turns each re-roll into a glide; amplitude is
  // 0.10 against a domain scale of 2.5, so peak travel is ~0.8 units/s and
  // stays a swirl rather than a strobe.
  float seedAng = u_beatSeed * 6.2831853;
  vec2 fieldShift = vec2(cos(seedAng), sin(seedAng)) * 0.10 * u_audioActive;

  // Timbre slides the density palette; every brand stop stays intact.
  float paletteShift = audioHueShift(0.12);

  // ── March setup ───────────────────────────────────────────────
  vec2 mouseUv = (u_mouse - 0.5) * 2.0;
  mouseUv.x *= u_resolution.x / u_resolution.y;
  // Loop-invariant: this multiply used to run once per step.
  vec2 mouseCentre = mouseUv * u_scale;

  vec2 pos = uv * u_scale + fieldShift;

  // Hoisted: two divides per step in the old form (the step weight and the
  // final normalisation).
  float invSteps = 1.0 / float(max(u_steps, 1));

  // Per-pixel jitter on the step length. The march is only five steps, so
  // without this the accumulated density shows the step lattice as faint
  // contour rings; jittered, it reads as fine noise the grain already masks.
  float stepDither = hash(gl_FragCoord.xy * 1.7 + fract(u_time * 0.41) * 71.0) - 0.5;
  float dt = 0.15 * (1.0 + stepDither * 0.35);

  float density = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= u_steps) break;

    vec2 vel = curlNoise(pos, clock) * curlGain;

    // Pointer vortex — kept. One squared distance now serves the falloff, the
    // perpendicular swirl and the radial term, so the old length() sqrt and
    // the normalize() divide are both gone.
    vec2 toMouse = pos - mouseCentre;
    float d2 = dot(toMouse, toMouse);
    float mouseFalloff = exp(-d2 * 4.0);
    vec2 perp = vec2(-toMouse.y, toMouse.x);
    vec2 radial = toMouse * inversesqrt(max(d2, 1e-6));
    vel += (perp * 0.8 + radial * 0.2) * mouseFalloff * u_curl * 0.5;

    pos -= vel * dt;

    float n = fbmDensity(vec3(pos, clock * 0.5));
    float band = 1.0 - smoothstep(0.0, halfWidth, abs(n - 0.5));
    density += band * (1.0 - float(i) * invSteps);
  }

  density = clamp(density * invSteps * u_fade * 2.0, 0.0, 1.0);

  // Branch-free 5-stop palette, HDR-scaled so ACES has headroom to glow.
  vec3 color = tendrilPalette(clamp(density + paletteShift, 0.0, 1.0)) * 1.3;

  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    float burstDist = dot(uv - burstUv, uv - burstUv);
    float burst = u_burstStrength * exp(-burstDist * 6.0);
    color += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.8;
  }

  // Bloom on the densest filaments. Beats widen the halo — a light-side
  // response, so a transient never moves an outline.
  color += pow(density, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * (0.3 + beatHit(1.5) * 0.35);

  // Treble sparkle. High-frequency content is spatially high-frequency too,
  // so it belongs on a per-pixel term — and only where a filament is already
  // bright, or it reads as dirt on the screen.
  float sparkle = hash(gl_FragCoord.xy * 1.9 + fract(u_time * 3.3) * 83.0);
  sparkle = pow(sparkle, 12.0) * u_treble * u_audioActive;
  color += sparkle * mix(u_brandAccent, vec3(1.0), 0.6) * density * 2.2;

  // ── Post-process ──────────────────────────────────────────
  //
  // ACES maps an input of 1.0 to 0.804, so a light brand background could
  // never render at its own value. Gain that back in proportion to how light
  // the palette is; at lightBg = 0 the multiplier is exactly 1.0 and the dark
  // look is bit-identical.
  //
  // The white point is 1.6, not 1.0. A full gain (dividing by aces(1.0))
  // leaves headroom only up to an input of about 1.13, and this preset
  // pre-scales its whole palette by 1.3 — so on a light background the EMPTY
  // field alone lands at 1.27 and clips to pure white, taking the bright end
  // of the density ramp with it. At a 1.6 white point the empty field renders
  // 0.948 and a mid-ramp filament 0.866, a separation of 0.082 against 0.045
  // for the full gain, with nothing clipped.
  const float ACES_WHITE = 0.8862;   // aces(1.6)
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float lightBg = smoothstep(0.42, 0.76, bgLum);
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
