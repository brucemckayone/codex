/**
 * SmoothLife display fragment shader (GLSL ES 3.0).
 *
 * Maps continuous cell state (0-1) to brand colour gradient.
 * Multi-stop colour ramp: bg -> primary -> secondary -> accent.
 * Edge glow via screen-space derivatives, internal pulsing for alive organisms.
 * Standard post-processing chain with 0.75 brightness cap.
 */
export const LIFE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ---- 1. Read cell state ----
  float state = texture(uState, v_uv).r;

  // ---- 2. Multi-stop colour ramp ----
  vec3 color;
  float t = clamp(state * uIntensity, 0.0, 1.0);

  if (t < 0.3) {
    color = mix(uBgColor, uColorPrimary, t / 0.3);
  } else if (t < 0.7) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.3) / 0.4);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.7) / 0.3);
  }

  // ---- 3. Organism edge glow ----
  float dSdx = dFdx(state);
  float dSdy = dFdy(state);
  float edgeStrength = smoothstep(0.002, 0.04, abs(dSdx) + abs(dSdy));
  color += edgeStrength * 0.05 * uColorAccent * uIntensity;

  // ---- 4. Internal pulsing ----
  float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + state * 8.0);
  float coreGlow = smoothstep(0.6, 1.0, state) * pulse * 0.06;
  color += coreGlow * uColorAccent;

  // ---- 5. Reinhard tone mapping ----
  color = color / (1.0 + color);

  // ---- 6. Vignette ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 7. Film grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // ---- 8. Brightness cap ----
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
