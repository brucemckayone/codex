/**
 * JFA seed initialization shader (GLSL ES 3.0).
 *
 * Reads the logo texture's alpha channel to produce a seed map for the
 * Jump Flood Algorithm. Filled pixels store their own UV coordinates;
 * empty pixels store a sentinel value (-1, -1) with alpha 0.
 *
 * Output: vec4(seedU, seedV, 0, hasSeed)
 */
export const JFA_SEED_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_logo;

void main() {
  float mask = texture(u_logo, v_uv).a;
  if (mask > 0.5) {
    fragColor = vec4(v_uv, 0.0, 1.0);
  } else {
    fragColor = vec4(-1.0, -1.0, 0.0, 0.0);
  }
}
`;
