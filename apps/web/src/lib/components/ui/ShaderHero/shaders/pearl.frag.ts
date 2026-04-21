/**
 * Pearl fragment shader — Raymarched displaced sphere with iridescent fresnel.
 *
 * Shadertoy-grade polish pass:
 *  - Smooth 3-stop iridescent palette (primary → secondary → accent) via
 *    smoothstep weights; no per-pixel branching
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR specular * 3.5 lets ACES render sharp pearl highlights as
 *    near-white glints instead of the matte disc the 0.75 clip produced
 *  - Light-background radial gradient: subtle primary tint at centre,
 *    slightly deeper at edges (was flat bgLight * bgGrad)
 *  - Bloom halo around pearl silhouette
 *  - Luminance-aware filmic grain
 */
export const PEARL_FRAG = `#version 300 es
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
uniform float u_displacement;
uniform float u_speed;
uniform float u_fresnel;
uniform float u_specular;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float displace(vec3 p, float t) {
  return sin(p.x * 2.0 + t) * sin(p.y * 3.0) * sin(p.z * 2.0 + t * 0.7) * u_displacement
       + sin(p.x * 5.0 - t * 0.5) * sin(p.y * 4.0 + t) * sin(p.z * 6.0) * u_displacement * 0.3;
}

float sdf(vec3 p, float t) {
  return length(p) - 1.0 + displace(p, t);
}

vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sdf(p + e.xyy, t) - sdf(p - e.xyy, t),
    sdf(p + e.yxy, t) - sdf(p - e.yxy, t),
    sdf(p + e.yyx, t) - sdf(p - e.yyx, t)
  ));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Smooth 3-stop iridescent palette --
vec3 iridescent(float fr) {
  fr = clamp(fr, 0.0, 1.0);
  float w0 = smoothstep(0.6, 0.0, fr);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(fr - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, fr);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

void main() {
  float t = u_time * u_speed + u_burstStrength * 2.0;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= aspect;

  vec3 ro = vec3(0.0, 0.0, 3.5);
  vec3 rd = normalize(vec3(uv, -1.5));

  vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
  lightDir.x += (u_mouse.x - 0.5) * 1.5;
  lightDir.z += (u_mouse.y - 0.5) * 1.5;
  lightDir = normalize(lightDir);

  float totalDist = 0.0;
  bool hit = false;
  vec3 p;

  for (int i = 0; i < 64; i++) {
    p = ro + rd * totalDist;
    float d = sdf(p, t);
    if (d < 0.001) {
      hit = true;
      break;
    }
    totalDist += d;
    if (totalDist > 10.0) break;
  }

  // ── Light background with radial tint ──────────────────────
  vec3 bgLight = mix(u_bgColor, vec3(1.0), 0.85);
  float r2 = dot(uv, uv);
  vec3 bg = mix(
    bgLight + u_brandPrimary * 0.02,   // centre: bright with gentle primary tint
    bgLight * 0.9,                       // edges: slightly deeper
    smoothstep(0.0, 2.0, r2)
  );

  vec3 color;

  if (hit) {
    vec3 n = calcNormal(p, t);

    float fr = pow(1.0 - max(dot(n, -rd), 0.0), u_fresnel);

    // Smooth iridescent palette (branchless)
    vec3 iriColor = iridescent(fr);

    // Pearl cosine palette tint
    vec3 pearl = u_brandPrimary * 0.3 + 0.7 * (0.5 + 0.5 * cos(6.283 * (fr * 1.5 + vec3(0.0, 0.33, 0.67))));
    vec3 surfaceColor = mix(pearl, iriColor, 0.6);

    float diff = max(dot(n, lightDir), 0.0) * 0.6;

    vec3 refl = reflect(-lightDir, n);
    // HDR specular — lets ACES render glint as near-white
    float spec = pow(max(dot(refl, -rd), 0.0), 32.0) * u_specular * 3.5;

    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0) * 0.45;

    color = surfaceColor * (0.18 + diff) + mix(vec3(1.0), u_brandAccent, 0.15) * spec + iriColor * rim;
  } else {
    color = bg;
  }

  // ── Bloom halo around pearl silhouette ──────────────────────
  float silLum = hit ? dot(color, vec3(0.299, 0.587, 0.114)) : 0.0;
  color += pow(silLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);
  color = mix(bgLight, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
