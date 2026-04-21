/**
 * Pollen (Floating Organic Spore Drift) fragment shader (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 3-stop depth palette replaces per-pixel if/else chain (no
 *    dynamic branching in the hot particle loop)
 *  - ACES filmic tone map replaces min(x, 0.7) clip
 *  - HDR spore-core emission (> 1.0) lets ACES render bright cores as
 *    luminous seeds instead of the flat 0.7-capped dots
 *  - Bloom halo on brightest spore accumulations
 *  - Background gradient now primary-tinted (was flat bg * 0.25..0.4)
 *  - Luminance-aware filmic grain
 */
export const POLLEN_FRAG = `#version 300 es
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
uniform float u_density;
uniform float u_size;
uniform int u_fibres;
uniform float u_drift;
uniform int u_depth;
uniform float u_bokeh;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.2031);
  p3 += dot(p3, p3.yzx + 43.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 curlNoise(vec2 p) {
  float eps = 0.01;
  float n  = noise2d(p);
  float nx = noise2d(p + vec2(eps, 0.0));
  float ny = noise2d(p + vec2(0.0, eps));
  return vec2((ny - n) / eps, -(nx - n) / eps);
}

float sporeSDF(vec2 p, float baseRadius, int fibreCount, float fibreAmp,
               float fibreSeed, float bokehFactor) {
  float dist = length(p);
  float angle = atan(p.y, p.x);
  float fibreR = baseRadius + fibreAmp * sin(angle * float(fibreCount) + fibreSeed);
  float sharpAlpha = smoothstep(fibreR, fibreR * 0.4, dist);
  float coreGlow = exp(-dist * dist / (baseRadius * baseRadius * 0.15 + 0.0001));
  float sharp = sharpAlpha * 0.6 + coreGlow * 0.4;
  float bokehRadius = baseRadius * (1.0 + bokehFactor * 1.5);
  float bokehAlpha = exp(-dist * dist / (bokehRadius * bokehRadius + 0.0001));
  return mix(sharp, bokehAlpha, bokehFactor);
}

// -- Smooth 3-stop depth palette --
vec3 depthPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time * u_drift;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;

  // ── Background: subtle primary-tinted depth gradient ──────────
  vec3 bgTop = u_bgColor * 0.45 + u_brandPrimary * 0.03;
  vec3 bgBot = u_bgColor * 0.25;
  vec3 bgGrad = mix(bgBot, bgTop, v_uv.y);

  vec2 mouseUv = (2.0 * u_mouse - 1.0);
  mouseUv.x *= aspect;

  vec3 colorAccum = vec3(0.0);
  float alphaAccum = 0.0;

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    float depthFrac = float(layer) / max(float(u_depth - 1), 1.0);
    float layerScale = 1.0 - depthFrac * 0.25;
    float layerBright = 1.0 - depthFrac * 0.35;
    float bokehFactor = depthFrac * u_bokeh;
    float layerDriftSpeed = 0.8 + depthFrac * 0.4;

    float parallaxStr = (1.0 - depthFrac) * 0.12;
    vec2 mouseParallax = (u_mouse - 0.5) * parallaxStr;

    float gridSize = floor(6.0 + u_density * 8.0);
    float driftTime = u_time * u_drift * layerDriftSpeed;

    vec2 layerUv = uv * layerScale + mouseParallax;
    vec2 cellId = floor(layerUv * gridSize * 0.5 + 0.5);

    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 cell = cellId + vec2(float(dx), float(dy));
        vec2 cellSeed = cell + vec2(float(layer) * 137.0);

        float cellPresence = hash(cellSeed + vec2(99.0, 77.0));
        if (cellPresence > u_density) continue;

        vec2 basePos = hash2(cellSeed);
        vec2 curlOffset = curlNoise(cell * 0.3 + driftTime * 0.5) * 0.4;

        float wanderPhase = hash(cellSeed + vec2(42.0)) * 6.2831;
        vec2 wander = vec2(
          sin(driftTime * 0.7 + wanderPhase) * 0.15,
          cos(driftTime * 0.5 + wanderPhase * 1.3) * 0.15
        );

        vec2 sporePos = (cell + basePos + curlOffset + wander) / (gridSize * 0.5);

        vec2 toMouse = sporePos - mouseUv / layerScale;
        float mouseDist = length(toMouse);
        float avoidRadius = 0.35;
        float avoidStrength = smoothstep(avoidRadius, 0.0, mouseDist) * 0.15 * (1.0 - depthFrac * 0.5);
        vec2 avoidOffset = normalize(toMouse + vec2(0.001)) * avoidStrength;
        sporePos += avoidOffset;

        if (u_burstStrength > 0.01) {
          float burstPush = u_burstStrength * smoothstep(0.5, 0.0, mouseDist) * 0.3;
          sporePos += normalize(toMouse + vec2(0.001)) * burstPush;
        }

        vec2 delta = layerUv - sporePos;
        float dist = length(delta);

        float maxRadius = 0.12 * u_size * (1.0 + bokehFactor * 1.5);
        if (dist > maxRadius * 2.5) continue;

        float baseRadius = 0.04 * u_size * layerScale;
        float fibreAmp = baseRadius * 0.35;
        float fibreSeed = hash(cellSeed + vec2(13.0, 7.0)) * 6.2831;

        float sporeAlpha = sporeSDF(delta, baseRadius, u_fibres, fibreAmp,
                                     fibreSeed, bokehFactor);

        // Smooth palette by depth — branchless
        vec3 sporeColor = depthPalette(depthFrac);
        // Colour temperature shift per layer
        sporeColor *= vec3(1.0 - depthFrac * 0.05, 1.0, 1.0 + depthFrac * 0.08);
        sporeColor *= layerBright;

        // HDR emission on core so ACES renders luminous seed cores
        colorAccum += sporeColor * sporeAlpha * 1.1;
        alphaAccum += sporeAlpha * 0.3;
      }
    }
  }

  if (u_burstStrength > 0.01) {
    float burstDist = length(uv - mouseUv);
    float burst = u_burstStrength * exp(-burstDist * burstDist * 6.0);
    colorAccum += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.8;
  }

  vec3 color = bgGrad + colorAccum;

  // Bloom halo on brightest accumulations
  float accumLum = dot(colorAccum, vec3(0.299, 0.587, 0.114));
  color += pow(accumLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);
  color = mix(bgGrad, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
