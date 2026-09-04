/**
 * Lenia (continuous cellular automata) simulation fragment shader (GLSL ES 3.0).
 *
 * Bump-function kernel convolution + Gaussian growth function on a 256x256
 * ping-pong FBO. R channel = cell state (0.0 dead .. 1.0 fully alive).
 * Unlike SmoothLife's ring kernel, Lenia's kernel is a bell peaked at half the
 * radius, which is what gives its creatures concentric internal structure.
 *
 * ## What changed and why
 *
 * **Kernel cost.** The convolution was gathered by nested float loops whose
 * bounds came from a uniform — `for (float r = uTexel.x; r <= uRadius * uTexel.x; ...)`
 * with an inner angular sweep whose step was derived from the ring
 * circumference. At the default radius of 13 texels that is 9 rings, 7 of which
 * survive the weight cutoff, for ~210 texture fetches per pixel per step. With
 * two steps a frame at 256x256 that came to 27.5M fetches per frame, and
 * because the bounds are uniform-dependent the compiler could neither unroll
 * the loops nor hoist the per-sample `sin`/`cos` out of them.
 *
 * It is now a single equal-area golden-angle spiral of 48 taps with the bump
 * weight applied per tap: 48 fetches per pixel per step, 6.3M per frame, a
 * 4.4x reduction. Two properties make that cheap as well as short:
 *
 *  - the tap radius depends only on the loop index, so with a compile-time
 *    constant tap count the compiler unrolls the loop and folds every radius
 *    AND every bump weight (and their sum, the normaliser) to a literal;
 *  - successive directions come from one constant 2x2 golden-angle rotation
 *    rather than a `sin`/`cos` pair.
 *
 * The taps span 0.15R..0.9R rather than 0..R. The bump kernel is below 0.002 of
 * its peak outside that band, so the excluded core and rim carry under 1% of
 * the kernel mass — spending taps there is what the old loop's `continue` was
 * already skipping. The estimate is sparser than an exhaustive gather (~11%
 * areal coverage) but it is *deterministic and identical at every pixel*, so it
 * is a slightly different fixed kernel rather than added noise: the convolution
 * stays spatially smooth and nothing speckles.
 *
 * **Frame-rate independence.** The renderer ran a fixed number of substeps per
 * rendered frame at a fixed `uDt`, so the whole simulation evolved twice as
 * fast on a 120Hz display. `uDtScale` carries the frame's share of a
 * 60Hz-equivalent step; see the renderer for the clamp that keeps it stable.
 *
 * **Audio.** Previously none. mu and sigma ARE the Lenia ruleset, so both move
 * only with `u_energy` (tau 4s) and only by a fraction of the distance to the
 * next regime — see the excursion comment below for the numbers that keep the
 * field alive. The relaxation step is paced by `u_beatPhase`, so creatures
 * visibly surge on the beat and settle between beats. Beat-chosen colony
 * seeding arrives through `uDropPos` / `uDropGain` from the renderer.
 *
 * Mouse deposits living material. Ambient drops keep the simulation alive: an
 * all-dead field is an absorbing state, since a zero convolution sits far below
 * mu and the growth function is then negative everywhere.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const LENIA_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uGrowth;
uniform float uWidth;
uniform float uDt;
uniform float uDtScale;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;
uniform float uDropGain;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

/** Taps over the kernel band. Compile-time constant so the loop unrolls. */
const int KERNEL_TAPS = 48;

/**
 * Radial band the taps cover, as a fraction of the kernel radius. The bump
 * kernel is under 0.002 of its peak outside this, so the omitted core and rim
 * together hold less than 1% of the kernel mass.
 */
const float BAND_MIN = 0.15;
const float BAND_MAX = 0.9;

/**
 * Golden-angle rotation, pre-resolved to literals: cos and sin of
 * pi*(3-sqrt(5)) = 2.39996323 rad. Advancing a direction by this angle each tap
 * spreads successive samples as evenly as a 2D sequence can, for 4 multiplies
 * and 2 adds instead of a sin/cos pair.
 */
const float GOLDEN_C = -0.737368878;
const float GOLDEN_S = 0.675490294;

/** Advance a unit direction by the golden angle. */
vec2 spin(vec2 d) {
  return vec2(GOLDEN_C * d.x - GOLDEN_S * d.y, GOLDEN_S * d.x + GOLDEN_C * d.y);
}

/**
 * Lenia bump kernel as a function of normalised radius: peaked at nr = 0.5,
 * vanishing at 0 and 1. K(nr) = exp(alpha - alpha / (4*nr*(1-nr))), alpha = 4.
 *
 * No guard on the denominator: nr is confined to BAND_MIN..BAND_MAX by the
 * caller, where 4*nr*(1-nr) is at least 0.34.
 */
float bumpWeight(float nr) {
  return exp(4.0 - 4.0 / (4.0 * nr * (1.0 - nr)));
}

void main() {
  float state = texture(uState, v_uv).r;
  float radius = uRadius * uTexel.x;

  // ---- 1. Bump-kernel convolution over an equal-area spiral ----
  // nr_k = sqrt(a^2 + (b^2 - a^2) * (k + 0.5) / N) places the same annular area
  // between consecutive taps, so the weighted mean is an unbiased estimator of
  // the kernel-weighted region average. Both nr_k and its weight depend only on
  // k, so they fold to literals when the loop unrolls.
  float a2 = BAND_MIN * BAND_MIN;
  float span = BAND_MAX * BAND_MAX - a2;
  float acc = 0.0;
  float wsum = 0.0;
  vec2 dir = vec2(1.0, 0.0);
  for (int i = 0; i < KERNEL_TAPS; i++) {
    float nr = sqrt(a2 + span * ((float(i) + 0.5) / float(KERNEL_TAPS)));
    float w = bumpWeight(nr);
    acc += w * texture(uState, v_uv + dir * (nr * radius)).r;
    wsum += w;
    dir = spin(dir);
  }
  float convolution = acc / wsum;

  // ---- 2. Audio excursion of the ruleset ----
  // mu (growth centre) and sigma (growth width) are the entire ruleset, so the
  // excursion is deliberately small: mu moves +-0.008 around the configured
  // 0.14 and sigma is lifted by at most 18% of itself. Lenia's stable family is
  // roughly mu in 0.10..0.20 at sigma 0.03..0.06, so both stay inside it for
  // any value a creator can pick. Driven by u_energy (tau 4s) rather than a
  // band, because the field needs tens of steps to re-settle after a rule
  // change — a per-note signal would only smear the creatures.
  float macro = (u_energy - 0.5) * 2.0 * u_audioActive;
  float mu = uGrowth + macro * 0.008;
  float sigma = max(uWidth, 0.03) * audioLift(u_energy, 0.18);

  // ---- 3. Growth function: Gaussian around mu, returning -1..1 ----
  float diff = convolution - mu;
  float growth = 2.0 * exp(-(diff * diff) / (2.0 * sigma * sigma)) - 1.0;

  // ---- 4. Integrate, paced by the musical clock ----
  // audioBreath() is a raised sine over one beat, so growth surges on the beat
  // and eases between them. The band is 0.55x..1.15x of the silent rate, which
  // combined with the renderer's clamp on uDtScale keeps the per-step change
  // inside the range where the explicit Euler step is stable.
  float pace = mix(1.0, 0.55 + 0.6 * audioBreath(u_beatPhase), u_audioActive);
  float newState = state + uDt * uDtScale * pace * growth;

  // ---- 5. Deposits ----
  // Both injectors are unguarded: an inactive one is parked at (-10, -10),
  // where the Gaussian exponent is around -1e4 and exp() underflows to zero.
  vec2 dm = v_uv - uMouse;
  newState += uMouseStrength * 0.5 * exp(-dot(dm, dm) / 0.0016)
            * step(0.5, uMouseActive);

  vec2 dd = v_uv - uDropPos;
  newState += uDropGain * exp(-dot(dd, dd) / 0.0036);

  // ---- 6. Clamp + edge damping ----
  newState = clamp(newState, 0.0, 1.0);

  // Wider than the other presets' damping because the kernel radius is large:
  // a creature whose kernel overlaps the boundary reads the clamped edge as
  // dead space and dissolves, so fade before it gets there.
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
`;
