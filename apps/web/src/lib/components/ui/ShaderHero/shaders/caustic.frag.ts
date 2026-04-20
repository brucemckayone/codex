/**
 * Caustic fragment shader — Underwater light patterns (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 3-stop palette (bg → primary → secondary → accent) via smoothstep
 *    weights; no per-pixel branching
 *  - ACES filmic tone map — preserves highlight hierarchy so brightest
 *    convergence rays actually read as brighter than secondary rays
 *    (old min(x, 0.75) clipped all hot rays to the same ceiling)
 *  - Bloom-adjacent highlight boost on the hottest convergence lines
 *  - Subtle cool (primary-tinted) background gradient — "underwater" feel
 *  - Luminance-aware film grain
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

const mat2 iterRot = mat2(0.8, 0.6, -0.6, 0.8);

// -- Core caustic function: iterative sin/cos warp, accumulate convergence --
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

// -- Smooth 4-stop palette: bg → primary → secondary → accent --
vec3 causticPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = u_bgColor * 0.5;
  vec3 c1 = u_brandPrimary;
  vec3 c2 = u_brandSecondary;
  vec3 c3 = u_brandAccent;
  if (t < 0.333) return mix(c0, c1, smoothstep(0.0, 0.333, t));
  if (t < 0.666) return mix(c1, c2, smoothstep(0.333, 0.666, t));
  return mix(c2, c3, smoothstep(0.666, 1.0, t));
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 uv = v_uv;
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);

  // Mouse ripple — localized pattern disturbance
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = (mouseDist > 0.001) ? normalize(fragUV - mouseUV) : vec2(0.0);
  uv += u_mouseActive * u_ripple * 0.02
      * sin(mouseDist * 30.0 - t * 5.0)
      * exp(-mouseDist * 8.0)
      * mouseDir;

  // Click burst — propagating ring
  if (u_burst > 0.01) {
    float burstRing = sin(mouseDist * 20.0 - t * 8.0) * exp(-mouseDist * 4.0);
    uv += u_burst * 0.03 * burstRing * mouseDir;
  }

  // Two-layer caustic accumulation for smoother patterns
  float c1 = causticPattern(uv, t);
  float c2 = causticPattern(uv, t + 0.5);
  float c = (c1 + c2) * 0.5;

  // Normalize — clamped in [0,1] feeds palette
  float cNorm = clamp(c, 0.0, 1.0);

  // ── Smooth palette lookup ───────────────────────────────────
  vec3 color = causticPalette(cNorm);

  // ── Bloom-adjacent highlight boost on hot convergence rays ──
  // Convergence > 0.75 reads as "focused light" — give it emission >> 1
  // so ACES tone-maps it to a bright core rather than flat white.
  float hotMask = smoothstep(0.75, 1.0, cNorm);
  color += mix(u_brandSecondary, u_brandAccent, 0.5) * hotMask * 1.2;

  // ── Underwater background gradient (cool, primary-tinted) ──
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgCool = mix(
    u_bgColor + u_brandPrimary * 0.04,   // centre: bg with gentle cool lift
    u_bgColor * 0.75,                      // edges: deeper
    smoothstep(0.0, 1.4, r2)
  );

  // ── Post-process ────────────────────────────────────────────
  color = aces(color);                     // ACES (replaces min(x, 0.75))
  color = mix(bgCool, color, u_intensity); // underwater bg instead of flat
  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  // Luminance-aware grain
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
