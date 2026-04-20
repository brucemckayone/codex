/**
 * Silk Fabric fragment shader — flowing fabric with iridescent sheen.
 *
 * Technique: FBM (4 octaves) of iq-style value noise drives a heightfield;
 * normals from finite differences; dual-lobe specular (broad sheen + narrow
 * anisotropic streak along the heightfield gradient); Fresnel-biased
 * accent iridescence at grazing angles (fakes shot-silk colour shift);
 * secondary colour bleeds into valleys via `u_lining`; ACES tone map
 * (replaces the old 0.75 brightness cap); luminance-aware film grain.
 *
 * Uniforms (unchanged from previous revision):
 *   u_time, u_resolution, u_mouse, u_mouseActive, u_burst,
 *   u_brandPrimary, u_brandSecondary, u_brandAccent, u_bgColor,
 *   u_foldScale, u_foldDepth, u_speed, u_softness, u_sheen, u_lining,
 *   u_intensity, u_grain, u_vignette
 */
export const SILK_FRAG = `#version 300 es
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
uniform float u_foldScale;
uniform float u_foldDepth;
uniform float u_speed;
uniform float u_softness;
uniform float u_sheen;
uniform float u_lining;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- iq-style value noise (replaces sin(x)*sin(y) which produced checkerboard artefacts) --
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

// -- Cheap hash for grain --
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float totalAmp = 0.0;
  for (int i = 0; i < 4; i++) {
    f += amp * noise(p);
    totalAmp += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return totalAmp > 0.0 ? f / totalAmp : 0.0;
}

float heightfield(vec2 uv) {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_foldScale;
  float t = u_time * u_speed;

  // Slow domain drift — fabric flowing
  p += vec2(t * 0.4, t * 0.25);

  float h = fbm(p) * u_foldDepth;

  // Mouse depression — Gaussian dip
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float hoverDepth = u_mouseActive * u_foldDepth * 0.25 * exp(-mouseDist * mouseDist * 18.0);
  float burstDepth = u_burst * u_foldDepth * 0.5 * exp(-mouseDist * mouseDist * 8.0);
  h -= hoverDepth + burstDepth;

  return h;
}

// -- ACES filmic tone map (Narkowicz 2015) --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // ── 1. Heightfield + normal via finite differences ────────────
  float eps = 1.0 / u_resolution.x;
  float hC = heightfield(v_uv);
  float hR = heightfield(v_uv + vec2(eps, 0.0));
  float hU = heightfield(v_uv + vec2(0.0, eps));

  // Normal — spacing of eps*2 keeps gradient scale sane
  vec3 N = normalize(vec3(hC - hR, hC - hU, eps * 2.0));

  // Tangent direction (along the heightfield gradient, projected to 2D)
  // Used for anisotropic specular streak — the "grain" of the silk.
  vec2 tangent2D = normalize(vec2(hR - hC, hU - hC) + vec2(0.0001));

  // ── 2. Lighting setup ─────────────────────────────────────────
  vec3 L = normalize(vec3(0.5, 0.7, 0.8));       // upper-right key light
  vec3 V = vec3(0.0, 0.0, 1.0);                  // straight-on viewer
  vec3 H = normalize(L + V);

  // ── 3. Wrap-around diffuse ───────────────────────────────────
  float NdotL = dot(N, L);
  float diffuse = (NdotL + u_softness) / (1.0 + u_softness);
  diffuse = max(diffuse, 0.0);

  // ── 4. Dual-lobe specular ────────────────────────────────────
  // Lobe A: broad sheen (pow 4) — diffuse velvet-like highlight
  float NdotH = max(dot(N, H), 0.0);
  float broadSheen = pow(NdotH, 4.0);

  // Lobe B: narrow anisotropic streak aligned with fabric grain.
  // Squash H's projection along the tangent direction — stretches the highlight.
  vec2 H2D = H.xy;
  float alongGrain = abs(dot(H2D, tangent2D));
  float acrossGrain = abs(dot(H2D, vec2(-tangent2D.y, tangent2D.x)));
  float anisoH = 1.0 - (alongGrain * 0.3 + acrossGrain * 1.7);
  float aniso = pow(max(anisoH, 0.0), 28.0);

  // ── 5. Fresnel-biased iridescence (shot-silk colour shift) ───
  float NdotV = max(dot(N, V), 0.0);
  float fresnel = pow(1.0 - NdotV, 3.0);

  // Sheen colour: warm broad lobe (accent) + cool narrow streak (primary->accent)
  vec3 broadSheenColor = mix(vec3(1.0), u_brandAccent, 0.35);
  vec3 anisoColor = mix(u_brandPrimary * 2.2, u_brandAccent * 1.8, fresnel);

  vec3 specular = broadSheenColor * broadSheen * u_sheen
                + anisoColor       * aniso      * u_sheen * 1.2;

  // ── 6. Fabric colour — primary, with secondary in valleys, subtle accent in peaks ─
  float hNorm = clamp(hC / u_foldDepth * 0.5 + 0.5, 0.0, 1.0);
  float valleyMask = smoothstep(0.45, 0.20, hNorm) * u_lining;
  float peakMask = smoothstep(0.55, 0.85, hNorm) * 0.18;

  vec3 fabricBase = mix(u_brandPrimary, u_brandSecondary, valleyMask);
  fabricBase = mix(fabricBase, u_brandAccent, peakMask);

  // ── 7. Combine ───────────────────────────────────────────────
  vec3 color = fabricBase * diffuse * u_intensity + specular;

  // Coloured ambient — primary-tinted instead of pure fabric-scaled
  vec3 ambient = mix(u_brandPrimary, u_bgColor, 0.65) * 0.12;
  color += ambient;

  // ── 8. Post-processing ───────────────────────────────────────

  // ACES tone map — replaces the old min(x, 0.75) brutal clip
  color = aces(color);

  // Final blend with bg
  color = mix(u_bgColor, color, u_intensity);

  // Radial vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  // Luminance-aware grain: more in shadows, clean in highlights
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
