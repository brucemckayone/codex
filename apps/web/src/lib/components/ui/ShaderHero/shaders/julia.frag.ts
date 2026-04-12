/**
 * Julia fragment shader — Animated Julia set fractal with cosine palette.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * The c parameter orbits slowly in the complex plane, creating continuously
 * morphing fractal shapes. Escape-time colouring maps iteration count through
 * a brand-derived cosine palette. Mouse shifts the c parameter directly,
 * letting the user explore different fractal shapes. Click recentres c
 * to the orbit path.
 *
 * Post-processing: Reinhard tone map, vignette, grain.
 */
export const JULIA_FRAG = `#version 300 es
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
uniform float u_zoom;          // fractal zoom level
uniform float u_speed;         // c orbit speed
uniform int u_iterations;      // max iteration count (30-100)
uniform float u_radius;        // c orbit radius
uniform float u_saturation;    // palette intensity
uniform float u_intensity;     // overall blend
uniform float u_grain;
uniform float u_vignette;

// -- Cosine palette: a + b * cos(2pi * (c*t + d)) --
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Aspect-correct UVs scaled by zoom
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  uv /= u_zoom;

  // c parameter: orbit + mouse offset
  float t = u_time * u_speed;
  float r = u_radius + 0.05 * sin(t * 0.7);  // slight radius oscillation
  vec2 c_base = r * vec2(cos(t / 3.0), sin(t / 3.0));
  vec2 mouseOffset = (u_mouse - 0.5) * 0.4;
  // Click recentres c toward orbit path
  vec2 c = mix(c_base + mouseOffset, c_base, u_burstStrength * 0.8);

  // Julia set iteration
  vec2 z = uv;
  int i;
  for (i = 0; i < 100; i++) {
    if (i >= u_iterations) break;
    if (dot(z, z) > 256.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  }

  // Colour
  vec3 color;
  if (i >= u_iterations) {
    // Non-escaped core: deep dark
    color = u_bgColor * 0.15;
  } else {
    // Smooth escape-time colouring
    float smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
    float t_color = smoothIter / float(u_iterations);

    // Brand-derived cosine palette vectors
    vec3 pa = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation + 0.3;
    vec3 pb = (u_brandAccent - u_bgColor * 0.3) * u_saturation + 0.2;
    vec3 pc = vec3(1.0, 1.0, 1.0);
    vec3 pd = vec3(
      dot(u_brandPrimary, vec3(0.299, 0.587, 0.114)),
      dot(u_brandSecondary, vec3(0.299, 0.587, 0.114)),
      dot(u_brandAccent, vec3(0.299, 0.587, 0.114))
    );

    color = palette(t_color, pa, pb, pc, pd);
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
