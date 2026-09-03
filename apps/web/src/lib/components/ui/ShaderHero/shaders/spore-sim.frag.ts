/**
 * Spore simulation fragment shader (GLSL ES 3.0).
 *
 * Jones-style Physarum transport network on a 512x512 ping-pong FBO.
 * R = primary trail, G = secondary trail, B = heading (angle encoded into
 * 0..1), A = agent presence in 0..1.
 *
 * Distinct from the `physarum` preset by its sensor GEOMETRY: a narrow 12.5
 * degree sensor fan at a 3-texel offset with a 22.5 degree discrete turn,
 * which produces tight, thin, strongly branching filaments, where physarum's
 * wide fan and proportional steer produces broad smooth veins.
 *
 * ## What was broken — this preset had never run
 *
 * Two independent faults, and nobody had seen the output.
 *
 * 1. The sim declared `bool active`, and `active` is a RESERVED word in
 *    GLSL ES 3.00. The shader never compiled, so the preset rendered nothing in
 *    production. (Renamed before this pass; recorded here because it is why
 *    everything below went unnoticed.)
 *
 * 2. **There was no motor stage.** `float ss = uStepSize * uTexel.x;` was
 *    computed and never referenced — the one line that would have moved an
 *    agent. Agents sensed, turned, wrote a heading back, and deposited at their
 *    own texel forever. The heading channel was dead state, exactly as in the
 *    sibling physarum preset.
 *
 *    Worse, the deposit was unsurvivable arithmetic: `trail += 0.15` per step
 *    against `uDecay` of 0.998 gives an equilibrium of 0.15 / 0.002 = 75, and
 *    the clamp is at 2.8. Every agent texel pinned to the clamp within about
 *    twenty steps and the 3x3 blur spread that everywhere, so even with the
 *    reserved word fixed the preset would have rendered a flat saturated
 *    rectangle. Both faults had to be fixed for anything to be visible.
 *
 * 3. The turn was also inverted: `else if (fL < fR) { heading += ra; }` turns
 *    toward the WEAKER flank. Moot while nothing moved; corrected here.
 *
 * ## What replaced it
 *
 * A semi-Lagrangian backtrace supplies the missing motor stage: each texel
 * reads the state one step behind along its heading, so trails and agents are
 * transported. `uStepSize` now means what its name says.
 *
 * The backtrace uses this texel's heading rather than the source's — the usual
 * approximation, since the source is not known until the offset is chosen.
 * Heading is smooth along a filament, so the error stays well under a texel.
 *
 * **What keeps it alive.** Three bounded mechanisms, none of which can run
 * away: the agent channel is a clamped advected sample plus a sparse birth
 * gated on (1 - agent), so births only happen in empty space and coverage sits
 * at a fixed point; the deposit is sized against the decay so the mean trail
 * settles near a third of the ramp rather than at the clamp; and ambient food
 * sources (which the preset previously had none of) keep re-seeding exploration
 * so the network cannot settle into a frozen skeleton.
 *
 * **Audio.** Turn magnitude is the lever: `u_energy` widens `uRotation` by up
 * to 50%, so a busy passage grows a visibly more tortuous, more branched
 * network and a calm one grows long straight runners. That is structural, which
 * is what makes an agent system worth driving from audio rather than merely
 * tinting. `u_energy` also nudges the sensor fan width, `u_beatPhase` paces the
 * agent step so filaments surge on the beat, and `u_bass` lifts the deposit.
 * Beat-chosen food sources arrive through `uDropPos` and also spawn explorers,
 * so the network reaches toward each new source.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const SPORE_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uBurst;
uniform float uSensorAngle;
uniform float uSensorOffset;
uniform float uStepSize;
uniform float uRotation;
uniform float uDecay;
uniform float uDtScale;
uniform vec2 uDropPos;
uniform float uDropGain;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

#define TAU 6.28318531

/**
 * Fraction of uStepSize travelled per substep. uStepSize is in texels and the
 * renderer runs two substeps a frame, so 0.25 puts the default 6 at 1.5 texels
 * per step — 180 texels/s at 60Hz. Larger and the bilinear source no longer
 * overlaps the previous footprint, which breaks filaments into dashes.
 */
const float STEP_FRACTION = 0.25;

/** Primary trail deposited per step by a resident agent. */
const float DEPOSIT_PRIMARY = 0.020;
/** Secondary trail, for the display's colour variation. */
const float DEPOSIT_SECONDARY = 0.010;

/**
 * Agent retain per step. 0.9997 is a mean lifetime of ~3333 steps, 28s at 120
 * steps/s, over which an agent lays roughly 5000 texels of filament.
 */
const float AGENT_RETAIN = 0.9997;

/**
 * Birth probability per texel per step in empty space. At 512x512 with two
 * substeps at 60fps that is about 315 births/s against a 28s lifetime, so
 * equilibrium coverage lands near 3.4% of the field.
 */
const float BIRTH_PROB = 1.0e-5;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  // ---- 1. Trail diffusion: 3x3 box blur of both trail channels ----
  // The centre tap's heading is captured on the way past, so the backtrace
  // below needs no fetch of its own and the pass stays at 13 fetches.
  vec2 blurSum = vec2(0.0);
  float headHere = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 nb = texture(uState, v_uv + vec2(float(x), float(y)) * uTexel);
      blurSum += nb.rg;
      if (x == 0 && y == 0) headHere = nb.b * TAU;
    }
  }
  vec2 blurred = blurSum / 9.0;

  // ---- 2. Motor stage: semi-Lagrangian backtrace ----
  // The step this preset was missing entirely. uStepSize finally means the
  // distance an agent covers.
  // Paced by the musical clock: audioBreath() is a raised sine over one beat,
  // so filaments surge on the beat and ease between. Band is 0.7x..1.25x —
  // never zero, because a stalled agent stops depositing and its filament
  // starts fading within a couple of seconds.
  float pace = mix(1.0, 0.7 + 0.55 * audioBreath(u_beatPhase), u_audioActive);
  float travel = uStepSize * STEP_FRACTION * uTexel.x * uDtScale * pace;
  vec2 src = v_uv - vec2(cos(headHere), sin(headHere)) * travel;

  vec4 s = texture(uState, src);
  float trail = s.r;
  float trail2 = s.g;
  float heading = s.b * TAU;
  float agentIn = s.a;

  // ---- 3. Sensory stage: three sensors on the primary trail ----
  // Turn magnitude is the audio lever for this preset (see the header note).
  float ra = radians(uRotation) * audioLift(u_energy, 0.5);
  // The fan width sets the scale the network organises at, so it moves only
  // with the slow envelope — a per-note fan width would make the topology
  // shiver rather than reorganise.
  float sa = radians(uSensorAngle) * audioMod(u_energy, 0.15);
  float so = uSensorOffset * uTexel.x;

  vec2 dirC = vec2(cos(heading), sin(heading));
  vec2 dirL = rot2(sa) * dirC;
  vec2 dirR = rot2(-sa) * dirC;

  float fC = texture(uState, src + dirC * so).r;
  float fL = texture(uState, src + dirL * so).r;
  float fR = texture(uState, src + dirR * so).r;

  // ---- 4. Jones turning rule ----
  // Scaled by uDtScale so the turn per unit TIME is refresh-rate independent.
  float turn = ra * uDtScale;
  if (fC > fL && fC > fR) {
    // Centre strongest: hold course.
  } else if (fC < fL && fC < fR) {
    // Centre weakest: turn randomly. This is the rule that lets a filament
    // leave a saturated region instead of oscillating inside it.
    heading += (hash21(v_uv * 419.0 + fract(uTime * 7.13) * 61.0) - 0.5) * 2.0 * turn;
  } else if (fR > fL) {
    // Right flank stronger. The original turned the other way here, toward the
    // WEAKER sensor, which inverts chemotaxis into chemophobia.
    heading -= turn;
  } else {
    heading += turn;
  }

  // ---- 5. Agent population ----
  float rng = hash21(v_uv * 297.0 + fract(uTime * 17.31) * 53.0);
  float born = step(rng, BIRTH_PROB * uDtScale) * (1.0 - agentIn);
  float agent = clamp(agentIn * pow(AGENT_RETAIN, uDtScale) + born, 0.0, 1.0);

  // A newborn needs a heading of its own; inheriting the source texel's, which
  // in empty space is zero, would send every explorer due east.
  heading = mix(heading, hash21(v_uv * 77.0 + fract(uTime * 3.7)) * TAU, born);

  // ---- 6. Trail: diffuse, decay, deposit ----
  // uDecay is a per-substep multiplier as before, with the exponent scaled so
  // the decay per unit time no longer depends on the refresh rate. At the
  // default 0.998 that is a trail half-life of 3.3s: long enough for a route to
  // be re-found and reinforced, short enough that abandoned routes prune.
  float diffuse = clamp(0.35 * uDtScale, 0.0, 1.0);
  trail = mix(trail, blurred.x, diffuse) * pow(uDecay, uDtScale);
  trail2 = mix(trail2, blurred.y, diffuse) * pow(uDecay, uDtScale);

  float resident = smoothstep(0.25, 0.6, agent) * uDtScale
                 * audioLift(u_bass, 0.3);
  trail += DEPOSIT_PRIMARY * resident;
  trail2 += DEPOSIT_SECONDARY * resident;

  // ---- 7. Mouse attractant ----
  // Unguarded: an inactive mouse is parked at (-10, -10), where the Gaussian
  // exponent is around -6e4 and exp() underflows to zero.
  float dMouse = distance(v_uv, uMouse);
  float mouseG = exp(-dMouse * dMouse * 600.0) * step(0.5, uMouseActive);
  trail += 0.10 * mouseG * uDtScale;

  // ---- 8. Click burst: trail, agents, and headings aimed inward ----
  if (uBurst > 0.01) {
    float g = exp(-dMouse * dMouse * 300.0);
    trail += uBurst * 0.3 * g * uDtScale;
    trail2 += uBurst * 0.15 * g * uDtScale;
    agent = max(agent, step(rng, 0.35 * g));
    if (g > 0.1) {
      vec2 toBurst = uMouse - v_uv;
      heading = mix(heading, atan(toBurst.y, toBurst.x), 0.6);
    }
  }

  // ---- 9. Food source: pheromone, and explorers to find it ----
  // The preset previously had no ambient source at all, so once the initial
  // scatter had been consumed there was nothing left to organise around.
  vec2 dd = v_uv - uDropPos;
  float food = exp(-dot(dd, dd) / 0.0016);
  trail += uDropGain * food * uDtScale;
  agent = max(agent, step(rng, 0.06 * food));

  // ---- 10. Clamp + edge damping ----
  trail = clamp(trail, 0.0, 2.8);
  trail2 = clamp(trail2, 0.0, 2.0);

  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  float edgeDamp = edge.x * edge.y;
  trail *= edgeDamp;
  trail2 *= edgeDamp;
  // Agents damped at the border too, or the backtrace parks them against the
  // edge where they deposit into a damped trail and pile up invisibly.
  agent *= edgeDamp;

  fragColor = vec4(trail, trail2, fract(heading / TAU), agent);
}
`;
