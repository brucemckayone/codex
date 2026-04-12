/**
 * Tunnel fragment shader — Apollonian fractal tunnel flythrough.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Camera flies through an Apollonian gasket fractal tunnel created by iterated
 * sphere inversions. Colour accumulates volumetrically during the 128-step
 * raymarch based on position and depth, with brand-derived colour offsets.
 * Mouse shifts camera look direction. Click creates a speed burst.
 *
 * Post-processing: Reinhard tone map, vignette, grain.
 */
export const TUNNEL_FRAG = `#version 300 es
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
uniform float u_speed;         // camera flight speed
uniform int u_fractal;         // Apollonian iterations (4-8)
uniform float u_radius;        // tunnel radius / cell size
uniform float u_brightness;    // colour brightness multiplier
uniform float u_twist;         // path curvature
uniform float u_intensity;     // overall blend
uniform float u_grain;
uniform float u_vignette;

// -- Camera path: smooth curve through 3D space --
vec3 cameraPath(float z) {
  return vec3(cos(z * u_twist) * 16.0, 0.0, z);
}

// -- Apollonian fractal SDF: iterated sphere inversions --
float apollonian(vec3 p) {
  float b = u_radius;
  float s;
  float w = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= u_fractal) break;
    p = mod(p + b, 2.0 * b) - b;        // fold space
    s = 2.0 / max(dot(p, p), 0.001);     // sphere inversion (guarded)
    p *= s;
    w *= s;
  }

  return length(p) / w - 0.01;
}

// -- Tunnel SDF: fractal inside cylinder --
float tunnelSDF(vec3 p) {
  vec3 q = p - cameraPath(p.z);
  float tunnel = -(length(q.xy) - u_radius * 1.5);  // inside of cylinder
  float fractal = apollonian(p);
  return max(tunnel, fractal);                        // intersection
}

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Camera position: flies forward, click burst adds speed
  float z = u_time * u_speed + u_burstStrength * 5.0;
  vec3 ro = cameraPath(z);
  vec3 target = cameraPath(z + 1.0);

  // Camera frame
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);

  // Mouse shifts look direction
  vec2 mouseOffset = (u_mouse - 0.5) * 0.5;
  vec3 rd = normalize(fwd + (uv.x + mouseOffset.x) * right + (uv.y + mouseOffset.y) * up);

  // Brand-derived colour offsets for volumetric accumulation
  vec3 brandOffset = vec3(
    dot(u_brandPrimary, vec3(1.0)) * 2.0,
    dot(u_brandSecondary, vec3(1.0)) * 1.5,
    dot(u_brandAccent, vec3(1.0)) * 1.0
  );

  // Raymarch with colour accumulation (128 steps)
  vec3 color = vec3(0.0);
  float t = 0.0;

  for (int i = 0; i < 128; i++) {
    vec3 p = ro + rd * t;
    float d = tunnelSDF(p);

    if (d < 0.001) break;
    if (t > 50.0) break;

    // Volumetric colour accumulation
    vec3 marchColor = 0.5 + 0.5 * cos(0.05 * float(i) + 0.5 * p.z + brandOffset);
    float falloff = exp(-0.15 * t);
    color += marchColor * falloff * 0.02 * u_brightness;

    t += max(d, 0.01);  // minimum step to avoid getting stuck
  }

  // -- Post-processing --

  // Reinhard tone map
  color = color / (1.0 + color);

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
