/**
 * Lenia (Advanced Continuous Cellular Automata) display fragment shader.
 *
 * Multi-stop colour ramp mapping concentric creature structure to brand colours:
 *   0.0 = void (bg)
 *   0.0-0.25 = outermost corona / fading trails (bg -> primary)
 *   0.25-0.55 = outer body ring (primary -> secondary)
 *   0.55-1.0 = inner core / dense centre (secondary -> accent)
 *
 * Screen-space derivatives highlight concentric zone boundaries.
 * Core pulsing glow for alive creatures.
 * Standard post-processing chain (Reinhard, 0.75 cap, vignette, grain).
 */
export const LENIA_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // -- 1. Read cell state --
  float state = texture(uState, v_uv).r;

  // -- 2. Multi-stop colour ramp: bg -> primary -> secondary -> accent --
  vec3 color;
  float t = clamp(state * uIntensity, 0.0, 1.0);

  if (t < 0.25) {
    color = mix(uBgColor, uColorPrimary, t / 0.25);
  } else if (t < 0.55) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.25) / 0.30);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.55) / 0.45);
  }

  // -- 3. Concentric ring highlight (screen-space derivatives) --
  float dSdx = dFdx(state);
  float dSdy = dFdy(state);
  float edgeMag = abs(dSdx) + abs(dSdy);
  float edgeGlow = smoothstep(0.003, 0.05, edgeMag);
  color += edgeGlow * 0.04 * uColorAccent * uIntensity;

  // -- 4. Core pulsing (alive creatures subtly breathe) --
  float pulse = 0.5 + 0.5 * sin(uTime * 1.2 + state * 10.0);
  float coreGlow = smoothstep(0.65, 1.0, state) * pulse * 0.05;
  color += coreGlow * uColorAccent;

  // -- 5. Reinhard tone mapping --
  color = color / (1.0 + color);

  // -- 6. Vignette --
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // -- 7. Film grain --
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // -- 8. Brightness cap --
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
