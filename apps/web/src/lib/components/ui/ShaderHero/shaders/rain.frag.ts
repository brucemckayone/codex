/**
 * Rain on Glass fragment shader (GLSL ES 3.0).
 *
 * Shadertoy-grade polish pass:
 *  - ACES filmic tone map replaces min(x, 0.7) clip
 *  - HDR drop rim highlight (*0.3 → *0.9) lets ACES render refracting
 *    drops with bright glinting edges — proper wet-glass feel
 *  - Background scene brightened modestly (primary blob 0.4 → 0.5,
 *    accent 0.25 → 0.35) so refraction actually shows contrast
 *  - Bloom halo around brightest drop rims
 *  - Luminance-aware filmic grain
 *
 * BigWings "Heartfelt" layered-grid drop technique preserved — that part
 * is well-constructed and doesn't need fixing.
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

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

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

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  f += 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p); p = octaveRot * p * 2.03;
  f += 0.125 * noise(p);
  return f / 0.875;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 backgroundScene(vec2 uv, float blur) {
  vec3 bg = u_bgColor * 0.4;
  float n1 = fbm(uv * 1.5 * blur + vec2(0.3, 0.7));
  bg += u_brandPrimary * smoothstep(0.1, 0.6, n1) * 0.5;
  float n2 = fbm(uv * 2.5 * blur + vec2(1.7, 0.2));
  bg += u_brandSecondary * smoothstep(0.2, 0.7, n2) * 0.35;
  float n3 = fbm(uv * 4.0 * blur + vec2(0.9, 1.4));
  bg += u_brandAccent * smoothstep(0.4, 0.8, n3) * 0.35;
  return bg;
}

vec3 rainLayer(vec2 uv, float gridScale, float t) {
  vec2 aspect = vec2(1.0, 2.0);
  vec2 st = uv * gridScale * aspect;
  vec2 id = floor(st);
  vec2 fc = fract(st) - 0.5;
  float h = hash(id);
  float h2 = hash(id + vec2(127.1, 311.7));
  if (h > u_density) return vec3(0.0);

  float wobble = sin(t * u_speed + h * 6.28) * 0.3;
  float dropY = fract(-t * u_speed * (0.5 + h * 0.5) + h2) * 2.0 - 1.0;
  vec2 dropPos = vec2(wobble * 0.2, dropY);
  vec2 toCenter = fc - dropPos;
  float dropRadius = (0.03 + h * 0.02) * u_size;
  float sdf = length(toCenter / vec2(1.0, 1.5)) - dropRadius;

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

  float dropMask = smoothstep(0.01, 0.0, sdf);
  float totalMask = max(dropMask, trailMask * 0.6);
  vec2 normal = toCenter / (length(toCenter) + 0.001);
  normal *= smoothstep(dropRadius * 2.0, 0.0, length(toCenter));
  return vec3(normal * totalMask, totalMask);
}

void main() {
  float t = u_time;
  vec2 uv = v_uv;

  vec3 layer1 = rainLayer(uv, 8.0, t);
  vec3 layer2 = rainLayer(uv + vec2(0.37, 0.13), 5.0, t * 0.8);
  vec3 layer3 = rainLayer(uv + vec2(0.71, 0.59), 3.0, t * 0.6);

  vec2 totalNormal = layer1.xy + layer2.xy * 0.7 + layer3.xy * 0.5;
  float totalMask = max(max(layer1.z, layer2.z), layer3.z);

  vec2 wiperCenter = u_mouse;
  float wiperRadius = 0.15;
  float wiperDist = length(v_uv - wiperCenter);
  float wiperMask = smoothstep(wiperRadius, wiperRadius * 0.3, wiperDist);
  totalMask *= (1.0 - wiperMask * 0.8);
  vec2 wiperPush = (wiperDist > 0.001)
    ? normalize(v_uv - wiperCenter) * wiperMask * 0.1
    : vec2(0.0);
  totalNormal += wiperPush;

  if (u_burstStrength > 0.01) {
    vec2 burstUv = v_uv - u_mouse;
    float burstDist = length(burstUv);
    float ring = abs(burstDist - u_burstStrength * 0.3) - 0.01;
    float splash = smoothstep(0.02, 0.0, ring) * u_burstStrength;
    vec2 burstDir = (burstDist > 0.001) ? normalize(burstUv) : vec2(0.0);
    totalNormal += burstDir * splash * 0.3;
  }

  vec2 refractedUv = uv + totalNormal * u_refraction;
  refractedUv = clamp(refractedUv, 0.0, 1.0);
  vec3 refractedBg = backgroundScene(refractedUv, u_blur);
  vec3 plainBg = backgroundScene(uv, u_blur);
  vec3 glassTint = mix(plainBg, u_brandPrimary * 0.1, 0.05);

  // HDR rim highlight — proper wet-glass glint
  float rim = pow(1.0 - abs(dot(normalize(vec3(totalNormal, 1.0)), vec3(0, 0, 1))), 3.0);
  vec3 highlight = mix(u_brandAccent, vec3(1.0), 0.3) * rim * totalMask * 0.9;

  vec3 color = mix(glassTint, refractedBg, totalMask) + highlight;

  // Bloom halo around bright rims
  float rimLum = rim * totalMask;
  color += pow(rimLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ──────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
