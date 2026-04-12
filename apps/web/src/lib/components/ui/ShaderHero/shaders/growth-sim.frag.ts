/**
 * Growth (Differential Growth) simulation fragment shader.
 *
 * SDF-based differential growth. Each frame:
 * 1. Expand the zero-contour outward (narrow band)
 * 2. Add curvature-dependent FBM noise for buckling
 * 3. Eikonal redistribution to maintain valid SDF (|grad| -> 1.0)
 * 4. Edge damping to prevent growth reaching canvas borders
 *
 * Buffer format: R = SDF, G = curvature (Laplacian), B = growth age, A = 1.0
 * Mouse accelerates growth near cursor. Click plants a new SDF seed via smooth-min union.
 * Ambient seeds merge with existing SDF every 8-15 seconds.
 */
export const GROWTH_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uSpeed;
uniform float uNoise;
uniform float uScale;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform vec2 uSeedPos;
uniform float uSeedRadius;

// -- Hash noise (same pattern as ink-sim) --
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

// -- FBM noise for multi-scale buckling (3 octaves, fixed) --
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float curvature = state.g;
  float age = state.b;

  // -- 1. Sample neighbors for gradient and Laplacian --
  float sN = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float sS = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float sE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float sW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  // Gradient (central differences)
  vec2 grad = vec2(sE - sW, sN - sS) / (2.0 * uTexel.x);
  float gradLen = length(grad) + 0.0001;

  // Laplacian (curvature of the SDF -- high at folds)
  float laplacian = sN + sS + sE + sW - 4.0 * sdf;
  curvature = laplacian;

  // -- 2. Expansion -- push zero-contour outward --
  // Only expand near the zero-contour (within a narrow band)
  float band = smoothstep(0.06, 0.0, abs(sdf));
  float expansion = uSpeed * 0.0003 * band; // very slow, meditative growth

  // Mouse acceleration: grow faster near cursor
  if (uMouseActive > 0.5) {
    float mouseDist = length(v_uv - uMouse);
    float mouseInfluence = smoothstep(0.15, 0.0, mouseDist);
    expansion += uSpeed * 0.001 * mouseInfluence * band;
  }

  sdf -= expansion;

  // -- 3. Curvature-dependent buckling noise --
  vec2 noiseCoord = v_uv * uScale * 15.0 + uTime * 0.03;
  float buckle = (fbm(noiseCoord, 3) - 0.5) * 2.0;

  // Curvature factor: gentle positive feedback (too much = chaos)
  float curvFactor = 1.0 + abs(curvature) * 0.5;

  // Apply buckling only near the zero-contour (very gentle)
  sdf += buckle * uNoise * 0.0002 * band * curvFactor;

  // -- 4. SDF redistribution (Eikonal correction) --
  // Push |grad(SDF)| toward 1.0 to maintain valid distances
  float sign_sdf = sign(sdf);
  float redistance = sign_sdf * (gradLen - 1.0);
  sdf -= 0.3 * redistance * uTexel.x;

  // -- 5. Age tracking -- pixels near the zero-contour reset age --
  if (abs(sdf) < 0.02) {
    age = 0.0;
  } else {
    age = min(age + 0.002, 1.0);
  }

  // -- 6. New seed: plant a circular SDF --
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos) - uSeedRadius;
    // Merge seed with existing SDF via smooth min (union)
    float h = clamp(0.5 + 0.5 * (seedDist - sdf) / 0.02, 0.0, 1.0);
    sdf = mix(seedDist, sdf, h) - 0.02 * h * (1.0 - h);
    if (abs(seedDist) < 0.01) age = 0.0;
  }

  // -- 7. Clamp SDF range --
  sdf = clamp(sdf, -0.5, 0.5);

  // -- 8. Edge damping --
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  float edgeDamp = edge.x * edge.y;
  // Push SDF positive (outside) near canvas edges to prevent growth overflow
  sdf = mix(0.3, sdf, edgeDamp);

  fragColor = vec4(sdf, curvature, age, 1.0);
}
`;
