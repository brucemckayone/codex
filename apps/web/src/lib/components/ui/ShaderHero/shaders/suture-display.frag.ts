/**
 * Suture Fluid display fragment shader (GLSL ES 3.0).
 *
 * Renders the velocity/divergence field with brand palette colorization.
 * Combines the original XddSRX cross-product coloring with a smooth
 * 3-color brand palette mapped from velocity direction.
 *
 * Audio modulation summary:
 *   bassSmooth       → UV-breath warp + overall brightness push + divergence
 *                      "sheen" lift (sub-sonic pressure pushing the fabric)
 *   midsSmooth       → suture-line sparkle gain + palette hue nudge (prismatic)
 *   trebleSmooth     → specular-like highlight on divergence ridges; magnitude
 *                      lift, exponent softens, tint picks up the accent colour
 *   amplitudeSmooth  → overall brightness lift + saturation-pump scaling
 *   audioActive      → 0..1 wanderer fade, gates all audio-reactive boosts and
 *                      vibrance multiplier (playback = saturated, paused = neutral)
 *
 * Uniforms:
 *   uState           — simulation texture (vec3: vx, vy, divergence)
 *   uColorA          — brand primary color (normalized RGB)
 *   uColorB          — brand secondary color
 *   uColorC          — brand accent color
 *   uBgColor         — background color
 *   uIntensity       — display brightness multiplier
 *   uGrain           — film grain strength
 *   uVignette        — vignette strength
 *   uTime            — elapsed time in seconds
 *   uBassSmooth      — smoothed bass 0-1
 *   uMidsSmooth      — smoothed mids 0-1
 *   uTrebleSmooth    — smoothed treble 0-1
 *   uAmplitudeSmooth — smoothed amplitude 0-1
 *   uAudioActive     — 0-1 wanderer fade (use as vibrance + gate multiplier)
 */
export const SUTURE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorA, uColorB, uColorC, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uBassSmooth, uMidsSmooth, uTrebleSmooth, uAmplitudeSmooth, uAudioActive;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// ACES filmic tone-mapping approximation (Narkowicz 2015). Preserves shadows
// and highlights with an S-curve, retains saturation where Reinhard would
// wash to grey. Input is linear HDR; output is clamped SDR 0..1.
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Triangle-blend the three brand colours at position t in [0, 1).
vec3 paletteCycle(float t) {
  t = fract(t);
  float t3 = t * 3.0;
  if (t3 < 1.0) return mix(uColorA, uColorB, smoothstep(0.0, 1.0, t3));
  if (t3 < 2.0) return mix(uColorB, uColorC, smoothstep(0.0, 1.0, t3 - 1.0));
  return mix(uColorC, uColorA, smoothstep(0.0, 1.0, t3 - 2.0));
}

void main() {
  // ── UV-breath warp ─────────────────────────────────────────
  // Low-frequency, slow-moving UV displacement scaled by smoothed bass —
  // creates the feel of sub-sonic pressure moving through the fabric even
  // when there are no transients. Gated on uAudioActive so it's still when
  // paused. Warps sampling only; doesn't desynchronise from the sim.
  vec2 bassBreath = vec2(
    sin(v_uv.y * 6.2831 + uTime * 0.45),
    cos(v_uv.x * 6.2831 + uTime * 0.40)
  ) * uBassSmooth * uAudioActive * 0.02;
  vec2 sampleUV = clamp(v_uv + bassBreath, 0.0, 1.0);

  vec3 c = texture(uState, sampleUV).xyz;
  float mag = length(c.xy);

  // Original XddSRX colorization as base — organic colour variation from the
  // vorticity cross-product.
  vec3 norm = mag > 0.001 ? c / max(length(c), 0.001) : vec3(0.0);
  vec3 origColor = 0.5 + 0.6 * cross(norm, vec3(0.5, -0.4, 0.5));
  origColor += 0.1 * norm.z;  // divergence tint

  // ── Prismatic palette (velocity-angle driven) ─────────────
  // Velocity direction -> palette position. Phase nudged by time (slow
  // hue drift) and by smoothed mids (so melodic energy shifts hue), giving
  // every whorl a slightly different brand colour than the last.
  float angle = atan(c.y, c.x);
  float paletteT = angle / 6.2831853 + 0.5
                 + uTime * 0.04
                 + uMidsSmooth * 0.3;
  vec3 palColor = paletteCycle(paletteT);

  // Blend branded palette with original cross-product coloring —
  // cross-product gives organic variation; palette gives brand identity.
  vec3 fluidColor = mix(origColor * palColor, palColor * origColor.r, 0.5);

  // ── Magnitude-based brightness ────────────────────────────
  // Velocity magnitude drives the base brightness. Amplitude lifts it
  // slightly so loud passages feel more present.
  float brightness = smoothstep(0.0, 0.3, mag) * 0.6
                   + smoothstep(0.3, 0.8, mag) * 0.2;

  // ── Divergence "sparkle" — mids-driven ─────────────────────
  // Suture lines emerge from divergence edges. Mids pump the sparkle gain
  // so melodic content lights up the fabric; bass lifts it slightly too
  // (the fabric "glows" with low-end presence).
  float divEffect = abs(c.z);
  float sparkleBase = smoothstep(0.1, 0.5, divEffect);
  float sparkleGain = 0.35
                    + uAudioActive * (0.9 * uMidsSmooth + 0.3 * uBassSmooth);
  brightness += sparkleBase * sparkleGain;

  // ── Treble "specular" — sharp highlights on ridges ─────────
  // Pseudo-specular: steep power of divergence, exponent softens with
  // treble, magnitude lifts, tint picks up the accent colour on bright
  // transients. Similar role to ripple's specular highlight.
  float specExp = mix(6.0, 3.0, uTrebleSmooth);
  float specBase = pow(divEffect, specExp);
  float specGain = uAudioActive * (0.35 + 0.8 * uTrebleSmooth);
  vec3 specTint = mix(vec3(1.0), uColorC, uTrebleSmooth * 0.7);
  vec3 specColor = specTint * specBase * specGain;

  // Compose — bass "pushes light through" the fabric. Up to +30% at peak.
  float bassPush = 1.0 + 0.3 * uBassSmooth * uAudioActive;
  float ampLift = 1.0 + 0.2 * uAmplitudeSmooth * uAudioActive;
  vec3 color = uBgColor
             + fluidColor * brightness * uIntensity * bassPush * ampLift;
  color += specColor * uIntensity;

  // ── Vibrance BEFORE tone-mapping ──────────────────────────
  // Saturate vivid HDR values, not squished SDR ones. Base 0.50,
  // amp-scaled up to +0.75. Luminance-preserving.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + uAudioActive * (0.50 + 0.25 * uAmplitudeSmooth);
  color = mix(vec3(lum), color, sat);

  // Filmic tone-mapping (ACES) — preserves contrast and saturation where
  // Reinhard x/(1+x) would collapse everything toward middle grey.
  color = aces(color);

  // Vignette (post-tonemap — operates on SDR values)
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
