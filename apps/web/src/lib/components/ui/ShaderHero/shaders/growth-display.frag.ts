/**
 * Growth (differential growth) display fragment shader (GLSL ES 3.0).
 *
 * Reads the SDF simulation buffer (R = distance, G = curvature, B = age) and
 * renders the interior as a depth gradient, the zero-contour as a bright line,
 * and recently grown tissue as a glow.
 *
 * ## What changed and why
 *
 * **Light backgrounds.** The chain was `color / (1 + color)`, then
 * `min(color, 0.75)`, then `mix(uBgColor / (1 + uBgColor), color, uIntensity)`.
 * All three are absolute, so a light `uBgColor` of 0.96 arrived at 0.49 and the
 * whole preset rendered as mid grey with grey growth on it. Tone mapping is now
 * relative to the background, the cap is floored at it, and every additive glow
 * routes through `highlight()`, which blends toward the tint on a light ground
 * instead of adding a saturated colour to something already near white.
 *
 * **A nutrient wave, and no wall-clock throb.** The pass had no motion of its
 * own beyond film grain. It now carries a wave that travels through the age
 * gradient — outward from wherever the front last grew — paced by `uClock`, the
 * monotone clock the renderer integrates at 0.3 rad/s when silent and at the
 * music's rate when playing. The rate is blended and integrated in the
 * RENDERER: crossfading `mix(uTime * k, u_beatPhase, u_audioActive)` here would
 * sweep the phase backwards when playback starts, because `u_beatPhase` begins
 * at zero while `uTime` may be at 60s.
 *
 * **Audio.** `u_bass` thickens the contour line (body/weight), `u_energy` plus
 * `beatHit()` gain the halo, `audioHueShift()` warms the accent with timbre,
 * `u_flux` — noisy by construction — gains the grain. All four brand stops stay
 * distinguishable: interior runs primary→secondary with depth, the contour and
 * its halo are accent, and the background is the fourth.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const GROWTH_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uWidth, uGlow, uTime;
uniform float uClock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/** Emphasis that survives a light palette (see the header note). */
vec3 highlight(vec3 base, vec3 tint, float amount, float darkBg) {
  vec3 additive = base + tint * amount;
  vec3 blended = mix(base, tint, clamp(amount, 0.0, 1.0));
  return mix(blended, additive, darkBg);
}

/** Reinhard on the excursion either side of the background, so bg maps to bg. */
vec3 toneOverBg(vec3 c, vec3 bg) {
  vec3 over = max(c - bg, 0.0);
  vec3 under = max(bg - c, 0.0);
  return bg + over / (1.0 + over) - under / (1.0 + under);
}

void main() {
  // -- 1. Read simulation state --
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float curvature = state.g;
  float age = state.b;

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);

  // -- 2. Interior: depth gradient, darkened at folds --
  // smootherstep rather than a clamped divide so the crossover from primary to
  // secondary has no acceleration corner as the contour sweeps past a pixel.
  float depth = smootherstep(0.0, 0.3, -sdf);
  vec3 interior = mix(uColorPrimary, uColorSecondary, depth);

  // High curvature reads as a fold, so shade it — this is the cue that makes
  // the shape look three-dimensional rather than like a flat stencil.
  interior *= 1.0 - clamp(abs(curvature) * 0.8, 0.0, 0.4);

  // Nutrient wave travelling through the age gradient: fresh tissue is phase 0
  // and old tissue is phase -14, so a crest moves outward from the front.
  float wave = 0.5 + 0.5 * sin(uClock - age * 14.0);

  // The interior mask is a smootherstep rather than the old branch on sdf < 0,
  // which put a hard one-pixel step at the contour that no amount of edge glow
  // could hide.
  float inside = smootherstep(0.004, -0.004, sdf);
  vec3 color = mix(uBgColor, interior * uIntensity, inside);
  color = highlight(
    color, uColorPrimary, wave * 0.10 * uIntensity * inside, darkBg
  );

  // -- 3. The contour line --
  // Bass thickens it: weight and body are what a low band should carry.
  float edgeWidth = uWidth * 0.01 * audioLift(u_bass, 0.25);
  float edgeFactor = smootherstep(edgeWidth, 0.0, abs(sdf));
  vec3 accent = uColorAccent * (1.0 + audioHueShift(0.3));
  color = mix(color, accent * uIntensity, edgeFactor * 0.8);

  // -- 4. Halo around the contour --
  float glowFactor = smootherstep(edgeWidth * 4.0, 0.0, abs(sdf));
  float glowGain = uGlow * 0.3 * audioLift(u_energy, 0.3) + beatHit(1.8) * 0.14;
  color = highlight(color, accent * uIntensity, glowFactor * glowGain, darkBg);

  // -- 5. Fresh growth glow --
  float freshness = (1.0 - smoothstep(0.0, 0.15, age)) * inside;
  color = highlight(
    color, accent, freshness * 0.15 * uIntensity * audioLift(u_mids, 0.4), darkBg
  );

  // -- 6. Tone mapping, relative to the background --
  color = toneOverBg(color, uBgColor);

  // -- 7. Overall strength --
  color = mix(uBgColor, color, uIntensity);

  // -- 8. Vignette (ramped down by the renderer while audio plays) --
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // -- 9. Film grain — u_flux is noisy by design, which suits grain --
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain
         * audioLift(u_flux, 0.5);

  // -- 10. Brightness cap, floored at the background --
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;
