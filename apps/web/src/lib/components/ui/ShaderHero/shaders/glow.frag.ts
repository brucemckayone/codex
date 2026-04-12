/**
 * Glow (Bioluminescent Deep Sea) fragment shader (GLSL ES 3.0).
 *
 * Single-pass: hash-based tiled organisms across depth layers.
 * Each organism pulses, drifts, and glows with a hash-selected brand colour.
 * Fading light trails follow organisms. Mouse gently attracts nearby organisms.
 * Click creates a bright flash. Performance: tiled hash grid (9 neighbours per layer).
 *
 * Uniforms:
 *   u_time           — elapsed seconds
 *   u_resolution     — canvas pixel dimensions
 *   u_mouse          — normalized mouse (0-1), lerped
 *   u_burstStrength  — click burst intensity (decays)
 *   u_brandPrimary   — brand primary colour
 *   u_brandSecondary — brand secondary colour
 *   u_brandAccent    — brand accent colour
 *   u_bgColor        — background colour
 *   u_count          — organisms per layer (int, 5-20)
 *   u_pulse          — pulse speed
 *   u_size           — organism size multiplier
 *   u_drift          — drift speed
 *   u_trail          — trail length/opacity
 *   u_depth          — depth layers (int, 2-4)
 *   u_intensity      — overall blend
 *   u_grain          — film grain
 *   u_vignette       — vignette strength
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

// -- Cell hashing --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

// -- Film grain hash (different seed to avoid correlation) --
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Aspect-correct UVs
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Deep ocean background
  vec3 bgDark = u_bgColor * 0.15;

  // Brand colours array for per-organism selection
  vec3 brandColors[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);

  // Accumulate glow from all organisms across all layers
  vec3 glowAccum = vec3(0.0);

  float gridSize = float(u_count);

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    // Layer properties: deeper layers dimmer, slower, less parallax
    float layerFrac = (u_depth > 1) ? float(layer) / float(u_depth - 1) : 0.0;
    float layerScale = 1.0 - layerFrac * 0.3;
    float layerBright = 1.0 - layerFrac * 0.4;

    // Mouse parallax: nearer layers move more
    float parallaxStr = (1.0 - layerFrac) * 0.15;
    vec2 mouseOffset = (u_mouse - 0.5) * parallaxStr;

    // Effective UV for this layer
    vec2 layerUv = uv * layerScale + mouseOffset;

    // Slow drift over time per layer
    float driftTime = u_time * u_drift * (0.8 + layerFrac * 0.4);

    // Tiled hash grid: find which cell this pixel belongs to
    vec2 scaledUv = (layerUv * 0.5 + 0.5) * gridSize; // map from [-1,1] to grid
    vec2 cellId = floor(scaledUv);

    // Check 9 neighbour cells (3x3)
    for (int ox = -1; ox <= 1; ox++) {
      for (int oy = -1; oy <= 1; oy++) {
        vec2 cell = cellId + vec2(float(ox), float(oy));
        vec2 cellSeed = cell + vec2(float(layer) * 100.0);

        // Random base position within cell (0-1)
        vec2 basePos = hash2(cellSeed);

        // Drift: slow sinusoidal wander
        float driftPhase = hash(cellSeed + vec2(99.0)) * 6.28;
        vec2 driftOffset = vec2(
          sin(driftTime + driftPhase) * 0.3,
          cos(driftTime * 0.7 + driftPhase) * 0.3
        );

        // Organism world position in layerUv space
        vec2 orgGridPos = (cell + basePos + driftOffset) / gridSize;
        vec2 orgUv = orgGridPos * 2.0 - 1.0;

        // Distance from pixel to organism
        float dist = length(layerUv - orgUv);

        // Pulsing radius
        float pulsePhase = hash(cellSeed + vec2(42.0)) * 6.28;
        float pulseFactor = sin(u_time * u_pulse + pulsePhase) * 0.3 + 0.7;
        float radius = 0.04 * u_size * pulseFactor * layerScale;

        // Soft exponential glow body
        float glow = exp(-dist * dist / (radius * radius + 0.0001));

        // Trail: sample "past position"
        if (u_trail > 0.0) {
          vec2 velocity = vec2(
            cos(driftTime + driftPhase) * 0.3,
            -sin(driftTime * 0.7 + driftPhase) * 0.3 * 0.7
          ) / gridSize * 2.0;
          vec2 trailPos = orgUv - velocity * u_trail * 2.0;
          float trailDist = length(layerUv - trailPos);
          float trailRadius = radius * 1.5;
          float trailGlow = exp(-trailDist * trailDist / (trailRadius * trailRadius + 0.0001));
          glow += trailGlow * 0.3 * u_trail;
        }

        // Colour: hash-selected brand colour
        int colorIdx = int(floor(hash(cellSeed + vec2(7.0)) * 3.0));
        colorIdx = clamp(colorIdx, 0, 2);
        vec3 orgColor = brandColors[colorIdx] * layerBright;

        // Click burst: bright flash near click point
        if (u_burstStrength > 0.01) {
          vec2 burstUv = (u_mouse * 2.0 - 1.0);
          burstUv.x *= aspect;
          float burstDist = length(orgUv - burstUv);
          float flash = u_burstStrength * exp(-burstDist * burstDist * 4.0);
          orgColor += vec3(flash * 0.5);
        }

        glowAccum += orgColor * glow;
      }
    }
  }

  // Composite: dark bg + accumulated glow
  vec3 color = bgDark + glowAccum;

  // -- Post-processing --

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness (lower for dark scene)
  color = min(color, vec3(0.65));

  // Intensity blend with background
  color = mix(bgDark, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.65), 1.0);
}
`;
