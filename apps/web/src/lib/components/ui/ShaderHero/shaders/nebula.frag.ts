/**
 * Nebula fragment shader — Single-pass raymarched volumetric cosmic dust.
 *
 * Shadertoy-grade polish pass:
 *  - iq value noise replaces sin(x)*sin(y) — no more checkerboard artefacts
 *    at higher FBM octaves; produces organic cloud shapes
 *  - Smooth 3-stop palette interpolation (primary → secondary → accent)
 *    with smoothstep weights; no per-pixel branching
 *  - ACES filmic tone map replaces the old min(x, 0.7) clip — HDR cloud
 *    cores roll off instead of flattening
 *  - Bloom-adjacent highlight boost on bright cloud cores
 *  - Radial cosmic-space background gradient (was flat u_bgColor * 0.3)
 *  - Luminance-aware film grain (filmic)
 *
 * Front-to-back volumetric compositing unchanged — that's the good part
 * of the original and doesn't need fixing.
 */
export const NEBULA_FRAG = `#version 300 es
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
uniform float u_speed;
uniform float u_scale;
uniform int u_depth;
uniform float u_wind;
uniform float u_stars;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- iq-style value noise --
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// -- Hash for grain + star field --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- FBM: 3 octaves with inter-octave rotation --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3(vec2 p) {
  float f = 0.0;
  f += 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p); p = octaveRot * p * 2.03;
  f += 0.125 * noise(p);
  return f / 0.875;
}

// -- Smooth 3-stop palette --
vec3 nebulaPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Star field: grid-based random stars with twinkle --
float starField(vec2 uv, float starDensity, float time) {
  if (starDensity <= 0.0) return 0.0;
  float stars = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float scale = 30.0 + float(layer) * 20.0;
    vec2 cell = floor(uv * scale);
    vec2 frac = fract(uv * scale);
    vec2 starPos = vec2(hash(cell), hash(cell + vec2(127.1, 311.7)));
    float d = length(frac - starPos);
    float threshold = 1.0 - starDensity * 0.3;
    float starBright = hash(cell + vec2(42.0, 17.0));
    if (starBright > threshold) {
      float twinkle = 0.7 + 0.3 * sin(time * (2.0 + starBright * 3.0) + starBright * 6.28);
      // Softer falloff + size variation based on brightness
      float sizeMul = mix(0.04, 0.08, smoothstep(threshold, 1.0, starBright));
      float glow = smoothstep(sizeMul, 0.0, d) * twinkle;
      stars += glow * (starBright - threshold) / (1.0 - threshold);
    }
  }
  return clamp(stars, 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;

  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec2 windOffset = (u_mouse - 0.5) * u_wind;
  vec2 gasUv = uv + windOffset;

  // ── Stars (stable position, tinted by cell hash) ──────────────
  float stars = starField(v_uv, u_stars, u_time);
  // Per-star tint: some stars lean cold (primary), others warm (accent)
  float starTintHash = hash(floor(v_uv * 30.0) + vec2(17.3));
  vec3 starColor = mix(
    mix(u_brandPrimary * 1.2, vec3(1.0), 0.75),
    mix(u_brandAccent * 1.2, vec3(1.0), 0.75),
    starTintHash
  ) * stars;

  // ── Raymarch: front-to-back volumetric compositing ──────────
  vec3 accColor = vec3(0.0);
  float accAlpha = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i >= u_depth) break;
    if (accAlpha > 0.95) break;

    float depthFrac = float(i) / float(u_depth - 1);
    float layerDepth = 1.0 + depthFrac * 3.0;
    float rotAngle = depthFrac * 1.5 + t * 0.3;
    float cR = cos(rotAngle), sR = sin(rotAngle);
    mat2 layerRot = mat2(cR, -sR, sR, cR);

    vec2 samplePos = layerRot * (gasUv * u_scale * layerDepth) + vec2(t * 0.7, t * 0.5);

    // FBM on value noise — organic cloud shapes
    float n = fbm3(samplePos);
    float cloudDensity = smoothstep(0.05, 0.45, n * 0.5 + 0.5);

    // Edge glow: bright at cloud boundaries (classic nebula rim light)
    float edgeGlow = smoothstep(0.1, 0.3, cloudDensity) * smoothstep(0.7, 0.5, cloudDensity);

    // Smooth palette lookup by depth
    vec3 layerColor = nebulaPalette(depthFrac);
    // Rim adds accent + white
    layerColor += edgeGlow * mix(u_brandAccent, vec3(1.0), 0.3) * 0.5;

    // Front-to-back compositing with depth attenuation
    float layerAlpha = cloudDensity * u_density * (1.0 - accAlpha);
    layerAlpha *= (1.0 - depthFrac * 0.3);
    accColor += layerColor * layerAlpha;
    accAlpha += layerAlpha;
  }

  // ── Click burst ────────────────────────────────────────────
  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    vec2 toMouse = uv - burstUv;
    float burstDist = dot(toMouse, toMouse);
    float burst = u_burstStrength * exp(-burstDist * 8.0);
    accColor += mix(u_brandAccent, vec3(1.0), 0.6) * burst * 2.5;
    accAlpha = min(accAlpha + burst * 0.5, 1.0);
  }

  // ── Cosmic background gradient (was flat u_bgColor * 0.3) ──
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  // Darker at edges, gentle primary lift near centre for deep-space warmth
  vec3 spaceColor = mix(
    u_bgColor * 0.35 + u_brandPrimary * 0.03,  // centre: slight warm lift
    u_bgColor * 0.18,                           // edges: deep black
    smoothstep(0.0, 1.6, r2)
  );

  vec3 background = spaceColor + starColor;
  vec3 color = background * (1.0 - accAlpha) + accColor;

  // ── Bloom-adjacent highlight boost on bright cloud cores ──
  float cloudLum = dot(accColor, vec3(0.299, 0.587, 0.114));
  color += pow(cloudLum, 2.5) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ────────────────────────────────────────────
  // ACES (replaces min(x, 0.7) clip)
  color = aces(color);

  // Intensity blend
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  // Luminance-aware grain
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
