/**
 * Physarum deposit vertex shader (GLSL ES 3.0), WP-1d R3 (Codex-1yd58).
 *
 * Drawn as POINTS with no vertex attributes: vertex N is agent N, read from
 * the agent texture by `gl_VertexID`, and placed one texel wide on the trail
 * grid where that agent stands. PHYSARUM_DEPOSIT_FRAG adds its deposit.
 */
export const PHYSARUM_DEPOSIT_VERT = `#version 300 es
precision highp float;
// The agents are 32-bit float positions; ESSL3's default sampler2D is lowp.
precision highp sampler2D;

uniform sampler2D uAgents;
uniform int uAgentSide;

void main() {
  ivec2 id = ivec2(gl_VertexID % uAgentSide, gl_VertexID / uAgentSide);
  vec2 pos = texelFetch(uAgents, id, 0).xy;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;
