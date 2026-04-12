/**
 * Clouds fragment shader — Procedural sky with volumetric-looking clouds.
 *
 * Two-layer approach: ridged noise FBM for cloud shape, regular noise FBM
 * for cloud density. Composited over a sky gradient background using brand
 * colors. 8 total FBM octaves (4 ridged + 4 smooth) of 2D simplex noise.
 *
 * Single-pass fragment shader. No FBOs needed.
 * Mouse shifts wind direction/speed. Click clears clouds near cursor.
 * Brand colors: primary=cloud body, secondary=sky top, accent=ridge glow.
 */
export const CLOUDS_FRAG = `#version 300 es
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
uniform float u_cover;
uniform float u_speed;
uniform float u_scale;
uniform float u_dark;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Simplex noise helpers --
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289v3((x * 34.0 + 1.0) * x); }

// -- 2D Simplex noise --
float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,   // (3.0-sqrt(3.0))/6.0
    0.366025403784439,   // 0.5*(sqrt(3.0)-1.0)
   -0.577350269189626,   // -1.0 + 2.0 * C.x
    0.024390243902439    // 1.0 / 41.0
  );

  // First corner
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);

  // Other corners
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  // Permutations
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;

  // Gradients
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;

  return 130.0 * dot(m, g);
}

// -- Ridged noise: abs(noise) inverted = sharp ridges --
float ridgedNoise(vec2 p) {
  return 1.0 - abs(snoise(p));
}

// -- Ridged FBM: cloud shape (4 octaves) --
float cloudShape(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;

  // Wind drift
  vec2 drift = vec2(t * 0.6, t * 0.3);

  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);

  for (int i = 0; i < 4; i++) {
    f += amp * ridgedNoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.3;
  }

  return f / totalAmp;
}

// -- Smooth FBM: cloud density (4 octaves) --
float cloudDensity(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;

  vec2 drift = vec2(t * 0.4, t * 0.2);
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);

  for (int i = 0; i < 4; i++) {
    f += amp * snoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.2;
  }

  return (f / totalAmp) * 0.5 + 0.5; // Remap to 0..1
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // -- Sky gradient (bottom to top: bg -> secondary) --
  vec3 skyColor = mix(u_bgColor, u_brandSecondary, uv.y * 0.8 + 0.1);

  // -- Aspect-corrected cloud coordinates --
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;

  // -- Mouse wind shift --
  vec2 windShift = u_mouseActive * vec2(
    (u_mouse.x - 0.5) * 0.3,
    (u_mouse.y - 0.5) * 0.15
  );
  p += windShift * t * 10.0;

  // -- Click clears clouds near cursor --
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float clearMask = 1.0 - u_burst * exp(-mouseDist * mouseDist * 10.0);

  // -- Cloud shape (ridged FBM) --
  float shape = cloudShape(p, t);

  // -- Cloud density (smooth FBM) --
  float density = cloudDensity(p * 1.5, t * 0.7);

  // -- Combine: shape determines presence, density modulates --
  float cloud = shape * density;

  // -- Coverage threshold (controls how much sky is covered) --
  cloud = smoothstep(u_cover, u_cover + 0.3, cloud);

  // -- Apply click clear mask --
  cloud *= clearMask;

  // -- Cloud coloring --
  // Dark undersides
  vec3 cloudDarkColor = u_brandPrimary * (1.0 - u_dark);

  // Bright tops (primary lightened)
  vec3 cloudLightColor = u_brandPrimary * (1.0 + u_light) + vec3(u_light * 0.5);

  // Ridge accent glow (accent color on ridged edges)
  float ridgeGlow = pow(shape, 3.0) * 0.5;

  // Cloud brightness from density (dark undersides, bright tops)
  float brightness = density * 0.7 + 0.3;
  vec3 cloudColor = mix(cloudDarkColor, cloudLightColor, brightness);
  cloudColor += u_brandAccent * ridgeGlow;

  // -- Composite cloud over sky --
  vec3 color = mix(skyColor, cloudColor, cloud);

  // -- Post-processing --
  // 1. Reinhard tone map
  color = color / (1.0 + color);

  // 2. Brightness cap at 75%
  color = min(color, vec3(0.75));

  // 3. Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // 4. Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // 5. Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // 6. Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
