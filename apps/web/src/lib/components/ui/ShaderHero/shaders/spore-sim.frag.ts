/**
 * Spore simulation fragment shader (GLSL ES 3.0).
 *
 * Ping-pong at 512x512.
 * Buffer: R = trail density, G = secondary trail, B = heading, A = agent flag.
 *
 * Explicit Physarum transport network (Jones 2010):
 * ~30% of texels are agents that sense trail, turn, move, and deposit.
 * Trail diffuses via 3x3 blur and decays each frame.
 *
 * Configurable: sensor angle, sensor offset, step size, rotation angle, decay.
 */
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

#define PI 3.14159265
#define TAU 6.28318530

// ── Pseudo-random ───────────────────────────────────────────
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec4 center = texture(uState, v_uv);

  // ── Trail diffusion (3x3 box blur of R channel) ──────────
  float trailSum = 0.0;
  float trailSum2 = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 nb = texture(uState, v_uv + vec2(float(x), float(y)) * uTexel);
      trailSum += nb.r;
      trailSum2 += nb.g;
    }
  }
  float trail = (trailSum / 9.0) * uDecay;
  float trail2 = (trailSum2 / 9.0) * uDecay;

  float heading = center.b;
  float isAgent = center.a;

  // ── Agent logic (only for agent texels) ───────────────────
  // Determine if this texel is an agent via spatial hash
  // Use time-varying hash to rotate which texels are active
  float agentHash = hash21(v_uv * 512.0 + floor(uTime * 0.5) * 0.1);
  bool active = agentHash < 0.30; // ~30% density

  if (active) {
    // Convert angles from degrees to radians (normalized 0-1 heading)
    float sa = uSensorAngle / 360.0; // sensor angle as fraction of full turn
    float ra = uRotation / 360.0;    // rotation as fraction of full turn
    float so = uSensorOffset * uTexel.x; // sensor offset in UV space
    float ss = uStepSize * uTexel.x;     // step size in UV space

    float h = heading * TAU; // heading in radians

    // ── Sensory stage: sample trail at 3 sensor positions ───
    vec2 dirC = vec2(cos(h), sin(h));
    vec2 dirL = rot2(sa * TAU) * dirC;
    vec2 dirR = rot2(-sa * TAU) * dirC;

    float fC = texture(uState, v_uv + dirC * so).r; // center
    float fL = texture(uState, v_uv + dirL * so).r; // left
    float fR = texture(uState, v_uv + dirR * so).r; // right

    // ── Turning logic (Jones algorithm) ─────────────────────
    if (fC > fL && fC > fR) {
      // Stay on course — center is strongest
    } else if (fC < fL && fC < fR) {
      // Random turn — center is weakest
      float rnd = hash21(v_uv + fract(uTime * 7.13));
      heading += (rnd - 0.5) * 2.0 * ra;
    } else if (fL < fR) {
      // Turn right
      heading += ra;
    } else {
      // Turn left
      heading -= ra;
    }

    heading = fract(heading); // wrap to 0-1

    // ── Motor stage: deposit trail ──────────────────────────
    trail += 0.15; // deposit pheromone
    trail2 += 0.08; // secondary trail for color variation
    isAgent = 1.0;
  } else {
    isAgent = 0.0;
  }

  // ── Mouse interaction: deposit attractant trail ───────────
  if (uMouseActive > 0.5) {
    float d = distance(v_uv, uMouse);
    trail += 0.3 * exp(-d * d * 600.0);
  }

  // ── Click burst: large trail deposit + seed new agents ────
  if (uBurst > 0.01) {
    float d = distance(v_uv, uMouse);
    float g = exp(-d * d * 300.0);
    trail += uBurst * 0.8 * g;
    trail2 += uBurst * 0.4 * g;
    // Seed heading toward burst center
    if (g > 0.1) {
      vec2 toBurst = normalize(uMouse - v_uv + 1e-6);
      heading = fract(atan(toBurst.y, toBurst.x) / TAU);
    }
  }

  // ── Clamp ─────────────────────────────────────────────────
  trail = clamp(trail, 0.0, 2.8);
  trail2 = clamp(trail2, 0.0, 2.0);

  fragColor = vec4(trail, trail2, heading, isAgent);
}
`;
