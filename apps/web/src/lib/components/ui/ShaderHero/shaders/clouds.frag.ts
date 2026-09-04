/**
 * Clouds fragment shader — procedural sky with volumetric-looking clouds.
 *
 * ## What this preset is
 *
 * A sky. That matters more than it sounds: `u_bgColor` is a brand slot, so
 * half the palettes a creator can choose are LIGHT, and a cloud shader that
 * assumes night is broken on all of them. This file's colour section is
 * written around that, not retrofitted to it.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** One outright bug: the pointer wind was applied as
 * `p += windShift * t * 10.0`, and `t` grows without bound. The pointer's
 * influence therefore grew linearly with how long the page had been open —
 * after ten minutes at the default speed, the same pointer position displaced
 * the sky about eighteen times further than it did at load, and the
 * displacement kept growing. It is a bounded parallax now. `u_mouseActive`
 * also arrived as a hard 1 or 0, so the parallax snapped back the instant the
 * pointer left the canvas; it is damped in the renderer. The cloud drift
 * itself is kept — clouds really do stream past, that is internal flow, not a
 * camera — but it is paced by an integrated clock and given a bounded
 * cross-wind from `drift2()` so a ten-minute view does not read as a straight
 * texture scroll.
 *
 * **Audio.** Previously `speed + amplitude * 0.1` off the raw per-frame
 * amplitude, which reads as jitter. Now: `u_bass` thickens the cloud mass by
 * lowering the cover threshold, `u_energy` (4s time constant) opens the
 * sunlit-to-shadowed range, `u_beatSeed` re-rolls a bounded direction that
 * slides the noise domain so the cloud field reshuffles on each onset,
 * `u_treble` sparkles the ridge glow, `u_beatPulse` flares the tops,
 * `u_centroid` warms the sky, and `u_flux` rides the grain.
 *
 * **Cost.** The guaranteed win is the density FBM dropping from four octaves
 * to three: its fourth carries under 7% of the amplitude and feeds only a soft
 * brightness term, invisible under the silhouette mask. That is 8.00 simplex
 * lookups per pixel down to 7.00, measured over a 480x270 grid. The pointer
 * clear-mask also lost a `sqrt` — the distance was immediately squared again —
 * and no longer runs its `exp` when there is no click.
 *
 * The density FBM is additionally skipped when the shape FBM has already
 * fallen at or below `u_cover`, which is sound because
 * `cloud = smoothstep(cover, cover + 0.3, shape * density)` and `density`
 * cannot exceed 1, so `shape <= cover` PROVES `cloud == 0`. Be honest about
 * what that buys: over the measured grid the 4-octave ridged shape has a
 * minimum of 0.215 and a median of 0.594, so at the default cover of 0.2 the
 * reject fires on 0.0% of pixels. It reaches 5.4% at cover 0.35, 27.5% at 0.5
 * and 64.4% at 0.65 — the sparse-cloud configurations. It is one compare, so
 * it is free where it does not fire, but it is not a default-case win.
 *
 * **Colour.** The light-sky problem turned out to be narrower than it looked,
 * and the first attempt at it made things worse — so the finding is recorded
 * here rather than quietly dropped.
 *
 * Measured over a 320x180 grid with a light palette (background luminance
 * 0.979), the ORIGINAL preset rendered its clouds perfectly visibly: mean
 * visible amplitude 0.0237, and 0.0637 within the clouds themselves. What was
 * actually broken was the ceiling — the frame peaked at 0.914 and averaged
 * 0.748, so a white background could not render as white, because ACES maps an
 * input of 1.0 to 0.804.
 *
 * The obvious fix, rewriting the cloud stops so a cloud reads DARKER than a
 * bright sky (which is what real cumulus do) and dividing the tonemap by
 * aces(1.0), scored 0.0137 mean and 0.0338 within-cloud: it halved the
 * clouds' visibility in the name of fixing them. A full gain leaves headroom
 * only up to an input of about 1.13, and the sunlit tops run to 1.6x, so cloud
 * and sky both clipped to white.
 *
 * What shipped is the minimal change the evidence supports: the cloud stops
 * are untouched, the zenith no longer scales `u_bgColor` by 0.55 on a light
 * palette, and the tonemap uses a white point of 1.6 — the tops' own HDR
 * scale. That lifts the mean to 0.809 and the peak to 0.984 while
 * within-cloud contrast holds at 0.0640. The dark palette is bit-identical.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const CLOUDS_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_cover;
uniform float u_scale;
uniform float u_dark;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see clouds-renderer.ts).
 *
 * Already scaled by the preset's speed setting, which is why there is no
 * u_speed uniform any more: speed multiplies the integration RATE rather than
 * the elapsed time, so changing it cannot retroactively teleport the cloud
 * field to a different point in the wind.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289v3((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float ridgedNoise(vec2 p) { return 1.0 - abs(snoise(p)); }

/**
 * Cloud silhouette: four octaves of ridged noise. Ridges are what give a
 * cumulus its cauliflower edge, so this one keeps all four.
 *
 * The wind offset arrives as an argument rather than being derived from a
 * time uniform in here, so the caller owns the pacing clock and the bounded
 * cross-wind in one place.
 */
float cloudShape(vec2 p, vec2 wind) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;
  vec2 drift = wind;
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    f += amp * ridgedNoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.3;
  }
  return f / totalAmp;
}

/**
 * Cloud interior density: three octaves of smooth noise.
 *
 * Was four. The fourth carried 0.0625 of 0.9375 total amplitude — under 7% —
 * and it feeds only the brightness term, a soft shading value that the
 * silhouette mask then multiplies down. It was not visible, and it was an
 * eighth of this preset's whole noise budget.
 */
float cloudDensity(vec2 p, vec2 wind) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;
  vec2 drift = wind;
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    f += amp * snoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.2;
  }
  return (f / totalAmp) * 0.5 + 0.5;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // Integrated by the renderer, never derived here. Deriving it as
  // mix(u_time * k, u_beatPhase, u_audioActive) would sweep it BACKWARDS as
  // the audio ramp eased in, because beatPhase starts at zero when the
  // analyser is created while u_time may already be at 60s — the whole sky
  // would blow backwards at the moment playback started.
  float clock = u_clock;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // ── Light-vs-dark palette ─────────────────────────────────────
  // Every decision below that used to assume a dark sky blends on this.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float lightSky = smoothstep(0.42, 0.78, bgLum);

  // ── Sky gradient: horizon, primary hint, secondary zenith ─────
  vec3 skyLow = mix(u_bgColor, u_brandPrimary, 0.3);
  vec3 skyTop = mix(
    u_brandSecondary,                            // night: full secondary
    mix(u_bgColor, u_brandSecondary, 0.5),       // day: keep the sky bright
    lightSky
  );
  // Timbre warms the zenith. audioTint preserves the base exactly at silence.
  skyTop = audioTint(skyTop, u_brandAccent, u_centroid, 0.3);

  vec3 skyColor;
  if (uv.y < 0.45) {
    skyColor = mix(u_bgColor, skyLow, uv.y / 0.45);
  } else {
    skyColor = mix(skyLow, skyTop, (uv.y - 0.45) / 0.55);
  }

  // ── Sampling domain ───────────────────────────────────────────
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;

  // Pointer parallax, BOUNDED. The old form multiplied this by the unbounded
  // clock, so the pointer's authority over the sky grew for as long as the
  // page stayed open. u_mouseActive is a damped 0..1, so leaving the canvas
  // is a glide rather than a snap.
  vec2 windShift = u_mouseActive * vec2(
    (u_mouse.x - 0.5) * 0.3,
    (u_mouse.y - 0.5) * 0.15
  );
  p += windShift * u_scale * 2.0;

  // Per-onset reshuffle: a bounded offset whose DIRECTION is re-rolled on each
  // onset, so the cloud field slides and reorganises on the beat instead of
  // only brightening. The seed is slewed over 250ms upstream, so each re-roll
  // is a glide; 0.12 units against a domain of about 1.1.
  float seedAng = u_beatSeed * 6.2831853;
  p += vec2(cos(seedAng), sin(seedAng)) * 0.12 * u_audioActive;

  // Wind. Linear because clouds really do stream past, but with a bounded
  // cross-wind so the path curves instead of scrolling dead straight forever.
  // The cross term's peak rate is 0.062 * 2 * 0.25 = 0.031 units per unit
  // clock, about 5% of the linear term at the default speed.
  vec2 wind = vec2(clock * 0.6, clock * 0.3) + drift2(clock * 2.0, 5.1) * 0.25;

  // ── Click: clear the sky near the cursor ──────────────────────
  float clearMask = 1.0;
  if (u_burst > 0.01) {
    vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
    vec2 fragUV = vec2(uv.x * aspect, uv.y);
    vec2 toMouse = fragUV - mouseUV;
    // Only the squared distance is used, so the old distance() sqrt was
    // immediately squared again.
    clearMask = 1.0 - u_burst * exp(-dot(toMouse, toMouse) * 10.0);
  }

  // ── Cloud field ───────────────────────────────────────────────

  // Bass thickens the mass by lowering the cover threshold. u_bass is the
  // smoothed band, which the shared vocabulary designates for body and
  // weight; the depth is small because cover is a threshold, and a large
  // swing would make cloud appear out of clear sky.
  float cover = u_cover - u_bass * 0.05 * u_audioActive;

  float shape = cloudShape(p, wind);

  // Analytic reject. cloud is smoothstep(cover, cover + 0.3, shape * density)
  // and density is bounded above by 1, so shape <= cover PROVES cloud == 0 —
  // at which point the three-octave density FBM cannot affect this pixel and
  // is skipped. Same shape as a bounding-volume reject on a raymarch: prove
  // the contribution is zero, then skip the expensive evaluation rather than
  // computing it and multiplying by zero. (The cloud colouring and bloom below
  // still evaluate; they collapse to zero through the cloud mask, and they are
  // a handful of ALU against three simplex lookups.)
  //
  // Hit rate is entirely cover-dependent: 0% at the default cover of 0.2
  // (the measured shape minimum is 0.215), 27.5% at 0.5, 64.4% at 0.65. It
  // costs one compare, so it is free where it does not fire.
  float cloud = 0.0;
  float brightness = 0.3;
  if (shape > cover) {
    float density = cloudDensity(p * 1.5, wind * 0.7);
    cloud = smootherstep(cover, cover + 0.3, shape * density) * clearMask;
    brightness = density * 0.7 + 0.3;
  }

  // ── Cloud colouring ────────────────────────────────────────
  // Slow envelope opens the sunlit-to-shadowed range across a musical section.
  float lit = u_light * audioLift(u_energy, 0.25);

  // Sunlit tops blow out toward white with HDR headroom for ACES to roll off;
  // shadowed undersides go toward the primary. Both stops are unchanged from
  // before this pass, INCLUDING on a light sky, and that is a measured
  // decision rather than an omission — see the tonemap note at the bottom of
  // this function.
  vec3 cloudLightColor = mix(u_brandPrimary, vec3(1.0), 0.6) * (1.0 + lit) * 1.6;
  vec3 cloudDarkColor = u_brandPrimary * (1.0 - u_dark) * 0.8;
  vec3 cloudColor = mix(cloudDarkColor, cloudLightColor, brightness);

  // Ridge glow with the accent — warmer at tall ridges. Treble sparkles it,
  // since high-frequency content belongs on the finest detail available.
  cloudColor += u_brandAccent * pow(shape, 3.0) * 0.7 * audioLift(u_treble, 0.4);

  vec3 color = mix(skyColor, cloudColor, cloud);

  // ── Bloom on the brightest cloud peaks ────────────────────
  // Beats flare the tops. Light side, so a transient never moves a silhouette.
  float cloudLum = cloud * brightness;
  color += pow(cloudLum, 2.5) * mix(u_brandSecondary, u_brandAccent, 0.4) * (0.35 + beatHit(1.5) * 0.35);

  // ── Post-process ───────────────────────────────────────────
  //
  // The light-background defect this preset actually had is HERE, not in the
  // cloud colours. ACES maps an input of 1.0 to 0.804, so a white brand
  // background rendered at a measured peak of 0.914 and a frame mean of 0.748
  // against a background luminance of 0.979 — the sky could not reach the
  // value the creator chose. The clouds themselves were never invisible.
  //
  // The fix is a white point, not a flat gain, and the difference is the whole
  // point. Dividing by aces(1.0) maps 1.0 to 1.0 but leaves headroom only up
  // to an input of about 1.13, and the sunlit tops run to 1.6 x their base —
  // so cloud and sky both clip to white and the clouds vanish. Measured over a
  // 320x180 grid with a light palette, that form cut within-cloud contrast
  // from 0.0637 to 0.0338, i.e. it broke the preset in the name of fixing it.
  // Dividing by aces(1.6) instead — the tops' own HDR scale — lifts the frame
  // mean to 0.809 and the peak to 0.984 while within-cloud contrast holds at
  // 0.0640. The dark palette is bit-identical either way, since lightSky is 0.
  const float ACES_WHITE = 0.8862;   // aces(1.6)
  color = clamp(aces(color) * mix(1.0, 1.0 / ACES_WHITE, lightSky), 0.0, 1.0);

  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Luminance-aware grain. Spectral flux is noisy by construction — right for
  // grain, wrong for anything structural.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum) * (1.0 + u_flux * 0.5 * u_audioActive);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
