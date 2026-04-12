/**
 * Sigil fragment shader — Fractal line SDF with iterative UV warping.
 *
 * Adapted from https://www.shadertoy.com/view/4fsfWX
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Technique: Nested iteration — outer loop applies UV distortion (rotation,
 * inverse-square zoom, triangle-wave folding), inner loop accumulates glow
 * from a rotating line-segment SDF. Each octave adds finer detail.
 * Mouse: shifts initial UV offset for parallax.
 * Click burst: flash/glow multiplier.
 * Brand colors: 3-phase cycling through primary, secondary, accent.
 */
export const SIGIL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform vec2  u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3  u_brandPrimary;
uniform vec3  u_brandSecondary;
uniform vec3  u_brandAccent;
uniform vec3  u_bgColor;
// Preset-specific
uniform float u_speed;
uniform int   u_layers;
uniform float u_distortion;
uniform float u_glow;
// Shared post-process
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

#define TAU 6.28318530

// ── Hash for film grain ──────────────────────────────────
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Rotating line-segment SDF ────────────────────────────
float lineSDF(vec2 uv, float t) {
  float c = cos(t), s = sin(t);
  mat2 R = mat2(c, s, -s, c);

  vec2 a = R * vec2(-2.0, 0.0);
  vec2 b = R * vec2(2.0, 0.0) - a;
  vec2 p = uv - a;

  // Mix between smooth and segmented line (dashed effect)
  float smooth_d = length(clamp(dot(p, b) / dot(b, b), 0.0, 1.0) * b - p);
  float seg_d    = length(clamp(round(dot(p, b) / dot(b, b) * 30.0) / 30.0, 0.0, 1.0) * b - p);
  return mix(smooth_d, seg_d, 0.5 + 0.5 * tanh(10.0 * sin(u_time * u_speed * 0.1)));
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution.xy) / u_resolution.y;
  float t = (u_time + 10.0) * u_speed;

  // Mouse parallax — shift UV origin
  if (u_mouseActive > 0.5) {
    uv += (u_mouse - 0.5) * 0.3;
  }

  // Distance-dependent time offset (creates spiral/zoom feel)
  float dd = dot(uv, uv);
  t -= mix(log2(max(dd, 0.001)), dd, 0.5 + 0.5 * tanh(4.0 * sin(u_time * u_speed * 0.25)));

  vec3 color = vec3(0.0);
  vec2 tex_uv = uv;
  float index = 0.0;

  // ── Outer loop: fractal octaves ────────────────────────
  for (int j = 0; j < 8; j++) {
    if (j >= u_layers) break;
    float fj = float(j);

    vec2 uv2 = 2.0 * tex_uv;

    // Rotation
    float angle = TAU * 0.01 * t;
    float c = cos(angle), s = sin(angle);
    mat2 R = mat2(c, s, -s, c);

    // Smooth absolute + offset
    tex_uv = sqrt(tex_uv * tex_uv + 0.0005);
    tex_uv += 0.1 + cos(t * 0.33) * 0.05;

    // Triangle-wave fold
    tex_uv = asin(sin(tex_uv));

    // Inverse-square zoom with distortion control
    float scale = u_distortion / (0.00001 + dot(tex_uv, tex_uv));
    tex_uv *= scale;

    tex_uv *= R;

    // Subtle per-octave wobble
    float fi2 = 0.01;
    for (int k = 0; k < 7; k++) {
      tex_uv += cos(tex_uv.yx * fi2) / fi2 * 0.005;
      fi2 *= 2.0;
    }

    // Evaluate line SDF
    float sdf = lineSDF(uv2, t);
    vec3 col = vec3(0.0);

    // Quadrant-based index for color variation
    index *= 4.0;
    index += 2.0 * smoothstep(-0.05, 0.05, tex_uv.y) + smoothstep(-0.05, 0.05, tex_uv.x);

    // ── Inner loop: glow accumulation ──────────────────
    float fi = 0.01;
    for (int k = 0; k < 7; k++) {
      t -= sdf * fi;
      sdf = lineSDF(uv2, t);
      float a = u_glow / (0.001 + sdf);

      // Brand color cycling (120° phase offsets)
      float phase = index / 32.0 + t * 0.25;
      float p1 = 0.5 + 0.5 * cos(phase);
      float p2 = 0.5 + 0.5 * cos(phase + 2.094);
      float p3 = 0.5 + 0.5 * cos(phase + 4.189);
      vec3 cmap = p1 * u_brandPrimary + p2 * u_brandSecondary + p3 * u_brandAccent;

      col += a * cmap;
      fi *= 2.0;
    }

    // Exponential falloff per octave
    color += col * exp2(-12.0 * smoothstep(2.0, 14.0, fj));
  }

  // Burst flash
  color += u_burst * u_brandAccent * 0.3;

  // Gamma-like power curve + exposure
  color *= pow(abs(color), vec3(0.85));
  color = 1.0 - exp(-color);

  // ── Post-processing (MANDATORY) ────────────────────────
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
