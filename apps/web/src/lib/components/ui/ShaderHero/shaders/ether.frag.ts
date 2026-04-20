/**
 * Ether fragment shader — Raymarched volumetric light.
 *
 * Built on nimitz's MsjSW3 (https://www.shadertoy.com/view/MsjSW3) SDF map,
 * then reworked for brand-aware beauty:
 *  - Iñigo Quilez-style 4-stop brand palette (bg → primary → secondary → accent)
 *  - ACES filmic tone map (replaces hard 0.7 clip — HDR highlights roll off instead of flattening)
 *  - True per-channel chromatic aberration via 3 raymarches (gated on u_aberration > 0.001)
 *  - Bloom-adjacent highlight boost (pow(lum, 3) accent injection)
 *  - Radial background gradient tinted by primary at the centre
 *  - Mouse-centred spotlight vignette
 *  - Luminance-aware film grain (more in shadows, clean in highlights — filmic)
 */
export const ETHER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;         // normalized 0-1, lerped
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_rotSpeed;
uniform int u_complexity;     // 3-8 raymarch steps
uniform float u_glow;         // glow intensity multiplier
uniform float u_scale;        // map() detail scale
uniform float u_zoom;         // camera Z distance
uniform float u_intensity;    // overall blend intensity
uniform float u_grain;
uniform float u_vignette;
uniform float u_aberration;

// -- 2D rotation --
mat2 m(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// -- Hash for film grain --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// -- 4-stop brand palette (iq-inspired smooth gradient) --
// t in [0,1]: bg → primary (0..1/3) → secondary (1/3..2/3) → accent (2/3..1)
vec3 brandPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.3333) {
    return mix(u_bgColor, u_brandPrimary, smoothstep(0.0, 0.3333, t));
  } else if (t < 0.6666) {
    return mix(u_brandPrimary, u_brandSecondary, smoothstep(0.3333, 0.6666, t));
  }
  return mix(u_brandSecondary, u_brandAccent, smoothstep(0.6666, 1.0, t));
}

// -- SDF map (nimitz) + subtle breathing axis for organic motion --
float map(vec3 p, float t, float rotSpd, float scl) {
  p.xz *= m(t * rotSpd);
  p.xy *= m(t * rotSpd * 0.75);
  // Breathing wobble: slow sinusoidal third axis — avoids the "spin around a fixed centre" feel
  p.yz *= m(sin(t * rotSpd * 0.3) * 0.15);
  vec3 q = p * scl + t;
  return length(p + vec3(sin(t * 0.7))) * log(length(p) + 1.0)
       + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
}

// -- ACES filmic tone map (Narkowicz 2015 approximation) --
// Preserves highlights (rolls off instead of clipping) and deepens shadows.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- One full raymarch pass. Returns accumulated light. --
// scaleMul is used to produce per-channel offsets for true chromatic aberration.
vec3 raymarchEther(vec2 uv, float t, float scaleMul) {
  vec3 baseLight = u_brandPrimary * 0.28;
  vec3 highlight = mix(u_brandSecondary, u_brandAccent, 0.4) * 4.0;

  vec3 cl = vec3(0.0);
  float d = 2.5;

  for (int i = 0; i <= 7; i++) {
    if (i >= u_complexity) break;
    vec3 p = vec3(0.0, 0.0, u_zoom) + normalize(vec3(uv, -1.0)) * d;
    float rz = map(p, t, u_rotSpeed, u_scale * scaleMul);
    float grad = clamp((rz - map(p + vec3(0.1), t, u_rotSpeed, u_scale * scaleMul)) * 0.5, -0.1, 1.0);

    // Palette lookup by distance + gradient — tighter structures pull toward accent
    float palT = clamp(1.0 - d * 0.11 + grad * 0.35, 0.0, 1.0);
    vec3 paletteCol = brandPalette(palT);

    vec3 l = baseLight + highlight * grad;
    // Multiplicative accumulation with palette injection — warmer, more dimensional than pure multiply
    cl = cl * l + smoothstep(2.5, 0.0, rz) * u_glow * mix(l, paletteCol * 2.0, 0.55);

    d += min(rz, 1.0);
  }
  return cl;
}

void main() {
  float t = u_time;

  // Mouse parallax — shifts view origin for a subtle look-around feel
  float mx = (u_mouse.x - 0.5) * 0.3;
  float my = (u_mouse.y - 0.5) * 0.2;

  // Shadertoy-style coordinate mapping (nimitz's original framing)
  vec2 uv = gl_FragCoord.xy / u_resolution.y - vec2(
    0.9 + mx,
    0.5 + my
  );

  // -- Raymarch (with optional true per-channel chromatic aberration) --
  vec3 cl;
  if (u_aberration > 0.001) {
    // 3x cost: offset the map() scale per channel to produce real RGB fringing at edges.
    float ab = u_aberration * 6.0;
    vec3 etherR = raymarchEther(uv, t, 1.0 - ab);
    vec3 etherG = raymarchEther(uv, t, 1.0);
    vec3 etherB = raymarchEther(uv, t, 1.0 + ab);
    cl = vec3(etherR.r, etherG.g, etherB.b);
  } else {
    cl = raymarchEther(uv, t, 1.0);
  }

  // -- ACES tone map (replaces the old brutal 0.7 clip) --
  vec3 etherColor = aces(cl);

  // -- Bloom-adjacent highlight boost --
  // pow(lum, 3) concentrates the boost on the brightest regions only.
  float lum = dot(etherColor, vec3(0.299, 0.587, 0.114));
  vec3 bloomTint = mix(u_brandSecondary, u_brandAccent, 0.5);
  etherColor += pow(lum, 3.0) * bloomTint * 0.35;

  // -- Background: subtle primary-tinted radial gradient instead of flat bg --
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgGrad = mix(
    u_bgColor + u_brandPrimary * 0.04,  // centre: bg with gentle primary lift
    u_bgColor * 0.82,                    // edges: slightly deeper than bg
    smoothstep(0.0, 1.4, r2)
  );

  // -- Intensity blend --
  vec3 color = mix(bgGrad, etherColor, u_intensity);

  // -- Mouse-centred spotlight vignette --
  // Standard radial darkening, but with a soft lift where the cursor is.
  vec2 mouseOffset = (u_mouse - 0.5) * 2.0;
  float mouseDist = length(vc - mouseOffset * 0.3);
  float spotlight = smoothstep(1.2, 0.0, mouseDist) * 0.12;
  float vig = clamp(1.0 - r2 * u_vignette + spotlight, 0.0, 1.2);
  color *= vig;

  // -- Filmic grain: more in shadows, clean in highlights --
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(t * 7.13)) - 0.5) * grainAmt;

  // -- Final clamp (ACES already gave us a well-behaved range) --
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
