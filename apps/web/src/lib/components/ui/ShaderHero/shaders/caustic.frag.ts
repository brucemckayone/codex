/**
 * Caustic fragment shader — Underwater light patterns (GLSL ES 3.0).
 *
 * Single-pass: iterative sin/cos UV warping creates caustic convergence lines.
 * Two-layer accumulation with offset time seeds for smoother, more complex patterns.
 * Mouse creates a localized ripple disturbance; click propagates an outward ring.
 * Brand colors mapped via 3-segment gradient from caustic intensity.
 *
 * Uniforms:
 *   u_time           — elapsed seconds
 *   u_resolution     — canvas pixel dimensions
 *   u_mouse          — normalized mouse (0-1), lerped
 *   u_mouseActive    — 1.0 when hovering
 *   u_burst          — click burst strength (decays)
 *   u_brandPrimary   — brand primary color
 *   u_brandSecondary — brand secondary color
 *   u_brandAccent    — brand accent color (hot highlights)
 *   u_bgColor        — background color
 *   u_scale          — caustic pattern scale (1.0-5.0)
 *   u_speed          — animation speed (0.05-0.30)
 *   u_iterations     — detail layers (int, 2-5)
 *   u_brightness     — highlight intensity (0.5-2.0)
 *   u_ripple         — mouse ripple strength (0.5-3.0)
 *   u_intensity      — overall blend intensity
 *   u_grain          — film grain strength
 *   u_vignette       — vignette strength
 */
export const CAUSTIC_FRAG = `#version 300 es
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
uniform float u_scale;
uniform float u_speed;
uniform int u_iterations;
uniform float u_brightness;
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

// -- Rotation matrix for inter-iteration warp axis rotation --
const mat2 iterRot = mat2(0.8, 0.6, -0.6, 0.8);

// -- Core caustic function --
// Iterative sin/cos UV warping: accumulate where rays converge
float causticPattern(vec2 uv, float t) {
  vec2 p = uv * u_scale;
  float c = 0.0;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_iterations) break;
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0) * u_brightness);
    freq *= 2.0;
    p = iterRot * p;
  }
  return c / float(u_iterations);
}

// -- 3-segment brand color gradient from caustic intensity --
vec3 causticColor(float c) {
  if (c < 0.33) {
    return mix(u_bgColor * 0.5, u_brandPrimary, c / 0.33);
  } else if (c < 0.66) {
    return mix(u_brandPrimary, u_brandSecondary, (c - 0.33) / 0.33);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (c - 0.66) / 0.34);
  }
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;

  // Aspect-corrected UVs
  vec2 uv = v_uv;
  vec2 fragUV = vec2(uv.x * aspect, uv.y);

  // Aspect-corrected mouse position
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);

  // -- Mouse ripple: localized pattern disturbance --
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = (mouseDist > 0.001) ? normalize(fragUV - mouseUV) : vec2(0.0);
  uv += u_mouseActive * u_ripple * 0.02
      * sin(mouseDist * 30.0 - t * 5.0)
      * exp(-mouseDist * 8.0)
      * mouseDir;

  // -- Click burst: propagating ring --
  if (u_burst > 0.01) {
    float burstRing = sin(mouseDist * 20.0 - t * 8.0) * exp(-mouseDist * 4.0);
    uv += u_burst * 0.03 * burstRing * mouseDir;
  }

  // -- Two-layer caustic (averaged for smoother patterns) --
  float c1 = causticPattern(uv, t);
  float c2 = causticPattern(uv, t + 0.5);
  float c = (c1 + c2) * 0.5;

  // Normalize to 0-1 range for color mapping
  float cNorm = clamp(c, 0.0, 1.0);

  // -- Color mapping --
  vec3 color = causticColor(cNorm);

  // -- Post-processing --

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.75));

  // Intensity blend with background
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
