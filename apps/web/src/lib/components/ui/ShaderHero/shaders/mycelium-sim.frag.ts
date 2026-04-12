/**
 * Mycelium simulation fragment shader (GLSL ES 3.0).
 *
 * Frontier-driven network growth on a 512x512 ping-pong FBO.
 * R = network density (0.0 = empty, 1.0 = branch present).
 * G = growth direction (encoded angle: 0.0-1.0 maps to 0-2*PI).
 * B = age (0.0 = newly grown, increases toward 1.0 over ~600 frames).
 *
 * Growth: frontier pixels extend in noise-biased direction with branching.
 * Repulsion: neighbourhood density check prevents self-intersection.
 * Mouse attracts growth direction. Click accelerates nearby frontier growth.
 * Ambient seed points spawn new growth origins.
 */
export const MYCELIUM_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uGrowth;
uniform float uBranch;
uniform float uSpread;
uniform float uPulse;
uniform float uThickness;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseClick;
uniform vec2 uSeedPos;

// ── Hash noise ──────────────────────────────────────────────────
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

// ── Decode/encode angle in [0,1] range ─────────────────────────
float decodeAngle(float encoded) {
  return encoded * 6.2831853;
}

float encodeAngle(float angle) {
  return fract(angle / 6.2831853);
}

// ── Sample neighborhood density (repulsion check) ──────────────
float neighborhoodDensity(vec2 uv, float radius) {
  float total = 0.0;
  float samples = 0.0;
  float step = uTexel.x;
  float r = radius * step * uSpread;
  for (float dy = -3.0; dy <= 3.0; dy += 1.0) {
    for (float dx = -3.0; dx <= 3.0; dx += 1.0) {
      vec2 offset = vec2(dx, dy) * step;
      if (length(offset) <= r && length(offset) > step * 0.5) {
        total += texture(uState, uv + offset).r;
        samples += 1.0;
      }
    }
  }
  return samples > 0.0 ? total / samples : 0.0;
}

void main() {
  vec4 state = texture(uState, v_uv);
  float density = state.r;
  float direction = state.g;
  float age = state.b;

  // ── 1. Existing branch — age it, pass through ────────────────
  if (density > 0.5) {
    age = min(age + 0.0017, 1.0);
    fragColor = vec4(density, direction, age, 1.0);
    return;
  }

  // ── 2. Empty pixel — check if any neighbor is a frontier ─────
  float nN  = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float nS  = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float nE  = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float nW  = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;
  float nNE = texture(uState, v_uv + vec2(uTexel.x, uTexel.y)).r;
  float nNW = texture(uState, v_uv + vec2(-uTexel.x, uTexel.y)).r;
  float nSE = texture(uState, v_uv + vec2(uTexel.x, -uTexel.y)).r;
  float nSW = texture(uState, v_uv + vec2(-uTexel.x, -uTexel.y)).r;

  float occupied = step(0.5, nN) + step(0.5, nS) + step(0.5, nE) + step(0.5, nW)
                 + step(0.5, nNE) + step(0.5, nNW) + step(0.5, nSE) + step(0.5, nSW);

  if (occupied < 0.5) {
    // No adjacent branches — check for new seed placement
    if (uSeedPos.x > -5.0) {
      float seedDist = length(v_uv - uSeedPos);
      if (seedDist < 0.006) {
        float seedAngle = hash21(v_uv * 100.0 + uTime) * 6.2831853;
        fragColor = vec4(1.0, encodeAngle(seedAngle), 0.0, 1.0);
        return;
      }
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // ── 3. Adjacent to a branch — attempt growth ─────────────────
  vec2 growDir = vec2(0.0);
  growDir += vec2(0.0, -1.0) * step(0.5, nN);
  growDir += vec2(0.0, 1.0) * step(0.5, nS);
  growDir += vec2(-1.0, 0.0) * step(0.5, nE);
  growDir += vec2(1.0, 0.0) * step(0.5, nW);
  growDir += vec2(-1.0, -1.0) * step(0.5, nNE) * 0.707;
  growDir += vec2(1.0, -1.0) * step(0.5, nNW) * 0.707;
  growDir += vec2(-1.0, 1.0) * step(0.5, nSE) * 0.707;
  growDir += vec2(1.0, 1.0) * step(0.5, nSW) * 0.707;

  // Read parent direction (youngest neighbor)
  float parentDir = 0.0;
  float maxParent = 0.0;

  float ageN = texture(uState, v_uv + vec2(0.0, uTexel.y)).b;
  float ageS = texture(uState, v_uv - vec2(0.0, uTexel.y)).b;
  float ageE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).b;
  float ageW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).b;

  float dirN = texture(uState, v_uv + vec2(0.0, uTexel.y)).g;
  float dirS = texture(uState, v_uv - vec2(0.0, uTexel.y)).g;
  float dirE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).g;
  float dirW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).g;

  if (nN > 0.5 && (1.0 - ageN) > maxParent) { maxParent = 1.0 - ageN; parentDir = dirN; }
  if (nS > 0.5 && (1.0 - ageS) > maxParent) { maxParent = 1.0 - ageS; parentDir = dirS; }
  if (nE > 0.5 && (1.0 - ageE) > maxParent) { maxParent = 1.0 - ageE; parentDir = dirE; }
  if (nW > 0.5 && (1.0 - ageW) > maxParent) { maxParent = 1.0 - ageW; parentDir = dirW; }

  float inheritedAngle = decodeAngle(parentDir);

  // ── 4. Noise-biased growth direction ─────────────────────────
  float noiseVal = valueNoise(v_uv * 40.0 + uTime * 0.03);
  float noiseAngle = noiseVal * 6.2831853;
  float finalAngle = inheritedAngle + (noiseAngle - 3.14159) * 0.3;

  // ── 5. Mouse attraction ──────────────────────────────────────
  if (uMouseActive > 0.5) {
    vec2 toMouse = uMouse - v_uv;
    float mouseDist = length(toMouse);
    if (mouseDist > 0.001) {
      float mouseAngle = atan(toMouse.y, toMouse.x);
      float attraction = smoothstep(0.4, 0.0, mouseDist) * 0.5;
      finalAngle = mix(finalAngle, mouseAngle, attraction);
    }
  }

  // ── 6. Check growth cone alignment ───────────────────────────
  vec2 parentToHere = normalize(growDir + vec2(0.001));
  vec2 growVec = vec2(cos(finalAngle), sin(finalAngle));
  float alignment = dot(parentToHere, growVec);
  float coneThreshold = 0.3 / uThickness;

  // ── 7. Repulsion ─────────────────────────────────────────────
  float localDensity = neighborhoodDensity(v_uv, 3.0);
  float repulsionPenalty = smoothstep(0.15, 0.4, localDensity);

  // ── 8. Growth probability ────────────────────────────────────
  float growthChance = uGrowth * 0.15;
  if (uMouseClick > 0.1) {
    float clickDist = length(v_uv - uMouse);
    growthChance += uMouseClick * smoothstep(0.15, 0.0, clickDist) * 0.4;
  }

  float rng = hash21(v_uv * 512.0 + fract(uTime * 17.31));

  if (alignment > coneThreshold && repulsionPenalty < 0.7 && rng < growthChance) {
    // ── 9. Branching decision ────────────────────────────────
    float branchRng = hash21(v_uv * 256.0 + fract(uTime * 23.17));
    if (branchRng < uBranch * 0.3) {
      float forkAngle = (hash21(v_uv * 789.0 + uTime) - 0.5) * 1.5;
      finalAngle += forkAngle;
    }

    density = 1.0;
    direction = encodeAngle(finalAngle);
    age = 0.0;
  }

  // ── 10. New seed placement ───────────────────────────────────
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos);
    if (seedDist < 0.006) {
      float seedAngle = hash21(v_uv * 100.0 + uTime) * 6.2831853;
      density = 1.0;
      direction = encodeAngle(seedAngle);
      age = 0.0;
    }
  }

  // ── 11. Edge damping ─────────────────────────────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  density *= edge.x * edge.y;

  fragColor = vec4(density, direction, age, 1.0);
}
`;
