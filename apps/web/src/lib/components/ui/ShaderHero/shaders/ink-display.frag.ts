/**
 * Ink Dispersion display fragment shader (GLSL ES 3.0).
 *
 * Maps the 3-channel ink concentration buffer to brand colors:
 *   R channel → primary color   (wanderer trail in immersive mode)
 *   G channel → secondary color (bass rumble atmosphere)
 *   B channel → accent color    (beat splash)
 *
 * Uses additive blending with overlap darkening for a subtractive-mixing feel,
 * wet-edge highlight via screen-space derivatives, ACES filmic tone-mapping
 * with a pre-tonemap saturation pump, vignette, and film grain.
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
 *   uBassSmooth      — smoothed bass 0-1
 *   uMidsSmooth      — smoothed mids 0-1
 *   uTrebleSmooth    — smoothed treble 0-1
 *   uAmplitudeSmooth — smoothed amplitude 0-1
 *   uAudioActive     — 0-1 wanderer fade (saturation multiplier)
 */
export const INK_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uBassSmooth, uMidsSmooth, uTrebleSmooth, uAmplitudeSmooth, uAudioActive;

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

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
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
  ) * uBassSmooth * 0.02;
  vec2 sampleUV = clamp(v_uv + bassBreath, 0.0, 1.0);

  // ── 2. Read ink concentrations ────────────────────────────────────
  vec3 ink = texture(uState, sampleUV).rgb;

  // ── 3. Additive color blending ────────────────────────────────────
  // Each channel maps to its brand color. Bass lifts the whole
  // composition's baseline brightness — up to +30% at peak bass — so
  // low-end presence reads as luminosity, not just motion.
  float bassLift = 1.0 + 0.30 * uBassSmooth;
  float midsLift = 1.0 + 0.20 * uMidsSmooth;
  float totalLift = uIntensity * bassLift * midsLift;

  vec3 color = uBgColor
    + ink.r * uColorPrimary * totalLift
    + ink.g * uColorSecondary * totalLift
    + ink.b * uColorAccent * totalLift;

  // ── 4. Overlap darkening — subtractive mixing simulation ──────────
  // Where multiple inks overlap, darken for a realistic ink-on-paper
  // feel instead of pure additive blowout. Mids soften this darkening a
  // bit (wet ink reads more luminous during mid-heavy passages — piano,
  // voice, strings). Base darken factor 0.55; mids lift it toward 0.70.
  float totalInk = ink.r + ink.g + ink.b;
  float overlapFactor = smoothstep(0.8, 2.0, totalInk);
  float darkenFloor = mix(0.55, 0.70, uMidsSmooth);
  color *= mix(1.0, darkenFloor, overlapFactor);

  // ── 5. Wet-edge highlight via screen-space derivatives ────────────
  // Detect ink concentration edges using dFdx/dFdy for a wet-edge glow.
  // Treble sharpens the edge threshold and lifts the gain — high-frequency
  // content adds sparkle along ink boundaries. Ink has no specular proper;
  // this is the analogous visual term.
  float dIdx = length(dFdx(ink));
  float dIdy = length(dFdy(ink));
  float dTotal = dIdx + dIdy;
  // Lower threshold + steeper ramp on treble → sharper edges on transients.
  float edgeLo = mix(0.002, 0.0008, uTrebleSmooth);
  float edgeHi = mix(0.03, 0.015, uTrebleSmooth);
  float edgeStrength = smoothstep(edgeLo, edgeHi, dTotal);
  float edgeGain = 0.08 + 0.12 * uTrebleSmooth;
  // Edge tint picks up accent on bright transients — matches ripple's
  // accent-tinted specular behaviour.
  vec3 edgeTint = mix(
    mix(uColorPrimary, uColorAccent, 0.5),
    uColorAccent,
    uTrebleSmooth * 0.7
  );
  color += edgeStrength * edgeGain * edgeTint * uIntensity;

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
  float gdx = dFdx(inkSum);
  float gdy = dFdy(inkSum);
  float gradAngle = atan(gdy, gdx);
  float prismT = fract(
    gradAngle / 6.2831853 + 0.5
      + uTime * 0.06
      + uMidsSmooth * 0.3
  );
  vec3 prismatic = spectrum(prismT);
  float prismGain = edgeStrength * uAudioActive
                  * (0.25 + 0.40 * uTrebleSmooth);
  color += prismatic * prismGain * uIntensity;

  // ── 6. Pre-tonemap saturation pump ────────────────────────────────
  // Luminance-preserving saturate BEFORE tone-mapping so we're saturating
  // vivid HDR values, not squished SDR ones. Active only during playback.
  // Base 0.50, amp-scaled up to +0.75 at peak amplitude.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + uAudioActive * (0.50 + 0.25 * uAmplitudeSmooth);
  color = mix(vec3(lum), color, sat);

  // ── 7. ACES filmic tone mapping ───────────────────────────────────
  // Replaces the former Reinhard x/(1+x). Preserves contrast (deep
  // shadows, glowing highlights) where Reinhard would collapse everything
  // toward middle grey — the same fix applied to ripple.
  color = aces(color);

  // ── 8. Vignette (post-tonemap) ────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 9. Film grain ─────────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
