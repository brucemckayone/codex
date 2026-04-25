/**
 * Ether fragment shader — Raymarched volumetric light.
 *
 * Built on nimitz's MsjSW3 (https://www.shadertoy.com/view/MsjSW3) SDF map,
 * then reworked for brand-aware beauty:
 *  - Iñigo Quilez-style 4-stop brand palette (bg → primary → secondary → accent)
 *  - ACES filmic tone map (replaces hard 0.7 clip — HDR highlights roll off instead of flattening)
 *  - True per-channel chromatic aberration via 3 raymarches (gated on u_aberration > 0.001)
 *  - Bloom-adjacent highlight boost (pow(lum, 3) accent injection) — treble lifts the boost
 *  - Radial background gradient tinted by primary at the centre
 *  - Mouse-centred spotlight vignette
 *  - Luminance-aware film grain (more in shadows, clean in highlights — filmic)
 *
 * Audio-reactive layer (gated by u_audioActive — wanderer fade 0..1):
 *  - u_wanderer (UV 0..1) shifts the raymarch ray origin laterally (focal
 *    point drift) AND seeds a soft radial glow in the final composition.
 *  - u_bassSmooth warps ray origin on a slow sin/cos envelope → sub-sonic
 *    "pressure through the ether" breath.
 *  - u_midsSmooth sparkles on the in-loop highlight term.
 *  - u_trebleSmooth amplifies bloom-boost magnitude.
 *  - u_amplitudeSmooth lifts saturation pump + ambient brightness.
 *  - u_beatPulse adds a short-lived overall brightness splash.
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

// Audio-reactive uniforms — all gated by u_audioActive (wanderer fade).
uniform vec2 u_wanderer;          // UV 0..1, Lissajous focal point
uniform float u_bassSmooth;       // 0..1 smoothed bass envelope
uniform float u_midsSmooth;       // 0..1 smoothed mids envelope
uniform float u_trebleSmooth;     // 0..1 smoothed treble envelope
uniform float u_amplitudeSmooth;  // 0..1 smoothed amplitude envelope
uniform float u_beatPulse;        // 0..1 transient detector (beat onsets)
uniform float u_audioActive;      // 0..1 wanderer fade — gate for all audio boosts

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
// bassBreath adds a slow low-frequency wobble to the sampled point so bass
// energy is felt as "pressure moving through the ether."
float map(vec3 p, float t, float rotSpd, float scl, float bassBreath) {
  p.xz *= m(t * rotSpd);
  p.xy *= m(t * rotSpd * 0.75);
  // Breathing wobble: slow sinusoidal third axis — avoids the "spin around a fixed centre" feel
  p.yz *= m(sin(t * rotSpd * 0.3) * 0.15);
  // Bass-driven sub-sonic displacement — audible low end becomes a visible
  // slow swirl in the volumetric structure. Magnitudes kept small so the
  // base SDF topology stays intact.
  p.xy += vec2(sin(p.z + t * 0.8), cos(p.z + t * 0.65)) * bassBreath;
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
// roOffset shifts the ray origin laterally — used by the wanderer to drift
// the volumetric focal point along a Lissajous path during audio playback.
// bassBreath is forwarded into map() for sub-sonic swirl.
// midsSparkle boosts the in-loop highlight term on mid-frequency energy.
vec3 raymarchEther(
  vec2 uv,
  float t,
  float scaleMul,
  vec3 roOffset,
  float bassBreath,
  float midsSparkle
) {
  vec3 baseLight = u_brandPrimary * 0.28;
  // Highlight magnitude sparkles with mids — the brightest in-loop injection
  // picks up extra punch when midrange energy is present. Gated inside the
  // renderer via midsSparkle already-scaled by u_audioActive.
  vec3 highlight = mix(u_brandSecondary, u_brandAccent, 0.4)
                 * (4.0 + midsSparkle * 2.5);

  vec3 cl = vec3(0.0);
  float d = 2.5;

  for (int i = 0; i <= 7; i++) {
    if (i >= u_complexity) break;
    vec3 p = vec3(0.0, 0.0, u_zoom) + roOffset
           + normalize(vec3(uv, -1.0)) * d;
    float rz = map(p, t, u_rotSpeed, u_scale * scaleMul, bassBreath);
    float grad = clamp((rz - map(p + vec3(0.1), t, u_rotSpeed, u_scale * scaleMul, bassBreath)) * 0.5, -0.1, 1.0);

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

  // ── Audio coupling pre-computation ─────────────────────────────
  // Wanderer shift: convert UV-space wanderer [0..1] to centred [-0.5, 0.5]
  // and apply as a lateral ray-origin offset. Gated on u_audioActive so the
  // focal point gently glides in on playback.
  vec2 wandererCentred = u_wanderer - 0.5;
  vec3 roOffset = vec3(wandererCentred * 1.8 * u_audioActive, 0.0);

  // Bass breath: small sub-sonic warp magnitude fed into map().
  float bassBreath = 0.04 * u_bassSmooth * u_audioActive;

  // Mids sparkle amount fed into the highlight term.
  float midsSparkle = u_midsSmooth * u_audioActive;

  // -- Raymarch (with optional true per-channel chromatic aberration) --
  vec3 cl;
  if (u_aberration > 0.001) {
    // 3x cost: offset the map() scale per channel to produce real RGB fringing at edges.
    float ab = u_aberration * 6.0;
    vec3 etherR = raymarchEther(uv, t, 1.0 - ab, roOffset, bassBreath, midsSparkle);
    vec3 etherG = raymarchEther(uv, t, 1.0,       roOffset, bassBreath, midsSparkle);
    vec3 etherB = raymarchEther(uv, t, 1.0 + ab,  roOffset, bassBreath, midsSparkle);
    cl = vec3(etherR.r, etherG.g, etherB.b);
  } else {
    cl = raymarchEther(uv, t, 1.0, roOffset, bassBreath, midsSparkle);
  }

  // ── Wanderer glow: additive radial contribution centred on the wanderer
  // UV. Gives a subtle drifting "focal bright spot" that reads even when
  // the raymarch structure is dim. Uses secondary/accent mix so it picks
  // up brand colour.
  vec2 wanderDelta = v_uv - u_wanderer;
  wanderDelta.x *= u_resolution.x / u_resolution.y; // aspect-correct
  float wanderGlow = exp(-dot(wanderDelta, wanderDelta) * 18.0);
  vec3 wanderTint = mix(u_brandSecondary, u_brandAccent, 0.55);
  cl += wanderTint * wanderGlow * 0.55 * u_audioActive;

  // -- Pre-tonemap saturation pump --
  // Operates on HDR values so the lift lands on vivid source, not squished
  // SDR output. Base 0.50, amp-scaled up to +0.75 (matches ripple).
  float lumPre = dot(cl, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + u_audioActive * (0.50 + 0.25 * u_amplitudeSmooth);
  cl = mix(vec3(lumPre), cl, sat);

  // -- ACES tone map (replaces the old brutal 0.7 clip) --
  vec3 etherColor = aces(cl);

  // -- Bloom-adjacent highlight boost --
  // pow(lum, 3) concentrates the boost on the brightest regions only.
  // Treble lifts the boost magnitude: edge sparkle reads stronger on
  // high-frequency content.
  float lum = dot(etherColor, vec3(0.299, 0.587, 0.114));
  vec3 bloomTint = mix(u_brandSecondary, u_brandAccent, 0.5);
  float bloomGain = 0.35 + 0.35 * u_trebleSmooth * u_audioActive;
  etherColor += pow(lum, 3.0) * bloomTint * bloomGain;

  // -- Background: subtle primary-tinted radial gradient instead of flat bg --
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgGrad = mix(
    u_bgColor + u_brandPrimary * 0.04,  // centre: bg with gentle primary lift
    u_bgColor * 0.82,                    // edges: slightly deeper than bg
    smoothstep(0.0, 1.4, r2)
  );

  // -- Intensity blend --
  // Amplitude lifts overall intensity slightly during playback so loud
  // passages feel brighter without blowing out quiet ones.
  float intensityScale = 1.0 + 0.25 * u_amplitudeSmooth * u_audioActive;
  vec3 color = mix(bgGrad, etherColor, u_intensity * intensityScale);

  // -- Beat-pulse splash: short-lived overall brightness flash on onsets.
  // Multiplicative so it tints with existing colour rather than adding white.
  color *= 1.0 + 0.40 * u_beatPulse * u_audioActive;

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
