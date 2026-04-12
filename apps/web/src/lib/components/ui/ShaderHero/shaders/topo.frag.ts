/**
 * Topographic Contour fragment shader — animated contour lines on a procedural heightfield.
 *
 * Technique: Layered FBM noise (sin-based, 2-5 octaves with inter-octave rotation)
 * generates a smooth heightfield. Contour lines extracted via fract(height * lineCount)
 * with fwidth() anti-aliasing. Height mapped to brand gradient (bg → primary → secondary → accent).
 *
 * Single-pass fragment shader. No FBOs needed.
 * Mouse creates Gaussian elevation hills; clicks produce larger bursts.
 * Brand colors map height to a 3-segment gradient.
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

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Noise: smooth periodic function (matches warp pattern) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation between octaves --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float totalAmp = 0.0;

  // Constant upper bound of 5, dynamic early exit via u_octaves
  for (int i = 0; i < 5; i++) {
    if (i >= u_octaves) break;
    f += amp * noise(p);
    totalAmp += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }

  return totalAmp > 0.0 ? f / totalAmp : 0.0;
}

// -- Height-to-color gradient (3-segment: bg → primary → secondary → accent) --
vec3 heightColor(float h) {
  // h is in 0..1 range
  if (h < 0.33) {
    return mix(u_bgColor, u_brandPrimary, h / 0.33);
  } else if (h < 0.66) {
    return mix(u_brandPrimary, u_brandSecondary, (h - 0.33) / 0.33);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (h - 0.66) / 0.34);
  }
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;

  // Aspect-corrected coordinates for noise sampling
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;

  // Animate the noise field
  p += vec2(t * 0.3, t * 0.2);

  // --- Heightfield from FBM noise ---
  float height = fbm(p);

  // Remap to 0..1
  height = clamp(height * 0.5 + 0.5, 0.0, 1.0);

  // --- Mouse hill (Gaussian) ---
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);

  // Hover hill
  float hoverHill = u_mouseActive * u_elevation * 0.15 * exp(-mouseDist * mouseDist * 20.0);

  // Burst hill (larger radius)
  float burstHill = u_burst * u_elevation * 0.3 * exp(-mouseDist * mouseDist * 8.0);

  height = clamp(height + hoverHill + burstHill, 0.0, 1.0);

  // --- Contour lines via fract + fwidth ---
  float lineCountF = float(u_lineCount);
  float scaledHeight = height * lineCountF;
  float contourFrac = fract(scaledHeight);

  // Anti-aliased contour line using fwidth
  float fw = fwidth(scaledHeight);
  float halfWidth = u_lineWidth * 0.5;

  // Distance from nearest contour line edge (at 0.0 and 1.0 of frac)
  float d1 = abs(contourFrac);
  float d2 = abs(contourFrac - 1.0);
  float d = min(d1, d2);

  // Smooth anti-aliased line
  float lineMask = 1.0 - smoothstep(fw * halfWidth, fw * (halfWidth + 1.0), d);

  // --- Color by height ---
  vec3 lineColor = heightColor(height);

  // Fill between lines: darkened subtle gradient
  vec3 fillColor = heightColor(height) * 0.15;

  // Composite: bright gradient-colored lines on dark fill
  vec3 color = mix(fillColor, lineColor, lineMask);

  // --- Post-processing ---

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap at 75%
  color = min(color, vec3(0.75));

  // Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
