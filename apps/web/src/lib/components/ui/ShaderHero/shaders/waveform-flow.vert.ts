/**
 * Waveform-flow vertex shader (GLSL ES 3.0).
 *
 * Trivial screen-space quad pass — forwards the position as a 0-1 UV into the
 * fragment stage. Paired with `waveform-flow.frag.ts` by the AudioPlayer's
 * WaveformShader.svelte.
 *
 * Not part of the hero-preset rotation; this is the audio-player background.
 */
export const WAVEFORM_FLOW_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0, 1);
}
`;
