/**
 * Waveform-flow fragment shader (GLSL ES 3.0).
 *
 * Flowing organic background for the AudioPlayer waveform. Value-noise FBM
 * with smooth interpolation (simplex-like look without the heavier gradient
 * noise) painted in the org's brand colours, gently modulated by the live
 * audio amplitude uniform.
 *
 * Consumed by `WaveformShader.svelte`. Not part of the hero-preset rotation.
 *
 * Uniforms:
 *  - u_time       seconds since mount
 *  - u_resolution canvas pixel size
 *  - u_color1     primary brand colour (0-1 RGB)
 *  - u_color2     secondary brand colour (0-1 RGB)
 *  - u_amplitude  0-1 smoothed audio amplitude
 *  - u_speed      base flow speed, mixed with amplitude at bind time
 */
export const WAVEFORM_FLOW_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_amplitude;
uniform float u_speed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    val += amp * noise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return val;
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_speed;

  float n1 = fbm(uv * 3.0 + vec2(t * 0.3, t * 0.2));
  float n2 = fbm(uv * 2.0 + vec2(-t * 0.2, t * 0.15) + n1 * 0.5);

  float blend = smoothstep(0.3, 0.7, n2);
  vec3 col = mix(u_color1, u_color2, blend);

  float brightness = 0.15 + n1 * 0.1 + u_amplitude * 0.08;

  float vig = 1.0 - length((uv - 0.5) * vec2(1.8, 1.2)) * 0.5;
  vig = clamp(vig, 0.0, 1.0);

  fragColor = vec4(col * brightness * vig, 0.85);
}
`;
