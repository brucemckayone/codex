/**
 * Mycelium display fragment shader (GLSL ES 3.0).
 *
 * Reads simulation state (R=density, G=direction, B=age).
 * Branch body colour with nutrient pulse wave animation.
 * Junction detection via screen-space derivatives.
 * Growth tips highlighted in accent colour.
 * Nearby branch glow for ambient atmosphere.
 * Standard post-processing chain with 0.75 brightness cap.
 */
export const MYCELIUM_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uPulse, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read simulation state with 3x3 smoothing ────────────────
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float density = 0.0;
  float direction = 0.0;
  float age = 0.0;
  float w = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      float k = (dx == 0 && dy == 0) ? 4.0 : (abs(dx) + abs(dy) == 1 ? 2.0 : 1.0);
      vec4 s = texture(uState, v_uv + vec2(float(dx), float(dy)) * tx);
      density += s.r * k;
      direction += s.g * k;
      age += s.b * k;
      w += k;
    }
  }
  density /= w;
  direction /= w;
  age /= w;

  // ── 2. Base color with smooth threshold ───────────────────────
  vec3 color = uBgColor;
  float branchMask = smoothstep(0.15, 0.5, density);

  if (branchMask > 0.01) {
    // ── 3. Nutrient pulse — travelling wave along branches ──────
    float pulsePhase = age * 10.0 - uTime * uPulse;
    float pulseWave = 0.5 + 0.5 * sin(pulsePhase * 3.14159);

    vec3 branchColor = mix(uColorPrimary, uColorAccent, pulseWave * 0.4);

    // ── 4. Junction detection ───────────────────────────────────
    float dDx = abs(dFdx(density));
    float dDy = abs(dFdy(density));
    float edgeness = smoothstep(0.0, 0.2, dDx + dDy);
    float junctionFactor = smoothstep(0.1, 0.3, edgeness) * 0.5;
    branchColor = mix(branchColor, uColorSecondary, junctionFactor);

    // ── 5. Growth tips ──────────────────────────────────────────
    float youthFactor = 1.0 - smoothstep(0.0, 0.08, age);
    branchColor = mix(branchColor, uColorAccent, youthFactor * 0.7);

    // ── 6. Smooth blend using branchMask ──────────────────────────
    color = mix(uBgColor, branchColor * uIntensity, branchMask);
    color += uColorPrimary * pulseWave * 0.15 * uIntensity * branchMask;
  } else {
    // ── 7. Nearby branch glow ───────────────────────────────────
    float nearby = 0.0;
    float tx = 1.0 / 512.0;
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
        nearby += texture(uState, v_uv + vec2(dx, dy) * tx).r;
      }
    }
    nearby /= 25.0;
    color += nearby * uColorPrimary * 0.08 * uIntensity;
  }

  // ── 8. Reinhard tone mapping ──────────────────────────────────
  color = color / (1.0 + color);

  // ── 9. Brightness cap ─────────────────────────────────────────
  color = min(color, vec3(0.75));

  // ── 10. Intensity blend ───────────────────────────────────────
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // ── 11. Vignette ──────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 12. Film grain ────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
