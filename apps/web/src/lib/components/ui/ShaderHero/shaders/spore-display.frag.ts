/**
 * Spore display fragment shader (GLSL ES 3.0).
 *
 * Maps the two trail channels to a brand-coloured filament network, with the
 * agent channel drawn as bright accent fronts and a slow shimmer travelling
 * along the trails.
 *
 * ## What changed and why
 *
 * **The agent glow now shows agents.** It gathered a 3x3 neighbourhood of the
 * A channel, which the old sim filled with a per-texel hash re-rolled every two
 * seconds — so the "agent highlights" were a static noise pattern that jumped
 * every 2s, unrelated to anything moving. The A channel now carries advected
 * agent presence, so the same gather draws the fronts where the network is
 * actually being extended.
 *
 * **Fetch count.** The pass did a point sample, then a separate 3x3 loop for
 * the agent glow, then four more taps for the trail gradient: 14 fetches. The
 * 3x3 loop now returns the whole `vec4` and supplies the trail, the secondary
 * trail and the agent presence from one gather, and the gradient comes from the
 * taps that gather already read — 9 fetches for a strictly better result (the
 * trail is tent-weighted rather than point-sampled, so filaments no longer
 * stair-step where the canvas is larger than the 512x512 simulation).
 *
 * **Light backgrounds.** `color / (1 + color)`, `min(color, 0.75)` and
 * `mix(uBgColor, color, uIntensity)` are all absolute, so a light `uBgColor` of
 * 0.96 arrived at 0.49 — a grey network on a grey ground before any brand
 * colour was applied. Tone mapping is now relative to the background, the cap
 * is floored at it, and additive glows route through `highlight()`.
 *
 * **Motion.** The pass had none of its own beyond film grain. A shimmer now
 * travels along the trail-strength gradient, paced by `uClock` — the monotone
 * clock the renderer integrates at 0.3 rad/s when silent and at the music's
 * rate when playing. The rate is blended and integrated in the RENDERER, never
 * crossfaded here: `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the phase backwards as
 * the ramp eases in and the shimmer runs in reverse when playback starts.
 *
 * **Audio.** `beatHit()` flares the agent fronts — the one place a beat should
 * be visible in a network is where it is growing; `u_energy` opens the trail
 * ramp; `u_treble` sparkles on strong trail only; `audioHueShift()` warms the
 * accent with timbre; `u_flux` gains the grain.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const SPORE_DISPLAY_FRAG = `#version 300 es
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
  // ---- 1. One 3x3 gather for everything ----
  // Tent weights for the trails (anti-aliases filaments when the canvas is
  // larger than the 512x512 simulation), a plain mean for the agent channel
  // (its fronts want to read as a soft glow, not a hard dot), and the axial
  // taps kept for the gradient.
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float trail = 0.0;
  float trail2 = 0.0;
  float agentSum = 0.0;
  float w = 0.0;
  float tN = 0.0, tS = 0.0, tE = 0.0, tW = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 nb = texture(uState, v_uv + vec2(float(x), float(y)) * tx);
      float k = (x == 0 && y == 0) ? 4.0 : (abs(x) + abs(y) == 1 ? 2.0 : 1.0);
      trail += nb.r * k;
      trail2 += nb.g * k;
      agentSum += nb.a;
      w += k;
      if (x == 0 && y == 1) tN = nb.r;
      if (x == 0 && y == -1) tS = nb.r;
      if (x == 1 && y == 0) tE = nb.r;
      if (x == -1 && y == 0) tW = nb.r;
    }
  }
  trail /= w;
  trail2 /= w;
  float agent = agentSum / 9.0;

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);
  vec3 accent = uColorAccent * (1.0 + audioHueShift(0.3));

  // ---- 2. Trail network colouring ----
  // The slow envelope opens the upper end of the ramp, so a loud passage pushes
  // more of a trunk route into the secondary stop. Macro signal only: moving a
  // stop per note would strobe the whole network.
  float open = u_energy * u_audioActive;
  float t = smootherstep(0.05, 0.8 - open * 0.15, trail);
  float t2 = smootherstep(0.1, 0.6 - open * 0.10, trail2);

  vec3 color = mix(uBgColor, uColorPrimary, t * 0.9);
  color = mix(color, uColorSecondary, t2 * 0.5);

  // ---- 3. Shimmer travelling along the trail gradient ----
  // Phase comes from trail strength, so a crest moves from thin capillaries
  // toward trunk routes rather than flashing the network uniformly.
  float shimmer = 0.5 + 0.5 * sin(uClock - trail * 6.0);
  color = highlight(
    color, uColorPrimary, shimmer * t * 0.08 * audioLift(u_mids, 0.4), darkBg
  );

  // ---- 4. Agent fronts — where the network is being drawn right now ----
  float front = smootherstep(0.05, 0.45, agent);
  color = highlight(color, accent, front * (0.30 + beatHit(1.6) * 0.20), darkBg);

  // ---- 5. Trail edge definition ----
  float edge = length(vec2(tE - tW, tN - tS));
  color = highlight(color, accent, edge * 0.2, darkBg);

  // ---- 6. Treble sparkle, on strong trail only ----
  // Confined to established routes so the empty field never twinkles: a
  // background that sparkles everywhere reads as noise, not as a reaction.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(uTime * 3.3) * 83.0);
  sparkle = pow(sparkle, 11.0) * u_treble * u_audioActive
          * smoothstep(0.3, 0.9, trail);
  color = highlight(color, mix(accent, vec3(1.0), 0.55), sparkle * 1.6, darkBg);

  // ---- 7. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

  // ---- 8. Overall strength ----
  color = mix(uBgColor, color, uIntensity);

  // ---- 9. Vignette (ramped down by the renderer while audio plays) ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 10. Film grain — u_flux is noisy by design, which suits grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain
         * audioLift(u_flux, 0.5);

  // ---- 11. Brightness cap, floored at the background ----
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;
