/**
 * Pollen (Floating Organic Spore Drift) fragment shader (GLSL ES 3.0).
 *
 * Single-pass: organic SDF particles with radial fibres, depth layers with bokeh.
 * Tiled hash grid for performance. Curl noise drift. Mouse avoidance (push away).
 * Near particles are sharp with visible fibre structure; far particles are soft bokeh discs.
 * Lerped mouse input for smooth breath avoidance.
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

// ---- Hash functions ----
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

// Film grain hash (different seed)
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.2031);
  p3 += dot(p3, p3.yzx + 43.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ---- Curl noise for drift displacement ----
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

// ---- Spore SDF: radial fibres via polar modulation ----
float sporeSDF(vec2 p, float baseRadius, int fibreCount, float fibreAmp,
               float fibreSeed, float bokehFactor) {
  float dist = length(p);
  float angle = atan(p.y, p.x);

  float fibreR = baseRadius + fibreAmp * sin(angle * float(fibreCount) + fibreSeed);

  // Sharp spore: structured falloff with visible fibre edges
  float sharpAlpha = smoothstep(fibreR, fibreR * 0.4, dist);

  // Inner core glow
  float coreGlow = exp(-dist * dist / (baseRadius * baseRadius * 0.15 + 0.0001));

  float sharp = sharpAlpha * 0.6 + coreGlow * 0.4;

  // Bokeh: soft Gaussian disc
  float bokehRadius = baseRadius * (1.0 + bokehFactor * 1.5);
  float bokehAlpha = exp(-dist * dist / (bokehRadius * bokehRadius + 0.0001));

  return mix(sharp, bokehAlpha, bokehFactor);
}

void main() {
  float t = u_time * u_drift;

  // --- Aspect-correct UVs ---
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;

  // --- Background: subtle depth gradient ---
  vec3 bgTop = u_bgColor * 0.4;
  vec3 bgBot = u_bgColor * 0.25;
  vec3 bgGrad = mix(bgBot, bgTop, v_uv.y);

  // --- Mouse avoidance position (in aspect-correct UV space) ---
  vec2 mouseUv = (2.0 * u_mouse - 1.0);
  mouseUv.x *= aspect;

  // --- Accumulate particle contributions across all layers ---
  vec3 colorAccum = vec3(0.0);
  float alphaAccum = 0.0;

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    float depthFrac = float(layer) / max(float(u_depth - 1), 1.0);

    float layerScale = 1.0 - depthFrac * 0.25;
    float layerBright = 1.0 - depthFrac * 0.35;
    float bokehFactor = depthFrac * u_bokeh;
    float layerDriftSpeed = 0.8 + depthFrac * 0.4;

    // Mouse parallax
    float parallaxStr = (1.0 - depthFrac) * 0.12;
    vec2 mouseParallax = (u_mouse - 0.5) * parallaxStr;

    // Grid density
    float gridSize = floor(6.0 + u_density * 8.0);
    float driftTime = u_time * u_drift * layerDriftSpeed;

    // Effective UV for this layer
    vec2 layerUv = uv * layerScale + mouseParallax;

    // Tiled hash grid
    vec2 cellId = floor(layerUv * gridSize * 0.5 + 0.5);

    // Check 3x3 neighbourhood
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 cell = cellId + vec2(float(dx), float(dy));
        vec2 cellSeed = cell + vec2(float(layer) * 137.0);

        float cellPresence = hash(cellSeed + vec2(99.0, 77.0));
        if (cellPresence > u_density) continue;

        vec2 basePos = hash2(cellSeed);

        // Curl noise drift displacement
        vec2 curlOffset = curlNoise(cell * 0.3 + driftTime * 0.5) * 0.4;

        // Sinusoidal gentle wander
        float wanderPhase = hash(cellSeed + vec2(42.0)) * 6.2831;
        vec2 wander = vec2(
          sin(driftTime * 0.7 + wanderPhase) * 0.15,
          cos(driftTime * 0.5 + wanderPhase * 1.3) * 0.15
        );

        // Spore world position in layer UV space
        vec2 sporePos = (cell + basePos + curlOffset + wander) / (gridSize * 0.5);

        // Mouse avoidance
        vec2 toMouse = sporePos - mouseUv / layerScale;
        float mouseDist = length(toMouse);
        float avoidRadius = 0.35;
        float avoidStrength = smoothstep(avoidRadius, 0.0, mouseDist) * 0.15 * (1.0 - depthFrac * 0.5);
        vec2 avoidOffset = normalize(toMouse + vec2(0.001)) * avoidStrength;
        sporePos += avoidOffset;

        // Click burst: stronger push away
        if (u_burstStrength > 0.01) {
          float burstPush = u_burstStrength * smoothstep(0.5, 0.0, mouseDist) * 0.3;
          sporePos += normalize(toMouse + vec2(0.001)) * burstPush;
        }

        // Distance from pixel to spore centre
        vec2 delta = layerUv - sporePos;
        float dist = length(delta);

        // Early out
        float maxRadius = 0.12 * u_size * (1.0 + bokehFactor * 1.5);
        if (dist > maxRadius * 2.5) continue;

        // Spore rendering parameters
        float baseRadius = 0.04 * u_size * layerScale;
        float fibreAmp = baseRadius * 0.35;
        float fibreSeed = hash(cellSeed + vec2(13.0, 7.0)) * 6.2831;

        // Compute spore alpha via SDF
        float sporeAlpha = sporeSDF(delta, baseRadius, u_fibres, fibreAmp,
                                     fibreSeed, bokehFactor);

        // Colour by depth layer
        vec3 sporeColor;
        if (depthFrac < 0.4) {
          float fibreMix = smoothstep(baseRadius * 0.5, baseRadius, dist);
          sporeColor = mix(u_brandPrimary, u_brandSecondary, fibreMix * 0.6);
        } else if (depthFrac < 0.7) {
          sporeColor = mix(u_brandSecondary, u_brandPrimary, 0.2);
        } else {
          sporeColor = mix(u_brandSecondary, u_brandAccent, 0.5);
        }

        // Colour temperature shift per layer
        sporeColor *= vec3(1.0 - depthFrac * 0.05, 1.0, 1.0 + depthFrac * 0.08);

        sporeColor *= layerBright;

        // Additive blending
        colorAccum += sporeColor * sporeAlpha * 0.7;
        alphaAccum += sporeAlpha * 0.3;
      }
    }
  }

  // --- Click burst: bright flash at cursor position ---
  if (u_burstStrength > 0.01) {
    float burstDist = length(uv - mouseUv);
    float burst = u_burstStrength * exp(-burstDist * burstDist * 6.0);
    colorAccum += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.5;
  }

  // --- Composite ---
  vec3 color = bgGrad + colorAccum;

  // --- Post-processing ---
  color = color / (1.0 + color);
  color = min(color, vec3(0.7));
  color = mix(bgGrad, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
