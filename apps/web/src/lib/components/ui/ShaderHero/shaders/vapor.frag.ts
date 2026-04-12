/**
 * Vapor fragment shader — Volumetric dot noise clouds with ACES tonemapping.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Frostbyte-inspired dot noise creates organic volumetric cloud density fields.
 * Raymarching (80 steps) accumulates colour using front-to-back compositing.
 * Brand colours map to depth: primary near, secondary mid, accent far.
 * Mouse shifts the camera viewing angle. Click creates a brightness pulse.
 *
 * Post-processing: ACES filmic tone map, vignette, grain.
 */
export const VAPOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;          // normalized 0-1, lerped
uniform float u_burstStrength;  // click burst (decays)
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_density;       // cloud density
uniform float u_speed;         // animation speed
uniform float u_scale;         // noise frequency
uniform float u_warmth;        // colour temperature shift
uniform float u_glow;          // bloom intensity
uniform float u_intensity;     // overall blend
uniform float u_grain;
uniform float u_vignette;

// -- Golden ratio decorrelation matrix (column-major) --
const mat3 G = mat3(
  0.618, 0.324, 0.0,
  0.0, 0.618, 0.324,
  0.324, 0.0, 0.618
);

// -- Dot noise (Frostbyte-inspired) --
float dotNoise(vec3 p) {
  return dot(cos(G * p), sin(1.6 * p * G));
}

// -- ACES filmic tonemapping --
vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Camera: mouse shifts viewing angle
  vec2 mouseOffset = (u_mouse - 0.5) * 0.3;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv + mouseOffset, 2.0));

  // Raymarch with front-to-back compositing
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float stepSize = 0.08;

  for (int i = 0; i < 80; i++) {
    if (alpha > 0.95) break;

    vec3 p = ro + rd * float(i) * stepSize;
    p *= u_scale * 0.1;

    // Animate
    p.z += u_time * u_speed * 0.1;
    p.x += sin(u_time * u_speed * 0.05) * 0.5;

    // Density from dot noise
    float d = dotNoise(p) * 0.5 + 0.5;
    d = smoothstep(0.3, 0.7, d) * u_density;

    // Depth fraction for colour mapping
    float depthFrac = float(i) / 80.0;

    // Colour by depth: near=primary, mid=secondary, far=accent
    vec3 layerColor;
    if (depthFrac < 0.5) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, depthFrac * 2.0);
    } else {
      layerColor = mix(u_brandSecondary, u_brandAccent, (depthFrac - 0.5) * 2.0);
    }

    // Warmth shift
    layerColor = mix(layerColor, layerColor * vec3(1.1, 1.0, 0.9), u_warmth);

    // Accumulate
    float a = d * (1.0 - alpha) * 0.15;
    color += layerColor * a * u_glow;
    alpha += a;
  }

  // Click brightness pulse
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5) * 0.3;

  // Composite over darkened background
  color = mix(u_bgColor * 0.2, color, min(alpha + 0.1, 1.0));

  // -- Post-processing --

  // ACES filmic tone map
  color = ACESFilm(color);

  // Brightness cap
  color = min(color, vec3(0.7));

  // Intensity blend with background
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
