/**
 * Rain on Glass fragment shader (GLSL ES 3.0).
 *
 * Single-pass: BigWings "Heartfelt" layered-grid technique.
 * Tiled grid drops with SDF bodies + elongated trails + sub-drops.
 * SDF gradient used as normal vector for refraction of background scene.
 * Mouse creates a wiper effect that smears/pushes drops aside.
 * Background is a procedural FBM-based blurred gradient of brand colors.
 *
 * Uniforms:
 *   u_time           — elapsed seconds
 *   u_resolution     — canvas pixel dimensions
 *   u_mouse          — normalized mouse (0-1), lerped
 *   u_burstStrength  — click burst intensity (decays)
 *   u_brandPrimary   — glass tint / warm background glow
 *   u_brandSecondary — background mid-tone blobs
 *   u_brandAccent    — drop highlight / rim light / bright blobs
 *   u_bgColor        — deep base tone
 *   u_density        — drop density (grid skip threshold)
 *   u_speed          — fall speed multiplier
 *   u_size           — drop size multiplier
 *   u_refraction     — refraction distortion strength
 *   u_blur           — background blur/softness
 *   u_intensity      — overall blend
 *   u_grain          — film grain
 *   u_vignette       — vignette strength
 */
export const RAIN_FRAG = `#version 300 es
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
uniform float u_size;
uniform float u_refraction;
uniform float u_blur;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Stable hash (fract/dot pattern, battle-tested) --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Smooth value noise --
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// -- FBM for background blobs (3 octaves) --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);
float fbm(vec2 p) {
  float f = 0.0;
  f += 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p); p = octaveRot * p * 2.03;
  f += 0.125 * noise(p);
  return f / 0.875;
}

// -- Procedural background scene (blurred brand-coloured gradient) --
vec3 backgroundScene(vec2 uv, float blur) {
  vec3 bg = u_bgColor * 0.4;

  // Large primary-coloured blob (warm glow)
  float n1 = fbm(uv * 1.5 * blur + vec2(0.3, 0.7));
  bg += u_brandPrimary * smoothstep(0.1, 0.6, n1) * 0.4;

  // Medium secondary-coloured blobs
  float n2 = fbm(uv * 2.5 * blur + vec2(1.7, 0.2));
  bg += u_brandSecondary * smoothstep(0.2, 0.7, n2) * 0.3;

  // Small accent highlights (streetlights / neon)
  float n3 = fbm(uv * 4.0 * blur + vec2(0.9, 1.4));
  bg += u_brandAccent * smoothstep(0.4, 0.8, n3) * 0.25;

  return bg;
}

// -- Single raindrop grid layer --
// Returns vec3: xy = refraction normal, z = drop mask
vec3 rainLayer(vec2 uv, float gridScale, float t) {
  vec2 aspect = vec2(1.0, 2.0); // cells taller than wide
  vec2 st = uv * gridScale * aspect;

  vec2 id = floor(st);
  vec2 fc = fract(st) - 0.5;

  // Per-cell random properties
  float h = hash(id);
  float h2 = hash(id + vec2(127.1, 311.7));

  // Skip cells based on density
  if (h > u_density) return vec3(0.0);

  // -- Main drop body --
  float wobble = sin(t * u_speed + h * 6.28) * 0.3;
  // Downward motion: fract(-t * speed + phase) for top-to-bottom
  float dropY = fract(-t * u_speed * (0.5 + h * 0.5) + h2) * 2.0 - 1.0;

  vec2 dropPos = vec2(wobble * 0.2, dropY);
  vec2 toCenter = fc - dropPos;

  // Elliptical SDF (wider drop shape)
  float dropRadius = (0.03 + h * 0.02) * u_size;
  float sdf = length(toCenter / vec2(1.0, 1.5)) - dropRadius;

  // -- Trail behind the drop (sub-drops above main body) --
  float trailMask = 0.0;
  float trailLen = 0.3 + h * 0.3;
  for (int i = 0; i < 4; i++) {
    float fi = float(i) / 4.0;
    float subH = hash(id + vec2(float(i) * 13.0, 0.0));
    vec2 subPos = dropPos + vec2(sin(fi * 3.14 + h) * 0.05, fi * trailLen);
    float subR = dropRadius * (0.3 - fi * 0.06) * (subH * 0.5 + 0.5);
    float subSdf = length(fc - subPos) - subR;
    trailMask = max(trailMask, smoothstep(0.01, 0.0, subSdf));
  }

  // Combine main drop + trail
  float dropMask = smoothstep(0.01, 0.0, sdf);
  float totalMask = max(dropMask, trailMask * 0.6);

  // -- Normal from SDF gradient (refraction lens) --
  vec2 normal = toCenter / (length(toCenter) + 0.001);
  normal *= smoothstep(dropRadius * 2.0, 0.0, length(toCenter));

  return vec3(normal * totalMask, totalMask);
}

void main() {
  float t = u_time;
  vec2 uv = v_uv;

  // 1. Accumulate drops from 3 grid layers (small, medium, large)
  vec3 layer1 = rainLayer(uv, 8.0, t);
  vec3 layer2 = rainLayer(uv + vec2(0.37, 0.13), 5.0, t * 0.8);
  vec3 layer3 = rainLayer(uv + vec2(0.71, 0.59), 3.0, t * 0.6);

  vec2 totalNormal = layer1.xy + layer2.xy * 0.7 + layer3.xy * 0.5;
  float totalMask = max(max(layer1.z, layer2.z), layer3.z);

  // 2. Wiper effect (mouse pushes drops aside)
  vec2 wiperCenter = u_mouse;
  float wiperRadius = 0.15;
  float wiperDist = length(v_uv - wiperCenter);
  float wiperMask = smoothstep(wiperRadius, wiperRadius * 0.3, wiperDist);

  // Reduce drop visibility near wiper
  totalMask *= (1.0 - wiperMask * 0.8);

  // Push refraction normals away from wiper center
  vec2 wiperPush = (wiperDist > 0.001)
    ? normalize(v_uv - wiperCenter) * wiperMask * 0.1
    : vec2(0.0);
  totalNormal += wiperPush;

  // 3. Click burst: radial splash
  if (u_burstStrength > 0.01) {
    vec2 burstUv = v_uv - u_mouse;
    float burstDist = length(burstUv);
    float ring = abs(burstDist - u_burstStrength * 0.3) - 0.01;
    float splash = smoothstep(0.02, 0.0, ring) * u_burstStrength;
    vec2 burstDir = (burstDist > 0.001) ? normalize(burstUv) : vec2(0.0);
    totalNormal += burstDir * splash * 0.3;
  }

  // 4. Refracted background lookup
  vec2 refractedUv = uv + totalNormal * u_refraction;
  refractedUv = clamp(refractedUv, 0.0, 1.0);
  vec3 refractedBg = backgroundScene(refractedUv, u_blur);

  // 5. Non-refracted background (plain glass)
  vec3 plainBg = backgroundScene(uv, u_blur);

  // 6. Glass tint
  vec3 glassTint = mix(plainBg, u_brandPrimary * 0.1, 0.05);

  // 7. Drop highlights (Fresnel-like rim)
  float rim = pow(1.0 - abs(dot(normalize(vec3(totalNormal, 1.0)), vec3(0, 0, 1))), 3.0);
  vec3 highlight = u_brandAccent * rim * totalMask * 0.3;

  // 8. Final composite
  vec3 color = mix(glassTint, refractedBg, totalMask) + highlight;

  // -- Post-processing --

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.7));

  // Intensity blend
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
