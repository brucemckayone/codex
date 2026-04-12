/**
 * Nebula fragment shader — Single-pass raymarched volumetric cosmic dust.
 *
 * Volumetric gas clouds rendered via front-to-back compositing. Each depth
 * layer is tinted with a different brand color: primary (near), secondary
 * (mid-ground), accent (far/highlights). Background star field sits behind.
 *
 * Mouse creates "stellar wind" — displaces the gas UVs smoothly.
 * Click creates a bright star flash (Gaussian burst) at the cursor.
 *
 * Noise: sin(p.x)*sin(p.y) consistent with warp convention.
 * FBM: 3 octaves with mat2(0.8, 0.6, -0.6, 0.8) inter-octave rotation.
 * Post-processing: Reinhard tone map, cap 0.7, intensity blend, vignette, grain.
 */
export const NEBULA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;          // normalized 0-1, lerped
uniform float u_burstStrength;  // click burst (decays)
uniform vec3 u_brandPrimary;   // near gas color
uniform vec3 u_brandSecondary; // mid dust color
uniform vec3 u_brandAccent;    // far/highlight color
uniform vec3 u_bgColor;        // deep space base
uniform float u_density;       // gas opacity
uniform float u_speed;         // evolution speed
uniform float u_scale;         // cloud scale
uniform int u_depth;           // ray steps (quality, 4-16)
uniform float u_wind;          // mouse wind strength
uniform float u_stars;         // background star density
uniform float u_intensity;     // overall blend
uniform float u_grain;         // film grain
uniform float u_vignette;      // vignette

// -- Noise: smooth periodic function (same convention as warp) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
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

// -- Hash for film grain + star field --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Star field: grid-based random stars with twinkle --
float starField(vec2 uv, float starDensity, float time) {
  if (starDensity <= 0.0) return 0.0;

  float stars = 0.0;
  // Two layers at different scales for depth
  for (int layer = 0; layer < 2; layer++) {
    float scale = 30.0 + float(layer) * 20.0;
    vec2 cell = floor(uv * scale);
    vec2 frac = fract(uv * scale);

    // Random star position within cell
    vec2 starPos = vec2(hash(cell), hash(cell + vec2(127.1, 311.7)));

    // Distance to star center
    float d = length(frac - starPos);

    // Star brightness with threshold based on density
    float threshold = 1.0 - starDensity * 0.3;
    float starBright = hash(cell + vec2(42.0, 17.0));
    if (starBright > threshold) {
      // Twinkle
      float twinkle = 0.7 + 0.3 * sin(time * (2.0 + starBright * 3.0) + starBright * 6.28);
      // Point-like falloff
      float glow = smoothstep(0.05, 0.0, d) * twinkle;
      stars += glow * (starBright - threshold) / (1.0 - threshold);
    }
  }

  return clamp(stars, 0.0, 1.0);
}

void main() {
  float t = u_time * u_speed;

  // --- Aspect-correct UVs ---
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // --- Stellar wind: offset gas UVs by mouse ---
  vec2 windOffset = (u_mouse - 0.5) * u_wind;
  vec2 gasUv = uv + windOffset;

  // --- Star field (behind gas, uses v_uv so stars stay fixed) ---
  float stars = starField(v_uv, u_stars, u_time);
  vec3 starColor = mix(u_brandAccent, vec3(1.0), 0.7) * stars;

  // --- Raymarch: front-to-back volumetric compositing ---
  vec3 accColor = vec3(0.0);
  float accAlpha = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i >= u_depth) break;
    if (accAlpha > 0.95) break;

    // Depth fraction: 0=near, 1=far
    float depthFrac = float(i) / float(u_depth - 1);

    // Per-layer depth offset and rotation angle
    float layerDepth = 1.0 + depthFrac * 3.0;
    float rotAngle = depthFrac * 1.5 + t * 0.3;
    float c = cos(rotAngle), s = sin(rotAngle);
    mat2 layerRot = mat2(c, -s, s, c);

    // Sample position: scaled, rotated, time-evolving
    vec2 samplePos = layerRot * (gasUv * u_scale * layerDepth) + vec2(t * 0.7, t * 0.5);

    // FBM noise sample
    float n = fbm3(samplePos);

    // Remap noise to cloud density (threshold for cloud edges)
    float cloudDensity = smoothstep(0.05, 0.45, n * 0.5 + 0.5);

    // Edge glow: bright at cloud boundaries
    float edgeGlow = smoothstep(0.1, 0.3, cloudDensity) * smoothstep(0.7, 0.5, cloudDensity);

    // Color by depth: near=primary, mid=secondary, far=accent
    vec3 layerColor;
    if (depthFrac < 0.5) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, depthFrac * 2.0);
    } else {
      layerColor = mix(u_brandSecondary, u_brandAccent, (depthFrac - 0.5) * 2.0);
    }

    // Add edge glow highlight
    layerColor += edgeGlow * mix(u_brandAccent, vec3(1.0), 0.3) * 0.4;

    // Front-to-back compositing
    float layerAlpha = cloudDensity * u_density * (1.0 - accAlpha);
    // Attenuate far layers
    layerAlpha *= (1.0 - depthFrac * 0.3);
    accColor += layerColor * layerAlpha;
    accAlpha += layerAlpha;
  }

  // --- Click burst: bright star flash at cursor ---
  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    vec2 toMouse = uv - burstUv;
    float burstDist = dot(toMouse, toMouse);
    float burst = u_burstStrength * exp(-burstDist * 8.0);
    accColor += mix(u_brandAccent, vec3(1.0), 0.6) * burst * 2.0;
    accAlpha = min(accAlpha + burst * 0.5, 1.0);
  }

  // --- Composite: stars behind gas on deep space ---
  vec3 spaceColor = u_bgColor * 0.3;
  vec3 background = spaceColor + starColor;
  vec3 color = background * (1.0 - accAlpha) + accColor;

  // --- Post-processing ---

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.7));

  // Intensity blend: mix background with nebula
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
`;
