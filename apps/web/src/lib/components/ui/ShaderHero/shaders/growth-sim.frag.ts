/**
 * Growth (differential growth) simulation fragment shader (GLSL ES 3.0).
 *
 * SDF-based differential growth on a 512x512 ping-pong FBO.
 * Buffer: R = signed distance, G = curvature (Laplacian), B = growth age.
 *
 * Each step:
 *  1. push the zero-contour outward inside a narrow band
 *  2. add curvature-weighted FBM buckling so the front develops lobes
 *  3. an Eikonal correction pulls |grad(sdf)| back toward 1
 *  4. senescence erodes old deep interior, so the field keeps reorganising
 *  5. edge damping keeps growth off the canvas boundary
 *
 * ## What changed and why
 *
 * **Frame-rate independence.** Every increment here was per-step, and the
 * renderer ran a fixed two substeps per rendered frame, so the contour advanced
 * at twice the rate on a 120Hz display. `uDtScale` carries the frame's share of
 * a 60Hz step and multiplies all four rate terms. It is clamped by the renderer
 * because the Eikonal correction is a relaxation: its coefficient is 0.3 per
 * step and must stay below 1 to be stable.
 *
 * **The buckling field no longer translates.** `v_uv * uScale * 15.0 + uTime *
 * 0.03` slid the noise field in a fixed direction forever, so every lobe on the
 * front drifted the same way — a slow mechanical sweep with no turnaround and
 * an unbounded coordinate. It is now offset by `drift2(uClock, 3.1) * 1.2`:
 * three incommensurate low-frequency components per axis, peak rate
 * 0.062 * 1.2 = 0.074 noise-units/s, bounded amplitude, no visible period.
 *
 * **It no longer jams.** Nothing removed material, so once the contour reached
 * the edge damping the whole field was frozen: `band` is zero in the deep
 * interior, so the only surviving motion was the display's grain. Senescence
 * now erodes interior that has aged, opening holes whose own contours then
 * grow — a slowly churning foam rather than a static blob. Both rates are
 * bounded and the front itself is never eroded (see the age gate below), so the
 * field can neither dissolve nor fill.
 *
 * **Audio.** Growth RATE, not growth position: `u_energy` (tau 4s) and
 * `beatHit()` scale the expansion speed, whose integral is smooth, so the
 * contour never jumps. `u_mids` gains the buckling amplitude — busy passages
 * grow a more convoluted front. Beat-seeded growth centres arrive through
 * `uSeedPos` from the renderer, one per onset.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const GROWTH_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uSpeed;
uniform float uNoise;
uniform float uScale;
uniform float uClock;
uniform float uDtScale;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform vec2 uSeedPos;
uniform float uSeedRadius;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

// -- Hash noise (same construction as ink-sim) --
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Three-octave FBM. Fixed octave count so the loop unrolls. */
float fbm3(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float age = state.b;

  // -- 1. Neighbours for gradient and Laplacian --
  float sN = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float sS = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float sE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float sW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  vec2 grad = vec2(sE - sW, sN - sS) / (2.0 * uTexel.x);
  float gradLen = length(grad) + 0.0001;

  // Laplacian of the SDF — large at folds, which is what makes the buckling
  // self-reinforcing rather than uniform.
  float curvature = sN + sS + sE + sW - 4.0 * sdf;

  // -- 2. Expansion: push the zero-contour outward --
  // Confined to a narrow band around the contour: expanding the deep interior
  // would just translate the whole field.
  float band = smoothstep(0.06, 0.0, abs(sdf));

  // Audio scales the RATE. Its integral is C1, so the contour accelerates and
  // eases rather than jumping — the reason a rate is safe to drive from
  // beatHit() where a position would not be. Worst case is 1.25 * 1.25 = 1.56x
  // the silent rate, on a base that crosses the canvas in about 70 seconds.
  float rateGain = audioLift(u_energy, 0.25) * (1.0 + beatHit(1.6) * 0.25);
  float expansion = uSpeed * 0.0003 * band * uDtScale * rateGain;

  // Mouse acceleration — the one motion the viewer causes directly, so it is
  // deliberately stronger than anything audio does here.
  if (uMouseActive > 0.5) {
    float mouseInfluence = smoothstep(0.15, 0.0, length(v_uv - uMouse));
    expansion += uSpeed * 0.001 * mouseInfluence * band * uDtScale;
  }

  sdf -= expansion;

  // -- 3. Curvature-weighted buckling --
  // The drift offset wanders the noise field instead of translating it, so
  // lobes on the front reorganise instead of marching in one direction.
  vec2 noiseCoord = v_uv * uScale * 15.0 + drift2(uClock, 3.1) * 1.2;
  float buckle = (fbm3(noiseCoord) - 0.5) * 2.0;

  // Gentle positive feedback only: at higher gain the front self-intersects
  // and the Eikonal correction cannot recover a valid distance field.
  float curvFactor = 1.0 + abs(curvature) * 0.5;

  sdf += buckle * uNoise * 0.0002 * band * curvFactor * uDtScale
       * audioLift(u_mids, 0.35);

  // -- 4. Eikonal correction: pull |grad(sdf)| toward 1 --
  // 0.3 is a relaxation coefficient; uDtScale is clamped by the renderer so
  // 0.3 * uDtScale stays below 1 and this cannot overshoot into oscillation.
  sdf -= 0.3 * sign(sdf) * (gradLen - 1.0) * uTexel.x * uDtScale;

  // -- 5. Age, then senescence --
  // Age resets at the contour and accumulates away from it, so it measures how
  // long ago a pixel was part of the growing front.
  if (abs(sdf) < 0.02) {
    age = 0.0;
  } else {
    age = min(age + 0.002 * uDtScale, 1.0);
  }

  // Erode old, deep interior. Two gates keep this from eating the effect: the
  // age gate (age climbs 0.24/s, so only tissue that left the front ~2s ago) and the
  // depth gate (never within 0.03 of the contour, so the front itself is
  // untouched and cannot be pushed backwards). The rate is 0.6x the expansion
  // rate, so growth wins wherever there is room and erosion only takes over
  // once fronts have collided and the interior has aged.
  // smootherstep, not smoothstep, for the depth gate: its edges are REVERSED
  // (-0.03 > -0.10) and the built-in is undefined when edge0 >= edge1. The
  // shared helper divides by (e1 - e0) and clamps, so reversal is well defined.
  float senescence = smoothstep(0.5, 1.0, age) * smootherstep(-0.03, -0.10, sdf);
  sdf += senescence * uSpeed * 0.00018 * uDtScale * audioLift(u_energy, 0.4);

  // -- 6. New seed: plant a circular SDF, unioned in --
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos) - uSeedRadius;
    // Smooth-min union so a new seed merges into the existing shape with a
    // fillet rather than a crease the Eikonal step would have to repair.
    float h = clamp(0.5 + 0.5 * (seedDist - sdf) / 0.02, 0.0, 1.0);
    sdf = mix(seedDist, sdf, h) - 0.02 * h * (1.0 - h);
    if (abs(seedDist) < 0.01) age = 0.0;
  }

  // -- 7. Clamp --
  sdf = clamp(sdf, -0.5, 0.5);

  // -- 8. Edge damping: push positive (outside) near the canvas border --
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  sdf = mix(0.3, sdf, edge.x * edge.y);

  fragColor = vec4(sdf, curvature, age, 1.0);
}
`;
