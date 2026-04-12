/**
 * Growth (Differential Growth) display fragment shader.
 *
 * Reads the SDF simulation texture and renders:
 * - Interior gradient (primary near edge -> secondary deep inside)
 * - Curvature-based fold shadows
 * - Bright edge contour line (accent)
 * - Soft edge glow halo
 * - Fresh growth glow (recently expanded areas)
 * - Standard post-processing chain (Reinhard, 0.75 cap, vignette, grain)
 */
export const GROWTH_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uWidth, uGlow, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // -- 1. Read simulation state --
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float curvature = state.g;
  float age = state.b;

  // -- 2. Base layer: interior gradient based on distance from edge --
  vec3 color = uBgColor;

  if (sdf < 0.0) {
    // Inside the contour -- gradient from primary (near edge) to secondary (deep)
    float depth = clamp(-sdf / 0.3, 0.0, 1.0);
    vec3 interior = mix(uColorPrimary, uColorSecondary, depth);

    // Folded regions (high curvature) create natural shadows
    float shadow = 1.0 - clamp(abs(curvature) * 0.8, 0.0, 0.4);
    interior *= shadow;

    color = interior * uIntensity;
  }

  // -- 3. Edge line -- the growing contour --
  float edgeWidth = uWidth * 0.01;
  float edgeFactor = smoothstep(edgeWidth, 0.0, abs(sdf));

  // Edge color: accent glow
  color = mix(color, uColorAccent * uIntensity, edgeFactor * 0.8);

  // -- 4. Edge glow -- soft halo around the contour --
  float glowWidth = edgeWidth * 4.0;
  float glowFactor = smoothstep(glowWidth, 0.0, abs(sdf));
  color += uColorAccent * glowFactor * uGlow * 0.3 * uIntensity;

  // -- 5. Fresh growth glow -- newly expanded areas glow brighter --
  float freshness = 1.0 - smoothstep(0.0, 0.15, age);
  if (sdf < 0.0) {
    color += uColorAccent * freshness * 0.15 * uIntensity;
  }

  // -- 6. Reinhard tone mapping --
  color = color / (1.0 + color);

  // -- 7. Brightness cap --
  color = min(color, vec3(0.75));

  // -- 8. Intensity blend (mix with bg to control overall strength) --
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // -- 9. Vignette --
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // -- 10. Film grain --
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
