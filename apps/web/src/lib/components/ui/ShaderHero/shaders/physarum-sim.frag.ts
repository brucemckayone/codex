/**
 * Physarum simulation fragment shaders (GLSL ES 3.0): agents that follow
 * their own trail (Jones, 2010), so the trail draws a vein network.
 *
 * WP-1d R3 (Codex-1yd58): the agents are particles now. The old shader moved
 * an "agent density" field through the trail texture by a bilinear backtrace,
 * and every step of that blurred it: agents smeared below the deposit
 * threshold within seconds, so the picture stayed a faint mist (the lab, 18 s
 * in) and never drew a vein. Each agent is now one texel of an agent texture
 * (x, y, heading) that senses the trail ahead of it, turns toward the
 * strongest of three sensors, steps forward and deposits where it lands.
 *
 * Three passes a step, all here:
 *   PHYSARUM_AGENT_FRAG    sense, turn and move every agent (agent texture)
 *   PHYSARUM_SIM_FRAG      diffuse and decay the trail, add pointer and food
 *   PHYSARUM_DEPOSIT_FRAG  each agent's deposit, drawn as a point with
 *                          additive blending (physarum-sim.vert.ts places it)
 *
 * Distances are in trail texels (`uTexel` converts), and the trail grid has
 * the canvas's shape (sim-grid.ts), so an agent's step, its sensors and a
 * touch are round on screen. A reach tuned in uv on the old square grid is
 * that many SIM_BASE texels.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { SIM_BASE } from '../sim-grid';

/**
 * The agent step. Agents: R, G = position in 0..1 uv, B = heading (radians).
 *
 * Steering is Jones's rule: keep going when the trail ahead is strongest,
 * pick a side at random when both flanks beat it (a fork), else turn toward
 * the stronger flank. A small random wander on every step keeps the headings
 * off the few directions a purely deterministic rule settles into.
 */
export const PHYSARUM_AGENT_FRAG = `#version 300 es
precision highp float;
// The agents are 32-bit float positions; ESSL3's default sampler2D is lowp.
precision highp sampler2D;
out vec4 fragColor;

uniform sampler2D uAgents;
uniform sampler2D uTrail;
uniform vec2 uTexel;
uniform float uSensor;
uniform float uTurn;
uniform float uStep;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

#define PI 3.14159265
#define TAU 6.28318531

/** Texels an agent moves a step (120 steps a second). */
const float SPEED_TEXELS = 1.0;
/** Random turn on every step, radians either way. */
const float WANDER = 0.08;
/**
 * Chance a step that an agent starts again somewhere new (a life of about
 * 12 s). Without it the network coarsens into a few thick tubes within a
 * minute; the newcomers keep drawing fine branches.
 */
const float RESPAWN = 1.0 / 1500.0;

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec2 heading(float a) { return vec2(cos(a), sin(a)); }

void main() {
  vec2 id = floor(gl_FragCoord.xy);
  vec4 agent = texelFetch(uAgents, ivec2(id), 0);
  vec2 pos = agent.xy;
  float dir = agent.z;
  float tick = mod(uStep, 4096.0);

  // Turn: the sensor angle and the turn per step. Busy music bends the
  // veins tighter; a calm passage relaxes them into long runs.
  float turn = uTurn * PI * audioLift(u_energy, 0.5);
  // Sensor reach sets the scale the network organises at.
  vec2 reach = uTexel * (uSensor * ${SIM_BASE}.0 * audioMod(u_energy, 0.2));

  float ahead = texture(uTrail, pos + heading(dir) * reach).r;
  float left = texture(uTrail, pos + heading(dir + turn) * reach).r;
  float right = texture(uTrail, pos + heading(dir - turn) * reach).r;

  float r1 = hash31(vec3(id, tick));
  float r2 = hash31(vec3(id + 17.0, tick + 0.5));
  if (ahead < left && ahead < right) {
    dir += r1 < 0.5 ? turn : -turn;
  } else if (left > right && left > ahead) {
    dir += turn;
  } else if (right > left && right > ahead) {
    dir -= turn;
  }
  dir += (r2 - 0.5) * 2.0 * WANDER;

  // The veins surge on the beat and ease between beats.
  float pace = mix(1.0, 0.7 + 0.55 * audioBreath(u_beatPhase), u_audioActive);
  pos += heading(dir) * uTexel * SPEED_TEXELS * pace;

  // An agent that reaches an edge stays on it and sets off somewhere new.
  if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
    pos = clamp(pos, vec2(0.0), vec2(1.0));
    dir = r2 * TAU;
  }
  float r3 = hash31(vec3(id + 41.0, tick + 0.25));
  if (r3 < RESPAWN) {
    pos = vec2(hash31(vec3(id, tick + 0.75)), hash31(vec3(id + 5.0, tick)));
    dir = r1 * TAU;
  }

  fragColor = vec4(pos, mod(dir, TAU), 1.0);
}
`;

/**
 * The trail step: a small blur (diffusion), decay, then the pointer and any
 * food. R = trail. The blur is four bilinear taps half a texel off centre,
 * which together weigh the 3x3 neighbourhood 1-2-1.
 *
 * `uRetain` is the trail kept a step, from the decay slider
 * (`physarumRetain` in the renderer, which also scales the deposit by it).
 */
export const PHYSARUM_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDiffusion;
uniform float uRetain;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;
uniform float uDropGain;

const float TRAIL_MAX = 6.0;
/** A touch's radius and a food drop's, in SIM_BASE texels. */
const float TOUCH_RADIUS = 0.06;
const float FOOD_RADIUS = 0.04;

/** Distance to p in SIM_BASE texels: round on screen at any grid shape. */
float texelDistance2(vec2 p) {
  vec2 d = (v_uv - p) / uTexel / ${SIM_BASE}.0;
  return dot(d, d);
}

void main() {
  float here = texture(uState, v_uv).r;
  vec2 h = uTexel * 0.5;
  float blurred = 0.25 * (
      texture(uState, v_uv + vec2(-h.x, -h.y)).r
    + texture(uState, v_uv + vec2(h.x, -h.y)).r
    + texture(uState, v_uv + vec2(-h.x, h.y)).r
    + texture(uState, v_uv + vec2(h.x, h.y)).r
  );
  float trail = mix(here, blurred, clamp(uDiffusion * 0.5, 0.0, 1.0));
  trail *= uRetain;

  // The pointer lays trail, so the agents gather to it. Unguarded: an
  // inactive pointer is parked far off the grid, where exp() is zero.
  trail += uMouseStrength * 0.6 * step(0.5, uMouseActive)
         * exp(-texelDistance2(uMouse) / (TOUCH_RADIUS * TOUCH_RADIUS));
  trail += uDropGain * exp(-texelDistance2(uDropPos) / (FOOD_RADIUS * FOOD_RADIUS));

  fragColor = vec4(min(trail, TRAIL_MAX), 0.0, 0.0, 1.0);
}
`;

/** One agent's deposit, added (blendFunc ONE, ONE) where its point lands. */
export const PHYSARUM_DEPOSIT_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform float uDeposit;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

void main() {
  fragColor = vec4(uDeposit * audioLift(u_bass, 0.3), 0.0, 0.0, 0.0);
}
`;
