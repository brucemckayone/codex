/**
 * Ether fragment shader — Raymarched volumetric light.
 *
 * Faithful port of MsjSW3 by nimitz (2014).
 * https://www.shadertoy.com/view/MsjSW3
 *
 * Single-pass: fullscreen quad, no FBOs.
 * The map() function creates organic 3D forms via SDF + sine waves.
 * Configurable raymarch steps (3-8) with multiplicative color accumulation.
 * Brand colors injected as uniforms replacing hardcoded constants.
 * Post-processing: Reinhard tone map, chromatic aberration, vignette, grain.
 */
export const ETHER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;         // normalized 0-1, lerped
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_rotSpeed;
uniform int u_complexity;     // 3-8 raymarch steps
uniform float u_glow;         // glow intensity multiplier
uniform float u_scale;        // map() detail scale
uniform float u_zoom;         // camera Z distance
uniform float u_intensity;    // overall blend intensity
uniform float u_grain;
uniform float u_vignette;
uniform float u_aberration;

// -- nimitz's rotation matrix --
mat2 m(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// -- The SDF map function -- heart of the shader --
// Organic form: rotating log-distance + nested sine waves
float map(vec3 p, float t, float rotSpd, float scl) {
  p.xz *= m(t * rotSpd);
  p.xy *= m(t * rotSpd * 0.75);
  vec3 q = p * scl + t;
  return length(p + vec3(sin(t * 0.7))) * log(length(p) + 1.0)
       + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
}

// -- Hash for film grain --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float t = u_time;

  // Mouse parallax: shift view origin for perspective effect
  float mx = (u_mouse.x - 0.5) * 0.3;
  float my = (u_mouse.y - 0.5) * 0.2;

  // Shadertoy-style coordinate mapping
  // Original: fragCoord.xy/iResolution.y - vec2(.9,.5)
  vec2 uv = gl_FragCoord.xy / u_resolution.y - vec2(
    0.9 + mx,
    0.5 + my
  );

  // Brand color setup:
  // Base light replaces vec3(0.1, 0.3, 0.4)
  vec3 baseLight = u_brandPrimary * 0.3;
  // Highlight replaces vec3(5.0, 2.5, 3.0) -- mix secondary+accent, scaled up
  vec3 highlight = mix(u_brandSecondary, u_brandAccent, 0.4) * 4.0;

  // -- Raymarch loop --
  vec3 cl = vec3(0.0);
  float d = 2.5;

  // Unroll manually up to 8 steps (controlled by u_complexity)
  for (int i = 0; i <= 7; i++) {
    if (i >= u_complexity) break;

    vec3 p = vec3(0.0, 0.0, u_zoom) + normalize(vec3(uv, -1.0)) * d;
    float rz = map(p, t, u_rotSpeed, u_scale);
    float f = clamp((rz - map(p + vec3(0.1), t, u_rotSpeed, u_scale)) * 0.5, -0.1, 1.0);

    // Brand-colored lighting
    vec3 l = baseLight + highlight * f;
    cl = cl * l + smoothstep(2.5, 0.0, rz) * u_glow * l;

    d += min(rz, 1.0);
  }

  // -- Post-processing --

  // Reinhard tone mapping
  vec3 etherColor = cl / (1.0 + cl);

  // Cap maximum brightness
  etherColor = min(etherColor, vec3(0.7));

  // Intensity blend: mix background with ether
  vec3 color = mix(u_bgColor, etherColor, u_intensity);

  // Chromatic aberration on bright areas
  {
    float lum = dot(etherColor, vec3(0.299, 0.587, 0.114));
    float abStr = u_aberration * smoothstep(0.2, 0.6, lum);
    // Shift R and B channels based on distance from center
    // Full per-pixel re-raymarch would be too expensive, so we
    // use a screen-space color split proportional to brightness
    color.r = mix(color.r, etherColor.r * 0.9 + 0.05, abStr * 2.0);
    color.b = mix(color.b, etherColor.b * 1.1, abStr * 2.0);
  }

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(t * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
