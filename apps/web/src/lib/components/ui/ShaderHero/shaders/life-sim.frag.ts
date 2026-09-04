/**
 * SmoothLife simulation fragment shader (GLSL ES 3.0).
 *
 * Continuous-state cellular automaton at 256x256 ping-pong FBO.
 * R channel = cell state (continuous float, 0.0 = dead, 1.0 = fully alive).
 * Ring kernel: inner disc (alive fraction, m) + outer annulus (neighbourhood, n).
 * A smooth sigmoid transition replaces the hard thresholds of classic Life.
 *
 * ## What changed and why
 *
 * **Kernel cost.** The two averages were gathered by nested float loops whose
 * bounds came from uniforms — `for (float r = 0.0; r <= uInner * texel; ...)`
 * with an angular step derived from the ring circumference. At the default
 * radii that is ~66 inner and ~399 outer fetches per pixel per step, ~465 in
 * total, and because the bounds are uniform-dependent the compiler can neither
 * unroll the loops nor hoist the `sin`/`cos` out of them. Two steps a frame at
 * 256x256 came to roughly 61M texture fetches per frame.
 *
 * They are now gathered by an equal-area golden-angle spiral with compile-time
 * constant tap counts: 24 taps for the disc, 64 for the annulus, 88 in total.
 * Equal-area placement (radius proportional to sqrt of the tap index) makes the
 * unweighted mean an unbiased estimator of the region average, so no per-tap
 * weight is needed, and successive directions come from one constant 2x2
 * rotation rather than a `sin`/`cos` pair. That is 5.3x fewer fetches and far
 * less ALU per fetch.
 *
 * The estimate is sparser than the old gather (about 60% areal coverage once
 * bilinear filtering is counted) but it is *deterministic and identical at
 * every pixel*, so it is a slightly different fixed kernel rather than added
 * noise: m and n stay spatially smooth and nothing speckles.
 *
 * **Audio.** Previously none. The birth/death thresholds are what SmoothLife
 * *is*, so they move with `u_energy` only, and by a fraction of the distance to
 * the next regime. The relaxation step is paced by `u_beatPhase`, so colonies
 * visibly surge on the beat and settle between beats. Beat-chosen colony
 * seeding arrives through `uDropPos` from the renderer.
 *
 * Mouse deposits life material. Ambient drops keep the simulation alive — an
 * all-dead field is an absorbing state (see the transition-function comment).
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const LIFE_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uInner;
uniform float uOuter;
uniform float uBirth;
uniform float uDeath;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;
uniform float uDropGain;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

/** Taps over the inner disc (the alive-fraction term, m). */
const int INNER_TAPS = 24;
/** Taps over the outer annulus (the neighbourhood term, n). */
const int OUTER_TAPS = 64;

/**
 * Golden-angle rotation, pre-resolved to literals: cos and sin of
 * pi*(3-sqrt(5)) = 2.39996323 rad. Advancing a direction vector by this angle
 * each tap distributes successive samples as evenly as a 2D sequence can, and
 * costs 4 multiplies and 2 adds instead of a sin/cos pair.
 */
const float GOLDEN_C = -0.737368878;
const float GOLDEN_S = 0.675490294;

/** Advance a unit direction by the golden angle. */
vec2 spin(vec2 d) {
  return vec2(GOLDEN_C * d.x - GOLDEN_S * d.y, GOLDEN_S * d.x + GOLDEN_C * d.y);
}

// ---- SmoothLife sigmoid transition function ----
float sigma(float x, float center, float width) {
  return 1.0 / (1.0 + exp(-(x - center) / width));
}

/**
 * Transition function S(n, m).
 *
 * Note that S(0, 0) = 0: an empty neighbourhood produces no birth, so an
 * all-dead field is an absorbing state this simulation cannot leave on its own.
 * That is why the renderer's ambient drops are never gated on audio. The
 * opposite extreme is self-correcting — S(1, 1) = 0 too, so a saturated field
 * decays back on its own.
 */
float transition(float n, float m, float birth, float death) {
  float sigWidth = 0.028;

  float birthWindow = sigma(n, birth, sigWidth) * (1.0 - sigma(n, birth + 0.07, sigWidth));
  float surviveWindow = sigma(n, death - 0.07, sigWidth) * (1.0 - sigma(n, death, sigWidth));

  return mix(birthWindow, surviveWindow, sigma(m, 0.5, sigWidth));
}

void main() {
  float state = texture(uState, v_uv).r;

  float ri = uInner * uTexel.x;
  float ro = max(uOuter * uTexel.x, ri + uTexel.x);

  // ---- 1. Inner disc average (m) ----
  // Equal-area spiral: r_k = ri * sqrt((k + 0.5) / N) puts the same disc area
  // between consecutive radii, so a plain mean of the taps estimates the disc
  // average without per-tap weights.
  float innerSum = 0.0;
  vec2 dir = vec2(1.0, 0.0);
  for (int i = 0; i < INNER_TAPS; i++) {
    float r = ri * sqrt((float(i) + 0.5) / float(INNER_TAPS));
    innerSum += texture(uState, v_uv + dir * r).r;
    dir = spin(dir);
  }
  float m = innerSum / float(INNER_TAPS);

  // ---- 2. Outer annulus average (n) ----
  // Equal-area over the annulus: r_k = sqrt(ri^2 + (ro^2 - ri^2) * t_k).
  // The direction starts off-axis so the two spirals do not share a spoke
  // pattern, which would bias the pair of estimates the same way.
  float ri2 = ri * ri;
  float span = ro * ro - ri2;
  float outerSum = 0.0;
  dir = vec2(0.3826834, 0.9238795);
  for (int i = 0; i < OUTER_TAPS; i++) {
    float r = sqrt(ri2 + span * ((float(i) + 0.5) / float(OUTER_TAPS)));
    outerSum += texture(uState, v_uv + dir * r).r;
    dir = spin(dir);
  }
  float n = outerSum / float(OUTER_TAPS);

  // ---- 3. Audio excursion of the rule ----
  // b1 and d2 are the entire ruleset, so the excursion is small: +-0.012 and
  // +-0.015 around the configured pair, which keeps both inside the classic
  // SmoothLife family (roughly b1 in 0.25..0.34, d2 in 0.33..0.55) whatever the
  // creator picked. Window widths are preserved because both edges shift
  // together. Driven by u_energy (tau 4s) because the field needs many steps to
  // re-settle after a rule change — a per-note signal would only smear.
  float e = (u_energy - 0.5) * 2.0 * u_audioActive;
  float birth = uBirth + e * 0.012;
  float death = uDeath + e * 0.015;

  // ---- 4. Apply the transition ----
  float target = transition(n, m, birth, death);

  // Relaxation step, paced by the beat clock. audioBreath() is a raised sine
  // over one beat, so growth surges on the beat and eases between them; the
  // band is 0.5x..1.1x of the silent rate, which stays far inside the dt < 1
  // bound for a relaxation toward a target in 0..1.
  float dt = 0.12 * mix(1.0, 0.5 + 0.6 * audioBreath(u_beatPhase), u_audioActive);
  float newState = state + dt * (target - state);

  // ---- 5. Deposits ----
  // Both injectors are unguarded: an inactive one is parked at (-10, -10),
  // where the Gaussian's exponent is about -4e4 and exp() underflows to zero.
  vec2 dm = v_uv - uMouse;
  newState += uMouseStrength * 0.6 * exp(-dot(dm, dm) / 0.0016)
            * step(0.5, uMouseActive);

  vec2 dd = v_uv - uDropPos;
  newState += uDropGain * exp(-dot(dd, dd) / 0.0025);

  // ---- 6. Clamp + edge damping ----
  newState = clamp(newState, 0.0, 1.0);

  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
`;
