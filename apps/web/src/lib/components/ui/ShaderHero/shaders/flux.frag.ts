/**
 * Flux fragment shader — Magnetic dipole field lines.
 *
 * Technique: Scalar potential from fixed poles (max 5) + mouse as movable pole.
 * Poles orbit slowly at different radii with alternating +/- charges.
 * Mouse pole is positive on hover, flips on click (u_burst).
 *
 * Field lines: fract(potential * lineDensity / TWO_PI) + fwidth() anti-aliasing.
 * Field magnitude |B| = sum(charge/dist^2), log-scaled for colour mapping.
 * 3-segment gradient: bg -> primary -> secondary -> accent.
 * Lines = full brightness; fill = 12% brightness.
 *
 * Single-pass fragment shader. No FBOs needed.
 */
export const FLUX_FRAG = `#version 300 es
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
uniform int u_poles;
uniform float u_lineDensity;
uniform float u_lineWidth;
uniform float u_strength;
uniform float u_speed;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

const float TWO_PI = 6.28318530718;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // --- Accumulate scalar potential and field magnitude ---
  float potential = 0.0;
  float fieldMag = 0.0;

  // Loop over fixed poles + mouse pole (last iteration)
  // Max 5 fixed poles + 1 mouse = 6 total
  for (int i = 0; i < 6; i++) {
    if (i >= u_poles + 1) break;

    vec2 polePos;
    float charge;

    if (i < u_poles) {
      // Fixed poles: orbit at different radii
      float fi = float(i);
      float angle = t * (0.3 + fi * 0.1) + fi * TWO_PI / float(u_poles);
      float radius = 0.4 + 0.2 * sin(t * 0.2 + fi * 1.7);
      polePos = vec2(cos(angle), sin(angle)) * radius;
      // Alternate charges: +1, -1, +1, -1, ...
      charge = (mod(fi, 2.0) < 0.5) ? u_strength : -u_strength;
    } else {
      // Mouse pole
      polePos = (u_mouse * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
      // Positive on hover, flips on click (burst)
      float mouseCharge = u_strength * mix(1.0, -1.0, smoothstep(0.0, 0.5, u_burst));
      charge = mouseCharge * u_mouseActive;
    }

    vec2 d = uv - polePos;
    float dist = length(d);
    float safeDist = max(dist, 0.02);

    // Scalar potential: charge * atan2(dy, dx)
    potential += charge * atan(d.y, d.x);

    // Field magnitude: charge / dist^2
    fieldMag += abs(charge) / (safeDist * safeDist);
  }

  // --- Field lines via fract + fwidth anti-aliasing ---
  float linePhase = fract(potential * u_lineDensity / TWO_PI);
  float fw = fwidth(potential * u_lineDensity / TWO_PI) * u_lineWidth;
  float lineMask = smoothstep(0.5 - fw, 0.5, linePhase) - smoothstep(0.5, 0.5 + fw, linePhase);
  // Also catch the wrap-around at 0/1
  lineMask += smoothstep(fw, 0.0, linePhase) + smoothstep(1.0 - fw, 1.0, linePhase);
  lineMask = clamp(lineMask, 0.0, 1.0);

  // --- Field strength colour mapping (log scale) ---
  float logField = clamp(log(1.0 + fieldMag) / 3.0, 0.0, 1.0);

  // 3-segment gradient: bg -> primary -> secondary -> accent
  vec3 gradientColor;
  if (logField < 0.33) {
    gradientColor = mix(u_bgColor, u_brandPrimary, logField / 0.33);
  } else if (logField < 0.66) {
    gradientColor = mix(u_brandPrimary, u_brandSecondary, (logField - 0.33) / 0.33);
  } else {
    gradientColor = mix(u_brandSecondary, u_brandAccent, (logField - 0.66) / 0.34);
  }

  // Lines = full brightness; fill = 12% brightness
  vec3 color = gradientColor * mix(0.12, 1.0, lineMask);

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
