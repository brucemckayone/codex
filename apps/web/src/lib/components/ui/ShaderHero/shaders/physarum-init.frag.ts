/**
 * Physarum agent seed (GLSL ES 3.0), WP-1d R3 (Codex-1yd58).
 *
 * One agent per texel of the agent texture: a random position over the whole
 * canvas and a random heading (R, G = position in uv, B = heading). The
 * renderer then runs the network for a few seconds before the first frame
 * shows, so the hero opens on grown veins, never on the speckle the agents
 * start as.
 */
export const PHYSARUM_INIT_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform float uSeed;

#define TAU 6.28318531

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec2 id = floor(gl_FragCoord.xy);
  vec2 pos = vec2(hash31(vec3(id, uSeed)), hash31(vec3(id, uSeed + 11.3)));
  fragColor = vec4(pos, hash31(vec3(id, uSeed + 23.7)) * TAU, 1.0);
}
`;

/**
 * The agents after a real change of canvas shape (a rotate), WP-1d review
 * round 2. Positions are uv, so kept as they were a round vein loop on a
 * 390x844 phone became an oval 4.7x wider than tall at 844x390. Each agent
 * instead keeps its PIXEL offset from the centre: uScale is the old canvas
 * size over the new, per axis.
 *
 * An agent that falls off the new canvas on one axis wraps on that axis and
 * moves half a canvas along the other, into the band the narrower axis left
 * empty: after a rotate, the agents above and below the new frame fill its
 * sides, so no side waits for the veins to grow into it.
 */
export const PHYSARUM_REMAP_FRAG = `#version 300 es
precision highp float;
// The agents are 32-bit float positions; ESSL3's default sampler2D is lowp.
precision highp sampler2D;
out vec4 fragColor;

uniform sampler2D uAgents;
uniform vec2 uScale;

void main() {
  vec4 agent = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
  vec2 pos = 0.5 + (agent.xy - 0.5) * uScale;
  vec2 off = step(1.0, abs(pos * 2.0 - 1.0));
  pos = fract(pos + off.yx * 0.5);
  fragColor = vec4(pos, agent.zw);
}
`;
