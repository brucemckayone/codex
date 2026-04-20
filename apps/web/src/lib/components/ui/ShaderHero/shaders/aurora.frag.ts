/**
 * Aurora Borealis fragment shader (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - Curtains distributed across distinct y-heights (0.28 → 0.68) for real
 *    vertical parallax instead of stacking on one horizontal strip
 *  - Vertical flame shimmer inside each band (aurora's true visual signature)
 *  - Smooth 3-stop brand palette interpolation (no per-pixel branching)
 *  - ACES filmic tone map (replaces min(x, 0.75) clip)
 *  - Bloom-adjacent highlight boost on brightest curtain streaks
 *  - Stars with variable size + tinted twinkle (primary vs accent)
 *  - Sky gradient: deep bg at top, slightly primary-lifted near horizon
 *  - Luminance-aware film grain (filmic)
 */
export const AURORA_FRAG = `#version 300 es
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
uniform int u_layers;
uniform float u_speed;
uniform float u_height;
uniform float u_spread;
uniform float u_shimmer;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Grain + star hash --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- triNoise (nimitz-inspired organic noise) --
float triNoise(vec2 p, float t) {
  float z = 1.5;
  float rz = 0.0;
  const mat2 triRot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    float val = abs(sin(p.x * z + t) + sin(p.y * z + t));
    rz += val / z;
    p = triRot * p * 1.45;
    z *= 2.0;
    t *= 1.3;
  }
  return rz;
}

// -- Smooth 3-stop palette: primary → secondary → accent --
vec3 auroraPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  // Use smoothstep weights instead of branching
  float w0 = smoothstep(0.6, 0.0, t);          // primary weight (peaks at t=0)
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0); // secondary peak at t=0.5
  float w2 = smoothstep(0.4, 1.0, t);          // accent weight (peaks at t=1)
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_time;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Mouse interaction: y-offset shifts bands, x shifts phase
  float mouseYOffset = u_mouseActive * (u_mouse.y - 0.5) * 0.15;
  float phaseShift = u_mouseActive * (u_mouse.x - 0.5) * 1.5;

  // ── Sky gradient (bg at top, gently warmer near horizon) ──────
  float skyGrad = smoothstep(0.0, 0.8, uv.y);
  vec3 color = mix(
    u_bgColor,                                      // horizon-ish: base bg
    u_bgColor * 0.55 + u_brandPrimary * 0.02,       // top of sky: deeper with hint of primary
    skyGrad
  );

  // ── Stars (tinted, variable size, stable twinkle) ─────────────
  float starDensity = 280.0;
  vec2 starUV = floor(p * starDensity);
  float starHash = hash(starUV);
  float starThresh = 0.996;
  if (starHash > starThresh) {
    // Size variation: brighter threshold = bigger/brighter star
    float sizeBoost = smoothstep(starThresh, 1.0, starHash);
    float twinkle = 0.5 + 0.5 * sin(t * 1.7 + starHash * 12.57);
    float starHue = fract(starHash * 71.3); // stable per-star hue
    vec3 starColor = mix(vec3(1.0), mix(u_brandPrimary, u_brandAccent, starHue), 0.4);
    color += starColor * sizeBoost * twinkle * 0.22;
  }

  // ── Aurora curtains: distributed across y-heights ─────────────
  // Band heights: evenly spaced across 0.28..0.68 with per-layer jitter
  // so bands sit at distinct elevations instead of stacking.
  vec3 auroraAccum = vec3(0.0);
  int maxLayers = u_layers;

  for (int i = 0; i < 7; i++) {
    if (i >= maxLayers) break;

    float layerF = float(i);
    float layerT = float(i) / max(float(u_layers - 1), 1.0);

    // Distribute band centres around u_height with per-layer vertical offsets.
    // Layers fan out ±0.18 from u_height so they stack with parallax instead of
    // collapsing onto one strip (the old behaviour).
    float bandCentre = u_height + (layerT - 0.5) * 0.36 + mouseYOffset;
    // Narrower spread per layer for crisper curtains
    float bandSpread = u_spread * (0.85 + 0.25 * sin(layerF * 1.7));

    // Horizontal curtain wave: sin + triNoise wobble + slow drift
    float freq = 1.2 + layerF * 0.45;
    float phase = layerF * 2.399;
    float speedMul = 0.65 + layerF * 0.12;
    float drift = (t + phaseShift) * speedMul * u_speed;
    float horizWave = sin(p.x * freq + drift + phase);
    float wobble = triNoise(vec2(p.x * 0.5, t * 0.3 + layerF), t) * 0.35;
    float disp = horizWave + wobble;

    // Vertical flame shimmer inside the band (aurora's signature shiver)
    float flameScale = 6.0 + layerF * 2.0;
    float flameNoise = triNoise(vec2(p.x * 1.5, uv.y * flameScale + t * 1.4), t * 0.8);
    float flame = smoothstep(0.4, 1.4, flameNoise) * 0.5;

    // Vertical Gaussian envelope
    float dy = (uv.y - bandCentre) / bandSpread;
    float env = exp(-dy * dy);

    // Bottom-edge shimmer — aurora often dissolves downward into sparkle
    float bottomEdge = smoothstep(bandCentre - bandSpread, bandCentre - bandSpread * 0.4, uv.y);
    float shimmerNoise = triNoise(uv * 10.0 + vec2(t * 2.0, layerF), t * 3.0);
    float shimmerVal = (1.0 - bottomEdge) * shimmerNoise * u_shimmer * env;

    // Combine: band brightness. Lower base (sharper curtains) + stronger wave +
    // visible flame. Tuned so 5 layers accumulate to a clearly visible aurora
    // without washing out shadows.
    float c = env * (0.15 + 0.85 * abs(disp) * 0.6 + flame * 0.55) + shimmerVal;

    // Burst brightening on click
    c += u_burst * 0.3 * exp(-pow((uv.y - u_height) / (bandSpread + u_burst * 0.1), 2.0));

    // Smooth palette lookup — each layer pulls a specific palette position.
    // Fixed per-layer weight (not normalized): more layers = brighter, and
    // ACES handles the dynamic range gracefully at the tone-map step.
    vec3 layerColor = auroraPalette(layerT);
    auroraAccum += layerColor * c * 0.22;
  }

  color += auroraAccum;

  // ── Bloom-adjacent highlight boost — brightest streaks get accent injection ──
  float auroraLum = dot(auroraAccum, vec3(0.299, 0.587, 0.114));
  color += pow(auroraLum, 2.2) * u_brandAccent * 0.45;

  // ── Post-process ────────────────────────────────────────────
  // ACES tone map (replaces old min(x, 0.75) clip — keeps HDR alive)
  color = aces(color);

  // Final intensity blend
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Luminance-aware grain
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
