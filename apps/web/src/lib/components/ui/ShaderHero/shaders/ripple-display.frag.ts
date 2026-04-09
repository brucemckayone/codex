/**
 * Water Ripple display fragment shader (GLSL ES 3.0).
 *
 * Renders the wave height field as a water surface with:
 * - Normal-mapped surface from height gradient (finite differences)
 * - Refracted UV offset sampling a diagonal brand gradient
 * - Fresnel reflection (Schlick approximation)
 * - Caustic highlights from gradient magnitude
 * - Specular highlight from directional light
 * - Reinhard tone mapping, vignette, film grain
 *
 * Uniforms:
 *   uState          — simulation texture (vec4: height, prevHeight, 0, 0)
 *   uTexel          — 1.0 / simResolution
 *   uColorPrimary   — brand primary color (normalized RGB)
 *   uColorSecondary — brand secondary color
 *   uColorAccent    — brand accent color
 *   uBgColor        — background color
 *   uIntensity      — display brightness multiplier
 *   uRefraction     — refraction UV offset strength (default 0.5)
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uTime           — elapsed time in seconds
 */
export const RIPPLE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uRefraction, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Smooth brand color gradient based on UV position
vec3 brandGradient(vec2 uv) {
  // Diagonal gradient through brand colors
  float t = (uv.x + uv.y) * 0.5;
  float t3 = t * 3.0;
  vec3 col;
  if (t3 < 1.0) col = mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 1.0, t3));
  else if (t3 < 2.0) col = mix(uColorSecondary, uColorAccent, smoothstep(0.0, 1.0, t3 - 1.0));
  else col = mix(uColorAccent, uColorPrimary, smoothstep(0.0, 1.0, t3 - 2.0));
  return col;
}

void main() {
  // Read wave height field
  float hC = texture(uState, v_uv).x;
  float hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).x;
  float hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).x;
  float hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).x;
  float hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).x;

  // Compute surface normal from height gradient (finite differences)
  float dhdx = (hE - hW) * 0.5;
  float dhdy = (hN - hS) * 0.5;
  vec3 normal = normalize(vec3(-dhdx * 8.0, 1.0, -dhdy * 8.0));

  // View direction (looking down at water surface)
  vec3 viewDir = vec3(0.0, 1.0, 0.0);

  // Refracted UV offset
  vec2 refractedUV = v_uv + normal.xz * uRefraction * 0.08;
  refractedUV = clamp(refractedUV, 0.0, 1.0);

  // Sample brand color at refracted position
  vec3 refractedColor = brandGradient(refractedUV);

  // Deep water base: darken background for depth
  vec3 deepColor = uBgColor * 0.6;

  // Fresnel effect (Schlick approximation)
  float cosTheta = max(dot(normal, viewDir), 0.0);
  float fresnel = pow(1.0 - cosTheta, 3.0) * 0.6;

  // Reflection color: lighter brand color mix
  vec3 reflectColor = mix(uColorPrimary, uColorSecondary, 0.5) * 0.4 + 0.1;

  // Combine refraction and reflection via Fresnel
  vec3 surfaceColor = mix(refractedColor, reflectColor, fresnel);

  // Caustic highlights: where wave height gradient is steep (constructive interference)
  float gradientMag = length(vec2(dhdx, dhdy));
  float caustic = smoothstep(0.02, 0.15, gradientMag) * 0.35;
  vec3 causticColor = uColorAccent * caustic;

  // Specular highlight from directional light
  vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
  vec3 specColor = vec3(1.0) * spec * 0.3;

  // Wave height contribution: brighter on crests, darker in troughs
  float heightBright = hC * 0.15;

  // Compose final color
  vec3 waterColor = deepColor + surfaceColor * uIntensity * 0.8;
  waterColor += causticColor * uIntensity;
  waterColor += specColor * uIntensity;
  waterColor += heightBright * uColorPrimary * uIntensity * 0.5;

  // Tone mapping (Reinhard)
  waterColor = waterColor / (1.0 + waterColor);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  waterColor *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  waterColor += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // Brightness cap for subtlety
  fragColor = vec4(clamp(waterColor, 0.0, 0.75), 1.0);
}
`;
