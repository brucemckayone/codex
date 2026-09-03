/**
 * Turing Pattern simulation fragment shader (GLSL ES 3.0).
 *
 * Gray-Scott reaction-diffusion on a 512x512 ping-pong FBO.
 * RG channels = chemical concentrations A and B.
 *
 *   dA/dt = Da * lap(A) - A*B^2 + f*(1-A)
 *   dB/dt = Db * lap(B) + A*B^2 - (k+f)*B
 *
 * ## What changed and why
 *
 * **CFL guard.** The update is explicit Euler on a 4-point Laplacian, which is
 * stable only while `D * scl * 4 < 1`. With `scl = 0.21` that caps D at 1.19 —
 * but `uDa` reaches 2.0 on the slider, so the field could ring and saturate at
 * the top of its own configured range. `cfl` below clamps the timestep instead,
 * so every slider position is now stable by construction.
 *
 * **Audio.** Previously none. The feed/kill pair is the *whole* morphology of
 * Gray-Scott, so it is driven from `u_energy` (tau 4s) and by a deliberately
 * small excursion — see the `feed`/`kill` comment for the numbers and why they
 * cannot leave the regime the creator chose. The reaction rate is paced by
 * `u_beatPhase`, one-sided downward so pacing can never overstep the CFL bound.
 * Beat-chosen seed injection is plumbed through `uSeedPos` / `uSeedGain` by the
 * renderer, so a beat writes a new spot into a field that has memory: the
 * pattern it nucleates keeps evolving long after the transient has decayed.
 *
 * Note the mixed uniform naming: this preset predates the shared audio block
 * and uses `uThing`, while the shared block is fixed at `u_thing`. The shared
 * names are a contract with `uploadAudioUniforms()` and cannot be renamed.
 *
 * Uniforms:
 *   uState         — ping-pong simulation texture (RG = chemicals A, B)
 *   uTexel         — 1.0 / simResolution
 *   uFeed          — feed rate f (0.01-0.10)
 *   uKill          — kill rate k (0.04-0.07)
 *   uDa            — diffusion rate of A (0.5-2.0)
 *   uDb            — diffusion rate of B (0.1-1.0)
 *   uTime          — elapsed time in seconds
 *   uMouse         — mouse position normalized 0..1
 *   uMouseActive   — 1.0 if mouse is over canvas, 0.0 otherwise
 *   uMouseStrength — impulse strength
 *   uSeedPos       — seed position (-10 if none: the Gaussian underflows to 0)
 *   uSeedGain      — seed amplitude (ambient ~0.4, beat-driven up to ~0.62)
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const TURING_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uFeed;
uniform float uKill;
uniform float uDa;
uniform float uDb;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uSeedPos;
uniform float uSeedGain;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

/**
 * Gaussian deposit of chemical B.
 *
 * No branch guards the call: an inactive injector is parked at (-10, -10),
 * where -dot(d,d)/r^2 is around -2.5e5 and exp() underflows to exactly 0. That
 * removes two uniform-valued branches from the hot path for free.
 */
float seedB(vec2 center, float radius) {
  vec2 d = v_uv - center;
  return exp(-dot(d, d) / (radius * radius));
}

void main() {
  // ── 1. Sample center + 4 neighbors ───────────────────────────────
  vec2 center = texture(uState, v_uv).rg;
  vec2 hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).rg;
  vec2 hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).rg;
  vec2 hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).rg;
  vec2 hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).rg;

  float A = center.r;
  float B = center.g;

  // ── 2. Laplacian for both chemicals ──────────────────────────────
  float lapA = hN.r + hS.r + hE.r + hW.r - 4.0 * A;
  float lapB = hN.g + hS.g + hE.g + hW.g - 4.0 * B;

  // ── 3. Timestep: CFL bound, then musical pacing ─────────────────
  // Scale factor: the 4-point Laplacian is ~5x stronger than the canonical
  // 9-point stencil used in standard Gray-Scott. 0.21 maps Da=1.0 to the
  // physically correct diffusion rate of ~0.2097.
  float scl = 0.21;

  // Explicit Euler on this stencil is stable while rate*D*scl*4 < 1. uDa goes
  // to 2.0 on the slider, which alone breaches that, so shrink the step rather
  // than let the field ring itself into a saturated flat.
  float cfl = min(1.0, 0.9 / max(max(uDa, uDb) * scl * 4.0, 1e-4));

  // Musical pacing. audioBreath() over the beat clock is a raised sine in
  // 0..1 with a period of one beat, so growth surges on the beat and eases
  // between them. Deliberately one-sided *downward* — 0.55..1.0 of the silent
  // rate — because anything above 1.0 would eat into the CFL margin above.
  float pace = mix(1.0, 0.55 + 0.45 * audioBreath(u_beatPhase), u_audioActive);
  float rate = cfl * pace;

  // ── 4. Audio excursion of the feed/kill pair ─────────────────────
  // f and k *are* the morphology in Gray-Scott (spots / worms / stripes /
  // extinction), which is exactly why the excursion is small: +-0.003 on f and
  // +-0.0015 on k, against slider ranges of 0.09 and 0.03. That is at most a
  // tenth of the distance to a neighbouring regime, so audio can move the
  // texture — worms breathing wider, spots elongating — but cannot walk the
  // system out of the band the creator chose, in either direction.
  //
  // The driver is u_energy (tau 4s), not a band: at 512x512 the field needs
  // hundreds of steps to re-equilibrate after a parameter change, so a signal
  // that moves per note would just smear. Morphology drifts per *section*.
  float e = (u_energy - 0.5) * 2.0 * u_audioActive;
  float feed = uFeed + e * 0.003;
  float kill = uKill + e * 0.0015;

  // ── 5. Gray-Scott reaction-diffusion ─────────────────────────────
  float reaction = A * B * B;
  float newA = A + rate * (uDa * scl * lapA - reaction + feed * (1.0 - A));
  float newB = B + rate * (uDb * scl * lapB + reaction - (kill + feed) * B);

  // ── 6. Injections: pointer and seed both deposit B ───────────────
  newB += uMouseStrength * 0.3 * seedB(uMouse, 0.025) * step(0.5, uMouseActive);
  newB += uSeedGain * seedB(uSeedPos, 0.02);

  // ── 7. Dirichlet boundary (A=1, B=0 at edges) ───────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 3.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 3.0), 1.0 - v_uv);
  float edgeMask = edge.x * edge.y;
  newA = mix(1.0, newA, edgeMask);
  newB = mix(0.0, newB, edgeMask);

  // ── 8. Clamp [0,1] ──────────────────────────────────────────────
  fragColor = vec4(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0), 0.0, 1.0);
}
`;
