/**
 * Orb fragment shader — Raymarched crystal sphere with procedural displacement.
 *
 * Adapted from Stephane Cuillerdier (Aiekick, 2015).
 * Original: CC BY-NC-SA 3.0.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Texture lookups replaced with procedural value noise + FBM.
 * Cubemap replaced with brand-colored procedural environment.
 * Mouse: orbits camera angle + elevation.
 * Click burst: camera push-in effect.
 * Brand colors: surface = primary↔secondary blend, specular = accent,
 *               environment = bg↔secondary gradient with accent highlights.
 */
export const ORB_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform vec2  u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3  u_brandPrimary;
uniform vec3  u_brandSecondary;
uniform vec3  u_brandAccent;
uniform vec3  u_bgColor;
// Preset-specific
uniform float u_speed;
uniform float u_displace;
uniform float u_reflect;
uniform float u_refract;
uniform float u_camDist;
// Shared post-process
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

#define PI  3.14159265
#define TAU 6.28318530

// ── Hash (fast, no trig) ─────────────────────────────────
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Value noise (single octave, cheap) ───────────────────
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// ── FBM (4 octaves, for environment only — called once per pixel) ──
const mat2 octRot = mat2(0.8, 0.6, -0.6, 0.8);
float fbm4(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = octRot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

// ── Procedural displacement (replaces textureLod) ────────
// Called per march step — kept cheap: 2-octave noise.
vec4 displacement(vec3 p) {
  float t = u_time * u_speed * 1.5;
  vec2 g = p.xz / 200.0;
  g.x -= t * 0.015;
  g.y += sin(g.x * 46.5 + t) * 0.12;

  float n1 = vnoise(g * 6.0 + t * 0.05);
  float n2 = vnoise(g * 6.0 + vec2(3.7, 1.3) + t * 0.05);
  n1 = vnoise(vec2(n1, n2) * 4.0 + g * 3.0);

  vec3 c = smoothstep(vec3(n1 + 0.5), vec3(n1), vec3(0.71));
  c = clamp(c, vec3(0.0), vec3(1.0));
  float dist = dot(c, vec3(0.3));
  return vec4(dist, c);
}

// ── Procedural environment (replaces cubemap) ────────────
vec3 envMap(vec3 rd) {
  float y = rd.y * 0.5 + 0.5;
  vec3 env = mix(u_bgColor * 1.2, u_brandSecondary * 0.4, smoothstep(0.0, 1.0, y));
  float n = fbm4(rd.xz * 2.0 + rd.y * 1.5);
  env += u_brandPrimary * smoothstep(0.4, 0.7, n) * 0.15;
  env += u_brandAccent  * smoothstep(0.6, 0.9, n) * 0.1;
  return env;
}

// ── SDF: displaced sphere ────────────────────────────────
float sphereSDF(vec3 p) {
  vec4 disp = displacement(p);
  float y = 1.0 - smoothstep(0.0, 1.0, disp.x) * u_displace;
  return length(p) - 5.0 + y;
}

vec4 sphereMap(vec3 p) {
  vec4 disp = displacement(p);
  float y = 1.0 - smoothstep(0.0, 1.0, disp.x) * u_displace;
  return vec4(length(p) - 5.0 + y, disp.yzw);
}

vec3 calcNormal(vec3 pos) {
  vec2 e = vec2(0.05, 0.0);
  return normalize(vec3(
    sphereSDF(pos + e.xyy) - sphereSDF(pos - e.xyy),
    sphereSDF(pos + e.yxy) - sphereSDF(pos - e.yxy),
    sphereSDF(pos + e.yyx) - sphereSDF(pos - e.yyx)
  ));
}

void main() {
  float t = u_time * u_speed;

  // ── Camera ─────────────────────────────────────────────
  float cam_a = 3.3 + t * 0.1;
  float cam_e = 6.0;
  float cam_d = u_camDist;

  // Mouse orbits camera
  if (u_mouseActive > 0.5) {
    cam_e = mix(3.0, 9.0, u_mouse.y);
    cam_a += (u_mouse.x - 0.5) * 3.0;
  }

  // Burst pushes camera closer
  cam_d = max(0.5, cam_d - u_burst * 0.8);

  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  vec3 ro  = vec3(-sin(cam_a) * cam_d * 5.0, cam_e + 1.0, cos(cam_a) * cam_d * 5.0);
  vec3 rov = normalize(-ro);
  vec3 u   = normalize(cross(vec3(0.0, 1.0, 0.0), rov));
  vec3 v   = cross(rov, u);
  vec3 rd  = normalize(rov + uv.x * u + uv.y * v);

  // ── Raymarch ───────────────────────────────────────────
  float d = 0.0, s = 1.0;
  vec3 p;
  for (int i = 0; i < 80; i++) {
    if (s < 0.001 || d > 50.0) break;
    p = ro + rd * d;
    s = sphereSDF(p) * 0.5;
    d += s;
  }

  vec3 color;

  if (d < 50.0) {
    vec3 n = calcNormal(p);

    // Reflection + refraction via procedural environment
    vec3 reflRay = reflect(rd, n);
    vec3 refl = envMap(reflRay) * u_reflect;
    vec3 refrRay = refract(reflRay, n, 1.2);
    vec3 refr = envMap(refrRay) * u_refract;
    color = refl + refr;

    // Surface color with brand mapping
    vec4 surf = sphereMap(p);
    vec3 surfCol = mix(u_brandPrimary, u_brandSecondary, surf.y);
    surfCol = mix(surfCol, u_brandAccent, surf.z * 0.3);

    // Lighting
    vec3  lig = normalize(vec3(-0.6, 0.7, -0.5));
    float dif = clamp(dot(n, lig), 0.0, 1.0);
    float spe = pow(clamp(dot(reflect(-lig, n), -rd), 0.0, 1.0), 16.0);
    float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    float amb = 0.5 + 0.5 * n.y;

    vec3 brdf = vec3(0.05);
    brdf += 1.0  * dif * vec3(1.0, 0.9, 0.7);
    brdf += 0.8  * spe * u_brandAccent;
    brdf += 0.3  * amb * u_brandSecondary;
    brdf += 0.35 * fre * vec3(1.0);

    color = color * brdf;
    // Fog
    color = mix(color, u_bgColor, 1.0 - exp(-0.0005 * d * d));
    // Blend surface pattern
    color = mix(color, surfCol, 0.45);
  } else {
    color = envMap(rd);
  }

  // ── Post-processing (MANDATORY) ────────────────────────
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
