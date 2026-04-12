/**
 * Vortex fragment shader — Polar volumetric spirals.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Multiple volumetric layers accumulated via ray stepping in polar space.
 * Each step rotates by depth + angle with cell repetition via mod.
 * Spiral glow and ring edge highlights driven by brand colors.
 * Mouse shifts the polar centre; click creates a twist distortion.
 * Post-processing: Reinhard tone map, vignette, grain.
 */
export const VORTEX_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_speed;
uniform int u_density;
uniform float u_twist;
uniform float u_rings;
uniform float u_spiral;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float t = u_time * u_speed;

  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse offset shifts vortex centre
  uv += (u_mouse - 0.5) * 0.5;

  // Polar coordinates
  float r = length(uv);
  float theta = atan(uv.y, uv.x);

  // Click twist distortion
  theta += u_burstStrength * 3.0 * exp(-r * 2.0);

  // Volumetric accumulation
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 60; i++) {
    if (i >= u_density) break;

    float d = float(i) / float(u_density - 1);

    // Per-step rotation
    float angle = d * 6.283 * u_twist + theta + t;
    float c = cos(angle), s = sin(angle);
    vec2 p = mat2(c, -s, s, c) * uv * (1.0 + d * 2.0);

    // Cell repetition
    float cellSize = 1.0 / u_rings;
    vec2 cell = mod(p + 0.5 * cellSize, cellSize) - 0.5 * cellSize;
    float shape = length(cell);

    // SDF: blended sphere + ring
    float sdfVal = smoothstep(0.2, 0.0, shape) + smoothstep(0.02, 0.0, abs(shape - 0.15));

    // Spiral arm alignment
    float spiralPhase = fract(theta / 6.283 * 3.0 + d * u_twist + t * 0.5);
    float spiralBright = smoothstep(0.35, 0.15, abs(spiralPhase - 0.5)) * u_spiral;

    // Color by angle + depth (3-segment cyclic)
    float hue = fract(theta / 6.283 + 0.5 + d * 0.5 + t * 0.2);
    vec3 layerColor;
    if (hue < 0.33) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, hue / 0.33);
    } else if (hue < 0.66) {
      layerColor = mix(u_brandSecondary, u_brandAccent, (hue - 0.33) / 0.33);
    } else {
      layerColor = mix(u_brandAccent, u_brandPrimary, (hue - 0.66) / 0.34);
    }

    // Ring edge highlight
    float ringEdge = smoothstep(0.03, 0.0, abs(fract(r * u_rings * 4.0) - 0.5));
    layerColor += u_brandAccent * ringEdge * 0.3;

    // Accumulate with depth falloff (energy-normalized)
    float brightness = (sdfVal + spiralBright) * exp(-d * 3.0);
    acc += layerColor * brightness / float(u_density);
  }

  // Central core glow
  acc += u_brandSecondary * exp(-r * r * 4.0) * 0.5;

  // -- Post-processing --
  vec3 color = acc;

  // Reinhard tone map
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.75));

  // Intensity blend
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
