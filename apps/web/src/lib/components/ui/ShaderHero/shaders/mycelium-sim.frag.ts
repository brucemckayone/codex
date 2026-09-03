/**
 * Mycelium simulation fragment shader (GLSL ES 3.0).
 *
 * Frontier-driven network growth on a 512x512 ping-pong FBO.
 * R = hyphal density (0 empty, 1 branch present), G = growth direction as an
 * angle encoded into 0..1, B = age (0 newly grown, saturating at 1).
 *
 * An empty texel adjacent to a branch may extend it, inheriting the parent
 * direction, biased by a noise field, penalised by local crowding, and forked
 * with probability `uBranch`. Mature, well-buried tissue senesces, so the mat
 * turns over instead of freezing.
 *
 * ## What changed and why
 *
 * **Redundant fetches.** The growth path fetched each of the four axial
 * neighbours THREE times — once for `.r` (occupancy), once for `.b` (age) and
 * once for `.g` (direction) — as twelve separate `texture()` calls returning
 * data already in registers. Each neighbour is now fetched once as a `vec4`.
 * That is 8 fetches where there were 16, for identical results.
 *
 * **The repulsion gather.** Local crowding came from a 7x7 nested loop with
 * `length(offset)` evaluated twice per iteration and a conditional fetch
 * inside: 49 iterations, ~28 of which passed the radius test. It is now a
 * 12-tap equal-area golden-angle spiral over the same annulus — branch-free,
 * with the tap radii folding to literals when the loop unrolls, and successive
 * directions from one constant rotation instead of two `length()` calls.
 *
 * Together the empty-texel path goes from ~44 texture fetches to 20.
 *
 * **It no longer jams.** Nothing ever removed density: growth self-limits on
 * crowding, so after a minute or so every frontier was blocked and the field
 * was frozen — the only remaining motion was the display's pulse sliding over a
 * static network. Mature tissue with enough occupied neighbours now dies back
 * slowly, reopening frontier that regrows. See the senescence comment for the
 * rates and for the patch hash that stops the whole mat dying in unison.
 *
 * **Frame-rate independence.** Growth was a per-step probability and age a
 * per-step increment, with the renderer running two substeps per rendered
 * frame — so the network grew twice as fast on a 120Hz display. Both scale with
 * `uDtScale`, the frame's share of a 60Hz step.
 *
 * **Audio.** The striking lever for an agent system is the TURN RATE, not
 * brightness: `u_energy` widens the noise bias on the inherited direction, so a
 * busy passage grows a visibly more tortuous, more branched network and a calm
 * one grows straight runners. `u_energy` also lifts the fork probability, and
 * `u_beatPhase` paces the growth probability so the frontier advances in pulses
 * with the music. Beat-chosen inoculation points arrive through `uSeedPos`.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const MYCELIUM_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uGrowth;
uniform float uBranch;
uniform float uSpread;
uniform float uThickness;
uniform float uDtScale;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseClick;
uniform vec2 uSeedPos;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

#define TAU 6.2831853

/** Taps over the crowding annulus. Constant so the loop unrolls. */
const int CROWD_TAPS = 12;

/** Golden-angle rotation, pre-resolved: cos/sin of pi*(3-sqrt(5)) rad. */
const float GOLDEN_C = -0.737368878;
const float GOLDEN_S = 0.675490294;

/** Rate constants, all per 60Hz-equivalent step (scaled by uDtScale). */
const float AGE_RATE = 0.0017;
/**
 * Senescence rate. Tuned so fully buried, fully mature tissue takes about 15
 * seconds to fall below the 0.5 occupancy threshold and free its texel:
 * 0.5 / (0.00028 * 2 substeps * 60 fps) = 14.9s. Slower than that and the mat
 * jams before it turns over; much faster and the network never accumulates
 * enough to look like a network.
 */
const float SENESCENCE_RATE = 0.00028;

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

float decodeAngle(float encoded) { return encoded * TAU; }
float encodeAngle(float angle) { return fract(angle / TAU); }

/** Advance a unit direction by the golden angle. */
vec2 spin(vec2 d) {
  return vec2(GOLDEN_C * d.x - GOLDEN_S * d.y, GOLDEN_S * d.x + GOLDEN_C * d.y);
}

/**
 * Mean density over an annulus around this texel — the self-avoidance term.
 *
 * Equal-area spiral: r_k = sqrt(rmin^2 + (rmax^2 - rmin^2) * (k + 0.5) / N)
 * places the same annular area between consecutive taps, so an unweighted mean
 * is an unbiased estimate of the region average and needs no per-tap weight.
 * The sample pattern is identical at every texel, so this is a fixed sparse
 * kernel rather than added noise: nothing speckles.
 */
float crowding(vec2 uv) {
  float rmin = uTexel.x * 0.75;
  float rmax = max(uTexel.x * 3.0 * uSpread, rmin + uTexel.x);
  float r2 = rmin * rmin;
  float span = rmax * rmax - r2;
  float total = 0.0;
  vec2 dir = vec2(0.3826834, 0.9238795);
  for (int i = 0; i < CROWD_TAPS; i++) {
    float r = sqrt(r2 + span * ((float(i) + 0.5) / float(CROWD_TAPS)));
    total += texture(uState, uv + dir * r).r;
    dir = spin(dir);
  }
  return total / float(CROWD_TAPS);
}

void main() {
  vec4 self = texture(uState, v_uv);
  float density = self.r;
  float direction = self.g;
  float age = self.b;

  // Each neighbour fetched ONCE; both paths below read .r, .g and .b from it.
  vec4 nN = texture(uState, v_uv + vec2(0.0, uTexel.y));
  vec4 nS = texture(uState, v_uv - vec2(0.0, uTexel.y));
  vec4 nE = texture(uState, v_uv + vec2(uTexel.x, 0.0));
  vec4 nW = texture(uState, v_uv - vec2(uTexel.x, 0.0));
  vec4 nNE = texture(uState, v_uv + vec2(uTexel.x, uTexel.y));
  vec4 nNW = texture(uState, v_uv + vec2(-uTexel.x, uTexel.y));
  vec4 nSE = texture(uState, v_uv + vec2(uTexel.x, -uTexel.y));
  vec4 nSW = texture(uState, v_uv + vec2(-uTexel.x, -uTexel.y));

  float oN = step(0.5, nN.r);
  float oS = step(0.5, nS.r);
  float oE = step(0.5, nE.r);
  float oW = step(0.5, nW.r);
  float oNE = step(0.5, nNE.r);
  float oNW = step(0.5, nNW.r);
  float oSE = step(0.5, nSE.r);
  float oSW = step(0.5, nSW.r);
  float occupied = oN + oS + oE + oW + oNE + oNW + oSE + oSW;

  // ---- 1. Existing branch: age, then senesce if mature and buried ----
  if (density > 0.5) {
    age = min(age + AGE_RATE * uDtScale, 1.0);

    // Neighbour occupancy as the "buried" cue: a frontier tip has 1-2 occupied
    // neighbours and is never eroded, while interior tissue has 6-8.
    float buried = smoothstep(4.5, 7.0, occupied);

    // A per-patch hash decorrelates the die-back. Without it the whole mat
    // matures at the same time and dies in unison, which reads as the network
    // blinking rather than turning over. NB: the bare name patch is a GLSL ES
    // 3.00 reserved word (a tessellation qualifier) and will not compile.
    float patchGain = 0.5 + hash21(floor(v_uv * 64.0)) * 1.1;

    float die = smoothstep(0.9, 1.0, age) * buried * patchGain
              * SENESCENCE_RATE * uDtScale * audioLift(u_energy, 0.45);
    density -= die;

    fragColor = vec4(max(density, 0.0), direction, age, 1.0);
    return;
  }

  // ---- 2. Empty texel with no neighbour: seed placement only ----
  if (occupied < 0.5) {
    if (uSeedPos.x > -5.0 && length(v_uv - uSeedPos) < 0.006) {
      float seedAngle = hash21(v_uv * 100.0 + uTime) * TAU;
      fragColor = vec4(1.0, encodeAngle(seedAngle), 0.0, 1.0);
      return;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // ---- 3. Adjacent to a branch: attempt an extension ----
  // Direction FROM the occupied neighbours TO here — the growth cone axis.
  vec2 growDir = vec2(0.0);
  growDir += vec2(0.0, -1.0) * oN;
  growDir += vec2(0.0, 1.0) * oS;
  growDir += vec2(-1.0, 0.0) * oE;
  growDir += vec2(1.0, 0.0) * oW;
  growDir += vec2(-1.0, -1.0) * oNE * 0.707;
  growDir += vec2(1.0, -1.0) * oNW * 0.707;
  growDir += vec2(-1.0, 1.0) * oSE * 0.707;
  growDir += vec2(1.0, 1.0) * oSW * 0.707;

  // Inherit from the YOUNGEST occupied axial neighbour: that is the tip that
  // most recently grew, so the hypha keeps its heading instead of averaging
  // toward the middle of the mat.
  float parentDir = 0.0;
  float maxParent = 0.0;
  if (oN > 0.5 && (1.0 - nN.b) > maxParent) { maxParent = 1.0 - nN.b; parentDir = nN.g; }
  if (oS > 0.5 && (1.0 - nS.b) > maxParent) { maxParent = 1.0 - nS.b; parentDir = nS.g; }
  if (oE > 0.5 && (1.0 - nE.b) > maxParent) { maxParent = 1.0 - nE.b; parentDir = nE.g; }
  if (oW > 0.5 && (1.0 - nW.b) > maxParent) { maxParent = 1.0 - nW.b; parentDir = nW.g; }

  float inheritedAngle = decodeAngle(parentDir);

  // ---- 4. Noise-biased heading ----
  // The wander gain is THE audio lever for this preset. At 0.3 a hypha holds a
  // near-straight line; at 0.45 it meanders and the network reorganises
  // visibly. Driven by u_energy (tau 4s), not a band: the heading is integrated
  // along a hypha, so a per-note signal would only add high-frequency
  // roughness, while a slow one changes the SHAPE of the network.
  float noiseVal = valueNoise(v_uv * 40.0 + uTime * 0.03);
  float wander = 0.3 * audioLift(u_energy, 0.5);
  float finalAngle = inheritedAngle + (noiseVal * TAU - 3.14159) * wander;

  // ---- 5. Mouse attraction — the viewer-caused motion, kept strongest ----
  if (uMouseActive > 0.5) {
    vec2 toMouse = uMouse - v_uv;
    float mouseDist = length(toMouse);
    if (mouseDist > 0.001) {
      float mouseAngle = atan(toMouse.y, toMouse.x);
      float attraction = smoothstep(0.4, 0.0, mouseDist) * 0.5;
      finalAngle = mix(finalAngle, mouseAngle, attraction);
    }
  }

  // ---- 6. Growth cone: only extend roughly forward ----
  vec2 parentToHere = normalize(growDir + vec2(0.001));
  vec2 growVec = vec2(cos(finalAngle), sin(finalAngle));
  float alignment = dot(parentToHere, growVec);
  float coneThreshold = 0.3 / uThickness;

  // ---- 7. Self-avoidance ----
  float repulsionPenalty = smoothstep(0.15, 0.4, crowding(v_uv));

  // ---- 8. Growth probability ----
  // Paced by the beat clock: audioBreath() is a raised sine over one beat, so
  // the frontier advances in pulses. Band is 0.6x..1.3x of the silent rate —
  // the frontier never stalls entirely, which matters because a stalled
  // frontier that later resumes shows a visible seam in the network.
  float pace = mix(1.0, 0.6 + 0.7 * audioBreath(u_beatPhase), u_audioActive);
  float growthChance = uGrowth * 0.15 * uDtScale * pace;
  if (uMouseClick > 0.1) {
    growthChance += uMouseClick * smoothstep(0.15, 0.0, length(v_uv - uMouse)) * 0.4;
  }

  float rng = hash21(v_uv * 512.0 + fract(uTime * 17.31));

  if (alignment > coneThreshold && repulsionPenalty < 0.7 && rng < growthChance) {
    // ---- 9. Fork ----
    float branchRng = hash21(v_uv * 256.0 + fract(uTime * 23.17));
    if (branchRng < uBranch * 0.3 * audioLift(u_energy, 0.6)) {
      finalAngle += (hash21(v_uv * 789.0 + uTime) - 0.5) * 1.5;
    }

    density = 1.0;
    direction = encodeAngle(finalAngle);
    age = 0.0;
  }

  // ---- 10. Seed placement (may land on a frontier texel too) ----
  if (uSeedPos.x > -5.0 && length(v_uv - uSeedPos) < 0.006) {
    density = 1.0;
    direction = encodeAngle(hash21(v_uv * 100.0 + uTime) * TAU);
    age = 0.0;
  }

  // ---- 11. Edge damping ----
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  density *= edge.x * edge.y;

  fragColor = vec4(density, direction, age, 1.0);
}
`;
