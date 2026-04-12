/**
 * Curl Noise Tendrils fragment shader (GLSL ES 3.0).
 *
 * Single-pass: curl noise advected UV with density accumulation.
 * 3D FBM noise field generates a divergence-free curl velocity field.
 * Backward Euler advection traces streamlines, accumulating density.
 * Mouse creates a radial vortex force. Click produces a density flash.
 * Lerped mouse input for smooth vortex response.
 */
export const TENDRILS_FRAG = `#version 300 es
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
uniform float u_scale;
uniform float u_speed;
uniform int u_steps;
uniform float u_curl;
uniform float u_fade;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- 3D value noise --
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash31(i);
  float b = hash31(i + vec3(1, 0, 0));
  float c = hash31(i + vec3(0, 1, 0));
  float d = hash31(i + vec3(1, 1, 0));
  float e = hash31(i + vec3(0, 0, 1));
  float f1 = hash31(i + vec3(1, 0, 1));
  float g = hash31(i + vec3(0, 1, 1));
  float h = hash31(i + vec3(1, 1, 1));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}

// -- FBM 3 octaves with rotation --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3d(vec3 p) {
  float f = 0.0;
  f += 0.500 * noise3(p); p.xy = octaveRot * p.xy * 2.02; p.z *= 1.03;
  f += 0.250 * noise3(p); p.xy = octaveRot * p.xy * 2.03; p.z *= 1.04;
  f += 0.125 * noise3(p);
  return f / 0.875;
}

// -- Curl noise: gradient of scalar potential --
vec2 curlNoise(vec2 p, float t) {
  float eps = 0.01;
  vec3 p3 = vec3(p, t);
  float dPdy = (fbm3d(p3 + vec3(0, eps, 0)) - fbm3d(p3 - vec3(0, eps, 0))) / (2.0 * eps);
  float dPdx = (fbm3d(p3 + vec3(eps, 0, 0)) - fbm3d(p3 - vec3(eps, 0, 0))) / (2.0 * eps);
  return vec2(dPdy, -dPdx) * u_curl;
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse influence (aspect-corrected)
  vec2 mouseUv = (u_mouse - 0.5) * 2.0;
  mouseUv.x *= u_resolution.x / u_resolution.y;

  // Backward advection along curl noise field
  vec2 pos = uv * u_scale;
  float density = 0.0;
  float dt = 0.15;

  for (int i = 0; i < 7; i++) {
    if (i >= u_steps) break;

    // Curl noise velocity at current position
    vec2 vel = curlNoise(pos, t);

    // Mouse vortex force
    vec2 toMouse = pos - mouseUv * u_scale;
    float mouseDist = length(toMouse);
    float mouseFalloff = exp(-mouseDist * mouseDist * 4.0);
    vec2 perp = vec2(-toMouse.y, toMouse.x);
    vel += (perp * 0.8 + normalize(toMouse + 0.001) * 0.2) * mouseFalloff * u_curl * 0.5;

    // Advect backward
    pos -= vel * dt;

    // Sample density: use a narrow band of noise to create thin tendrils
    // Only the 0.45-0.55 isoline of the noise field produces visible density
    float n = fbm3d(vec3(pos, t * 0.5));
    float band = 1.0 - smoothstep(0.0, 0.08, abs(n - 0.5));
    float weight = 1.0 - float(i) / float(u_steps);
    density += band * weight;
  }
  density /= float(u_steps);

  // Apply fade (thickness control)
  density = clamp(density * u_fade * 2.0, 0.0, 1.0);

  // Brand colour mapping: bg -> primary -> secondary -> accent
  vec3 color;
  if (density < 0.25) {
    color = mix(u_bgColor, u_brandPrimary, density * 4.0);
  } else if (density < 0.5) {
    color = mix(u_brandPrimary, u_brandSecondary, (density - 0.25) * 4.0);
  } else if (density < 0.75) {
    color = mix(u_brandSecondary, u_brandAccent, (density - 0.5) * 4.0);
  } else {
    color = mix(u_brandAccent, vec3(1.0), (density - 0.75) * 2.0);
  }

  // Click burst
  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    float burstDist = dot(uv - burstUv, uv - burstUv);
    float burst = u_burstStrength * exp(-burstDist * 6.0);
    color += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.5;
  }

  // Post-process
  color = color / (1.0 + color);                    // Reinhard
  color = min(color, vec3(0.7));                     // Brightness cap
  color = mix(u_bgColor, color, u_intensity);        // Intensity blend

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
