/**
 * SmoothLife display fragment shader (GLSL ES 3.0).
 *
 * Maps continuous cell state (0-1) to a brand colour gradient:
 * bg → primary → secondary → accent, with an edge glow on organism outlines
 * and a slow internal glow on dense cores.
 *
 * ## What changed and why
 *
 * **The ramp.** Three `if`/`else if` branches over `t` became two nested
 * `smootherstep` mixes. Cheaper (no divides, no branch), and C2-continuous
 * where the stops meet — the branch form had a visible crease at t = 0.3 and
 * t = 0.7 wherever an organism's density crossed a stop.
 *
 * **The core pulse.** It was `sin(uTime * 1.5 + state * 8.0)`: a single sine at
 * a visible frequency, driven by wall clock, throbbing the whole field at
 * 1.5 rad/s. It is now paced at 0.26 rad/s in hero mode and handed over to
 * `u_beatPhase` once audio starts, so the breathing belongs to the track. The
 * `state * 8.0` term is kept — that is what makes the pulse travel through an
 * organism's density gradient rather than flashing it uniformly.
 *
 * **Light backgrounds.** `Reinhard(colour)` then `clamp(colour, 0, 0.75)` are
 * both absolute, so a light `uBgColor` of 0.96 tonemapped to 0.49 and a white
 * brand palette rendered as mid grey. Both are now relative to `uBgColor`, and
 * additive glows route through `highlight()` so they read as emphasis on a
 * light ground instead of clipping toward white.
 *
 * **Audio.** `u_energy` opens the ramp so busy passages push more cells into
 * the accent stop, `beatHit()` blooms organism outlines, `u_treble` sparkles on
 * live tissue only, `audioHueShift()` warms the accent with timbre.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const LIFE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/**
 * Emphasis that survives a light palette. Additive on a dark ground (identical
 * to the previous behaviour), a blend toward the tint on a light one — where
 * adding a saturated brand colour to something near white only greys it out.
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

  // ---- 2. Four-stop ramp as two smootherstep mixes ----
  // The slow envelope pulls the upper stops down, so a loud section shows more
  // accent through the dense cores. Macro signal only: moving a colour stop
  // per note would strobe.
  float open = u_energy * u_audioActive;
  vec3 color = mix(uBgColor, uColorPrimary, smootherstep(0.0, 0.34 - open * 0.06, t));
  color = mix(color, uColorSecondary, smootherstep(0.28, 0.72 - open * 0.08, t));
  color = mix(color, uColorAccent, smootherstep(0.66 - open * 0.10, 1.0, t));

  // ---- 3. Organism edge glow ----
  float edgeStrength = smoothstep(0.002, 0.04, abs(dFdx(state)) + abs(dFdy(state)));
  vec3 edgeTint = uColorAccent * (1.0 + audioHueShift(0.3));
  float edgeGain = 0.05 * audioLift(u_mids, 0.4) + beatHit(1.6) * 0.10;
  color = highlight(color, edgeTint * uIntensity, edgeStrength * edgeGain, darkBg);

  // ---- 4. Internal pulsing on dense cores ----
  // Clock crossfades from a slow wall-clock drift to the musical clock, so the
  // breath is the track's when there is one and never faster than 0.26 rad/s
  // when there is not.
  float clock = mix(uTime * 0.26, u_beatPhase * 2.0, u_audioActive);
  float pulse = 0.5 + 0.5 * sin(clock + state * 8.0);
  float coreGlow = smoothstep(0.6, 1.0, state) * pulse * (0.06 + beatHit(2.0) * 0.08);
  color = highlight(color, uColorAccent, coreGlow, darkBg);

  // ---- 5. Treble sparkle, on live tissue only ----
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(uTime * 3.3) * 83.0);
  sparkle = pow(sparkle, 11.0) * u_treble * u_audioActive * smoothstep(0.25, 0.7, state);
  color = highlight(color, mix(uColorAccent, vec3(1.0), 0.55), sparkle * 1.8, darkBg);

  // ---- 6. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

  // ---- 7. Vignette (ramped down by the renderer while audio plays) ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 8. Film grain — u_flux is noisy by design, which suits grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain * audioLift(u_flux, 0.5);

  // ---- 9. Brightness cap, floored at the background ----
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;
