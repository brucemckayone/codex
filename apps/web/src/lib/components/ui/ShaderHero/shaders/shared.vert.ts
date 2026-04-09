/** Shared fullscreen quad vertex shader (GLSL ES 3.0). */
export const SHARED_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0, 1);
}`;
