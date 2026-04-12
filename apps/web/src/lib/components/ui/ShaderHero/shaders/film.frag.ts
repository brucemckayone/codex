/**
 * Film fragment shader — Oil film thin-film interference (iridescence).
 *
 * Technique: Film thickness derived from FBM noise (sin-based, 3 octaves).
 * Cyclic brand palette: thickness * bands → bg → primary → secondary → accent → primary (wraps).
 * Fresnel-like shift based on distance from screen center.
 * Mouse hover: radial wave shifting thickness via sin(dist - time).
 * Click: larger propagating ripple. Specular highlight via dFdx/dFdy.
 *
 * Single-pass fragment shader. No FBOs needed.
 * Post-processing: Reinhard tone map (0.75 cap), vignette, film grain.
 */
export const FILM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;            // normalized 0-1, lerped
uniform float u_burstStrength;   // click ripple strength, decays
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_filmScale;
uniform float u_filmSpeed;
uniform float u_bands;
uniform float u_shift;
uniform float u_ripple;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Sin-based noise (matches warp pattern) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM: 3 octaves with rotation to break axis alignment --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3(vec2 p) {
  float f = 0.0;
  f += 0.5000 * noise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * noise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * noise(p);
  return f / 0.875;  // normalize sum of weights
}

// -- Cyclic brand palette lookup --
// Maps a 0-1 value cyclically through: bg -> primary -> secondary -> accent -> primary
vec3 brandPalette(float t) {
  t = fract(t); // wrap to 0-1
  float segments = 4.0;
  float seg = t * segments;
  float f = fract(seg);

  // Smooth hermite interpolation for fluid transitions
  f = f * f * (3.0 - 2.0 * f);

  int idx = int(floor(seg));
  if (idx == 0) return mix(u_bgColor, u_brandPrimary, f);
  if (idx == 1) return mix(u_brandPrimary, u_brandSecondary, f);
  if (idx == 2) return mix(u_brandSecondary, u_brandAccent, f);
  return mix(u_brandAccent, u_brandPrimary, f);
}

void main() {
  float t = u_time * u_filmSpeed;

  // Aspect-corrected coordinates
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect;

  // Base film thickness from FBM noise
  vec2 noiseCoord = uv * u_filmScale + vec2(t * 0.1, t * 0.07);
  float thickness = fbm3(noiseCoord) * 0.5 + 0.5; // remap to 0-1

  // Slow undulation in thickness
  thickness += 0.1 * sin(uv.x * 3.0 + t * 0.3) * sin(uv.y * 2.5 + t * 0.2);

  // Fresnel-like shift from screen center
  vec2 center = aspect * 0.5;
  float centerDist = distance(uv, center);
  float maxDist = length(center);
  float fresnel = centerDist / maxDist;
  thickness += u_shift * fresnel * 0.3;

  // Mouse hover — radial wave shifting thickness
  vec2 mouseUV = u_mouse * aspect;
  float mouseDist = distance(uv, mouseUV);
  float mouseWave = u_ripple * sin(mouseDist * 20.0 - t * 4.0)
                  * smoothstep(0.5, 0.0, mouseDist)
                  * 0.15;
  thickness += mouseWave;

  // Click burst — larger propagating ripple
  if (u_burstStrength > 0.01) {
    float burstWave = sin(mouseDist * 15.0 - t * 6.0)
                    * u_burstStrength
                    * smoothstep(0.8, 0.0, mouseDist)
                    * 0.25;
    thickness += burstWave;
  }

  // Map thickness through cyclic brand palette
  float paletteIdx = thickness * u_bands;
  vec3 filmColor = brandPalette(paletteIdx);

  // Specular highlight from surface normal approximation (dFdx/dFdy)
  float dTdx = dFdx(thickness);
  float dTdy = dFdy(thickness);
  vec3 surfaceNormal = normalize(vec3(-dTdx * 8.0, -dTdy * 8.0, 1.0));

  // Light from above-right
  vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
  float specular = pow(max(dot(surfaceNormal, lightDir), 0.0), 16.0);

  // Add specular as white highlight
  filmColor += specular * 0.3;

  // Subtle iridescent brightness variation
  float iridescence = 0.85 + 0.15 * sin(thickness * 6.2831 * u_bands * 0.5 + t);
  filmColor *= iridescence;

  // -- Post-processing --

  // Reinhard tone map
  filmColor = filmColor / (1.0 + filmColor);

  // Brightness cap at 75%
  filmColor = min(filmColor, vec3(0.75));

  // Mix with background by intensity
  vec3 color = mix(u_bgColor, filmColor, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
