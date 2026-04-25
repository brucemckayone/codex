/**
 * Flow display fragment shader (GLSL ES 3.0).
 *
 * Maps the self-organising vector field to brand colors using:
 * 1. Line Integral Convolution (LIC) — sample along flow for streak texture
 * 2. Direction-to-hue mapping across the full brand palette (paletteCycle)
 * 3. Bass-driven UV-breath warp so the flow "breathes" at low end
 * 4. Flow-aligned sheen — treble lifts a specular-style highlight along
 *    the streak normal (equivalent of ripple's specular)
 * 5. Pre-tonemap luminance-preserving saturation pump
 * 6. ACES filmic tone-mapping (replaces Reinhard + brightness cap)
 * 7. Standard post-processing chain (vignette, grain)
 *
 * Audio modulation summary:
 *   bassSmooth       → UV-breath warp on LIC sampling + streak brightness lift
 *   midsSmooth       → streak / divergence sparkle lift + palette-hue nudge
 *   trebleSmooth     → flow-aligned sheen magnitude + accent tint
 *   amplitudeSmooth  → overall brightness lift + vibrance pump scaling
 *   audioActive      → vibrance multiplier (playback = saturated, paused = neutral)
 *
 * Adapted from Flexi's curl-noise painting (Shadertoy), with the audio
 * pattern mirroring the ripple preset.
 */
export const FLOW_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uContrast;
uniform float uBassSmooth, uMidsSmooth, uTrebleSmooth, uAmplitudeSmooth, uAudioActive;

// ── Film grain hash ─────────────────────────────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// ── Sigmoid contrast (from original shader) ─────────────────
vec3 sigmoid(vec3 x, float s) {
  return 1.0 / (1.0 + exp(-s * (x - 0.5)));
}

// ACES filmic tone-mapping approximation (Narkowicz 2015). Preserves
// shadows and highlights with an S-curve, retains saturation where
// Reinhard would wash to grey. Input is linear HDR; output is clamped
// SDR 0..1.
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Triangle-blend the three brand colours at position t in [0, 1).
// Every streak carries all three palette colours cycled by direction —
// analogous to ripple's prismatic caustics.
vec3 paletteCycle(float t) {
  t = fract(t);
  float t3 = t * 3.0;
  if (t3 < 1.0) return mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 1.0, t3));
  if (t3 < 2.0) return mix(uColorSecondary, uColorAccent, smoothstep(0.0, 1.0, t3 - 1.0));
  return mix(uColorAccent, uColorPrimary, smoothstep(0.0, 1.0, t3 - 2.0));
}

void main() {
  vec2 tx = vec2(1.0 / 512.0);

  // ── Bass-driven UV-breath warp ────────────────────────────
  // Low-frequency, slow-moving UV displacement scaled by smoothed bass —
  // creates the feel of sub-sonic pressure moving through the field even
  // when there are no transients. Warps the LIC sampling UV only;
  // phase-offset sin/cos so both axes drift independently.
  vec2 bassBreath = vec2(
    sin(v_uv.y * 6.2831 + uTime * 0.45),
    cos(v_uv.x * 6.2831 + uTime * 0.40)
  ) * uBassSmooth * uAudioActive * 0.015;
  vec2 sampleUV = v_uv + bassBreath;

  // ── Read center vector ────────────────────────────────────
  vec3 state = texture(uState, fract(sampleUV)).xyz;
  vec2 vel = state.xy;
  float div = state.z;
  float mag = length(vel);

  // Palette hue nudge — time drift + mids shift. Mirrors ripple's
  // approach of letting mids push the palette phase so sparkle reads
  // as a colour response, not just a brightness response.
  float paletteShift = uTime * 0.04 + uMidsSmooth * 0.3 * uAudioActive;

  // ── Line Integral Convolution (LIC) ───────────────────────
  // Trace along the vector field in both directions to create coherent
  // streak patterns — the hallmark of this effect. Each sample maps its
  // local direction onto the full three-colour brand palette so every
  // streak carries all three colours.
  vec3 licColor = vec3(0.0);
  float licWeight = 0.0;
  vec2 pos = sampleUV;

  // Forward trace (8 steps)
  for (int i = 0; i < 8; i++) {
    vec3 s = texture(uState, fract(pos)).xyz;
    float w = exp(-float(i) * 0.3); // decay weight
    float angle = atan(s.y, s.x);

    // Map direction to a palette cycle position. +0.5 recentres the
    // atan range; paletteShift drifts with time and mids.
    float t = angle / 6.2831853 + 0.5 + paletteShift;
    vec3 c = paletteCycle(t);

    // Modulate by magnitude
    c *= 0.5 + 0.5 * length(s.xy);

    licColor += c * w;
    licWeight += w;

    // Step along the field
    pos += s.xy * tx * 2.0;
  }

  // Backward trace (8 steps)
  pos = sampleUV;
  for (int i = 0; i < 8; i++) {
    vec3 s = texture(uState, fract(pos)).xyz;
    float w = exp(-float(i) * 0.3);
    float angle = atan(s.y, s.x);

    float t = angle / 6.2831853 + 0.5 + paletteShift;
    vec3 c = paletteCycle(t);
    c *= 0.5 + 0.5 * length(s.xy);

    licColor += c * w;
    licWeight += w;

    pos -= s.xy * tx * 2.0;
  }

  licColor /= licWeight;

  // Small baseline brightness lift (+15%) — non-audio-gated so the
  // idle render reads as luminous rather than slightly dim. ACES rolls
  // off any highlight overshoot.
  licColor *= 1.15;

  // ── Mids sparkle: streak brightness + divergence accent ──
  // User feedback: audio-active state was creating an "X-ray" look —
  // ultra-bright streaks on dark ground. Reduced the audio coefficients
  // by ~2.5× so audio-driven brightness lifts stay gentle. Baseline
  // (no-audio) path is unaffected.
  float streakGain = 1.0
                   + uAudioActive * (0.20 * uMidsSmooth + 0.10 * uBassSmooth);
  licColor *= streakGain;

  // Divergence accent — audio gain reduced from 0.5·mids → 0.2·mids for
  // the same X-ray reason. Baseline 0.3 preserved.
  float divGain = 0.3 + uAudioActive * 0.20 * uMidsSmooth;
  licColor += uColorAccent * abs(div) * divGain;

  // ── Treble-driven flow-aligned sheen ─────────────────────
  // Equivalent of ripple's specular highlight. We build a tangent
  // direction perpendicular to the local flow and measure how close
  // v_uv's offset from the sample centre lies along that normal — a
  // sharp cross-streak ridge. Magnitude lifts with treble; colour tints
  // toward accent. Completely dormant when audio is idle.
  // Softened sharpness (analogue of ripple's spec exponent softening:
  // mix(64, 24, treble)) — higher 'sharpness' = thinner highlight.
  float sharpness = mix(28.0, 14.0, uTrebleSmooth);
  vec2 tangent = mag > 0.0001 ? vel / mag : vec2(1.0, 0.0);
  vec2 normal2 = vec2(-tangent.y, tangent.x);
  // Signed ridge coordinate in local pixel space.
  float ridge = 0.0;
  {
    // Short cross-streak probe: sample the field a few texels off-axis
    // and measure divergence along the normal. Small, stable signal that
    // peaks where streaks are straight and strong.
    vec3 sP = texture(uState, fract(v_uv + normal2 * tx * 1.5)).xyz;
    vec3 sM = texture(uState, fract(v_uv - normal2 * tx * 1.5)).xyz;
    ridge = abs(dot(sP.xy - sM.xy, tangent));
  }
  float sheen = pow(clamp(ridge * 4.0, 0.0, 1.0), 0.5)
              * exp(-sharpness * (1.0 - smoothstep(0.0, 0.3, mag)));
  // Sheen gain reduced ~3× (0.35+0.7·treble → 0.10+0.30·treble). The
  // sheen is added AFTER sigmoid contrast so it bypasses the compression
  // curve — at the old gains, it produced bright thin lines on dark
  // ground (the X-ray look the user reported). Baseline zero (audio-gated).
  float sheenGain = uAudioActive * (0.10 + 0.30 * uTrebleSmooth);
  vec3 sheenTint = mix(vec3(1.0), uColorAccent, uTrebleSmooth * 0.7);
  vec3 sheenColor = sheenTint * sheen * sheenGain;

  // ── Mix with background based on field magnitude ──────────
  // Amplitude lifts the foreground mix so loud passages read as
  // present rather than muted.
  float magMix = smoothstep(0.0, 0.3, mag) * uIntensity
               * (1.0 + uAudioActive * 0.25 * uAmplitudeSmooth);
  vec3 color = mix(uBgColor, licColor, clamp(magMix, 0.0, 1.0));

  // ── Sigmoid contrast (softened — the main X-ray fix) ─────
  // Sharpness scaled by 0.5 to soften the S-curve — pushes less of the
  // image into shadow/highlight extremes. The original uContrast makes
  // dark bg → black and bright streaks → white (X-ray signature);
  // halving it keeps the contrast character but in a painterly range.
  color = sigmoid(color, uContrast * 0.5);

  // Add sheen on top of the contrast curve so it reads as a crisp
  // highlight rather than disappearing into the S-curve midtones.
  color += sheenColor;

  // ── Pre-tonemap vibrance pump ─────────────────────────────
  // Saturate vivid HDR values, not squished SDR ones — the pump now
  // operates where the palette is intense, so the lift actually lands.
  // Base 0.25, amp-scaled up to +0.35 — halved from the previous
  // (0.50, 0.25) pair which was over-saturating audio-active frames.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + uAudioActive * (0.25 + 0.10 * uAmplitudeSmooth);
  color = mix(vec3(lum), color, sat);

  // ── ACES filmic tone-mapping ──────────────────────────────
  // Replaces Reinhard x/(1+x) + the old 0.75 brightness cap. ACES
  // preserves contrast (deep shadows, glowing highlights) where
  // Reinhard would collapse everything toward middle grey.
  color = aces(color);

  // Intensity blend with background — unchanged from the original
  // contract (lets low-intensity configs fade toward bg).
  color = mix(uBgColor, color, uIntensity);

  // ── Vignette (post-tonemap — operates on SDR values) ──────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── Film grain ────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // Final clamp to full SDR range; ACES already gates to [0,1].
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
