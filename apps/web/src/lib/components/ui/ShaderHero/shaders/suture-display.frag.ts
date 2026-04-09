/**
 * Suture Fluid display fragment shader (GLSL ES 3.0).
 *
 * Renders the velocity/divergence field with brand palette colorization.
 * Combines the original XddSRX cross-product coloring with a smooth
 * 3-color brand palette mapped from velocity direction.
 *
 * Uniforms:
 *   uState     — simulation texture (vec3: vx, vy, divergence)
 *   uColorA    — brand primary color (normalized RGB)
 *   uColorB    — brand secondary color
 *   uColorC    — brand accent color
 *   uBgColor   — background color
 *   uIntensity — display brightness multiplier
 *   uGrain     — film grain strength
 *   uVignette  — vignette strength
 *   uTime      — elapsed time in seconds
 */
export const SUTURE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorA, uColorB, uColorC, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 c = texture(uState, v_uv).xyz;
  float mag = length(c.xy);

  // Original XddSRX colorization as base
  vec3 norm = mag > 0.001 ? c / max(length(c), 0.001) : vec3(0.0);
  vec3 origColor = 0.5 + 0.6 * cross(norm, vec3(0.5, -0.4, 0.5));
  origColor += 0.1 * norm.z;  // divergence tint

  // Velocity direction -> palette position [0,1]
  float angle = atan(c.y, c.x);
  float t = fract(angle / 6.2831853 + 0.5);

  // Smooth 3-color palette
  float t3 = t * 3.0;
  vec3 palColor;
  if (t3 < 1.0) palColor = mix(uColorA, uColorB, smoothstep(0.0, 1.0, t3));
  else if (t3 < 2.0) palColor = mix(uColorB, uColorC, smoothstep(0.0, 1.0, t3 - 1.0));
  else palColor = mix(uColorC, uColorA, smoothstep(0.0, 1.0, t3 - 2.0));

  // Blend branded palette with original cross-product coloring
  // The cross-product gives organic color variation; palette gives brand identity
  vec3 fluidColor = mix(origColor * palColor, palColor * origColor.r, 0.5);

  // Magnitude-based brightness with sensitivity for subtle motion
  float brightness = smoothstep(0.0, 0.3, mag) * 0.6 + smoothstep(0.3, 0.8, mag) * 0.2;

  // Divergence creates suture line highlights
  float divEffect = abs(c.z);
  brightness += smoothstep(0.1, 0.5, divEffect) * 0.15;
  brightness = min(brightness, 0.7);

  // Compose: background + fluid at controlled intensity
  vec3 color = uBgColor + fluidColor * brightness * uIntensity;

  // Tone mapping (Reinhard)
  color = color / (1.0 + color);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // Hard brightness cap
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
