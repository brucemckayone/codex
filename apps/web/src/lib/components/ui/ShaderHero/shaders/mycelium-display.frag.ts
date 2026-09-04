/**
 * Mycelium display fragment shader (GLSL ES 3.0).
 *
 * Reads the simulation buffer (R = density, G = direction, B = age) and renders
 * hyphae with a travelling nutrient pulse, junction shading from screen-space
 * derivatives, accent-coloured growth tips, and a soft halo around the network.
 *
 * ## What changed and why
 *
 * **The halo gather.** Empty texels ran a 5x5 nested loop — 25 fetches to
 * produce one blurred mean — on top of the 9-fetch 3x3 read every texel does.
 * It is now an 8-tap equal-area golden-angle spiral over the same radius: 17
 * fetches instead of 34 on the majority of the frame (an established network
 * occupies well under half the field), for a visually indistinguishable halo.
 *
 * It also had a shadowing bug: the outer `vec2 tx` (a true texel size from
 * `textureSize`) was shadowed inside the loop by a `float tx = 1.0 / 512.0`, so
 * the halo silently hardcoded the simulation resolution. The spiral uses the
 * measured texel size.
 *
 * **The nutrient pulse.** It was `age * 10.0 - uTime * uPulse` scaled by pi —
 * 2.2 rad/s off the wall clock at the default `pulse` of 0.7, fast enough to
 * read as a throb over the whole network. It now runs off `uClock`, the
 * monotone clock the renderer integrates at 0.5 rad/s when silent and at the
 * music's rate when playing, which puts the silent pulse at 1.1 rad/s. This is
 * internal flow along the branches, not camera movement, so it is kept and
 * strengthened rather than removed.
 *
 * The clock is integrated in the RENDERER. Crossfading
 * `mix(uTime * k, u_beatPhase, u_audioActive)` here looks equivalent and is
 * not: `u_beatPhase` starts at zero while `uTime` may be at 60s, so the
 * crossfade sweeps the phase backwards as the ramp eases in and every pulse
 * visibly runs back down its branch the moment playback starts.
 *
 * **Light backgrounds.** `color / (1 + color)`, `min(color, 0.75)` and
 * `mix(uBgColor / (1 + uBgColor), color, uIntensity)` are all absolute, so a
 * light `uBgColor` of 0.96 came out at 0.49 — grey network on grey. Tone
 * mapping is now relative to the background, the cap is floored at it, and
 * additive glows route through `highlight()`.
 *
 * **Audio.** `u_treble` sharpens the pulse crest (fine detail is what a high
 * band should carry), `beatHit()` flares the growth tips, `u_energy` opens the
 * halo, `audioHueShift()` warms the accent with timbre, `u_flux` gains grain.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const MYCELIUM_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uPulse, uTime;
uniform float uClock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Taps for the halo gather. Constant so the loop unrolls. */
const int HALO_TAPS = 8;

/** Golden-angle rotation, pre-resolved: cos/sin of pi*(3-sqrt(5)) rad. */
const float GOLDEN_C = -0.737368878;
const float GOLDEN_S = 0.675490294;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/** Advance a unit direction by the golden angle. */
vec2 spin(vec2 d) {
  return vec2(GOLDEN_C * d.x - GOLDEN_S * d.y, GOLDEN_S * d.x + GOLDEN_C * d.y);
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
  // ---- 1. 3x3 tent-weighted read ----
  // The simulation's density channel is effectively binary, so a point sample
  // renders single-texel stair-stepped hyphae. This is the anti-aliasing.
  vec2 tx = vec2(1.0) / vec2(textureSize(uState, 0));
  float density = 0.0;
  float direction = 0.0;
  float age = 0.0;
  float w = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      float k = (dx == 0 && dy == 0) ? 4.0 : (abs(dx) + abs(dy) == 1 ? 2.0 : 1.0);
      vec4 s = texture(uState, v_uv + vec2(float(dx), float(dy)) * tx);
      density += s.r * k;
      direction += s.g * k;
      age += s.b * k;
      w += k;
    }
  }
  density /= w;
  direction /= w;
  age /= w;

  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);
  vec3 accent = uColorAccent * (1.0 + audioHueShift(0.3));

  vec3 color = uBgColor;
  float branchMask = smootherstep(0.15, 0.5, density);

  // ---- 2. Nutrient pulse travelling along the branches ----
  // Age increases away from the tip, so a crest moving in uClock travels from
  // the tip back down the hypha. Treble sharpens the crest without moving it:
  // raising a raised-sine to a power narrows it, which is fine detail, not
  // geometry, so a snappy band is the right driver.
  float pulseWave = 0.5 + 0.5 * sin((age * 10.0 - uClock * uPulse) * 3.14159);
  pulseWave = pow(pulseWave, 1.0 + u_treble * u_audioActive * 1.2);

  vec3 branchColor = mix(uColorPrimary, accent, pulseWave * 0.4);

  // ---- 3. Junction shading ----
  // Density derivatives are largest where hyphae cross or fork.
  float edgeness = smoothstep(0.0, 0.2, abs(dFdx(density)) + abs(dFdy(density)));
  branchColor = mix(
    branchColor, uColorSecondary, smoothstep(0.1, 0.3, edgeness) * 0.5
  );

  // ---- 4. Growth tips ----
  // Fresh tissue only, so the flare marks where the network is ACTIVELY
  // growing — which is the one place a beat should be visible in a network.
  float youth = 1.0 - smoothstep(0.0, 0.08, age);
  branchColor = mix(branchColor, accent, youth * (0.7 + beatHit(1.7) * 0.25));

  color = mix(uBgColor, branchColor * uIntensity, branchMask);
  color = highlight(
    color,
    uColorPrimary,
    pulseWave * 0.15 * uIntensity * branchMask * audioLift(u_mids, 0.4),
    darkBg
  );

  // ---- 5. Halo, on the empty side of the network only ----
  // Equal-area spiral out to 2.5 texels; r_k = rmax * sqrt((k + 0.5) / N) puts
  // equal disc area between taps, so the plain mean needs no per-tap weight.
  float halo = 0.0;
  vec2 dir = vec2(1.0, 0.0);
  float rmax = tx.x * 2.5;
  for (int i = 0; i < HALO_TAPS; i++) {
    float r = rmax * sqrt((float(i) + 0.5) / float(HALO_TAPS));
    halo += texture(uState, v_uv + dir * r).r;
    dir = spin(dir);
  }
  halo = (halo / float(HALO_TAPS)) * (1.0 - branchMask);
  color = highlight(
    color,
    uColorPrimary,
    halo * 0.10 * uIntensity * audioLift(u_energy, 0.5),
    darkBg
  );

  // ---- 6. Tone mapping, relative to the background ----
  color = toneOverBg(color, uBgColor);

  // ---- 7. Overall strength ----
  color = mix(uBgColor, color, uIntensity);

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
