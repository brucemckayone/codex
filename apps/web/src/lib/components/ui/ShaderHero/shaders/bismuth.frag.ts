/**
 * Bismuth (Crystal Terraces) fragment shader.
 *
 * Stepped terraces from domain-warped noise quantised via floor().
 * Edge detection with dFdx/dFdy on the stepped height field.
 * Brand-palette iridescence via Fresnel-like angle factor mapped through
 * primary -> secondary -> accent. Mouse shifts apparent viewing angle
 * for prismatic colour sweep. Click adds rotation impulse.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * u_terraces is an int uniform.
 */
export const BISMUTH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_terraces;
uniform float u_warp;
uniform float u_iridescence;
uniform float u_speed;
uniform float u_edge;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Noise (sin-based, same as topo/warp) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation (3 octaves) --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    f += amp * noise(p);
    total += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return total > 0.0 ? f / total : 0.0;
}

// -- Iridescent brand palette mapping --
// Maps a 0..1 angle factor through primary -> secondary -> accent
vec3 iridescent(float angle, float strength) {
  float t = clamp(angle * strength, 0.0, 1.0);
  if (t < 0.5) {
    return mix(u_brandPrimary, u_brandSecondary, t * 2.0);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (t - 0.5) * 2.0);
  }
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // Centre and aspect-correct
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 3.0;

  // Click rotation impulse
  float angle = u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  // Animate noise field
  vec2 pAnim = p + vec2(t * 0.3, t * 0.2);

  // Domain warp
  vec2 warpOffset = u_warp * 0.4 * vec2(
    fbm(pAnim * 2.0 + 10.0),
    fbm(pAnim * 2.0 + 20.0)
  );
  vec2 pWarped = pAnim + warpOffset;

  // Smooth height field
  float heightSmooth = fbm(pWarped);
  heightSmooth = clamp(heightSmooth * 0.5 + 0.5, 0.0, 1.0);

  // Terrace quantisation: floor(h * N) / N
  float N = float(u_terraces);
  float heightStepped = floor(heightSmooth * N) / N;

  // Edge detection via gradient of stepped field
  float dHdx = dFdx(heightStepped);
  float dHdy = dFdy(heightStepped);
  float edgeMask = length(vec2(dHdx, dHdy)) * 40.0;
  edgeMask = clamp(edgeMask, 0.0, 1.0);

  // Iridescent colour from viewing angle
  // Pre-step gradient gives a smooth normal for lighting
  float gx = dFdx(heightSmooth);
  float gy = dFdy(heightSmooth);
  vec3 normal = normalize(vec3(gx * 8.0, gy * 8.0, 1.0));

  // View direction from mouse (or default centre when inactive)
  float mx = u_mouseActive > 0.5 ? u_mouse.x : 0.5;
  float my = u_mouseActive > 0.5 ? u_mouse.y : 0.5;
  vec3 viewDir = normalize(vec3(mx - 0.5, my - 0.5, 0.5));

  // Fresnel-like angle factor
  float angleFactor = 1.0 - abs(dot(normal, viewDir));

  // Map through brand palette
  vec3 iriColor = iridescent(angleFactor, u_iridescence);

  // Terrace face colour: iridescent, darkened by depth level
  float depthFade = 0.4 + 0.6 * heightStepped;
  vec3 faceColor = mix(u_bgColor, iriColor, depthFade);

  // Edge glow with accent
  vec3 edgeColor = u_brandAccent * (0.8 + 0.4 * angleFactor);
  vec3 color = mix(faceColor, edgeColor, edgeMask * u_edge);

  // -- Post-processing --
  // Reinhard tone map
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
