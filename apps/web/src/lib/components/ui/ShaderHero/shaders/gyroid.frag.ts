/**
 * Gyroid fragment shader — Organic gyroid volumetric with space inversion.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Two nested gyroids at different frequencies create an intricate organic lattice.
 * Space inversion (p * k / dot(p,p)) bends the gyroid into spherical topology.
 * Volumetric raymarching accumulates density at gyroid surfaces with
 * brand-colored depth gradients.
 * Mouse rotates the structure; click creates a brightness pulse.
 * Post-processing: ACES tonemapping (richer color than Reinhard), vignette, grain.
 */
export const GYROID_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_scale1;
uniform float u_scale2;
uniform float u_speed;
uniform float u_density;
uniform float u_thickness;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// -- ACES filmic tonemapping --
// Richer color separation in highlights and deeper darks than Reinhard.
vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Gyroid SDF --
// Triply-periodic minimal surface approximation.
// abs() creates a shell; thickness controls wall width.
float sdGyroid(vec3 p, float scale, float thickness, float bias) {
  p *= scale;
  return abs(dot(sin(p), cos(p.zxy)) - bias) / scale - thickness;
}

void main() {
  float t = u_time * u_speed;

  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Camera
  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.5));

  // Mouse rotation (Y-axis and X-axis)
  float mx = (u_mouse.x - 0.5) * 3.14159;
  float my = (u_mouse.y - 0.5) * 1.5708;

  // Y-axis rotation
  float cy = cos(mx), sy = sin(mx);
  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

  // X-axis rotation
  float cx = cos(my), sx = sin(my);
  rd.yz = mat2(cx, -sx, sx, cx) * rd.yz;

  // Volumetric accumulation
  vec3 acc = vec3(0.0);
  float accAlpha = 0.0;
  float stepSize = 0.04;
  float bias = sin(t * 0.3) * 0.2;

  for (int i = 0; i < 80; i++) {
    if (accAlpha > 0.95) break;

    vec3 p = ro + rd * float(i) * stepSize;
    float depth = float(i) / 80.0;

    // Time rotation
    float ct = cos(t), st = sin(t);
    p.xz = mat2(ct, -st, st, ct) * p.xz;

    // Space inversion — maps infinite periodic gyroid into finite sphere.
    // Epsilon prevents division-by-zero singularity at origin.
    p = p * 2.5 / (dot(p, p) + 0.001);

    // Two-frequency gyroid with burst thickness
    float thk = u_thickness + u_burstStrength * 0.02;
    float g1 = sdGyroid(p, u_scale1, thk, bias);
    float g2 = sdGyroid(p, u_scale2, thk * 0.5, bias * 0.5);
    float s = min(g1, g2);

    // Density estimation
    float dens = smoothstep(0.05, 0.0, abs(s)) * u_density / 80.0;

    // Depth-based color (3-segment with wraparound)
    vec3 col;
    if (depth < 0.33) {
      col = mix(u_brandPrimary, u_brandSecondary, depth / 0.33);
    } else if (depth < 0.66) {
      col = mix(u_brandSecondary, u_brandAccent, (depth - 0.33) / 0.33);
    } else {
      col = mix(u_brandAccent, u_brandPrimary * 0.5, (depth - 0.66) / 0.34);
    }

    // Brightness pulse on click
    dens *= 1.0 + u_burstStrength * 3.0;

    // Front-to-back compositing
    acc += col * dens * (1.0 - accAlpha);
    accAlpha += dens * (1.0 - accAlpha);
  }

  // Background glow
  vec3 bgGlow = u_brandSecondary * exp(-dot(uv, uv) * 2.0) * 0.15;
  vec3 color = u_bgColor * 0.3 * (1.0 - accAlpha) + bgGlow * (1.0 - accAlpha) + acc;

  // -- Post-processing --

  // ACES tonemapping (richer color for overlapping semi-transparent layers)
  color = ACESFilm(color);

  // Cap maximum brightness
  color = min(color, vec3(0.75));

  // Intensity blend
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
