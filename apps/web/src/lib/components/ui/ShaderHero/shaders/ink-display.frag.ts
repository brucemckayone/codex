/**
 * Ink Dispersion display fragment shader (GLSL ES 3.0).
 *
 * Maps the 3-channel ink concentration buffer to brand colors:
 *   R channel → primary color   (wanderer trail in immersive mode)
 *   G channel → secondary color (bass rumble atmosphere)
 *   B channel → accent color    (beat splash)
 *
 * WP-1d (Codex-1yd58): ink is a PIGMENT on a light ground (each channel
 * multiplies the ground toward its colour, as ink on paper does) and an
 * EMISSION on a dark one (added over the ground), mixed by the ground's
 * luminance as lenia mixes its highlights. The ground is the brand's: the
 * tone curve works on the excursion either side of it (toneOverBg), so
 * clear water is exactly uBgColor. It used to add every ink over the
 * ground and ACES the sum, which on a light brand read as a grey blob and
 * shifted the ground itself. Wet-edge highlight via screen-space
 * derivatives, a pre-tonemap saturation pump, vignette, and film grain.
 *
 * Audio modulation summary (immersive playback):
 *   bassSmooth       → UV-breath warp on ink sample + overall brightness lift
 *   midsSmooth       → brightness + overlap-darkening softening
 *                      (wet ink looks more luminous during mid-heavy passages)
 *   trebleSmooth     → wet-edge sharpening + highlight gain (ink boundaries
 *                      pick up high-frequency sparkle)
 *   amplitudeSmooth  → brightness lift + saturation-pump scaling
 *   audioActive      → 0..1 wanderer fade used as saturation multiplier
 *                      (playback = saturated, paused = neutral)
 *
 * Uniforms:
 *   uState           — simulation texture (RGB = ink concentrations)
 *   uColorPrimary    — brand primary color (normalized RGB)
 *   uColorSecondary  — brand secondary color
 *   uColorAccent     — brand accent color
 *   uBgColor         — background color (zero-concentration areas)
 *   uIntensity       — brightness multiplier
 *   uGrain           — film grain strength
 *   uVignette        — vignette strength
 *   uTime            — elapsed time in seconds (for grain animation)
 *   u_bass      — smoothed bass 0-1
 *   u_mids      — smoothed mids 0-1
 *   u_treble    — smoothed treble 0-1
 *   u_level — smoothed amplitude 0-1
 *   u_audioActive     — 0-1 wanderer fade (saturation multiplier)
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const INK_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// ACES filmic tone-mapping approximation (Narkowicz 2015). Preserves shadows
// and highlights with an S-curve, retains saturation where Reinhard would
// wash to grey. Input is linear HDR; output is clamped SDR 0..1.
// Non-brand spectral colour (IQ cosine palette). Returns a vivid prismatic
// hue for t in [0,1) — cycles through cyan → magenta → yellow → cyan.
// Used to inject colour variety at ink wet-edges WITHOUT replacing the brand
// palette. Brand inks still dominate the flat regions; the prismatic shimmer
// only appears where ink concentration is changing rapidly.
vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
}

/**
 * Emphasis that survives a light palette: additive on a dark ground, a blend
 * toward the tint on a light one — where adding a saturated brand colour to
 * something near white only desaturates it. (lenia-display.frag.ts)
 */
vec3 highlight(vec3 base, vec3 tint, float amount, float darkBg) {
  vec3 additive = base + tint * amount;
  vec3 blended = mix(base, tint, clamp(amount, 0.0, 1.0));
  return mix(blended, additive, darkBg);
}

/**
 * Reinhard on the excursion either side of the background, so bg maps to
 * bg. The excursion above it rolls off at half the rate (a glow on a dark
 * ground keeps its brightness; lenia's full Reinhard halved it).
 */
vec3 toneOverBg(vec3 c, vec3 bg) {
  vec3 over = max(c - bg, 0.0);
  vec3 under = max(bg - c, 0.0);
  return bg + over / (1.0 + 0.5 * over) - under / (1.0 + under);
}

void main() {
  // ── 1. Bass-breath UV warp on ink sample ─────────────────────────
  // Low-frequency, slow-moving displacement scaled by smoothed bass —
  // creates the feel of sub-sonic pressure moving through the ink field
  // even when there are no transients. Warps the sample read only, not the
  // underlying sim state.
  vec2 bassBreath = vec2(
    sin(v_uv.y * 6.2831 + uTime * 0.45),
    cos(v_uv.x * 6.2831 + uTime * 0.40)
  ) * u_bass * 0.02;
  vec2 sampleUV = clamp(v_uv + bassBreath, 0.0, 1.0);

  // ── 2. Read ink concentrations ────────────────────────────────────
  vec3 ink = texture(uState, sampleUV).rgb;

  // ── 3. Additive color blending ────────────────────────────────────
  // Each channel maps to its brand color. Bass lifts the whole
  // composition's baseline brightness — up to +30% at peak bass — so
  // low-end presence reads as luminosity, not just motion.
  float bassLift = 1.0 + 0.30 * u_bass;
  float midsLift = 1.0 + 0.20 * u_mids;
  float totalLift = uIntensity * bassLift * midsLift;
  vec3 dens = ink * totalLift;

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smoothstep(0.35, 0.62, bgLum);

  // Dark ground: the inks GLOW, added over it. Where several overlap they
  // darken a little (mids soften that), so a pile-up is not a white blowout.
  vec3 glow = uBgColor
    + (dens.r * uColorPrimary
    + dens.g * uColorSecondary
    + dens.b * uColorAccent) * 1.5;
  float overlapFactor = smoothstep(0.8, 2.0, dens.r + dens.g + dens.b);
  glow *= mix(1.0, mix(0.55, 0.70, u_mids), overlapFactor);

  // Light ground: each ink is a PIGMENT, filtering the ground toward its
  // colour by its coverage (1 - e^-density), so overlaps mix subtractively.
  vec3 cover = 1.0 - exp(-dens * 1.6);
  vec3 pigment = uBgColor
    * mix(vec3(1.0), uColorPrimary, cover.r)
    * mix(vec3(1.0), uColorSecondary, cover.g)
    * mix(vec3(1.0), uColorAccent, cover.b);

  vec3 color = mix(pigment, glow, darkBg);

  // ── 5. Wet-edge highlight via screen-space derivatives ────────────
  // Detect ink concentration edges using dFdx/dFdy for a wet-edge glow.
  // Treble sharpens the edge threshold and lifts the gain — high-frequency
  // content adds sparkle along ink boundaries. Ink has no specular proper;
  // this is the analogous visual term.
  // Central differences over the sim's own texels, not dFdx: the grid is
  // coarser than the screen, so a screen derivative is constant across each
  // texel and drew its grid as a dot screen wherever ink was dense. Per
  // texel, so it is the same edge at any DPR (thresholds were per pixel at
  // ~2.25 pixels a texel).
  vec3 inkE = texture(uState, sampleUV + vec2(uTexel.x, 0.0)).rgb;
  vec3 inkW = texture(uState, sampleUV - vec2(uTexel.x, 0.0)).rgb;
  vec3 inkN = texture(uState, sampleUV + vec2(0.0, uTexel.y)).rgb;
  vec3 inkS = texture(uState, sampleUV - vec2(0.0, uTexel.y)).rgb;
  float dTotal = (length(inkE - inkW) + length(inkN - inkS)) * 0.5;
  // Lower threshold + steeper ramp on treble → sharper edges on transients.
  float edgeLo = mix(0.0045, 0.0018, u_treble);
  float edgeHi = mix(0.068, 0.034, u_treble);
  float edgeStrength = smoothstep(edgeLo, edgeHi, dTotal);
  float edgeGain = 0.08 + 0.12 * u_treble;
  // Edge tint picks up accent on bright transients — matches ripple's
  // accent-tinted specular behaviour.
  vec3 edgeTint = mix(
    mix(uColorPrimary, uColorAccent, 0.5),
    uColorAccent,
    u_treble * 0.7
  );
  color = highlight(color, edgeTint, edgeStrength * edgeGain * uIntensity, darkBg);

  // ── 5b. Prismatic shimmer — non-brand spectral accents ────────────
  // User direction: "introduce something else" beyond brand colours.
  // We compute the ink-field gradient angle and map it through a cosine
  // spectrum (cyan/magenta/yellow — non-brand by design). The prismatic
  // hue appears ONLY at wet edges (gated by edgeStrength) so it reads as
  // an iridescent sheen on ink boundaries rather than replacing the brand
  // colours. Gradient-direction keying means adjacent pixels on the same
  // edge get neighbouring hues — smooth rainbow sweeps, not confetti.
  // Mids nudge the phase; treble steepens the gain (treble owns colour).
  float inkSum = ink.r + ink.g + ink.b;
  vec3 one = vec3(1.0);
  float gdx = dot(inkE - inkW, one);
  float gdy = dot(inkN - inkS, one);
  float gradAngle = atan(gdy, gdx);
  float prismT = fract(
    gradAngle / 6.2831853 + 0.5
      + uTime * 0.06
      + u_mids * 0.3
  );
  vec3 prismatic = spectrum(prismT);
  float prismGain = edgeStrength * u_audioActive
                  * (0.25 + 0.40 * u_treble);
  color = highlight(color, prismatic, prismGain * uIntensity, darkBg);

  // ── 6. Pre-tonemap saturation pump ────────────────────────────────
  // Luminance-preserving saturate BEFORE tone-mapping so we're saturating
  // vivid HDR values, not squished SDR ones. Active only during playback.
  // Base 0.50, amp-scaled up to +0.75 at peak amplitude.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + u_audioActive * (0.50 + 0.25 * u_level);
  color = mix(vec3(lum), color, sat);

  // ── 7. Tone curve over the ground ─────────────────────────────────
  // Rolls off the excursion either side of the brand ground, so clear
  // water is exactly the ground and a dense glow does not clip.
  color = toneOverBg(color, uBgColor);

  // ── 8. Vignette (post-tonemap) ────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 9. Film grain ─────────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
