/**
 * JFA distance finalization shader (GLSL ES 3.0).
 *
 * Converts the Jump Flood Algorithm result into a normalized signed
 * distance field (SDF). The output is a single-channel value:
 *   - 0.5 = on the logo boundary
 *   - < 0.5 = inside the logo
 *   - > 0.5 = outside the logo
 *
 * The distance is scaled by a factor of 4 to give useful precision
 * in the 0–1 range (unscaled max distance in UV space is ~0.7 for
 * a 512px texture, so ×4 maps the useful range to ±0.5 around 0.5).
 *
 * Uniforms:
 *   u_jfa  — final JFA pass output (nearest seed coordinates)
 *   u_logo — original logo texture (alpha channel = inside/outside)
 */
export const JFA_DISTANCE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_jfa;
uniform sampler2D u_logo;

void main() {
  vec4 jfa = texture(u_jfa, v_uv);
  float mask = texture(u_logo, v_uv).a;

  // Distance to nearest boundary pixel
  float dist = jfa.a > 0.5 ? distance(v_uv, jfa.xy) : 1.0;

  // Signed: negative inside, positive outside
  float signedDist = mask > 0.5 ? -dist : dist;

  // Remap to [0, 1]: 0.5 = boundary, <0.5 = inside, >0.5 = outside
  float normalized = clamp(signedDist * 4.0 + 0.5, 0.0, 1.0);

  fragColor = vec4(normalized, 0.0, 0.0, 1.0);
}
`;
