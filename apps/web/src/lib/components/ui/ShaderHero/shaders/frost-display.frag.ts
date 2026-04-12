/**
 * Frost display fragment shader (GLSL ES 3.0).
 *
 * Renders crystal growth simulation as ice dendrites:
 * - Frozen regions coloured primary -> secondary (aged)
 * - Growth front glow (newly frozen pixels at edges) in accent
 * - Subtle diffusion field modulation for unfrozen areas
 * - Reinhard tone map, vignette, film grain
 *
 * Uniforms:
 *   uState          — sim texture (R=frozen, G=diffusion, B=age)
 *   uColorPrimary   — crystal body colour
 *   uColorSecondary — aged crystal tint
 *   uColorAccent    — growth front glow colour
 *   uBgColor        — background (unfrozen areas)
 *   uIntensity      — brightness multiplier
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uGlow           — growth front glow intensity
 *   uTime           — elapsed time (for grain animation)
 */
export const FROST_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uGlow, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ---- 1. Read simulation state with 3x3 bilinear smoothing ----
  // Smooths the binary frozen field to remove pixelation
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float frozen = 0.0;
  float diffuse = 0.0;
  float age = 0.0;
  float totalW = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      float w = (dx == 0 && dy == 0) ? 4.0 : (abs(dx) + abs(dy) == 1 ? 2.0 : 1.0);
      vec4 s = texture(uState, v_uv + vec2(float(dx), float(dy)) * tx);
      frozen += s.r * w;
      diffuse += s.g * w;
      age += s.b * w;
      totalW += w;
    }
  }
  frozen /= totalW;
  diffuse /= totalW;
  age /= totalW;

  // ---- 2. Smooth crystal colour (no hard binary threshold) ----
  vec3 crystalColor = mix(uColorPrimary, uColorSecondary, age * 0.4);
  vec3 color = mix(uBgColor, crystalColor * uIntensity, smoothstep(0.05, 0.5, frozen));

  // ---- 3. Growth front glow — edges of the frozen region ----
  float edgeness = smoothstep(0.1, 0.45, frozen) * (1.0 - smoothstep(0.55, 0.9, frozen));
  float youthFactor = 1.0 - smoothstep(0.0, 0.2, age);
  color += edgeness * youthFactor * uColorAccent * uGlow * uIntensity;

  // ---- 4. Diffusion field subtle glow in unfrozen areas ----
  float unfrozenMask = 1.0 - smoothstep(0.05, 0.3, frozen);
  color += unfrozenMask * diffuse * 0.08 * uColorPrimary * uIntensity;

  // ---- 5. Reinhard tone mapping ----
  color = color / (1.0 + color);

  // ---- 6. Brightness cap ----
  color = min(color, vec3(0.75));

  // ---- 7. Intensity blend ----
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // ---- 8. Vignette ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 9. Film grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
