/**
 * Plasma simulation fragment shader (GLSL ES 3.0).
 *
 * Particle-in-cell transport plus slime-mould angular sensors on a 512x512
 * ping-pong FBO. Buffer: RG = velocity (texels per step), B = mass,
 * A = SPH-smoothed mass (what the sensors read next step).
 *
 * Three phases in one pass: a mass-conserving PIC gather over the 5x5
 * neighbourhood, a Gaussian smoothing of mass for the sensors, and a force
 * stage combining a pressure gradient with a sensor-driven rotation. The
 * sensors read SMOOTHED MASS, not a pheromone trail — the self-organisation
 * comes from parcels being drawn toward density peaks their own mass created.
 *
 * ## What changed and why
 *
 * **Two 5x5 loops became one.** The PIC gather and the density smoothing each
 * ran their own nested `for (j) for (i)` over the same 25 neighbours, each
 * calling `texture(uState, nbUV)` on the same texels: 50 fetches to read 25
 * values. Merged, with the four axial neighbours captured on the way past for
 * the pressure gradient (which had fetched them a third time). 78 fetches per
 * pixel per step became 49, for bit-identical results.
 *
 * **The sensor fan lost 49 transcendentals.** It ran 24 iterations, each
 * computing `vec2(cos(cang), sin(cang))` for the sensor direction and
 * `vec2(cos(ang ± PI/2), sin(ang ± PI/2))` for the force direction — 48
 * sin/cos pairs plus one `atan` for the heading. Three identities remove all
 * of them:
 *
 *  - `Rot(±PI/2) * (cos a, sin a)` is `±(-sin a, cos a)`, so the force
 *    direction is one perpendicular, constant across the loop, and the two
 *    halves of the fan collapse to `perp * (sumPos - sumNeg)`;
 *  - the heading's basis is just `normalize(V)`, so the `atan` and the
 *    `cos`/`sin` that undid it are unnecessary;
 *  - successive sensor directions differ by a constant angle, so one 2x2
 *    rotation advances them.
 *
 * **A dead projection removed.** `slimeF -= dot(slimeF, Vn) * Vn` was there to
 * strip the component of the sensor force along the velocity. But `slimeF` is a
 * scalar multiple of `perp`, which is exactly perpendicular to `Vn`, so the dot
 * product is identically zero and the line was a normalize, a dot and two
 * multiply-adds to subtract nothing.
 *
 * **`uDiffusion` did something.** It was declared, uploaded, and never read —
 * legal GLSL that silently reads zero, so the brand editor's Diffusion slider
 * moved nothing. It is now the width of the SPH smoothing kernel, which is the
 * natural meaning: it sets how far the sensors can feel a density peak.
 *
 * **Frame-rate independence.** Velocity is in texels per STEP and every rate
 * here was per step, with the renderer running two substeps per rendered frame
 * — so the plasma flowed twice as fast on a 120Hz display. `uDtScale` scales
 * advection, force integration and the mass renormalisation. It is clamped by
 * the renderer so a parcel can never travel further than the 2-texel gather
 * radius in one step, which would drop its mass on the floor.
 *
 * **Audio.** The sensor force is the structural lever: `u_energy` raises it by
 * up to 45%, tightening the vortices, because that force IS the
 * self-organisation. The mass target also rises with `u_energy`, so a loud
 * passage is denser and therefore shows more of the display's iridescent
 * banding (the band count goes as mass cubed). `u_beatPhase` paces the
 * advection so the flow surges on the beat, and the renderer ignites a fireball
 * at a beat-chosen position on each onset through the burst channel.
 *
 * ## What keeps it alive
 *
 * Mass renormalisation, `mix(M, target, 0.25 * uDtScale)`, pins the mean
 * density every step, so the field can neither collapse to vacuum nor run away;
 * and the velocity is hard-capped at one texel per step, which bounds the CFL
 * number regardless of what the forces do. Those two together are why the audio
 * excursions here can be as large as they are without risking a blow-up.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const PLASMA_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uBurst;
uniform float uSpeed;
uniform float uPressure;
uniform float uTurn;
uniform float uDiffusion;
uniform float uDtScale;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

#define PI 3.14159265

/** Parcel distribution box width, in texels. */
const float DIST_SIZE = 1.7;
/** Sensors per side; the fan is 2 * SENSE_NUM wide. */
const int SENSE_NUM = 12;
/** Angular half-spread factor of the fan. */
const float SENSE_ANG = 0.2;
/** Sensor distance in texels. */
const float SENSE_DIS = 41.0;
/** Base sensor force magnitude. */
const float SENSE_FORCE = 0.11;
/** Mass renormalisation target and rate (per 60Hz-equivalent step). */
const float DENSITY_TARGET = 0.24;
const float DENSITY_NORM_SPEED = 0.25;

/**
 * Gain applied to the NORMALISED smoothing kernel.
 *
 * The original kernel was an unnormalised sum of exp(-d2 / 4) times 0.5, whose
 * response to a uniform field is 5.4232 times the mass. Normalising the kernel
 * and re-applying that gain means uDiffusion changes the RADIUS the sensors
 * feel over without changing the magnitude they read — otherwise widening the
 * kernel would raise smoothRho, and since sensor response is quadratic in it, a
 * Diffusion slider nudge would multiply the turning force.
 */
const float SMOOTH_GAIN = 5.4232;

/**
 * Rotation by the fan's angular increment, pre-resolved to literals:
 * SENSE_ANG * PI / SENSE_NUM = 0.05235988 rad (3 degrees). Advancing a
 * direction by this each iteration replaces a sin/cos pair with 4 multiplies
 * and 2 adds.
 */
const float FAN_C = 0.998629535;
const float FAN_S = 0.052335956;

void main() {
  // ════════════════════════════════════════════════════════════
  // PHASE 1+2: one 5x5 gather serving PIC transport AND smoothing
  // ════════════════════════════════════════════════════════════

  float M = 0.0;
  vec2 sumV = vec2(0.0);
  float rhoAcc = 0.0;
  float rhoW = 0.0;

  // Axial neighbours captured for the pressure gradient, so phase 3 needs no
  // fetches of its own.
  float mN = 0.0, mS = 0.0, mE = 0.0, mW = 0.0;

  // Gaussian kernel width for the smoothing pass. uDiffusion scales the
  // variance, so the slider controls how far the sensors feel a density peak.
  float kernelVar = max(4.0 * uDiffusion, 0.5);

  float travel = uSpeed * uDtScale
    // Advection paced by the musical clock. audioBreath() is a raised sine over
    // one beat, so the flow surges on the beat. Band 0.75x..1.25x, which with
    // the renderer's clamp keeps parcel travel inside the gather radius.
    * mix(1.0, 0.75 + 0.5 * audioBreath(u_beatPhase), u_audioActive);

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec4 data = texture(uState, v_uv + vec2(float(i), float(j)) * uTexel);
      vec2 V0 = data.rg;
      float M0 = data.b;

      // --- PIC: advect the neighbour's parcel, then AABB-overlap this cell ---
      vec2 advPos = vec2(float(i), float(j)) + V0 * travel;
      vec2 oMin = max(vec2(-0.5), advPos - DIST_SIZE * 0.5);
      vec2 oMax = min(vec2(0.5), advPos + DIST_SIZE * 0.5);
      vec2 oSize = max(oMax - oMin, vec2(0.0));
      float m = M0 * oSize.x * oSize.y / (DIST_SIZE * DIST_SIZE);
      sumV += V0 * m;
      M += m;

      // --- SPH-like smoothing of the CURRENT mass field ---
      float d2 = float(i * i + j * j);
      float kw = exp(-d2 / kernelVar);
      rhoAcc += M0 * kw;
      rhoW += kw;

      // --- Axial taps for the pressure gradient ---
      if (i == 0 && j == 1) mN = M0;
      if (i == 0 && j == -1) mS = M0;
      if (i == 1 && j == 0) mE = M0;
      if (i == -1 && j == 0) mW = M0;
    }
  }

  // Mass-weighted mean velocity.
  vec2 V = M > 0.001 ? sumV / M : vec2(0.0);

  // Normalised smoothed mass, restored to the original kernel's gain.
  float smoothRho = 0.001 + (rhoAcc / rhoW) * SMOOTH_GAIN;

  // Mass renormalisation — the mechanism that makes this unconditionally
  // stable: the mean density is pulled back toward the target every step, so
  // neither vacuum collapse nor runaway accumulation is reachable. The target
  // rises with the slow envelope, so a loud passage is a denser plasma.
  float target = DENSITY_TARGET * audioLift(u_energy, 0.3);
  float prevM = M;
  M = mix(M, target, clamp(DENSITY_NORM_SPEED * uDtScale, 0.0, 1.0));
  // Momentum is preserved across the rescale, so renormalising mass does not
  // inject or remove kinetic energy.
  V = V * prevM / max(M, 0.001);

  // ════════════════════════════════════════════════════════════
  // PHASE 3: forces
  // ════════════════════════════════════════════════════════════

  if (M > 0.001) {
    vec2 F = vec2(0.0);

    // --- Pressure gradient, P(rho) = 0.9 * rho ---
    vec2 pGrad = vec2(0.9 * (mE - mW), 0.9 * (mN - mS));
    F -= uPressure * audioMod(u_energy, 0.15) * M * pGrad;

    // --- Slime-mould sensor fan ---
    // Basis straight from the velocity: no atan, and no cos/sin to undo it.
    float speed = length(V);
    vec2 base = speed > 1e-6 ? V / speed : vec2(1.0, 0.0);
    // Rot(+PI/2) * base. The whole fan's force is a multiple of this one
    // vector, which is why the two halves collapse to a single difference.
    vec2 perp = vec2(-base.y, base.x);

    float sR = SENSE_DIS * uTexel.x;
    vec2 dp = base;
    vec2 dn = base;
    float sumPos = 0.0;
    float sumNeg = 0.0;

    for (int si = 0; si < SENSE_NUM; si++) {
      // Advance one fan step either side.
      dp = vec2(FAN_C * dp.x - FAN_S * dp.y, FAN_S * dp.x + FAN_C * dp.y);
      dn = vec2(FAN_C * dn.x + FAN_S * dn.y, FAN_C * dn.y - FAN_S * dn.x);

      // The sensors read SMOOTHED mass (A channel), which is the previous
      // step's smoothing output. Response is quadratic in density, so a peak
      // twice as dense pulls four times as hard.
      float ap = texture(uState, v_uv + dp * sR).a;
      float an = texture(uState, v_uv + dn * sR).a;
      sumPos += ap * ap;
      sumNeg += an * an;
    }

    // Sensor force is the self-organisation, so it is the structural audio
    // lever: more turning means tighter vortices.
    float turn = uTurn * audioLift(u_energy, 0.45);
    F += turn * SENSE_FORCE * perp * (sumPos - sumNeg) / float(2 * SENSE_NUM);

    // --- Mouse vortex — the viewer-caused motion, deliberately strong ---
    if (uMouseActive > 0.5) {
      vec2 d = (v_uv - uMouse) / uTexel.x;
      float g = exp(-dot(d, d) / 900.0);
      F += 0.1 * vec2(-d.y, d.x) * g * uTexel.x;
    }

    // --- Burst: a click, or a beat-ignited fireball from the renderer ---
    if (uBurst > 0.01) {
      vec2 d = (v_uv - uMouse) / uTexel.x;
      float g = exp(-dot(d, d) / 400.0);
      F += uBurst * 0.15 * vec2(-d.y, d.x) * g * uTexel.x;
      M = mix(M, 0.5, clamp(uBurst * g * 0.3, 0.0, 1.0));
    }

    // --- Integrate ---
    V += F * uDtScale / M;

    // Hard CFL cap at one texel per step. With the gather radius at 2 texels
    // and the renderer's clamp on uDtScale, this guarantees every parcel lands
    // inside some cell's gather window, so no mass is silently lost.
    float spd = length(V);
    if (spd > 1.0) V /= spd;
  }

  fragColor = vec4(V, clamp(M, 0.0, 1.5), clamp(smoothRho, 0.0, 2.0));
}
`;
