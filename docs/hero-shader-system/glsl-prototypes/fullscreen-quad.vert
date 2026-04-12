/**
 * fullscreen-quad.vert — Shared Vertex Shader
 *
 * Renders a fullscreen quad from 4 vertices: [-1,-1], [1,-1], [-1,1], [1,1]
 * Drawn via gl.drawArrays(TRIANGLE_STRIP, 0, 4).
 *
 * Outputs v_uv in [0, 1] range for fragment shader consumption.
 */

attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  // Map clip-space [-1, 1] to UV [0, 1]
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
