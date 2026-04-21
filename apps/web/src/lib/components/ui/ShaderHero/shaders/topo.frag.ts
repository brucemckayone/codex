/**
 * Topographic Contour fragment shader — animated contour lines on a procedural heightfield.
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin×sin (topo isn't iq's warp, no
 *    aesthetic preservation requirement — value noise gives cleaner
 *    heightfields without interference patterns)
 *  - Smooth 4-stop palette (bg → primary → secondary → accent) via
 *    smoothstep weights; no per-pixel branching
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR contour-line emission (> 1.0) lets ACES render bright lines
 *    with glowing edges; old 0.75 clip made every line equal brightness
 *  - Fill between lines gets a subtle height-tinted gradient instead of
 *    a flat heightColor * 0.15
 *  - Bloom halo on brightest contour lines (elevation-tinted)
 *  - Luminance-aware filmic grain
 */
export const TOPO_FRAG = `#version 300 es
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
uniform int u_lineCount;
uniform float u_lineWidth;
uniform float u_speed;
uniform float u_scale;
uniform float u_elevation;
uniform int u_octaves;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- iq value noise --
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float totalAmp = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_octaves) break;
    f += amp * valueNoise(p);
    totalAmp += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return totalAmp > 0.0 ? f / totalAmp : 0.0;
}

// -- Smooth 4-stop palette (bg → primary → secondary → accent) --
vec3 heightColor(float h) {
  h = clamp(h, 0.0, 1.0);
  if (h < 0.333) return mix(u_bgColor, u_brandPrimary, smoothstep(0.0, 0.333, h));
  if (h < 0.666) return mix(u_brandPrimary, u_brandSecondary, smoothstep(0.333, 0.666, h));
  return mix(u_brandSecondary, u_brandAccent, smoothstep(0.666, 1.0, h));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;
  p += vec2(t * 0.3, t * 0.2);

  float height = fbm(p);
  height = clamp(height * 0.5 + 0.5, 0.0, 1.0);

  // Mouse hill + burst
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float hoverHill = u_mouseActive * u_elevation * 0.15 * exp(-mouseDist * mouseDist * 20.0);
  float burstHill = u_burst * u_elevation * 0.3 * exp(-mouseDist * mouseDist * 8.0);
  height = clamp(height + hoverHill + burstHill, 0.0, 1.0);

  // ── Contour lines via fract + fwidth ──
  float lineCountF = float(u_lineCount);
  float scaledHeight = height * lineCountF;
  float contourFrac = fract(scaledHeight);
  float fw = fwidth(scaledHeight);
  float halfWidth = u_lineWidth * 0.5;
  float d1 = abs(contourFrac);
  float d2 = abs(contourFrac - 1.0);
  float d = min(d1, d2);
  float lineMask = 1.0 - smoothstep(fw * halfWidth, fw * (halfWidth + 1.0), d);

  // ── Colour by height (smooth palette) — HDR line emission ──
  vec3 lineColor = heightColor(height) * 1.8;   // > 1 for ACES rolloff
  // Subtle height-tinted fill between lines (was flat * 0.15)
  vec3 fillColor = mix(u_bgColor * 0.6, heightColor(height) * 0.25, height);

  vec3 color = mix(fillColor, lineColor, lineMask);

  // ── Bloom halo on brightest lines, tinted by elevation ──
  vec3 bloomTint = mix(u_brandPrimary, u_brandAccent, height);
  color += pow(lineMask * height, 2.2) * bloomTint * 0.4;

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
