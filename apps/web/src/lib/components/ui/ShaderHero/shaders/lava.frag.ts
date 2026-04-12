/**
 * Lava fragment shader — Molten Voronoi crust with glowing cracks.
 *
 * Technique: Two-pass Voronoi (nearest point + nearest edge, 3x3 neighbourhood
 * each pass = 18 iterations). Seeds animate via sin/cos(time * speed + hash * 6.28).
 * Crack glow: exp(-edgeDist / crackWidth). FBM noise (3 octaves, sin-based)
 * overlay for rocky crust texture.
 *
 * Mouse hover: widens cracks + increases glow near cursor.
 * Click: full eruption (removes crust, shows accent).
 *
 * Colour: crustColor = primary * (1 - crust*0.7) * surfaceNoise;
 *         crackColor = mix(secondary, accent, crackMask); emissive glow on cracks.
 *
 * Single-pass fragment shader. No FBOs needed.
 */
export const LAVA_FRAG = `#version 300 es
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
uniform float u_crackScale;
uniform float u_crackWidth;
uniform float u_glow;
uniform float u_speed;
uniform float u_crust;
uniform float u_heat;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for Voronoi seed positions --
vec2 hash2(vec2 p) {
  return vec2(
    fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
    fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
  );
}

// -- Hash for film grain --
float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Sin-based noise for FBM --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM 3 octaves for crust texture --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3(vec2 p) {
  float f = 0.0;
  f += 0.5000 * noise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * noise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * noise(p);
  return f / 0.875;
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 st = uv * u_crackScale;

  // --- Mouse influence ---
  float mouseDist = distance(uv, u_mouse);
  float mouseInfluence = u_mouseActive * smoothstep(0.4, 0.0, mouseDist);
  float burstInfluence = u_burst;

  // Effective crack width: wider near mouse hover
  float effectiveCrackWidth = u_crackWidth * (1.0 + mouseInfluence * 2.0 + burstInfluence * 4.0);

  // --- Voronoi: nearest point ---
  vec2 cellId = floor(st);
  vec2 cellUv = fract(st);

  float minDist = 8.0;
  vec2 nearestSeed = vec2(0.0);
  vec2 nearestCellOff = vec2(0.0);

  // Pass 1: find nearest Voronoi point (3x3 neighbourhood)
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 seedBase = hash2(cellId + neighbor);
      // Animate seeds
      vec2 seed = neighbor + 0.5 + 0.4 * sin(t + seedBase * 6.28318530718);
      float d = length(cellUv - seed);
      if (d < minDist) {
        minDist = d;
        nearestSeed = seed;
        nearestCellOff = neighbor;
      }
    }
  }

  // Pass 2: find nearest edge distance (3x3 neighbourhood)
  float edgeDist = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      if (neighbor == nearestCellOff) continue;
      vec2 seedBase = hash2(cellId + neighbor);
      vec2 seed = neighbor + 0.5 + 0.4 * sin(t + seedBase * 6.28318530718);
      // Edge = perpendicular bisector distance
      vec2 midpoint = 0.5 * (nearestSeed + seed);
      vec2 edgeDir = normalize(seed - nearestSeed);
      float d = abs(dot(cellUv - midpoint, edgeDir));
      edgeDist = min(edgeDist, d);
    }
  }

  // --- Crack glow ---
  float crackMask = exp(-edgeDist / effectiveCrackWidth);
  float glowMask = crackMask * u_glow;

  // --- Crust texture (FBM noise) ---
  vec2 noiseUv = uv * 8.0 + t * 0.3;
  float surfaceNoise = 0.5 + 0.5 * fbm3(noiseUv);

  // --- Colour ---
  // Crust colour: primary darkened by crust factor and textured
  vec3 crustColor = u_brandPrimary * (1.0 - u_crust * 0.7) * surfaceNoise;

  // Crack colour: mix secondary to accent based on crack intensity
  vec3 crackColor = mix(u_brandSecondary, u_brandAccent, crackMask);

  // Combine: crust base + crack emissive glow
  vec3 color = crustColor * (1.0 - crackMask * 0.8);
  color += crackColor * glowMask * u_heat;

  // Mouse hover: add heat near cursor
  color += u_brandAccent * mouseInfluence * 0.3 * u_heat;

  // Click eruption: remove crust, show accent
  float eruptionMask = burstInfluence * smoothstep(0.5, 0.0, mouseDist);
  color = mix(color, u_brandAccent * 1.2, eruptionMask);

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
  color += (hashGrain(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
