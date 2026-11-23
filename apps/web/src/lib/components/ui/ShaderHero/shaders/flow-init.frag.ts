import { PERIODIC_NOISE_GLSL, SIM_CELL } from '../sim-grid';

/**
 * Init shader: a smooth swirl that tiles over the grid.
 *
 * It used to be per-texel white noise. Curl measured on noise is large, so
 * every step's curl rotation scrambled the field faster than smoothing could
 * organise it: the hero drew nothing for ~3 s and needed ~8 s to fill, a
 * reduced-motion visitor's single frame was static, and above curl ~0.6 the
 * field never organised at all (Codex-c48om: OBB's dark mode drew black).
 * A low-frequency seed starts with small per-texel curl at any setting, so
 * the streaks read from the first frame. It tiles because the simulation
 * wraps at its edges; a seam would start as a line of false curl.
 */
export const FLOW_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 uGrid;
uniform float uSeed;
${PERIODIC_NOISE_GLSL}
void main() {
  vec2 p = v_uv * uGrid / ${SIM_CELL.toFixed(1)};
  vec2 period = uGrid / ${SIM_CELL.toFixed(1)};
  float n = 0.7 * periodicNoise(p, period, uSeed)
          + 0.3 * periodicNoise(p * 2.0, period * 2.0, uSeed + 7.0);
  float angle = n * 12.566371;
  fragColor = vec4(0.5 * cos(angle), 0.5 * sin(angle), 0.0, 1.0);
}
`;
