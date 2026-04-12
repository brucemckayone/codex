/**
 * Physarum simulation fragment shader (GLSL ES 3.0).
 *
 * Implicit agent trail simulation with diffusion + decay + deposit.
 * Buffer format: R = trail density, G = agent heading (encoded 0-1 = 0-2pi).
 * Each texel has a probability of acting as an agent based on hash.
 * Agents sense trail at 3 forward positions and turn toward highest concentration.
 * Mouse acts as pheromone attractor (deposits high-concentration trail).
 * Ambient deposits simulate food sources for network exploration.
 *
 * Uniforms:
 *   uState        — ping-pong sim texture (R = trail, G = heading)
 *   uTexel        — 1.0 / simResolution
 *   uDiffusion    — trail spread rate (3x3 blur weight)
 *   uDecay        — per-frame trail decay multiplier
 *   uDeposit      — trail deposit strength
 *   uSensor       — agent sensor distance (normalised)
 *   uTurn         — agent turn speed (radians per step)
 *   uTime         — elapsed time in seconds
 *   uMouse        — mouse position (0-1)
 *   uMouseActive  — 1.0 if mouse is over canvas
 *   uMouseStrength— mouse deposit impulse strength
 *   uDropPos      — ambient deposit position (-10 if none)
 */
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
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;

// Hash-based pseudo-random
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 state = texture(uState, v_uv);
  float trail = state.r;
  float heading = state.g * 6.28318; // decode heading from 0-1 to 0-2pi

  // ---- 1. Trail diffusion: 3x3 mean filter (weighted) ----
  float sum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * uTexel;
      sum += texture(uState, v_uv + offset).r;
    }
  }
  float blurred = sum / 9.0;
  float diffused = mix(trail, blurred, uDiffusion * 0.5);

  // ---- 2. Trail decay ----
  diffused *= uDecay;

  // ---- 3. Agent sensing (implicit -- each texel acts as potential agent) ----
  // Use hash to determine if this texel hosts an agent (~25% density)
  float agentProb = hash21(v_uv * 512.0 + floor(uTime * 0.5));
  bool isAgent = agentProb < 0.25;

  if (isAgent) {
    // Use a time-varying hash to vary heading per texel
    float h = hash21(v_uv * 256.0 + uTime * 0.1);
    heading = mix(heading, h * 6.28318, 0.02); // gentle random drift

    // Sense trail at 3 forward positions
    vec2 dir = vec2(cos(heading), sin(heading));
    vec2 dirLeft = vec2(cos(heading + uTurn), sin(heading + uTurn));
    vec2 dirRight = vec2(cos(heading - uTurn), sin(heading - uTurn));

    float senseF = texture(uState, v_uv + dir * uSensor).r;
    float senseL = texture(uState, v_uv + dirLeft * uSensor).r;
    float senseR = texture(uState, v_uv + dirRight * uSensor).r;

    // Turn toward highest trail concentration
    if (senseL > senseF && senseL > senseR) {
      heading += uTurn * 0.5;
    } else if (senseR > senseF && senseR > senseL) {
      heading -= uTurn * 0.5;
    }

    // Deposit trail at this texel
    diffused += uDeposit * 0.15;
  }

  // ---- 4. Mouse pheromone attractor ----
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = 0.06; // mouse influence radius
    float mouseDeposit = uMouseStrength * 0.5 * exp(-dot(d, d) / (r * r));
    diffused += mouseDeposit;
  }

  // ---- 5. Ambient deposit (random food source) ----
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float r = 0.04;
    diffused += 0.4 * exp(-dot(d, d) / (r * r));
  }

  // ---- 6. Clamp + edge damping ----
  diffused = clamp(diffused, 0.0, 3.0);
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  diffused *= edge.x * edge.y;

  // Encode heading back to 0-1 range
  float encodedHeading = fract(heading / 6.28318);

  fragColor = vec4(diffused, encodedHeading, 0.0, 1.0);
}
`;
