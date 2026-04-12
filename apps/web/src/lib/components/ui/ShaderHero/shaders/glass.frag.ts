/**
 * Glass fragment shader — Animated Voronoi stained glass.
 *
 * Technique: Voronoi tessellation with thick dark leading between cells.
 * Each cell coloured by hash(cellIntCoords) mod 3 → primary/secondary/accent.
 * Drifting seeds via sin/cos animation. Mouse adds a temporary Voronoi seed
 * that fractures nearby cells. Click injects 3-5 burst seeds.
 * Light shift per cell: sin(time + cellId). Edge glow on leading.
 *
 * Single-pass fragment shader. No FBOs needed.
 * Post-processing: Reinhard tone map (0.75 cap), vignette, film grain.
 */
export const GLASS_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;          // normalized 0-1, direct (no lerp)
uniform float u_mouseActive;   // 1.0 = active, 0.0 = inactive
uniform float u_burst;         // click burst strength, decays
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

// -- Hash functions --
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

// -- Film grain --
float grainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float t = u_time;

  // Aspect-corrected UV in cell-space
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect * u_cellSize;

  // Mouse position in cell-space
  vec2 mouseCell = u_mouse * aspect * u_cellSize;

  // Voronoi — track first and second nearest distances + cell ID
  float minDist = 1e9;
  float secondMinDist = 1e9;
  vec2 nearestCell = vec2(0.0);
  float nearestId = 0.0;

  // Search 5x5 neighbourhood for better coverage at large drift
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 cellBase = floor(uv) + vec2(float(x), float(y));
      vec2 cellHash = hash22(cellBase);

      // Drifting seed position
      vec2 seed = cellBase + 0.5 + u_drift * vec2(
        sin(t * 0.4 + cellHash.x * 6.2831),
        cos(t * 0.35 + cellHash.y * 6.2831)
      );

      float d = distance(uv, seed);
      if (d < minDist) {
        secondMinDist = minDist;
        minDist = d;
        nearestCell = cellBase;
        nearestId = hash21(cellBase);
      } else if (d < secondMinDist) {
        secondMinDist = d;
      }
    }
  }

  // Mouse seed — adds temporary fracture point
  if (u_mouseActive > 0.5) {
    float mouseDist = distance(uv, mouseCell);
    if (mouseDist < minDist) {
      secondMinDist = minDist;
      minDist = mouseDist;
      // Use a special ID for mouse cell
      nearestCell = floor(mouseCell);
      nearestId = 0.777;
    } else if (mouseDist < secondMinDist) {
      secondMinDist = mouseDist;
    }
  }

  // Burst seeds — 3-5 extra Voronoi points around mouse on click
  if (u_burst > 0.01 && u_mouseActive > 0.5) {
    for (int i = 0; i < 5; i++) {
      float angle = float(i) * 1.2566 + t * 0.5; // 2*PI/5 spacing
      float radius = 0.3 + 0.2 * sin(float(i) * 2.1 + t);
      vec2 burstSeed = mouseCell + radius * u_burst * vec2(cos(angle), sin(angle));

      float bd = distance(uv, burstSeed);
      if (bd < minDist) {
        secondMinDist = minDist;
        minDist = bd;
        nearestCell = floor(burstSeed) + vec2(float(i) * 100.0);
        nearestId = hash21(nearestCell);
      } else if (bd < secondMinDist) {
        secondMinDist = bd;
      }
    }
  }

  // Edge distance for leading (border)
  float edge = secondMinDist - minDist;

  // Cell color — hash(cellIntCoords) mod 3 picks brand color
  int colorIdx = int(floor(nearestId * 3.0));
  vec3 cellColor;
  if (colorIdx == 0) {
    cellColor = u_brandPrimary;
  } else if (colorIdx == 1) {
    cellColor = u_brandSecondary;
  } else {
    cellColor = u_brandAccent;
  }

  // Per-cell light variation
  float cellLight = 0.7 + u_light * 0.3 * sin(t * 0.8 + nearestId * 6.2831);
  cellColor *= cellLight;

  // Stained glass translucency — darken slightly at center, brighten at edges
  float centerFade = smoothstep(0.0, 0.5, minDist);
  cellColor *= 0.85 + 0.15 * centerFade;

  // Leading (dark border between cells)
  float borderMask = smoothstep(u_border * 0.5, u_border, edge);
  vec3 leadColor = u_bgColor * 0.15; // Very dark leading

  // Edge glow — bright edge on the leading
  float edgeGlow = (1.0 - borderMask) * u_glow * smoothstep(0.0, u_border * 0.5, edge);
  vec3 glowColor = mix(cellColor, vec3(1.0), 0.3) * edgeGlow;

  // Combine: cell color where no border, leading where border
  vec3 color = mix(leadColor + glowColor, cellColor, borderMask);

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
  color += (grainHash(gl_FragCoord.xy + fract(t * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
