/**
 * Frost simulation fragment shader (GLSL ES 3.0).
 *
 * DLA-inspired crystal growth with diffusion field + freezing threshold.
 * Buffer format: R = frozen state (0/1), G = diffusion field, B = freeze age.
 * Anisotropic bias creates N-fold symmetry branching (configurable 4-8).
 * Mouse acts as heat source (melts frozen regions).
 * New seed crystals planted via uSeedPos.
 *
 * Uniforms:
 *   uState       — ping-pong sim texture (R=frozen, G=diffusion, B=age)
 *   uTexel       — 1.0 / simResolution
 *   uGrowth      — growth speed (threshold bias, 0.3-1.0)
 *   uBranch      — branching tendency (anisotropy strength, 0.1-0.5)
 *   uSymmetry    — symmetry fold count (int, 4-8)
 *   uMelt        — mouse melt radius (UV units * 0.1)
 *   uTime        — elapsed time in seconds
 *   uMouse       — mouse position (0-1)
 *   uMouseActive — 1.0 if mouse over canvas
 *   uSeedPos     — new seed crystal position (-10 if none)
 */
export const FROST_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uGrowth;
uniform float uBranch;
uniform int uSymmetry;
uniform float uMelt;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform vec2 uSeedPos;

// -- Hash noise --
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

// -- Anisotropic freezing bias --
// Returns [0,1]: highest along preferred growth directions (N-fold symmetry).
float anisotropyBias(vec2 dir, int sym) {
  float angle = atan(dir.y, dir.x);
  float fold = float(sym);
  return 0.5 + 0.5 * cos(fold * angle);
}

void main() {
  vec4 state = texture(uState, v_uv);
  float frozen = state.r;
  float diffuse = state.g;
  float age = state.b;

  // ---- 1. Already frozen -- just age it ----
  if (frozen > 0.5) {
    age = min(age + 0.002, 1.0); // age slowly to 1.0

    // Mouse melt: frozen pixels within melt radius revert to liquid
    if (uMouseActive > 0.5) {
      float dist = length(v_uv - uMouse);
      float meltRadius = uMelt * 0.1;
      if (dist < meltRadius) {
        float meltStrength = smoothstep(meltRadius, meltRadius * 0.3, dist);
        frozen = mix(frozen, 0.0, meltStrength);
        age = 0.0;
      }
    }

    fragColor = vec4(frozen, diffuse, age, 1.0);
    return;
  }

  // ---- 2. Diffusion step: frozen pixels are the ONLY source ----
  // Read neighbour diffusion AND frozen state
  float gN = texture(uState, v_uv + vec2(0.0, uTexel.y)).g;
  float gS = texture(uState, v_uv - vec2(0.0, uTexel.y)).g;
  float gE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).g;
  float gW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).g;

  float fN_g = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float fS_g = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float fE_g = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float fW_g = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  // Frozen neighbours emit diffusion potential (growth source)
  float frozenSource = step(0.5, fN_g) + step(0.5, fS_g) +
                       step(0.5, fE_g) + step(0.5, fW_g);
  diffuse += frozenSource * 0.02; // slow, steady emission from crystal edges

  // Standard Laplacian diffusion (spreads potential outward from sources)
  float laplacian = gN + gS + gE + gW - 4.0 * diffuse;
  diffuse += 0.15 * laplacian;

  // Slow natural decay prevents runaway accumulation
  diffuse *= 0.995;
  diffuse = clamp(diffuse, 0.0, 1.0);

  // ---- 3. Freezing check: adjacent to frozen + diffusion > threshold ----
  float fN = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float fS = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float fE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float fW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  // Check diagonals for smoother growth
  float fNE = texture(uState, v_uv + vec2(uTexel.x, uTexel.y)).r;
  float fNW = texture(uState, v_uv + vec2(-uTexel.x, uTexel.y)).r;
  float fSE = texture(uState, v_uv + vec2(uTexel.x, -uTexel.y)).r;
  float fSW = texture(uState, v_uv + vec2(-uTexel.x, -uTexel.y)).r;

  float frozenNeighbors = step(0.5, fN) + step(0.5, fS) +
                          step(0.5, fE) + step(0.5, fW);
  float frozenDiags = step(0.5, fNE) + step(0.5, fNW) +
                      step(0.5, fSE) + step(0.5, fSW);

  // Cardinal neighbors count more
  float adjacency = frozenNeighbors + frozenDiags * 0.5;

  if (adjacency > 0.5) {
    // ---- 4. Anisotropic bias for branching ----
    vec2 frozenDir = vec2(0.0);
    frozenDir += vec2(0.0, 1.0) * fN;
    frozenDir += vec2(0.0, -1.0) * fS;
    frozenDir += vec2(1.0, 0.0) * fE;
    frozenDir += vec2(-1.0, 0.0) * fW;
    frozenDir = normalize(frozenDir + vec2(0.001));

    // Noise perturbation for stochastic variation
    float noiseVal = valueNoise(v_uv * 50.0 + uTime * 0.05);
    float aBias = anisotropyBias(frozenDir, uSymmetry);

    // Threshold: lower = easier to freeze = faster growth
    float threshold = 1.0 - uGrowth * 0.7;

    // Branching modulates anisotropy's effect on threshold
    float modulated = mix(1.0, aBias, uBranch);

    // Noise adds stochastic variation
    float noiseModulation = mix(0.8, 1.2, noiseVal);

    if (diffuse * modulated * noiseModulation > threshold) {
      frozen = 1.0;
      diffuse *= 0.3; // Consume diffusion on freezing
      age = 0.0;      // Newly frozen
    }
  }

  // ---- 5. New seed crystal ----
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos);
    if (seedDist < 0.005) {
      frozen = 1.0;
      age = 0.0;
    }
  }

  // ---- 6. Edge damping ----
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  diffuse *= edge.x * edge.y;

  fragColor = vec4(frozen, diffuse, age, 1.0);
}
`;
