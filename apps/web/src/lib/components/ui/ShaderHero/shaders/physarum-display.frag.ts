/**
 * Physarum display fragment shader (GLSL ES 3.0).
 *
 * Renders the pheromone field as a glowing transport network: a four-stop brand
 * ramp on trail density, edge definition from screen-space derivatives, a
 * travelling pulse on dense junctions, and accent-bright agent fronts.
 *
 * ## What changed and why
 *
 * **Agent fronts are now visible.** The pass read only the trail channel, so
 * the moving agents — the thing that makes this a transport network rather than
 * a smear — were invisible; you saw only what they had left behind. The 3x3
 * read now takes the whole `vec4` (the same fetch, no extra cost) and the agent
 * channel drives a bright accent front, so the network reads as being drawn.
 *
 * **The node pulse.** It was `sin(uTime * 2.0 + trail * 10.0)`: 2 rad/s off the
 * wall clock, fast enough to read as a strobe over dense regions. It now runs
 * off `uClock`, the monotone clock the renderer integrates at 0.32 rad/s when
 * silent and at the music's rate when playing. The `trail * 10.0` term is kept
 * — that is what makes the pulse travel along a vein's density gradient rather
 * than flashing the whole network at once.
 *
 * The clock is integrated in the RENDERER. Crossfading
 * `mix(uTime * k, u_beatPhase, u_audioActive)` here looks equivalent and is
 * not: `u_beatPhase` starts at zero while `uTime` may be at 60s, so the
 * crossfade sweeps the phase backwards as the ramp eases in and the pulse runs
 * in reverse at the moment playback starts.
 *
 * **Light backgrounds.** The old chain tonemapped and capped in absolute terms,
 * so a light `uBgColor` of 0.96 arrived at 0.49 — grey network on grey ground,
 * before any brand colour was applied. Tone mapping is now relative to the
 * background, the cap is floored at it, and additive glows route through
 * `highlight()`.
 *
 * **The ramp.** Three `if`/`else if` branches with a divide each became three
 * `smootherstep` mixes: no divides, no branch, and C2-continuous where the
 * stops meet — the branch form creased visibly at t = 0.33 and t = 0.66, which
 * on a slowly strengthening vein reads as a hard band sweeping along it.
 *
 * **Audio.** `u_energy` opens the upper stops so busy passages push more of a
 * vein into accent; `beatHit()` flares the agent fronts; `u_treble` sparkles on
 * dense trail only; `audioHueShift()` warms the accent with timbre; `u_flux` —
 * noisy by design — gains the grain.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const PHYSARUM_DISPLAY_FRAG = `#version 300 es
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
  // ---- 1. 3x3 tent-weighted read of trail and agent presence ----
  // The simulation runs at a fixed 512x512 while the canvas may be larger, so a
  // point sample shows texel stair-steps on every vein. One vec4 fetch per tap
  // gives the agent channel for free.
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float trail = 0.0;
  float agent = 0.0;
  float w = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      float k = (dx == 0 && dy == 0) ? 4.0 : (abs(dx) + abs(dy) == 1 ? 2.0 : 1.0);
      vec4 s = texture(uState, v_uv + vec2(float(dx), float(dy)) * tx);
      trail += s.r * k;
      agent += s.b * k;
      w += k;
    }
  }
  trail /= w;
  agent /= w;

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);
  vec3 accent = uColorAccent * (1.0 + audioHueShift(0.3));

  // ---- 2. Four-stop ramp as smootherstep mixes ----
  // The slow envelope pulls the upper stops down, so a loud passage shows more
  // accent through the trunk veins. Macro signal only: moving a colour stop per
  // note would strobe the whole network.
  float t = clamp(trail * uIntensity, 0.0, 1.0);
  float open = u_energy * u_audioActive;
  vec3 color = mix(uBgColor, uColorPrimary, smootherstep(0.0, 0.34 - open * 0.06, t));
  color = mix(color, uColorSecondary, smootherstep(0.28, 0.70 - open * 0.08, t));
  color = mix(color, uColorAccent, smootherstep(0.64 - open * 0.10, 1.0, t));

  // ---- 3. Vein edge definition ----
  float edge = smoothstep(0.001, 0.02, abs(dFdx(trail)) + abs(dFdy(trail)));
  color = highlight(
    color, accent * uIntensity, edge * 0.06 * audioLift(u_mids, 0.4), darkBg
  );

  // ---- 4. Junction pulse ----
  float pulse = 0.5 + 0.5 * sin(uClock + trail * 10.0);
  float nodeGlow = smoothstep(0.5, 1.0, trail) * pulse * (0.07 + beatHit(1.9) * 0.08);
  color = highlight(color, accent, nodeGlow, darkBg);

  // ---- 5. Agent fronts — where the network is being drawn right now ----
  float front = smootherstep(0.2, 0.7, agent);
  color = highlight(
    color, accent, front * (0.18 + beatHit(1.6) * 0.18) * uIntensity, darkBg
  );

  // ---- 6. Treble sparkle, on dense trail only ----
  // Confined to strong veins so the empty field never twinkles: a background
  // that sparkles everywhere reads as noise rather than as the network reacting.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(uTime * 3.3) * 83.0);
  sparkle = pow(sparkle, 11.0) * u_treble * u_audioActive
          * smoothstep(0.35, 0.9, trail);
  color = highlight(color, mix(accent, vec3(1.0), 0.55), sparkle * 1.6, darkBg);

  // ---- 7. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

  // ---- 8. Vignette (ramped down by the renderer while audio plays) ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 9. Film grain — u_flux is noisy by design, which suits grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain
         * audioLift(u_flux, 0.5);

  // ---- 10. Brightness cap, floored at the background ----
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;
