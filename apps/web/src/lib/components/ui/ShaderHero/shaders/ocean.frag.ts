/**
 * Ocean (Underwater Caustics + Sand Ripples) fragment shader.
 *
 * Three composited layers: sand ripples (base surface), caustic light network,
 * and soft height-derived shadows. Mouse creates dual ripple disturbance in
 * both water caustics and sand surface simultaneously.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * All float uniforms. Fixed 3 caustic iterations.
 * Two-layer caustic averaging for smoother patterns.
 */
export const OCEAN_FRAG = `#version 300 es
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
uniform float u_causticScale;
uniform float u_sandScale;
uniform float u_speed;
uniform float u_shadow;
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

// -- 2-octave FBM for sand irregularity --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbmNoise(vec2 p) {
  float f = sin(p.x) * sin(p.y) * 0.5;
  p = octaveRot * p * 2.02;
  f += sin(p.x) * sin(p.y) * 0.25;
  return f / 0.75;
}

// -- Sand ripple height field --
float sandHeight(vec2 p, float t) {
  // Primary ripple direction (diagonal)
  float ang = 0.4;
  vec2 dir = vec2(cos(ang), sin(ang));

  // Domain warp with slow noise
  vec2 warp = vec2(
    sin(dot(p, dir) * 2.0 + t * 0.3),
    cos(dot(p, dir.yx) * 1.5 + t * 0.2)
  ) * 0.3;

  vec2 wp = p + warp;

  // Layered sine waves for ripple pattern
  float h = 0.0;
  h += sin(dot(wp, dir) * u_sandScale * 3.0 + t * 0.5) * 0.5;
  h += sin(dot(wp, dir * 1.7) * u_sandScale * 5.0 + t * 0.3) * 0.25;
  h += sin(dot(wp, vec2(-dir.y, dir.x)) * u_sandScale * 2.0 + t * 0.15) * 0.15;

  // FBM noise for irregularity
  h += fbmNoise(wp * u_sandScale) * 0.3;

  return h * 0.5 + 0.5; // Normalize to 0..1
}

// -- Caustic pattern (iterative UV warp convergence) --
float caustic(vec2 uv, float t) {
  vec2 p = uv * u_causticScale;
  float c = 0.0;
  float freq = 1.0;

  // 3 fixed iterations for ocean (balanced quality/perf)
  for (int i = 0; i < 3; i++) {
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0));
    freq *= 2.0;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p; // rotate between iterations
  }

  return c / 3.0;
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // -- Mouse ripple warp (applied to both layers) --
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = mouseDist > 0.001 ? normalize(fragUV - mouseUV) : vec2(0.0);

  vec2 warp = vec2(0.0);
  // Hover ripple: concentric waves emanating from cursor
  warp += u_mouseActive * u_ripple * 0.015 *
    sin(mouseDist * 25.0 - t * 5.0) *
    exp(-mouseDist * 6.0) * mouseDir;
  // Click burst: larger, stronger outward ring
  warp += u_burst * 0.025 *
    sin(mouseDist * 18.0 - t * 8.0) *
    exp(-mouseDist * 3.0) * mouseDir;

  vec2 warpedUV = uv + warp;

  // Aspect-corrected coordinates
  vec2 p = vec2(warpedUV.x * aspect, warpedUV.y);

  // -- Layer 1: Sand ripples --
  float sandH = sandHeight(p * u_sandScale, t);

  // -- Layer 2: Caustics (two-layer average) --
  float c1 = caustic(p, t);
  float c2 = caustic(p, t + 0.5);
  float causticVal = (c1 + c2) * 0.5;

  // -- Layer 3: Soft shadow --
  vec2 lightDir = normalize(vec2(0.5, 0.7));
  float shadowSample = sandHeight((p + lightDir * 0.05) * u_sandScale, t);
  float shadowMask = smoothstep(0.0, 0.15, sandH - shadowSample);
  float shadowDarken = mix(1.0 - u_shadow, 1.0, shadowMask);

  // -- Composite --
  // Sand base color (warm gradient: bgColor -> primary)
  vec3 sandColor = mix(u_bgColor * 0.6, u_brandPrimary, sandH * 0.8 + 0.1);

  // Water tint overlay (secondary color)
  sandColor = mix(sandColor, sandColor + u_brandSecondary * 0.3, 0.5);

  // Caustic highlights (accent color, additive, squared for concentration)
  vec3 color = sandColor + u_brandAccent * causticVal * causticVal * 0.8;

  // Shadow darkening (multiplicative)
  color *= shadowDarken;

  // -- Post-processing --
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

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
