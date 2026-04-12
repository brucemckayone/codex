/**
 * SmoothLife simulation fragment shader (GLSL ES 3.0).
 *
 * Continuous-state cellular automaton at 256x256 ping-pong FBO.
 * R channel = cell state (continuous float, 0.0 = dead, 1.0 = fully alive).
 * Ring kernel convolution: inner disc (alive neighbours) + outer annulus (neighbourhood).
 * Smooth sigmoid transition function replaces hard binary thresholds of classic Game of Life.
 *
 * Mouse deposits life material. Ambient drops keep the simulation alive.
 */
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

// ---- SmoothLife sigmoid transition function ----
float sigma(float x, float center, float width) {
  return 1.0 / (1.0 + exp(-(x - center) / width));
}

// ---- Transition function: S(n, m) ----
float transition(float n, float m) {
  float sigWidth = 0.028;

  float birthLow = uBirth;
  float birthHigh = uBirth + 0.07;
  float deathLow = uDeath - 0.07;
  float deathHigh = uDeath;

  float birthWindow = sigma(n, birthLow, sigWidth) * (1.0 - sigma(n, birthHigh, sigWidth));
  float surviveWindow = sigma(n, deathLow, sigWidth) * (1.0 - sigma(n, deathHigh, sigWidth));

  return mix(birthWindow, surviveWindow, sigma(m, 0.5, sigWidth));
}

void main() {
  float state = texture(uState, v_uv).r;

  // ---- 1. Compute inner disc average ----
  float innerSum = 0.0;
  float innerCount = 0.0;
  float ri = uInner * uTexel.x;

  for (float r = 0.0; r <= ri; r += uTexel.x * 1.5) {
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.5));
    float angleStep = 6.2832 / circumference;
    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      innerSum += texture(uState, v_uv + offset).r;
      innerCount += 1.0;
    }
  }
  float m = innerSum / max(innerCount, 1.0);

  // ---- 2. Compute outer annulus average ----
  float outerSum = 0.0;
  float outerCount = 0.0;
  float ro = uOuter * uTexel.x;

  for (float r = ri + uTexel.x; r <= ro; r += uTexel.x * 1.8) {
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.8));
    float angleStep = 6.2832 / circumference;
    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      outerSum += texture(uState, v_uv + offset).r;
      outerCount += 1.0;
    }
  }
  float n = outerSum / max(outerCount, 1.0);

  // ---- 3. Apply SmoothLife transition ----
  float target = transition(n, m);

  float dt = 0.12;
  float newState = state + dt * (target - state);

  // ---- 4. Mouse life deposit ----
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = 0.04;
    float deposit = uMouseStrength * 0.6 * exp(-dot(d, d) / (r * r));
    newState += deposit;
  }

  // ---- 5. Ambient deposit ----
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float r = 0.05;
    newState += 0.5 * exp(-dot(d, d) / (r * r));
  }

  // ---- 6. Clamp + edge damping ----
  newState = clamp(newState, 0.0, 1.0);

  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
`;
