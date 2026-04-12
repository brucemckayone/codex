/**
 * Turing Pattern display fragment shader (GLSL ES 3.0).
 *
 * Maps Gray-Scott chemical concentrations to brand colors:
 *   B concentration (pattern) → primary color
 *   Deep B regions            → secondary color
 *   Edges (dFdx/dFdy of B)   → accent color
 *   Background where A dominates
 *
 * Standard post-processing: Reinhard tone mapping, vignette, grain, 0.75 cap.
 *
 * Uniforms:
 *   uState          — simulation texture (RG = chemicals A, B)
 *   uColorPrimary   — primary brand color (pattern body)
 *   uColorSecondary — secondary brand color (deep B)
 *   uColorAccent    — accent brand color (edges)
 *   uBgColor        — background color (A-dominated areas)
 *   uIntensity      — brightness multiplier
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uTime           — elapsed time in seconds (for grain animation)
 */
export const TURING_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read chemical concentrations ──────────────────────────────
  vec2 chem = texture(uState, v_uv).rg;
  float A = chem.r;
  float B = chem.g;

  // ── 2. Pattern body: B concentration → primary ───────────────────
  float patternStrength = smoothstep(0.05, 0.35, B);
  vec3 color = mix(uBgColor, uColorPrimary * uIntensity, patternStrength);

  // ── 3. Deep B regions → secondary ────────────────────────────────
  float deepB = smoothstep(0.25, 0.50, B);
  color = mix(color, uColorSecondary * uIntensity, deepB * 0.6);

  // ── 4. Edge detection via screen-space derivatives → accent ──────
  float dBx = dFdx(B);
  float dBy = dFdy(B);
  float edgeStrength = smoothstep(0.002, 0.025, abs(dBx) + abs(dBy));
  color += edgeStrength * 0.12 * uColorAccent * uIntensity;

  // ── 5. Reinhard tone mapping ─────────────────────────────────────
  color = color / (1.0 + color);

  // ── 6. Vignette ──────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 7. Film grain ────────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // ── 8. Brightness cap ────────────────────────────────────────────
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
