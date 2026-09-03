/**
 * Lenia display fragment shader (GLSL ES 3.0).
 *
 * Maps continuous cell state to a four-stop brand ramp — void, outer corona,
 * body ring, dense core — so a creature's concentric internal structure reads
 * as concentric colour. Screen-space derivatives pick out the zone boundaries.
 *
 * ## What changed and why
 *
 * **The ramp.** Three `if`/`else if` branches over `t`, each with a divide,
 * became two nested `smootherstep` mixes. Cheaper, and C2-continuous where the
 * stops meet: the branch form had a visible crease wherever a creature's
 * density crossed t = 0.25 or t = 0.55, which on a slowly growing organism
 * reads as a hard contour line sweeping through it.
 *
 * **The core pulse.** It was `sin(uTime * 1.2 + state * 10.0)` — a single sine
 * at 1.2 rad/s off the wall clock, throbbing the whole field. It now runs off
 * `uClock`, a monotone clock the renderer integrates at 0.28 rad/s when silent
 * and at the music's rate when playing. The `state * 10.0` term is kept: that
 * is what makes the pulse travel out through a creature's density gradient
 * rather than flashing it uniformly.
 *
 * The clock is integrated in the RENDERER, not crossfaded here. Blending
 * `mix(uTime * k, u_beatPhase, u_audioActive)` in the shader looks equivalent
 * and is not: `u_beatPhase` starts at zero while `uTime` may be at 60s, so the
 * crossfade sweeps the phase backwards as the ramp eases in and the pulse
 * visibly runs in reverse the moment playback starts. Blending the RATE and
 * accumulating makes the position monotone by construction.
 *
 * **Light backgrounds.** `color / (1 + color)` and `clamp(color, 0, 0.75)` are
 * both absolute, so a light `uBgColor` of 0.96 was tonemapped to 0.49 — the
 * background alone came out mid grey before any creature was drawn. Tone
 * mapping is now relative to `uBgColor` and the cap is floored at it, and
 * additive glows route through `highlight()` so they read as emphasis on a
 * light ground instead of washing toward white.
 *
 * **Audio.** `u_energy` opens the upper stops so busy passages push more of a
 * creature into the accent colour; `u_mids` plus `beatHit()` gain the ring
 * highlight; `u_treble` sparkles on live tissue only; `audioHueShift()` warms
 * the accent with timbre; `u_flux` — noisy by design — gains the film grain.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const LENIA_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uClock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/**
 * Emphasis that survives a light palette: additive on a dark ground, a blend
 * toward the tint on a light one — where adding a saturated brand colour to
 * something near white only desaturates it.
 */
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
  // ---- 1. Read cell state ----
  float state = texture(uState, v_uv).r;
  float t = clamp(state * uIntensity, 0.0, 1.0);

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);

  // ---- 2. Four-stop ramp as smootherstep mixes ----
  // The slow envelope pulls the upper stops down, so a loud passage shows more
  // core through a creature's dense centre. Macro signal only: moving a colour
  // stop per note would strobe the whole field.
  float open = u_energy * u_audioActive;
  vec3 color = mix(uBgColor, uColorPrimary, smootherstep(0.0, 0.26 - open * 0.05, t));
  color = mix(color, uColorSecondary, smootherstep(0.22, 0.58 - open * 0.07, t));
  color = mix(color, uColorAccent, smootherstep(0.54 - open * 0.09, 1.0, t));

  // ---- 3. Concentric zone highlight ----
  // Lenia's kernel produces internal rings, and the state gradient is largest
  // exactly at their boundaries — so the derivative magnitude IS the structure.
  float ringMag = abs(dFdx(state)) + abs(dFdy(state));
  float ring = smoothstep(0.003, 0.05, ringMag);
  vec3 ringTint = uColorAccent * (1.0 + audioHueShift(0.3));
  float ringGain = 0.05 * audioLift(u_mids, 0.4) + beatHit(1.6) * 0.09;
  color = highlight(color, ringTint * uIntensity, ring * ringGain, darkBg);

  // ---- 4. Core breathing ----
  // uClock is monotone and paced by the music when there is any; at 0.28 rad/s
  // idle the breath is slow enough not to compete with hero text over it.
  float pulse = 0.5 + 0.5 * sin(uClock + state * 10.0);
  float coreGlow = smoothstep(0.62, 1.0, state) * pulse * (0.05 + beatHit(2.0) * 0.07);
  color = highlight(color, uColorAccent, coreGlow, darkBg);

  // ---- 5. Treble sparkle, on live tissue only ----
  // Confined to state > 0.25 so the void never sparkles: a background that
  // twinkles everywhere reads as noise rather than as the creatures reacting.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(uTime * 3.3) * 83.0);
  sparkle = pow(sparkle, 11.0) * u_treble * u_audioActive
          * smoothstep(0.25, 0.7, state);
  color = highlight(color, mix(uColorAccent, vec3(1.0), 0.55), sparkle * 1.6, darkBg);

  // ---- 6. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

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
