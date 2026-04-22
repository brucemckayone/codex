/**
 * JFA flood step shader (GLSL ES 3.0).
 *
 * Classic Jump Flood Algorithm pass — for each pixel, samples a 3×3
 * neighborhood at the current step size and keeps the nearest seed.
 * Step sizes halve each pass: size/2, size/4, ..., 1.
 *
 * Input/output: vec4(seedU, seedV, 0, hasSeed)
 * Uniforms:
 *   u_state    — previous JFA pass result
 *   u_stepSize — current step size in pixels (halves each pass)
 *   u_texel    — 1.0 / textureResolution
 */
export const JFA_STEP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform float u_stepSize;
uniform vec2 u_texel;

void main() {
  float bestDist = 1e10;
  vec2 bestSeed = vec2(-1.0);
  float found = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y)) * u_stepSize * u_texel;
      vec4 s = texture(u_state, v_uv + offset);
      if (s.a > 0.5) {
        float d = distance(v_uv, s.xy);
        if (d < bestDist) {
          bestDist = d;
          bestSeed = s.xy;
          found = 1.0;
        }
      }
    }
  }

  fragColor = found > 0.5
    ? vec4(bestSeed, 0.0, 1.0)
    : vec4(-1.0, -1.0, 0.0, 0.0);
}
`;
