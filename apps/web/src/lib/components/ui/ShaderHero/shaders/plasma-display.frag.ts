/**
 * Plasma display fragment shader (GLSL ES 3.0).
 *
 * Faithful to the original Shadertoy Wt2BR1 image pass (non-heightmap):
 *   col = sin(vec4(1,2,3,4) * 25.0 * r * r * r)
 *
 * Where r = density from the simulation buffer.
 * The raw sin() output [-1,1] creates the characteristic iridescent
 * banding with inverted-color regions. We remap this through the
 * brand palette instead of using raw RGB.
 */
export const PLASMA_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uBands;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float r = texture(uState, v_uv).b; // density

  // ── The signature effect: sin(N * rho^3) ──────────────────
  // Exactly as in the original image pass
  float r3 = r * r * r;
  vec4 rawCol = sin(vec4(1.0, 2.0, 3.0, 4.0) * uBands * r3);

  // ── Map to brand colors ───────────────────────────────────
  // rawCol channels are in [-1, 1]. Use them to blend brand colors.
  // Channel 1 (slowest frequency) → primary/bg blend
  // Channel 2 (medium) → secondary blend
  // Channel 3 (fastest) → accent highlights
  float c1 = rawCol.x * 0.5 + 0.5; // 0-1
  float c2 = rawCol.y * 0.5 + 0.5;
  float c3 = rawCol.z * 0.5 + 0.5;

  vec3 color = mix(uBgColor, uColorPrimary, c1);
  color = mix(color, uColorSecondary, c2 * 0.6);
  color = mix(color, uColorAccent, c3 * 0.3);

  // Scale by density to fade in vacuum regions
  float densityMask = smoothstep(0.02, 0.15, r);
  color = mix(uBgColor, color, densityMask);

  // ── Post-processing (MANDATORY) ───────────────────────────

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap at 75%
  color = min(color, vec3(0.75));

  // Intensity blend with background
  color = mix(uBgColor, color, uIntensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
