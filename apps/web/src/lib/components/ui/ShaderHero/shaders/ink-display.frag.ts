/**
 * Ink Dispersion display fragment shader (GLSL ES 3.0).
 *
 * Maps the 3-channel ink concentration buffer to brand colors:
 *   R channel → primary color
 *   G channel → secondary color
 *   B channel → accent color
 *
 * Uses additive blending with overlap darkening for a subtractive-mixing feel,
 * wet-edge highlight via screen-space derivatives, Reinhard tone mapping,
 * vignette, film grain, and a brightness cap.
 *
 * Uniforms:
 *   uState          — simulation texture (RGB = ink concentrations)
 *   uColorPrimary   — brand primary color (normalized RGB)
 *   uColorSecondary — brand secondary color
 *   uColorAccent    — brand accent color
 *   uBgColor        — background color (zero-concentration areas)
 *   uIntensity      — brightness multiplier
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uTime           — elapsed time in seconds (for grain animation)
 */
export const INK_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read ink concentrations ────────────────────────────────────
  vec3 ink = texture(uState, v_uv).rgb;

  // ── 2. Additive color blending ────────────────────────────────────
  // Each channel maps to its brand color, additively mixed onto the background.
  vec3 color = uBgColor
    + ink.r * uColorPrimary * uIntensity
    + ink.g * uColorSecondary * uIntensity
    + ink.b * uColorAccent * uIntensity;

  // ── 3. Overlap darkening — subtractive mixing simulation ──────────
  // Where multiple inks overlap (total > threshold), darken for a more
  // realistic ink-on-paper feel instead of pure additive blowout.
  float totalInk = ink.r + ink.g + ink.b;
  float overlapFactor = smoothstep(0.8, 2.0, totalInk);
  color *= mix(1.0, 0.55, overlapFactor);

  // ── 4. Wet-edge highlight via screen-space derivatives ────────────
  // Detect ink concentration edges using dFdx/dFdy for a wet-edge glow.
  float dIdx = length(dFdx(ink));
  float dIdy = length(dFdy(ink));
  float edgeStrength = smoothstep(0.002, 0.03, dIdx + dIdy);
  color += edgeStrength * 0.08 * mix(uColorPrimary, uColorAccent, 0.5) * uIntensity;

  // ── 5. Reinhard tone mapping ──────────────────────────────────────
  color = color / (1.0 + color);

  // ── 6. Vignette ───────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 7. Film grain ─────────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // ── 8. Brightness cap for subtlety ────────────────────────────────
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
