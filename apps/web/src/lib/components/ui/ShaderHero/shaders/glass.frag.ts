/**
 * Glass fragment shader — Animated Voronoi stained glass.
 *
 * Shadertoy-grade polish pass:
 *  - Array-indexed palette (no if/else branching per pixel per neighbour)
 *  - Subtle per-cell luminance variation weighted by accent mix (each cell
 *    gets a touch of warm/cool shift beyond its base palette pick) — feels
 *    like real stained glass rather than three flat colour swatches
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR edge-glow emission (> 1.0) so ACES tone-maps it to luminous leading
 *  - Chromatic-fringe tint on glow: warm at one edge → cool at other via
 *    sign of gradient direction — fakes light refraction through glass
 *  - Bloom-adjacent halo on the brightest cell centres
 *  - Luminance-aware filmic grain
 */
export const GLASS_FRAG = `#version 300 es
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
uniform float u_cellSize;
uniform float u_border;
uniform float u_drift;
uniform float u_glow;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
}

float grainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect * u_cellSize;
  vec2 mouseCell = u_mouse * aspect * u_cellSize;

  // ── Voronoi: nearest + second-nearest, 5x5 neighbourhood ──────
  float minDist = 1e9;
  float secondMinDist = 1e9;
  vec2 nearestCell = vec2(0.0);
  float nearestId = 0.0;
  vec2 nearestSeed = vec2(0.0);

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 cellBase = floor(uv) + vec2(float(x), float(y));
      vec2 cellHash = hash22(cellBase);
      vec2 seed = cellBase + 0.5 + u_drift * vec2(
        sin(t * 0.4 + cellHash.x * 6.2831),
        cos(t * 0.35 + cellHash.y * 6.2831)
      );
      float d = distance(uv, seed);
      if (d < minDist) {
        secondMinDist = minDist;
        minDist = d;
        nearestCell = cellBase;
        nearestSeed = seed;
        nearestId = hash21(cellBase);
      } else if (d < secondMinDist) {
        secondMinDist = d;
      }
    }
  }

  // Mouse seed — temporary fracture
  if (u_mouseActive > 0.5) {
    float mouseDist = distance(uv, mouseCell);
    if (mouseDist < minDist) {
      secondMinDist = minDist;
      minDist = mouseDist;
      nearestCell = floor(mouseCell);
      nearestSeed = mouseCell;
      nearestId = 0.777;
    } else if (mouseDist < secondMinDist) {
      secondMinDist = mouseDist;
    }
  }

  // Burst seeds
  if (u_burst > 0.01 && u_mouseActive > 0.5) {
    for (int i = 0; i < 5; i++) {
      float angle = float(i) * 1.2566 + t * 0.5;
      float radius = 0.3 + 0.2 * sin(float(i) * 2.1 + t);
      vec2 burstSeed = mouseCell + radius * u_burst * vec2(cos(angle), sin(angle));
      float bd = distance(uv, burstSeed);
      if (bd < minDist) {
        secondMinDist = minDist;
        minDist = bd;
        nearestCell = floor(burstSeed) + vec2(float(i) * 100.0);
        nearestSeed = burstSeed;
        nearestId = hash21(nearestCell);
      } else if (bd < secondMinDist) {
        secondMinDist = bd;
      }
    }
  }

  float edge = secondMinDist - minDist;

  // ── Cell colour via array lookup (no if/else branch) ─────────
  vec3 palette[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);
  int colorIdx = int(floor(nearestId * 3.0));
  colorIdx = clamp(colorIdx, 0, 2);
  vec3 cellColor = palette[colorIdx];

  // Per-cell luminance variation + subtle warm/cool shift (stained-glass feel)
  float cellLight = 0.7 + u_light * 0.35 * sin(t * 0.8 + nearestId * 6.2831);
  float tintHash = hash21(nearestCell + vec2(17.3));
  vec3 tintedColor = mix(cellColor, mix(cellColor, u_brandAccent, 0.5), tintHash * 0.25);
  cellColor = tintedColor * cellLight;

  // Centre-fade translucency
  float centerFade = smoothstep(0.0, 0.5, minDist);
  cellColor *= 0.85 + 0.15 * centerFade;

  // ── Leading (dark border) ───────────────────────────────────
  float borderMask = smoothstep(u_border * 0.5, u_border, edge);
  vec3 leadColor = u_bgColor * 0.18;

  // ── Edge glow (HDR-scaled so ACES turns it luminous) ────────
  float edgeGlow = (1.0 - borderMask) * u_glow * smoothstep(0.0, u_border * 0.5, edge);
  // Chromatic-ish fringe: glow colour leans toward accent on one side of the seed
  vec2 edgeDir = normalize(uv - nearestSeed + vec2(0.0001));
  float fringeShift = 0.5 + 0.5 * edgeDir.x;
  vec3 glowTint = mix(
    mix(cellColor, u_brandPrimary, 0.4),
    mix(cellColor, u_brandAccent,  0.4),
    fringeShift
  );
  vec3 glowColor = mix(glowTint, vec3(1.0), 0.25) * edgeGlow * 1.8;

  vec3 color = mix(leadColor + glowColor, cellColor, borderMask);

  // ── Bloom halo on brightest cell centres ────────────────────
  float cellLum = dot(cellColor, vec3(0.299, 0.587, 0.114)) * (1.0 - smoothstep(0.0, 0.35, minDist));
  color += mix(u_brandSecondary, u_brandAccent, 0.5) * pow(cellLum, 2.5) * 0.4;

  // ── Post-process ────────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (grainHash(gl_FragCoord.xy + fract(t * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
