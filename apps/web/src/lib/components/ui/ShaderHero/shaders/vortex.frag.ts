/**
 * Vortex fragment shader — Polar volumetric spirals.
 *
 * ## What changed and why
 *
 * **Motion.** Every layer's angle got `+ u_time * u_speed`, so the entire
 * frame turned at one constant rate — the mechanical sweep, applied globally.
 * A real vortex does not rotate rigidly: angular velocity is highest in the
 * core and falls off with radius, so the arms shear past each other. The
 * rotation is now that Rankine-style profile driven by a monotone swirl
 * accumulator, which reads as internal flow rather than as a camera move and
 * costs nothing extra — the radius does not change inside the layer loop, so
 * the whole factor hoists out of it.
 *
 * The click used to twist the centre by up to three radians through
 * `theta += u_burstStrength * 3.0 * exp(-r * 2.0)` and then untwist it as the
 * burst decayed: a lurch out and a lurch home. It now feeds the swirl
 * accumulator's RATE, so a click spins the core up and the core stays spun up.
 *
 * The pointer still shifts the polar centre at full strength. That is the one
 * motion the viewer causes directly, and it deforms the whole silhouette of
 * the spiral, which is the kind of motion this pass is meant to keep.
 *
 * **Cost.** The layer loop ran up to 60 times per pixel and carried four
 * things that never changed with the layer index: the ring-edge highlight (a
 * function of radius alone), the cell size reciprocal, an `exp()` decay that
 * is a geometric sequence in disguise, and two divides. All four are now above
 * the loop — the decay became an incremental multiply. The palette also lost
 * its normalising divide: the old triangular weights provably sum to one, so
 * dividing by that sum was arithmetic to no purpose.
 *
 * **Quality.** The layer coordinate is dithered per pixel, which turns the
 * visible banding between slabs into fine noise the film grain already masks.
 * That matters most at the low end of the density slider, where the old
 * version showed concentric steps.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const VORTEX_FRAG = `#version 300 es
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
uniform int u_density;
uniform float u_twist;
uniform float u_rings;
uniform float u_spiral;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock for the travelling spiral phase and the hue drift,
 * integrated on the CPU (see vortex-renderer.ts). Already scaled by the
 * preset speed setting, which is why there is no u_speed uniform any more.
 */
uniform float u_clock;
/**
 * Monotone accumulated rotation. Separate from u_clock because it carries the
 * click and beat surges: those must add to a rotation RATE, never to a
 * rotation angle, or the field unwinds when the surge decays.
 */
uniform float u_swirl;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Reciprocal of two pi, so the hue and spiral terms need no divide. */
const float INV_TAU = 0.15915494;

/**
 * Core radius of the rotation profile, in the same units as the normalised
 * screen radius. Inside it the field turns almost as a solid body; outside,
 * angular velocity falls as the inverse square of radius.
 */
const float SWIRL_CORE = 0.42;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Cyclic 3-stop palette, wrapping at 1.0.
 *
 * The previous form took the circular distance to each of three pivots, ran a
 * smoothstep on each, summed the weights and divided by that sum. The divide
 * was unnecessary: for any input exactly two pivots are within a third of a
 * turn, and their weights are smoothstep(u) and smoothstep(1 - u), which sum
 * to one identically. Splitting the turn into three segments and blending the
 * pair directly gives the same curve with no divide, no max() guard, and three
 * fewer min/abs pairs — and it ran up to 60 times per pixel.
 */
vec3 cyclicPalette(float t) {
  float s = fract(t) * 3.0;
  float seg = floor(s);
  float f = s - seg;
  float w = f * f * (3.0 - 2.0 * f);
  float g1 = step(0.5, seg);
  float g2 = step(1.5, seg);
  vec3 a = mix(mix(u_brandPrimary, u_brandSecondary, g1), u_brandAccent, g2);
  vec3 b = mix(mix(u_brandSecondary, u_brandAccent, g1), u_brandPrimary, g2);
  return mix(a, b, w);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  // Pointer shifts the polar centre. Kept at full strength.
  uv += (u_mouse - 0.5) * 0.5;

  float r = length(uv);
  float theta = atan(uv.y, uv.x);

  // ── Differential rotation ──────────────────────────────────────────
  // Solid-body core, inverse-square falloff outside it. At the renderer's
  // idle swirl rate this is 0.36 rad/s at the very centre and about
  // 0.05 rad/s at r = 1, so the frame-average angular velocity is well under
  // the 0.25 rad/s at which a background starts reading as a camera move —
  // and no two radii share an angular velocity, which is what makes it read
  // as shear rather than as a turntable.
  float omega = (SWIRL_CORE * SWIRL_CORE)
              / (SWIRL_CORE * SWIRL_CORE + r * r);
  float swirl = u_swirl * omega;

  // ── Everything below is loop-invariant ─────────────────────────────
  int steps = max(u_density, 2);
  float invN = 1.0 / float(steps - 1);
  float cellSize = 1.0 / u_rings;
  float halfCell = 0.5 * cellSize;

  // Ring edges are a function of radius only. This was recomputed on every
  // one of up to 60 layers for a value that never changed. Treble drives the
  // highlight because filaments are fine detail — a light-side term, so a
  // transient brightens an edge instead of moving one.
  float ringEdge = smoothstep(0.03, 0.0, abs(fract(r * u_rings * 4.0) - 0.5));
  vec3 ringTint = mix(u_brandAccent, vec3(1.0), 0.35)
                * ringEdge * 0.6 * audioLift(u_treble, 0.3);

  // Hue base. The old term was + u_time * 0.2, a constant hue crawl that
  // eventually walked the palette right around the wheel. A bounded drift
  // wanders instead, and timbre offsets it on top.
  float hueBase = theta * INV_TAU + 0.5
                + driftAxis(u_clock * 0.5, 7.3) * 0.35
                + audioHueShift(0.22);

  // Travelling spiral phase, paced by the clock so the arms settle when the
  // music stops. fract() makes it a travelling wave, and a monotone clock
  // means it can only ever travel one way.
  float travel = u_clock * 0.5;

  // Spiral arm brightness opens out with the slow envelope, not with a band.
  float spiralGain = u_spiral * audioLift(u_energy, 0.22);

  // exp(-3 * d) with d = (i + dither) * invN is a geometric sequence: fold it
  // into an incremental multiply and the exp() leaves the hot loop entirely.
  float decay = exp(-3.0 * invN);
  float dither = hash(gl_FragCoord.xy + fract(u_time * 0.41));
  float weight = exp(-3.0 * dither * invN) / float(steps);

  vec3 acc = vec3(0.0);

  for (int i = 0; i < 60; i++) {
    if (i >= steps) break;

    // Dithered layer coordinate. The layers are discrete slabs, so without
    // this the accumulation bands into visible concentric steps at low
    // density; dithering converts those into fine noise.
    float d = (float(i) + dither) * invN;

    float angle = d * 6.283 * u_twist + theta + swirl;
    float c = cos(angle), s = sin(angle);
    vec2 p = mat2(c, -s, s, c) * uv * (1.0 + d * 2.0);

    vec2 cell = mod(p + halfCell, cellSize) - halfCell;
    float shape = length(cell);

    float sdfVal = smoothstep(0.2, 0.0, shape)
                 + smoothstep(0.02, 0.0, abs(shape - 0.15));

    float spiralPhase = fract(theta * INV_TAU * 3.0 + d * u_twist + travel);
    float spiralBright = smoothstep(0.35, 0.15, abs(spiralPhase - 0.5))
                       * spiralGain;

    vec3 layerColor = cyclicPalette(hueBase + d * 0.5) + ringTint;

    acc += layerColor * (sdfVal + spiralBright) * weight;
    weight *= decay;
  }

  // ── Core glow ──────────────────────────────────────────────────────
  // Bass widens it, a beat brightens it, a click brightens it. All three are
  // light-side terms, so nothing here moves geometry.
  float coreWidth = 4.0 / audioLift(u_bass, 0.3);
  acc += mix(u_brandSecondary, u_brandAccent, 0.3)
       * exp(-r * r * coreWidth)
       * (0.8 + beatHit(1.5) * 0.5 + u_burstStrength * 0.6);

  // Bloom halo on the brightest arms.
  float armLum = dot(acc, vec3(0.299, 0.587, 0.114));
  acc += pow(armLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5)
       * (0.35 + beatHit(1.8) * 0.3);

  // Flux is noisy by construction, so it only ever touches colour — here a
  // per-pixel sparkle on the arms, gated to where the field is already bright
  // or it reads as dirt on the screen.
  float spark = hash(gl_FragCoord.xy * 1.7 + fract(u_time * 3.1) * 91.0);
  spark = pow(spark, 12.0) * u_flux * u_audioActive;
  acc += spark * mix(u_brandAccent, vec3(1.0), 0.6) * armLum * 2.0;

  // ── Composite ──────────────────────────────────────────────────────
  // u_bgColor may be light, and an additive-light vortex on a light ground
  // has almost no contrast — the arms wash out into the paper. As the
  // background brightens, blend to a subtractive composite: the paper darkens
  // where the arms cover it and takes their hue. Same palette, opposite
  // polarity, so a light brand keeps a legible spiral. At a dark background
  // this branch contributes nothing and the result is the additive form.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float onLight = smootherstep(0.35, 0.75, bgLum);
  vec3 lit = aces(acc);
  vec3 inked = mix(u_bgColor, lit * 0.85, clamp(armLum, 0.0, 1.0));
  vec3 color = mix(lit, inked, onLight);

  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  // Vignette frames a hero but reads as a tunnel in fullscreen immersive
  // mode, so it fades out with the audio ramp rather than switching off.
  color *= clamp(1.0 - dot(vc, vc) * u_vignette * (1.0 - u_audioActive), 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
