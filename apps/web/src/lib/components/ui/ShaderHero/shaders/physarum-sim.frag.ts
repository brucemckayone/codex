/**
 * Physarum simulation fragment shader (GLSL ES 3.0).
 *
 * Eulerian chemotaxis on a 512x512 ping-pong FBO.
 * R = pheromone trail, G = heading (angle encoded into 0..1), B = agent
 * presence in 0..1.
 *
 * Agents advect along their heading, steer toward the strongest of three
 * forward trail sensors, and deposit pheromone as they go. Trail diffuses and
 * decays, so a route that stops being used fades — which is what makes the
 * network prune itself into veins rather than filling the frame.
 *
 * ## What was broken
 *
 * There was no motor stage. Each texel hashed itself into an "agent", sensed
 * the trail at three forward offsets, turned its heading, and then deposited at
 * ITS OWN position — the heading it had just computed moved nothing. Written
 * back to the G channel and read again next step, it was pure dead state: the
 * whole sensing and turning apparatus could be deleted with no visible change.
 *
 * What remained was diffusion plus decay plus a deposit at 25% of texels,
 * re-hashed every 2s. With `uDeposit * 0.15` per step against `uDecay` of 0.98,
 * an agent texel's equilibrium is 0.15 / 0.02 = 7.5, five times the point where
 * the display ramp saturates — so the preset rendered a slowly seething
 * near-uniform slab at the accent colour, with a hash pattern that jumped every
 * two seconds. No network, and none was reachable from that formulation.
 *
 * ## What replaced it
 *
 * A semi-Lagrangian backtrace. Each texel reads the state one step BEHIND along
 * its heading, so pheromone and agents are transported rather than parked. The
 * source's heading is inherited and then steered, which propagates heading
 * along a filament the way a trail of agents would.
 *
 * The backtrace uses this texel's heading rather than the source's — the usual
 * approximation, because the source is not known until the offset is chosen.
 * Heading is spatially smooth along a filament, so the error is well under one
 * texel per step, and bilinear sampling smooths what remains.
 *
 * **Population regulation is what keeps it alive.** The agent channel is a
 * clamped advected sample plus a sparse birth impulse gated on (1 - agent):
 * births happen only in empty space, deaths are a fixed exponential retain, so
 * coverage sits at a fixed point and A stays in 0..1 by construction. Backtrace
 * transport does not conserve mass — convergent flow duplicates the source, so
 * agents pile onto trails, which is exactly the chemotactic collapse that makes
 * veins — but the clamp bounds it, and divergent flow empties texels that the
 * birth term refills. Neither extinction nor saturation is reachable.
 *
 * **Rate reinterpretations.** `uDecay` is now applied per 60Hz FRAME rather
 * than per substep (the shader takes the appropriate root via `uDtScale`), so
 * the default 0.98 gives a trail half-life of 0.57s rather than 0.29s, which is
 * long enough for a route to be re-found and reinforced. `uDiffusion`'s
 * coefficient dropped from 0.5 to 0.22 per step: with no transport, diffusion
 * was the only thing that spread anything, and at 50% of a 3x3 box per step it
 * erases a one-texel filament in about three steps.
 *
 * **Audio.** Turn rate is the lever — `u_energy` widens `uTurn` by up to 50%,
 * so a busy passage reorganises the network into tighter, more tortuous veins
 * while a calm one relaxes into long smooth runs. That is a structural change,
 * not a brightness change, and it is why an agent system is worth driving from
 * audio at all. `u_energy` also scales the sensor distance (network coarseness)
 * and `u_beatPhase` paces the agent speed, so the veins surge forward on the
 * beat. `u_bass` lifts the deposit. Beat-chosen food sources arrive through
 * `uDropPos`, and a food drop also spawns explorers, so the network visibly
 * reaches toward each new source.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const PHYSARUM_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDiffusion;
uniform float uDecay;
uniform float uDeposit;
uniform float uSensor;
uniform float uTurn;
uniform float uDtScale;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;
uniform float uDropGain;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

#define TAU 6.28318531

/** Agent travel per 60Hz-equivalent step, in texels. */
const float AGENT_SPEED_TEXELS = 1.2;

/**
 * Agent retain per step. 0.9995 gives a mean lifetime of about 2000 steps —
 * 16.7s at 120 steps/s — during which an agent travels roughly 2400 texels,
 * several screen widths, so it draws a filament rather than a dot.
 */
const float AGENT_RETAIN = 0.9995;

/**
 * Birth probability per texel per step in empty space. At 512x512 with two
 * substeps at 60fps this is roughly 380 births/s against a 16.7s lifetime, so
 * equilibrium coverage lands near 2.4% of the field — sparse enough that
 * filaments read as filaments, dense enough that the network spans the frame.
 */
const float BIRTH_PROB = 1.2e-5;

/** Random-walk component of the heading, in radians per step. */
const float WANDER = 0.06;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // ---- 1. Chemoattractant: 3x3 mean of the trail at THIS texel ----
  // Sampled here rather than at the sensor points because a blur at each
  // sensor would cost nine fetches apiece. The trail is re-smoothed every step,
  // so a raw sample at a sensor is already a smoothed field.
  // The centre tap's heading is captured on the way past, so the backtrace
  // below needs no fetch of its own and the pass stays at 13 fetches — the same
  // budget as the version that transported nothing.
  float blurred = 0.0;
  float headHere = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec4 nb = texture(uState, v_uv + vec2(float(dx), float(dy)) * uTexel);
      blurred += nb.r;
      if (dx == 0 && dy == 0) headHere = nb.g * TAU;
    }
  }
  blurred /= 9.0;

  // ---- 2. Semi-Lagrangian backtrace ----
  // Speed paced by the musical clock: audioBreath() is a raised sine over one
  // beat, so the veins surge on the beat and ease between them. Band is
  // 0.7x..1.25x — the agents never stall, because a stalled agent stops
  // depositing and its filament fades within half a second.
  float pace = mix(1.0, 0.7 + 0.55 * audioBreath(u_beatPhase), u_audioActive);
  float travel = AGENT_SPEED_TEXELS * uTexel.x * uDtScale * pace;
  vec2 src = v_uv - vec2(cos(headHere), sin(headHere)) * travel;

  vec4 s = texture(uState, src);
  float trailIn = s.r;
  float heading = s.g * TAU;
  float agentIn = s.b;

  // ---- 3. Sensing and steering ----
  // Turn rate is the audio lever for this preset — see the header note.
  float turn = uTurn * audioLift(u_energy, 0.5);
  // Sensor distance sets the scale the network organises at. Slow signal only:
  // a per-note sensor distance would make the whole topology shiver.
  float sense = uSensor * audioMod(u_energy, 0.2);

  vec2 dirF = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading + turn), sin(heading + turn));
  vec2 dirR = vec2(cos(heading - turn), sin(heading - turn));

  float senseF = texture(uState, src + dirF * sense).r;
  float senseL = texture(uState, src + dirL * sense).r;
  float senseR = texture(uState, src + dirR * sense).r;

  // Proportional steer toward the stronger flank rather than a fixed-size
  // turn: a discrete turn quantises headings onto a lattice of multiples of
  // uTurn, which shows up as the network preferring a few fixed directions.
  float bias = (senseL - senseR) / (senseL + senseR + senseF + 0.001);
  heading += turn * clamp(bias * 2.0, -1.0, 1.0) * uDtScale;

  // Wander so a filament that has lost its trail still explores instead of
  // running dead straight forever.
  heading += (hash21(v_uv * 512.0 + fract(uTime * 11.71)) - 0.5) * WANDER * uDtScale;

  // ---- 4. Agent population ----
  float rng = hash21(v_uv * 297.0 + fract(uTime * 17.31) * 53.0);
  float born = step(rng, BIRTH_PROB * uDtScale) * (1.0 - agentIn);
  float agent = clamp(agentIn * pow(AGENT_RETAIN, uDtScale) + born, 0.0, 1.0);

  // A newborn agent needs a heading; without this it inherits whatever the
  // source texel held, which in empty space is zero — so every explorer would
  // set off due east.
  heading = mix(heading, hash21(v_uv * 77.0 + fract(uTime * 3.7)) * TAU, born);

  // ---- 5. Trail: transport, diffuse, decay, deposit ----
  // uDiffusion's coefficient is deliberately low; see the header note on why
  // the old 0.5 erased filaments once real transport existed.
  float trail = mix(trailIn, blurred, clamp(uDiffusion * 0.22 * uDtScale, 0.0, 1.0));

  // uDecay is a per-60Hz-FRAME multiplier, so the per-step exponent is the
  // frame's share divided between the renderer's two substeps.
  trail *= pow(uDecay, uDtScale * 0.5);

  trail += uDeposit * 0.35 * uDtScale * audioLift(u_bass, 0.3)
         * smoothstep(0.25, 0.6, agent);

  // ---- 6. Mouse pheromone attractor ----
  // Unguarded: an inactive mouse is parked at (-10, -10), where the Gaussian
  // exponent is about -3e4 and exp() underflows to zero.
  vec2 dm = v_uv - uMouse;
  trail += uMouseStrength * 0.5 * exp(-dot(dm, dm) / 0.0036)
         * step(0.5, uMouseActive) * uDtScale;

  // ---- 7. Food source: pheromone, and explorers to find it ----
  vec2 dd = v_uv - uDropPos;
  float food = exp(-dot(dd, dd) / 0.0016);
  trail += uDropGain * food * uDtScale;
  // Spawning agents at the source is what makes the network visibly REACH for
  // a new food source rather than merely brightening near it.
  agent = max(agent, step(rng, 0.06 * food));

  // ---- 8. Clamp + edge damping ----
  trail = clamp(trail, 0.0, 3.0);
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  float edgeDamp = edge.x * edge.y;
  trail *= edgeDamp;
  // Agents damped at the border too, or the backtrace parks them against the
  // edge where they deposit into a damped trail and pile up invisibly.
  agent *= edgeDamp;

  fragColor = vec4(trail, fract(heading / TAU), agent, 1.0);
}
`;
