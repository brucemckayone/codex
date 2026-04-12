/**
 * Silk Fabric fragment shader — flowing fabric with soft wrap-around lighting.
 *
 * Technique: FBM heightfield (4 octaves, sin-based noise with mat2 rotation between
 * octaves) generates a draped-fabric surface. Normals computed via finite differences
 * (FBM evaluated 3x per pixel). Wrap-around diffuse lighting for soft fabric feel,
 * broad sheen highlight (pow(NdotH, 4)).
 *
 * Primary = fabric colour. Secondary appears in deep valleys via `lining` param.
 * NO accent colour used. Mouse creates Gaussian depression in the fabric.
 *
 * Single-pass fragment shader. No FBOs needed.
 *
 * Uniforms:
 *   u_time           — elapsed time in seconds
 *   u_resolution     — canvas pixel dimensions
 *   u_mouse          — mouse position normalized 0..1
 *   u_mouseActive    — 1.0 if mouse is over canvas
 *   u_burst          — click burst intensity
 *   u_brandPrimary   — fabric colour
 *   u_brandSecondary — deep valley / lining colour
 *   u_bgColor        — background colour
 *   u_foldScale      — noise frequency (fabric fold density)
 *   u_foldDepth      — amplitude of surface displacement
 *   u_speed          — animation speed
 *   u_softness       — wrap-around diffuse softness (0-1)
 *   u_sheen          — specular/sheen intensity
 *   u_lining         — how much secondary colour bleeds into valleys
 *   u_intensity      — overall brightness multiplier
 *   u_grain          — film grain strength
 *   u_vignette       — vignette strength
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

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Noise: smooth periodic function (sin-based like warp) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation between octaves (4 octaves) --
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

// -- Heightfield with animation and mouse depression --
float heightfield(vec2 uv) {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_foldScale;
  float t = u_time * u_speed;

  // Animate the noise domain — slow drift for flowing fabric
  p += vec2(t * 0.4, t * 0.25);

  float h = fbm(p) * u_foldDepth;

  // Mouse depression — Gaussian dip in the fabric surface
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);

  float hoverDepth = u_mouseActive * u_foldDepth * 0.25 * exp(-mouseDist * mouseDist * 18.0);
  float burstDepth = u_burst * u_foldDepth * 0.5 * exp(-mouseDist * mouseDist * 8.0);

  h -= hoverDepth + burstDepth;

  return h;
}

void main() {
  // ── 1. Compute heightfield and normals via finite differences ────
  float eps = 1.0 / u_resolution.x;
  float hC = heightfield(v_uv);
  float hR = heightfield(v_uv + vec2(eps, 0.0));
  float hU = heightfield(v_uv + vec2(0.0, eps));

  // Surface normal from finite differences
  vec3 N = normalize(vec3(hC - hR, hC - hU, eps * 2.0));

  // ── 2. Lighting setup ────────────────────────────────────────────
  // Fixed light direction (upper-right, slightly forward)
  vec3 L = normalize(vec3(0.5, 0.7, 0.8));
  // View direction (straight on)
  vec3 V = vec3(0.0, 0.0, 1.0);
  // Half vector for sheen
  vec3 H = normalize(L + V);

  // ── 3. Wrap-around diffuse: (NdotL + softness) / (1 + softness) ─
  float NdotL = dot(N, L);
  float diffuse = (NdotL + u_softness) / (1.0 + u_softness);
  diffuse = max(diffuse, 0.0);

  // ── 4. Broad sheen highlight: pow(NdotH, 4) ─────────────────────
  float NdotH = max(dot(N, H), 0.0);
  float sheen = pow(NdotH, 4.0) * u_sheen;

  // ── 5. Fabric colour — primary, with secondary in deep valleys ───
  // Remap height to 0..1 range for valley detection
  float hNorm = clamp(hC / u_foldDepth * 0.5 + 0.5, 0.0, 1.0);
  float valleyMask = smoothstep(0.45, 0.25, hNorm) * u_lining;

  vec3 fabricColor = mix(u_brandPrimary, u_brandSecondary, valleyMask);

  // ── 6. Combine lighting ──────────────────────────────────────────
  vec3 color = fabricColor * diffuse * u_intensity + sheen * vec3(1.0);

  // Subtle ambient fill to prevent pure black
  color += fabricColor * 0.08;

  // ── 7. Post-processing ───────────────────────────────────────────

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap at 75%
  color = min(color, vec3(0.75));

  // Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
