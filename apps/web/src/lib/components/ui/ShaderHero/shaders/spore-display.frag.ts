/**
 * Spore display fragment shader (GLSL ES 3.0).
 *
 * Maps Physarum trail density to brand-colored network visualization.
 * Trail density drives primary/secondary color gradient.
 * Agent positions are highlighted with accent color glow.
 * Inspired by the distance-based visualization in the original shader.
 */
export const SPORE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

// ── Film grain hash ─────────────────────────────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 state = texture(uState, v_uv);
  float trail = state.r;
  float trail2 = state.g;
  float isAgent = state.a;

  // ── Trail network coloring ────────────────────────────────
  // Dense trails → primary color, edges → secondary
  float t = smoothstep(0.05, 0.8, trail);
  float t2 = smoothstep(0.1, 0.6, trail2);

  vec3 color = uBgColor;

  // Primary network: strong trail paths
  color = mix(color, uColorPrimary, t * 0.9);

  // Secondary: trail edges and gradient
  color = mix(color, uColorSecondary, t2 * 0.5);

  // ── Agent glow (accent highlights) ────────────────────────
  // Check 3x3 neighborhood for nearby agents to create soft glow
  float agentGlow = 0.0;
  vec2 tx = vec2(1.0 / 512.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 nb = texture(uState, v_uv + vec2(float(x), float(y)) * tx);
      float w = 1.0 / (1.0 + float(abs(x) + abs(y))); // distance weight
      agentGlow += nb.a * w;
    }
  }
  agentGlow = smoothstep(0.0, 2.0, agentGlow);
  color = mix(color, uColorAccent, agentGlow * 0.35);

  // ── Trail edge glow ───────────────────────────────────────
  // Compute trail gradient magnitude for edge highlighting
  float tN = texture(uState, v_uv + vec2(0.0, tx.y)).r;
  float tS = texture(uState, v_uv - vec2(0.0, tx.y)).r;
  float tE = texture(uState, v_uv + vec2(tx.x, 0.0)).r;
  float tW = texture(uState, v_uv - vec2(tx.x, 0.0)).r;
  float edge = length(vec2(tE - tW, tN - tS));
  color += uColorAccent * edge * 0.2;

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
