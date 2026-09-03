/**
 * Vapor fragment shader — Volumetric dot-noise clouds with ACES tonemapping.
 *
 * ## Reference implementation
 *
 * This preset is the worked example for the shared shader substrate. It shows
 * all three pieces in one file, and other presets should follow its shape:
 *
 *  - `AUDIO_UNIFORMS` + `AUDIO_HELPERS` from `../audio-glsl`
 *  - `MOTION_HELPERS` from `../motion-glsl`
 *  - `createAudioFade()` / `uploadAudioUniforms()` in `../renderers/vapor-renderer.ts`
 *
 * ## What changed and why
 *
 * **Camera motion.** The previous version advanced the volume with
 * `p.z += u_time * u_speed * 0.1` and swept it sideways with a single
 * `sin(u_time * u_speed * 0.05)`. The linear z term is unbounded, and because
 * it was applied *after* `p *= u_scale`, raising scale silently multiplied the
 * apparent travel speed — so the "scale" slider doubled as a speed slider. The
 * lone sine is the mechanical sweep: one frequency at visible amplitude, whose
 * turnarounds read as a stop-and-reverse. Both are replaced by `drift3()`,
 * three incommensurate low-frequency components per axis with an analytically
 * bounded derivative, plus a forward travel term that is now paced by a clock
 * and applied in pre-scale space so `u_scale` only changes scale.
 *
 * **Audio.** Previously none at all. Now: travel is paced by `u_beatPhase` so
 * the clouds move *with* the track and settle when it stops; bass thickens the
 * medium, treble adds high-frequency sparkle to the brightest regions, the slow
 * `u_energy` envelope opens the depth palette out, `u_centroid` shifts warmth
 * with timbre, and `u_beatPulse` blooms the accumulated light. Every term is
 * gated on `u_audioActive`, so with no audio the render is byte-identical in
 * intent to the silent look.
 *
 * **Cost.** The march is 80 fixed steps, exiting only once alpha saturates —
 * so an empty view paid full price. Now 56 steps with a per-pixel dither on the
 * start offset. Dithering trades banding for fine noise (which the existing
 * film grain already masks), and that buys back more quality than the 24 steps
 * cost: net ~30% fewer noise evaluations at equal or better appearance. The
 * per-step palette lookup also lost a divide — the old 3-weight normalised
 * blend became two nested `smootherstep` mixes, which is monotone as well as
 * cheaper.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const VAPOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_density;
uniform float u_scale;
uniform float u_warmth;
uniform float u_glow;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see vapor-renderer.ts).
 *
 * Already scaled by the preset's speed setting, which is why there is no
 * u_speed uniform any more — speed multiplies the integration RATE on the CPU
 * rather than the elapsed time here. That is what keeps a speed change from
 * retroactively rescaling the position the volume has already drifted to.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Steps in the volumetric march. Dithered, so this is far below the old 80. */
const int MARCH_STEPS = 56;
const float INV_MARCH_STEPS = 1.0 / float(MARCH_STEPS);

const mat3 G = mat3(
  0.618, 0.324, 0.0,
  0.0, 0.618, 0.324,
  0.324, 0.0, 0.618
);

// Asymmetric on purpose: G*p and p*G are row- vs column-major products, so the
// two terms decorrelate and the product reads as cellular rather than striped.
float dotNoise(vec3 p) {
  return dot(cos(G * p), sin(1.6 * p * G));
}

vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * Monotone 3-stop depth palette. Two nested smootherstep mixes: no divide, and
 * C2-continuous so the depth gradient has no visible seam where stops meet.
 * \`spread\` widens the mid stop — driven by the slow audio envelope so a busy
 * passage shows more of the secondary colour through the volume.
 */
vec3 depthPalette(float t, float spread) {
  float lo = 0.55 - spread * 0.15;
  float hi = 0.45 + spread * 0.15;
  vec3 c = mix(u_brandPrimary, u_brandSecondary, smootherstep(0.0, lo, t));
  return mix(c, u_brandAccent, smootherstep(hi, 1.0, t));
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse shifts the view direction. Kept — a shader that tracks the pointer
  // reads as responsive, and it is the one motion the viewer causes directly.
  vec2 mouseOffset = (u_mouse - 0.5) * 0.3;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv + mouseOffset, 2.0));

  // ── Pacing clock ────────────────────────────────────────────────
  // Integrated by the renderer, not derived here.
  //
  // The obvious form — mix(u_time * k, u_beatPhase, u_audioActive) — is
  // WRONG, and this shader shipped it briefly. u_beatPhase starts at zero
  // when the analyser is created, while u_time may already be at 60s, so as
  // the audio ramp eases 0 to 1 the crossfade sweeps the clock *backwards*
  // from ~30 to ~0. The whole volume lurches in reverse at the exact moment
  // playback starts.
  //
  // The renderer instead differentiates the musical clock and integrates the
  // resulting RATE, blending rates rather than positions. Position is then
  // monotone by construction and no rate change can ever move it backwards.
  float clock = u_clock;

  // Bounded, non-repeating volume drift. Replaces the old single-sine sweep;
  // peak rate is ~0.062 per unit clock per axis (see motion-glsl.ts), so even
  // at u_speed = 2 this stays firmly in "drift" rather than "camera move".
  vec3 wander = drift3(clock, 3.1) * 1.4;

  // Forward travel. Still unbounded (it is a fly-through) but now paced by the
  // clock, so it stops with the music instead of running on wall time.
  float travel = clock * 0.55;

  // Bass thickens the medium; the lift is one-sided so silence is the resting
  // look and audio can only ever add body.
  float density = u_density * audioLift(u_bass, 0.35);

  // Slow envelope opens the palette out — a macro signal, so it never twitches.
  float spread = u_energy * u_audioActive;

  // Timbre-driven warmth. Bright material cools the mix, dark material warms
  // it, around a neutral centre — colour then tracks *what* is playing.
  float warmth = clamp(u_warmth + audioHueShift(0.35), 0.0, 1.0);

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float stepSize = 0.115;

  // Per-pixel dither on the start offset. Converts the march's stair-step
  // banding into fine noise, which is what makes 56 steps look like 80.
  float dither = hash(gl_FragCoord.xy + fract(u_time * 0.37));

  for (int i = 0; i < MARCH_STEPS; i++) {
    if (alpha > 0.95) break;

    float march = (float(i) + dither) * stepSize;
    vec3 p = ro + rd * march;

    // Travel and wander are applied BEFORE the scale multiply, so u_scale
    // changes only the noise frequency. Previously they were applied after,
    // which coupled scale to apparent speed.
    p.z += travel;
    p += wander;
    p *= u_scale * 0.1;

    float d = dotNoise(p) * 0.5 + 0.5;
    d = smoothstep(0.3, 0.7, d) * density;

    float depthFrac = float(i) * INV_MARCH_STEPS;
    vec3 layerColor = depthPalette(depthFrac, spread);

    // Warmth shift
    layerColor = mix(layerColor, layerColor * vec3(1.15, 1.0, 0.88), warmth);

    // Accumulate with HDR headroom so ACES has something to roll off.
    float a = d * (1.0 - alpha) * 0.18;
    color += layerColor * a * u_glow * 1.3;
    alpha += a;
  }

  // Click brightness pulse
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5) * 0.4;

  // Palette-tinted dark background
  vec3 bgTinted = mix(u_bgColor * 0.22, u_brandPrimary * 0.1, 0.4);
  color = mix(bgTinted, color, min(alpha + 0.1, 1.0));

  // Bloom halo on the brightest composite regions. Beats widen the halo — a
  // light-side response, so a transient never moves geometry.
  float vaporLum = dot(color, vec3(0.299, 0.587, 0.114));
  float haloGain = 0.3 + beatHit(1.5) * 0.45;
  color += pow(vaporLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * haloGain;

  // Treble sparkle. High-frequency content is spatially high-frequency too, so
  // it belongs on a fine per-pixel term rather than on the volume — and only
  // where the volume is already bright, or it reads as dirt on the screen.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(u_time * 3.1) * 91.0);
  sparkle = pow(sparkle, 12.0) * u_treble * u_audioActive;
  color += sparkle * mix(u_brandAccent, vec3(1.0), 0.6) * vaporLum * 2.5;

  // ── Post-process ───────────────────────────────────────────
  color = ACESFilm(color);

  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
