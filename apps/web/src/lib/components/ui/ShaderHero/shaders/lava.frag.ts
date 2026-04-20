/**
 * Lava fragment shader — Molten Voronoi crust with glowing cracks.
 *
 * Shadertoy-grade polish pass:
 *  - iq-style value noise FBM for crust texture (replaces sin(x)*sin(y)
 *    which produced visible basketweave interference at higher octaves)
 *  - Cracks push emission values > 1.0 so ACES tone-maps them to
 *    incandescent cores (old min(x, 0.75) clipped all hot cracks flat)
 *  - Bloom-adjacent halo around cracks — secondary + accent injection
 *    proportional to luminance^2
 *  - Dual-stop palette for crust: dark basalt (bg-tinted) → primary where
 *    the noise peaks, giving crust depth instead of flat primary*surfaceNoise
 *  - Luminance-aware filmic grain (more in shadow crust, clean in crack glow)
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

// -- Voronoi seed hash --
vec2 hash2(vec2 p) {
  return vec2(
    fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
    fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
  );
}

// -- Grain hash --
float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- iq value noise (replaces sin×sin for crust FBM) --
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3(vec2 p) {
  float f = 0.0;
  f += 0.5000 * valueNoise(p); p = octaveRot * p * 2.02;
  f += 0.2500 * valueNoise(p); p = octaveRot * p * 2.03;
  f += 0.1250 * valueNoise(p);
  return f / 0.875;
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 st = uv * u_crackScale;

  // Mouse influence on cracks
  float mouseDist = distance(uv, u_mouse);
  float mouseInfluence = u_mouseActive * smoothstep(0.4, 0.0, mouseDist);
  float burstInfluence = u_burst;
  float effectiveCrackWidth = u_crackWidth * (1.0 + mouseInfluence * 2.0 + burstInfluence * 4.0);

  // ── Voronoi: nearest point ──────────────────────────────────
  vec2 cellId = floor(st);
  vec2 cellUv = fract(st);

  float minDist = 8.0;
  vec2 nearestSeed = vec2(0.0);
  vec2 nearestCellOff = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 seedBase = hash2(cellId + neighbor);
      vec2 seed = neighbor + 0.5 + 0.4 * sin(t + seedBase * 6.28318530718);
      float d = length(cellUv - seed);
      if (d < minDist) {
        minDist = d;
        nearestSeed = seed;
        nearestCellOff = neighbor;
      }
    }
  }

  // ── Voronoi: nearest edge distance ─────────────────────────
  float edgeDist = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      if (neighbor == nearestCellOff) continue;
      vec2 seedBase = hash2(cellId + neighbor);
      vec2 seed = neighbor + 0.5 + 0.4 * sin(t + seedBase * 6.28318530718);
      vec2 midpoint = 0.5 * (nearestSeed + seed);
      vec2 edgeDir = normalize(seed - nearestSeed);
      float d = abs(dot(cellUv - midpoint, edgeDir));
      edgeDist = min(edgeDist, d);
    }
  }

  // ── Crack glow ─────────────────────────────────────────────
  float crackMask = exp(-edgeDist / effectiveCrackWidth);
  float glowMask = crackMask * u_glow;

  // ── Crust texture: value-noise FBM ─────────────────────────
  vec2 noiseUv = uv * 8.0 + t * 0.3;
  float surfaceNoise = 0.5 + 0.5 * fbm3(noiseUv);

  // ── Crust colour — dark basalt → primary where noise peaks ─
  // Was: primary * (1 - crust*0.7) * surfaceNoise. Now layered:
  // basalt base (bg-tinted) mixed with primary in high-noise regions.
  vec3 basalt = u_bgColor * 0.6;
  vec3 crustColor = mix(basalt, u_brandPrimary * (1.0 - u_crust * 0.5), surfaceNoise);

  // ── Crack colour — secondary → accent by intensity, HDR-scaled ─
  vec3 crackColor = mix(u_brandSecondary, u_brandAccent, crackMask);

  // Combine: crust base + emissive cracks with > 1.0 emission for ACES
  vec3 color = crustColor * (1.0 - crackMask * 0.75);
  color += crackColor * glowMask * u_heat * 2.5;   // > 1.0 drives HDR

  // Mouse hover: add hot halo
  color += u_brandAccent * mouseInfluence * 0.6 * u_heat;

  // Click eruption: strong accent burst
  float eruptionMask = burstInfluence * smoothstep(0.5, 0.0, mouseDist);
  color = mix(color, u_brandAccent * 1.8, eruptionMask);

  // ── Bloom-adjacent halo around cracks ──────────────────────
  float crackLum = crackMask * u_heat;
  color += mix(u_brandSecondary, u_brandAccent, 0.6) * pow(crackLum, 2.2) * 0.5;

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);                     // ACES (replaces min(x, 0.75))
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hashGrain(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
