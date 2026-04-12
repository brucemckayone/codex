/**
 * Physarum display fragment shader (GLSL ES 3.0).
 *
 * Renders trail density field as glowing mycelial network:
 * - Multi-stop colour ramp: bg -> primary -> secondary -> accent
 * - Network edge glow via screen-space derivatives
 * - Pulsing glow on dense junction nodes
 * - Reinhard tone map, vignette, film grain
 *
 * Uniforms:
 *   uState          — sim texture (R = trail density)
 *   uColorPrimary   — brand primary (low density veins)
 *   uColorSecondary — brand secondary (medium density)
 *   uColorAccent    — brand accent (high density nodes/junctions)
 *   uBgColor        — background colour (zero density)
 *   uIntensity      — brightness multiplier
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uTime           — for grain animation + pulsing
 */
export const PHYSARUM_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ---- 1. Read trail density with 3x3 smoothing to remove pixelation ----
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float trail = 0.0;
  float w = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      float k = (dx == 0 && dy == 0) ? 4.0 : (abs(dx) + abs(dy) == 1 ? 2.0 : 1.0);
      trail += texture(uState, v_uv + vec2(float(dx), float(dy)) * tx).r * k;
      w += k;
    }
  }
  trail /= w;

  // ---- 2. Multi-stop colour ramp: bg -> primary -> secondary -> accent ----
  vec3 color;
  float t = clamp(trail * uIntensity, 0.0, 1.0);

  if (t < 0.33) {
    color = mix(uBgColor, uColorPrimary, t / 0.33);
  } else if (t < 0.66) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.33) / 0.33);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.66) / 0.34);
  }

  // ---- 3. Network edge glow (screen-space derivatives) ----
  float dTdx = dFdx(trail);
  float dTdy = dFdy(trail);
  float edgeStrength = smoothstep(0.001, 0.02, abs(dTdx) + abs(dTdy));
  color += edgeStrength * 0.06 * uColorAccent * uIntensity;

  // ---- 4. Pulsing glow on dense nodes ----
  float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + trail * 10.0);
  float nodeGlow = smoothstep(0.5, 1.0, trail) * pulse * 0.08;
  color += nodeGlow * uColorAccent;

  // ---- 5. Reinhard tone mapping ----
  color = color / (1.0 + color);

  // ---- 6. Brightness cap ----
  color = min(color, vec3(0.75));

  // ---- 7. Vignette ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 8. Film grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // ---- 9. Final clamp ----
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
