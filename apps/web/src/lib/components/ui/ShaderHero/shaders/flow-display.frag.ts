/**
 * Flow display fragment shader (GLSL ES 3.0).
 *
 * Maps the self-organising vector field to brand colors using:
 * 1. Line Integral Convolution (LIC) — sample along flow for streak texture
 * 2. Direction-to-hue mapping with brand palette
 * 3. Sigmoid contrast for punchy output
 * 4. Standard post-processing chain
 *
 * Adapted from Flexi's curl-noise painting (Shadertoy).
 */
export const FLOW_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uContrast;

// ── Film grain hash ─────────────────────────────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// ── Sigmoid contrast (from original shader) ─────────────────
vec3 sigmoid(vec3 x, float s) {
  return 1.0 / (1.0 + exp(-s * (x - 0.5)));
}

void main() {
  vec2 tx = vec2(1.0 / 512.0);

  // ── Read center vector ────────────────────────────────────
  vec3 state = texture(uState, v_uv).xyz;
  vec2 vel = state.xy;
  float div = state.z;
  float mag = length(vel);

  // ── Line Integral Convolution (LIC) ───────────────────────
  // Trace along the vector field in both directions to create
  // coherent streak patterns — the hallmark of this effect
  vec3 licColor = vec3(0.0);
  float licWeight = 0.0;
  vec2 pos = v_uv;

  // Forward trace (8 steps)
  for (int i = 0; i < 8; i++) {
    vec3 s = texture(uState, fract(pos)).xyz;
    float w = exp(-float(i) * 0.3); // decay weight
    float angle = atan(s.y, s.x);

    // Map angle to brand color blend
    float t = angle / 6.2832 + 0.5; // normalize to 0-1
    vec3 c = mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 0.5, t));
    c = mix(c, uColorAccent, smoothstep(0.5, 1.0, t) * 0.5);

    // Modulate by magnitude
    c *= 0.5 + 0.5 * length(s.xy);

    licColor += c * w;
    licWeight += w;

    // Step along the field
    pos += s.xy * tx * 2.0;
  }

  // Backward trace (8 steps)
  pos = v_uv;
  for (int i = 0; i < 8; i++) {
    vec3 s = texture(uState, fract(pos)).xyz;
    float w = exp(-float(i) * 0.3);
    float angle = atan(s.y, s.x);

    float t = angle / 6.2832 + 0.5;
    vec3 c = mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 0.5, t));
    c = mix(c, uColorAccent, smoothstep(0.5, 1.0, t) * 0.5);
    c *= 0.5 + 0.5 * length(s.xy);

    licColor += c * w;
    licWeight += w;

    pos -= s.xy * tx * 2.0;
  }

  licColor /= licWeight;

  // ── Divergence accent ─────────────────────────────────────
  // Highlight source/sink regions with accent color
  licColor += uColorAccent * abs(div) * 0.3;

  // ── Mix with background based on field magnitude ──────────
  vec3 color = mix(uBgColor, licColor, smoothstep(0.0, 0.3, mag) * uIntensity);

  // ── Sigmoid contrast ──────────────────────────────────────
  color = sigmoid(color, uContrast);

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

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
