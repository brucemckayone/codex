/**
 * Water Ripple display fragment shader (GLSL ES 3.0).
 *
 * Renders the wave height field as a water surface with:
 * - Normal-mapped surface from height gradient (finite differences, sharp)
 * - Refracted UV offset sampling a diagonal brand gradient
 * - Fresnel reflection (Schlick approximation)
 * - Prismatic caustic highlights — hue rotates through brand palette based on
 *   gradient angle, so every ripple carries all three brand colours
 * - Specular highlight from directional light — exponent softens AND magnitude
 *   lifts with treble; colour picks up accent tint on bright transients
 * - ACES filmic tone mapping — preserves contrast and saturation where
 *   Reinhard would wash everything into muddy midtones
 * - Pre-tonemap vibrance pump (saturates vivid source, not squished output)
 * - Vignette, film grain
 *
 * Audio modulation summary:
 *   mids  → caustic magnitude + palette hue nudge
 *   treble → specular exponent softens, magnitude lifts, colour gains accent tint
 *   amplitudeSmooth → overall brightness lift + saturation pump scaling
 *   bassSmooth (via renderer) → refraction strength
 *   audioActive → vibrance multiplier (playback = saturated, paused = neutral)
 *
 * Uniforms:
 *   uState           — simulation texture (vec4: height, prevHeight, 0, 0)
 *   uTexel           — 1.0 / simResolution
 *   uColorPrimary    — brand primary color (normalized RGB)
 *   uColorSecondary  — brand secondary color
 *   uColorAccent     — brand accent color
 *   uBgColor         — background color
 *   uIntensity       — display brightness multiplier
 *   uRefraction      — refraction UV offset strength (default 0.5)
 *   uGrain           — film grain strength
 *   uVignette        — vignette strength
 *   uTime            — elapsed time in seconds
 *   uMidsSmooth      — smoothed mids 0-1
 *   uTrebleSmooth    — smoothed treble 0-1
 *   uAmplitudeSmooth — smoothed amplitude 0-1
 *   uAudioActive     — 0-1 wanderer fade (use as vibrance multiplier)
 */
export const RIPPLE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uRefraction, uGrain, uVignette, uTime;
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

// Smooth brand color gradient based on UV position
vec3 brandGradient(vec2 uv) {
  float t = (uv.x + uv.y) * 0.5;
  float t3 = t * 3.0;
  vec3 col;
  if (t3 < 1.0) col = mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 1.0, t3));
  else if (t3 < 2.0) col = mix(uColorSecondary, uColorAccent, smoothstep(0.0, 1.0, t3 - 1.0));
  else col = mix(uColorAccent, uColorPrimary, smoothstep(0.0, 1.0, t3 - 2.0));
  return col;
}

// Triangle-blend the three brand colours at position t in [0, 1).
vec3 paletteCycle(float t) {
  t = fract(t);
  float t3 = t * 3.0;
  if (t3 < 1.0) return mix(uColorPrimary, uColorSecondary, smoothstep(0.0, 1.0, t3));
  if (t3 < 2.0) return mix(uColorSecondary, uColorAccent, smoothstep(0.0, 1.0, t3 - 1.0));
  return mix(uColorAccent, uColorPrimary, smoothstep(0.0, 1.0, t3 - 2.0));
}

void main() {
  // Read wave height field
  float hC = texture(uState, v_uv).x;
  float hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).x;
  float hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).x;
  float hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).x;
  float hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).x;

  // Compute surface normal from height gradient. Normal gain lifted 8 → 14
  // so gentle wanderer ripples produce readable shading, not flat shimmer.
  float dhdx = (hE - hW) * 0.5;
  float dhdy = (hN - hS) * 0.5;
  vec3 normal = normalize(vec3(-dhdx * 14.0, 1.0, -dhdy * 14.0));

  // View direction (looking down at water surface)
  vec3 viewDir = vec3(0.0, 1.0, 0.0);

  // Refracted UV offset — stronger offset (0.08 → 0.12) so refraction reads
  // even when the normal is gentle.
  vec2 refractedUV = v_uv + normal.xz * uRefraction * 0.12;
  refractedUV = clamp(refractedUV, 0.0, 1.0);

  // Bass-driven "breath" warp on the brand-gradient sample. Low-frequency,
  // slow-moving UV displacement scaled by smoothed bass — creates the feel
  // of sub-sonic pressure moving through the water even when there are no
  // transients. Warps colour only, NOT the wave-height read (would
  // desynchronise sim and display). sin/cos phases offset so both axes drift.
  vec2 bassBreath = vec2(
    sin(v_uv.y * 6.2831 + uTime * 0.45),
    cos(v_uv.x * 6.2831 + uTime * 0.40)
  ) * uBassSmooth * 0.02;
  vec2 sampleUV = clamp(refractedUV + bassBreath, 0.0, 1.0);
  vec3 refractedColor = brandGradient(sampleUV);

  // Deeper water baseline widens dynamic range. 0.55 → 0.40 so shadows really
  // drop below mid-grey and the ACES curve has room to shape contrast.
  vec3 deepColor = uBgColor * 0.40;

  // Fresnel reflection — brighter source colour; ACES will roll it off.
  float cosTheta = max(dot(normal, viewDir), 0.0);
  float fresnel = pow(1.0 - cosTheta, 3.0) * 0.7;

  // Reflection colour lifted to 1.0 + 0.25 — effectively HDR. ACES compresses
  // cleanly; the source needs to be vivid for the tonemap to have material.
  vec3 reflectColor = mix(uColorPrimary, uColorSecondary, 0.5) * 1.0 + 0.25;

  vec3 surfaceColor = mix(refractedColor, reflectColor, fresnel);

  // ── Prismatic caustics ────────────────────────────────────────
  // Threshold dropped to 0.005 so the wanderer's continuous gentle trail
  // produces visible sparkle — not only beat-splashes.
  float gradientMag = length(vec2(dhdx, dhdy));
  float causticBase = smoothstep(0.005, 0.08, gradientMag);
  float gradAngle = atan(dhdy, dhdx);
  // Palette cycling rate is now TREBLE-driven: bright treble-rich content
  // pushes colours to rotate faster through the brand palette; bass-heavy
  // or quiet content stays on a slow cycle. This is the "treble owns
  // colour" assignment — decoupled from bass so each band has a distinct
  // visual role. Mids still nudge the cycle phase (melody line → hue shift).
  float paletteT = gradAngle / 6.2831853 + 0.5
                 + uTime * (0.04 + 0.18 * uTrebleSmooth)
                 + uMidsSmooth * 0.3;
  vec3 causticHue = paletteCycle(paletteT);
  // Caustics are now purely mids-driven (bass removed from gain). Mids owns
  // sparkle; the previous shared bass contribution was piling onto the same
  // channel as mids and piles onto amplitude, flattening differential signal.
  float causticGain = 0.55 + 1.2 * uMidsSmooth;
  vec3 causticColor = causticHue * causticBase * causticGain;

  // ── Specular highlight ────────────────────────────────────────
  float specExp = mix(64.0, 24.0, uTrebleSmooth);
  vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), specExp);
  float specGain = 0.55 + 0.7 * uTrebleSmooth;              // was 0.35 + 0.5·treble
  vec3 specTint = mix(vec3(1.0), uColorAccent, uTrebleSmooth * 0.7);
  vec3 specColor = specTint * spec * specGain;

  // Wave height — brighter crests on loud passages.
  float heightBright = hC * (0.25 + 0.25 * uAmplitudeSmooth);

  // Compose — allow the linear HDR sum to exceed 1.0; ACES rolls it off.
  // Bass no longer lifts surface brightness here — that was piling onto the
  // same channel as amplitude and causing full-mix content to squash the
  // dynamic range. Bass's domain now lives entirely in the rumble emitter
  // (renderer), UV-breath warp (below), and refraction gain (renderer).
  vec3 waterColor = deepColor + surfaceColor * uIntensity * 1.2;
  waterColor += causticColor * uIntensity;
  waterColor += specColor * uIntensity;
  waterColor += heightBright * uColorPrimary * uIntensity * 0.9;

  // Vibrance BEFORE tone-mapping — saturate vivid HDR values, not squished
  // SDR ones. The pump is now TREBLE-scaled (not amplitude-scaled). This is
  // the "treble owns colour" assignment: bright, trebly content gets richer
  // saturation; bassy/quiet content stays at baseline so the three bands
  // don't all push the same channel in dense mixes. Base 0.30, treble-scaled
  // up to +0.55 (peak effective saturation ~1.85x on treble-rich content).
  float lum = dot(waterColor, vec3(0.299, 0.587, 0.114));
  float sat = 1.0 + uAudioActive * (0.30 + 0.55 * uTrebleSmooth);
  waterColor = mix(vec3(lum), waterColor, sat);

  // Filmic tone-mapping — key fix for perceived "washed out" feel.
  // ACES preserves contrast (deep shadows, glowing highlights) where Reinhard
  // x/(1+x) would collapse everything toward middle grey.
  waterColor = aces(waterColor);

  // Vignette (post-tonemap — operates on SDR values)
  vec2 vc = v_uv * 2.0 - 1.0;
  waterColor *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  waterColor += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(waterColor, 0.0, 1.0), 1.0);
}
`;
