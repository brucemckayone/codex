/**
 * Glow (Bioluminescent Deep Sea) fragment shader (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - HDR organism emission (> 1.0) before tone map — ACES renders cores as
 *    glowing white-hot pinpoints rather than flat coloured dots; old cap
 *    at 0.65 made every organism look identical in brightness
 *  - Bloom halo around organism cores via pow(dist-falloff, 0.6) extra
 *    layer — gives each creature the classic "luminous fog" look
 *  - Deep-sea background gradient (primary-tinted at centre, near-black
 *    edges) replaces flat bg * 0.15
 *  - Trail brightness boosted + palette-aware tint (not a flat 0.3 mul)
 *  - Luminance-aware filmic grain — more shadow texture, clean cores
 */
export const GLOW_FRAG = `#version 300 es
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
uniform int u_count;
uniform float u_pulse;
uniform float u_size;
uniform float u_drift;
uniform float u_trail;
uniform int u_depth;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // ── Deep-sea gradient (was flat bg * 0.15) ────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgDark = mix(
    u_bgColor * 0.22 + u_brandPrimary * 0.025,  // centre: slight warm lift
    u_bgColor * 0.08,                             // edges: near-black
    smoothstep(0.0, 1.5, r2)
  );

  vec3 brandColors[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);

  vec3 glowAccum = vec3(0.0);
  float gridSize = float(u_count);

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    float layerFrac = (u_depth > 1) ? float(layer) / float(u_depth - 1) : 0.0;
    float layerScale = 1.0 - layerFrac * 0.3;
    float layerBright = 1.0 - layerFrac * 0.4;

    float parallaxStr = (1.0 - layerFrac) * 0.15;
    vec2 mouseOffset = (u_mouse - 0.5) * parallaxStr;

    vec2 layerUv = uv * layerScale + mouseOffset;
    float driftTime = u_time * u_drift * (0.8 + layerFrac * 0.4);

    vec2 scaledUv = (layerUv * 0.5 + 0.5) * gridSize;
    vec2 cellId = floor(scaledUv);

    for (int ox = -1; ox <= 1; ox++) {
      for (int oy = -1; oy <= 1; oy++) {
        vec2 cell = cellId + vec2(float(ox), float(oy));
        vec2 cellSeed = cell + vec2(float(layer) * 100.0);

        vec2 basePos = hash2(cellSeed);
        float driftPhase = hash(cellSeed + vec2(99.0)) * 6.28;
        vec2 driftOffset = vec2(
          sin(driftTime + driftPhase) * 0.3,
          cos(driftTime * 0.7 + driftPhase) * 0.3
        );

        vec2 orgGridPos = (cell + basePos + driftOffset) / gridSize;
        vec2 orgUv = orgGridPos * 2.0 - 1.0;

        float dist = length(layerUv - orgUv);

        float pulsePhase = hash(cellSeed + vec2(42.0)) * 6.28;
        float pulseFactor = sin(u_time * u_pulse + pulsePhase) * 0.3 + 0.7;
        float radius = 0.04 * u_size * pulseFactor * layerScale;

        // Core: sharp exponential falloff
        float core = exp(-dist * dist / (radius * radius + 0.0001));
        // Halo: softer, wider falloff for bloom-like surround
        float halo = exp(-dist * dist / (radius * radius * 6.0 + 0.0001)) * 0.45;
        float glow = core + halo;

        // Trail — palette-tinted, slightly brighter than before
        if (u_trail > 0.0) {
          vec2 velocity = vec2(
            cos(driftTime + driftPhase) * 0.3,
            -sin(driftTime * 0.7 + driftPhase) * 0.3 * 0.7
          ) / gridSize * 2.0;
          vec2 trailPos = orgUv - velocity * u_trail * 2.0;
          float trailDist = length(layerUv - trailPos);
          float trailRadius = radius * 1.8;
          float trailGlow = exp(-trailDist * trailDist / (trailRadius * trailRadius + 0.0001));
          glow += trailGlow * 0.45 * u_trail;
        }

        int colorIdx = int(floor(hash(cellSeed + vec2(7.0)) * 3.0));
        colorIdx = clamp(colorIdx, 0, 2);
        // HDR emission: multiply by 1.7 so cores tone-map to near-white hotspots
        vec3 orgColor = brandColors[colorIdx] * layerBright * 1.7;

        if (u_burstStrength > 0.01) {
          vec2 burstUv = (u_mouse * 2.0 - 1.0);
          burstUv.x *= aspect;
          float burstDist = length(orgUv - burstUv);
          float flash = u_burstStrength * exp(-burstDist * burstDist * 4.0);
          orgColor += vec3(flash * 0.8);
        }

        glowAccum += orgColor * glow;
      }
    }
  }

  vec3 color = bgDark + glowAccum;

  // Bloom boost on brightest organism cores
  float coreLum = dot(glowAccum, vec3(0.299, 0.587, 0.114));
  color += pow(coreLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.35;

  // ── Post-process ─────────────────────────────────────────────
  color = aces(color);
  color = mix(bgDark, color, u_intensity);

  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
