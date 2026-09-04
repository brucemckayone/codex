/**
 * Plasma display fragment shader (GLSL ES 3.0).
 *
 * The signature effect is a sine of mass cubed: `sin(k * n * rho^3)` for four
 * increasing k, which turns a smooth density field into tight iridescent
 * banding with inverted-colour cores. The raw sine triplet is remapped through
 * the brand palette rather than used as RGB.
 *
 * ## What changed and why
 *
 * **Light backgrounds.** `color / (1 + color)`, `min(color, 0.75)` and
 * `mix(uBgColor, color, uIntensity)` are all absolute, so a light `uBgColor` of
 * 0.96 was tonemapped to 0.49: the vacuum regions, which is most of the frame,
 * came out mid grey. Tone mapping is now relative to the background and the cap
 * is floored at it, so vacuum renders as the creator's background whatever its
 * luminance.
 *
 * **The band mask.** `smoothstep(0.02, 0.15, r)` faded the bands in over a
 * narrow density window with a visible acceleration corner at each end; it is
 * now `smootherstep`, whose second derivative also vanishes, because the mask
 * edge sweeps slowly across the frame as the plasma moves and a C1 corner
 * shows up as a hard rim on every fireball.
 *
 * **Motion of its own.** The pass had none — every bit of movement came from
 * the simulation. A slow common phase offset on the band sines now adds an
 * iridescent shimmer, paced by `uClock`, the monotone clock the renderer
 * integrates at 0.35 rad/s when silent and at the music's rate when playing.
 * Because it is a common offset it shifts the band pattern without changing the
 * band SPACING, so it reads as sheen rather than as the density changing.
 *
 * The clock is integrated in the RENDERER, never crossfaded here:
 * `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the phase backwards as
 * the ramp eases in and the sheen visibly runs in reverse when playback starts.
 *
 * **Audio.** `u_energy` widens the band count by up to 12% — since band phase
 * goes as density cubed, that is a slow, smooth change in the fineness of the
 * iridescence and never a jump; `beatHit()` blooms the dense cores;
 * `audioHueShift()` warms the accent with timbre; `u_flux` — noisy by design —
 * gains the grain. The band count was previously modulated by `+ mids * 0.1`
 * on a base of 25, which is 0.4% and therefore not visible at all.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const PLASMA_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uBands;
uniform float uClock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Emphasis that survives a light palette: additive on dark, blend on light. */
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
  float r = texture(uState, v_uv).b; // mass

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);

  // ---- 1. The signature banding: sin(k * n * rho^3) ----
  // Band count rides the slow envelope only. Since the phase goes as rho^3, a
  // per-note band count would sweep the whole pattern through several cycles
  // between frames and alias into flicker.
  float bands = uBands * audioLift(u_energy, 0.12);
  float r3 = r * r * r;
  // uClock is a COMMON offset, so it slides the pattern without altering the
  // spacing — sheen, not a density change.
  vec4 raw = sin(vec4(1.0, 2.0, 3.0, 4.0) * bands * r3 + uClock);

  // ---- 2. Map the band triplet onto the brand palette ----
  float c1 = raw.x * 0.5 + 0.5;
  float c2 = raw.y * 0.5 + 0.5;
  float c3 = raw.z * 0.5 + 0.5;

  vec3 accent = uColorAccent * (1.0 + audioHueShift(0.3));
  vec3 color = mix(uBgColor, uColorPrimary, c1);
  color = mix(color, uColorSecondary, c2 * 0.6);
  color = mix(color, accent, c3 * 0.3);

  // ---- 3. Fade out toward vacuum ----
  // smootherstep, not smoothstep: this edge sweeps across the frame as the
  // plasma flows, and smoothstep's acceleration discontinuity reads as a hard
  // rim travelling with every fireball.
  float densityMask = smootherstep(0.02, 0.15, r);
  color = mix(uBgColor, color, densityMask);

  // ---- 4. Beat bloom on the dense cores ----
  // Cores only, so a beat reads as the fireballs flaring rather than the whole
  // frame flashing.
  float core = smootherstep(0.35, 0.9, r);
  color = highlight(color, accent, core * beatHit(1.7) * 0.22, darkBg);

  // ---- 5. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

  // ---- 6. Overall strength ----
  color = mix(uBgColor, color, uIntensity);

  // ---- 7. Vignette (ramped down by the renderer while audio plays) ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 8. Film grain — u_flux is noisy by design, which suits grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain
         * audioLift(u_flux, 0.5);

  // ---- 9. Brightness cap, floored at the background ----
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;
