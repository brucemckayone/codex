/**
 * Bismuth (Crystal Terraces) fragment shader.
 *
 * ## What changed and why
 *
 * **Motion.** The whole heightfield panned linearly: `pAnim = p + vec2(t *
 * 0.3, t * 0.2)` with `t = u_time * u_speed`. That is whole-frame translation
 * off wall clock — unbounded, so given long enough the terraces walk off frame
 * entirely and every visitor sees a different crop. It is now a bounded
 * wander from three incommensurate components per axis, so the terraces
 * migrate and re-form in place and no choice of speed can make it slide. The
 * click used to rotate the field by `u_burst * 0.5` and unwind it as the burst
 * decayed; it now advances a monotone tilt accumulator.
 *
 * **Colour — the headline change.** The iridescence was a view-angle-to-hue
 * ramp: one number, mapped through three smoothstep weights and a normalising
 * divide. Bismuth does not work like that. Its colour is a transparent oxide
 * film a few hundred nanometres thick, and what you see at a point is
 * whichever wavelengths reinforce after reflecting off both faces of that
 * film. Two quantities decide it — the film's optical thickness and the angle
 * light takes through it — and interference orders repeat, which is exactly
 * why a real bismuth crystal shows the same sequence of colours again and
 * again as its terraces step down.
 *
 * So thickness now comes from the TERRACE INDEX, not from the view angle
 * alone: each terrace is a different oxide depth and therefore a different
 * interference order. The view angle stretches the optical path on top of
 * that, which is what makes tilting the crystal (moving the pointer) sweep the
 * colours the way it does in the hand.
 *
 * `u_centroid` offsets the thickness, because thickness is physically what
 * sets an interference colour — timbral brightness is the natural driver, and
 * the result is audio-reactive colour that is motivated rather than a hue spin
 * bolted on.
 *
 * **Cost.** The two domain-warp `fbm` calls dropped from three octaves to two.
 * The warp is a low-frequency displacement scaled by 0.4 before use, so the
 * third octave contributed 0.125/0.875 of an offset the terrace quantiser
 * rounds away. That takes the shader from 36 value-noise taps per pixel to 28.
 *
 * **Light backgrounds.** The terrace risers were `accent * 1.8` — an HDR white
 * edge that vanishes into a light brand's field after tone mapping. On a light
 * background they now read as dark etched lines instead, same accent hue,
 * inverted polarity, so the terrace structure survives either.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const BISMUTH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_terraces;
uniform float u_warp;
uniform float u_iridescence;
uniform float u_edge;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock for the field wander, integrated on the CPU (see
 * bismuth-renderer.ts). Already scaled by the preset speed setting, which is
 * why there is no u_speed uniform any more: speed multiplies the integration
 * RATE, so changing it cannot retroactively rescale the position the field has
 * already wandered to.
 */
uniform float u_clock;
/**
 * Monotone accumulated tilt in radians. Separate from u_clock because it
 * carries the click surge: that must add to a rotation RATE, never to a
 * rotation angle, or the crystal counter-rotates as the burst decays.
 */
uniform float u_tilt;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/**
 * Peak excursion of the field wander, in units of the pre-scaled domain.
 *
 * driftAxis peaks at 0.062 per unit clock, so this amplitude moves the field
 * at most 0.087 domain-units per unit clock — against the renderer's 0.8/s
 * idle rate, 0.070 units/s, which after the domain's 3x scale is about 0.023
 * of a screen height per second. Slow enough to read as the crystal growing
 * rather than as the camera panning, and bounded, so it never leaves.
 */
const float WANDER = 1.4;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Value-noise lattice hash in -1..1. */
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

/** Three-octave FBM. Drives the heightfield, where the detail is the subject. */
float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    f += amp * valueNoise(p);
    total += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return total > 0.0 ? f / total : 0.0;
}

/**
 * Two-octave variant for the domain warp.
 *
 * The warp is a low-frequency displacement scaled by 0.4 before use, so a
 * third octave contributes 0.125/0.875 of an already small offset — well under
 * the step the terrace quantiser rounds to. Dropping it removes four
 * value-noise taps per call, and this is called twice per pixel.
 */
float fbm2(vec2 p) {
  float f = valueNoise(p) * 0.5;
  p = octaveRot * p * 2.02;
  return (f + valueNoise(p) * 0.25) / 0.75;
}

/**
 * Thin-film interference across the three brand stops.
 *
 * \`thick\` is optical thickness in interference orders and \`cosTheta\` the
 * view/normal cosine. The internal angle is compressed by refraction, so a
 * grazing view stretches the path far less than a bare reciprocal cosine would
 * suggest; 2.4 is the squared index of a bismuth oxide film, about 1.55.
 *
 * Because orders repeat, the result is CYCLIC in that product rather than
 * monotone in it, which is what gives a real crystal its recurring colour
 * sequence. The cycle runs across all three brand stops, so no hue is
 * hardcoded and every colour a creator picks appears on some terrace.
 *
 * \`strength\` dials the interference back toward a flat mid-palette, so the
 * iridescence setting still spans matte metal to full nacre.
 */
vec3 thinFilm(float thick, float cosTheta, float strength) {
  float ct = sqrt(max(1.0 - (1.0 - cosTheta * cosTheta) / 2.4, 0.02));
  float order = fract(thick / ct) * 3.0;
  float seg = floor(order);
  float f = order - seg;
  // No divide: the wrap is exact because smoothstep(u) + smoothstep(1 - u) is
  // identically 1, so the segment ends meet with matching value and slope.
  float w = f * f * (3.0 - 2.0 * f);
  float g1 = step(0.5, seg);
  float g2 = step(1.5, seg);
  vec3 a = mix(mix(u_brandPrimary, u_brandSecondary, g1), u_brandAccent, g2);
  vec3 b = mix(mix(u_brandSecondary, u_brandAccent, g1), u_brandPrimary, g2);
  vec3 film = mix(a, b, w);
  vec3 matteBase = mix(u_brandPrimary, u_brandSecondary, 0.5);
  return mix(matteBase, film, clamp(strength, 0.0, 1.0));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float clock = u_clock;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 3.0;

  // Monotone click tilt. No wall-clock rotation at all in this preset.
  float ca = cos(u_tilt), sa = sin(u_tilt);
  p = mat2(ca, sa, -sa, ca) * p;

  // Bounded wander replaces the old linear pan. See WANDER for the rates.
  vec2 pAnim = p + drift2(clock, 4.3) * WANDER;

  // The slow envelope widens the warp — a macro signal, so the terraces
  // reshape over seconds rather than twitching per note.
  float warpAmt = u_warp * 0.4 * audioLift(u_energy, 0.2);
  vec2 pWarped = pAnim + warpAmt * vec2(
    fbm2(pAnim * 2.0 + 10.0),
    fbm2(pAnim * 2.0 + 20.0)
  );

  float heightSmooth = clamp(fbm(pWarped) * 0.5 + 0.5, 0.0, 1.0);

  float N = float(u_terraces);
  float heightStepped = floor(heightSmooth * N) / N;

  // Terrace risers, from the derivative of the quantised height.
  float edgeMask = clamp(length(vec2(dFdx(heightStepped), dFdy(heightStepped))) * 40.0, 0.0, 1.0);

  vec3 normal = normalize(vec3(dFdx(heightSmooth) * 8.0, dFdy(heightSmooth) * 8.0, 1.0));

  // Pointer tilts the crystal. Kept at full strength: on a thin-film material
  // this is not decoration, it is the gesture that reveals the effect — the
  // view angle is one of the two physical quantities setting the colour.
  //
  // There is no u_mouseActive uniform here any more. It was a hard 0/1 that
  // switched the view direction between the pointer and dead centre, so the
  // colours jumped the instant the pointer left the canvas. The renderer now
  // damps the pointer toward centre with a time constant instead, which eases
  // the crystal back to a neutral view and makes the boolean redundant.
  vec3 viewDir = normalize(vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5));

  float cosTheta = abs(dot(normal, viewDir));
  float angleFactor = 1.0 - cosTheta;

  // Oxide thickness from the terrace index: one interference order every few
  // terraces, so neighbours read as different colours the way a real crystal's
  // do. Timbre offsets it — at the default settings the offset is under a
  // quarter of a segment, well inside the 25% budget, but a quarter segment is
  // plainly visible because the palette cycle is short.
  float thick = 0.35 + heightStepped * u_iridescence * 2.6 + audioHueShift(0.28);
  vec3 iriColor = thinFilm(thick, cosTheta, u_iridescence);

  float depthFade = 0.4 + 0.6 * heightStepped;
  vec3 faceColor = mix(u_bgColor, iriColor, depthFade);

  // ── Terrace risers, luminance-aware ────────────────────────────────
  // A near-white HDR edge catches the light beautifully on a dark ground and
  // disappears completely on a light one. On a light background the risers
  // read correctly as dark etched lines instead — same accent hue, inverted
  // polarity. A beat brightens the risers, which is outline light: the terrace
  // boundaries never move under audio.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float onLight = smootherstep(0.3, 0.75, bgLum);
  vec3 edgeLit = mix(u_brandAccent, vec3(1.0), 0.25) * (1.0 + 0.7 * angleFactor) * 1.8;
  vec3 edgeInk = mix(u_brandAccent, u_bgColor * 0.22, 0.55) * (0.6 + 0.4 * angleFactor);
  vec3 edgeColor = mix(edgeLit, edgeInk, onLight);

  float edgeAmt = clamp(
    edgeMask * u_edge * (1.0 + beatHit(1.5) * 0.45 + u_burst * 0.4),
    0.0,
    1.0
  );
  vec3 color = mix(faceColor, edgeColor, edgeAmt);

  // Bloom halo on the brightest risers, suppressed on a light ground where
  // the risers are dark and a halo would read as a smudge.
  float edgeLum = edgeAmt * (0.5 + 0.5 * angleFactor);
  color += pow(edgeLum, 2.2) * mix(u_brandSecondary, u_brandAccent, 0.5)
         * 0.4 * (1.0 - onLight);

  // Treble is spatially high-frequency as well as spectrally, so it goes on a
  // fine per-pixel glitter confined to the risers, where a real crystal's
  // facets catch the light.
  float glitter = hash(gl_FragCoord.xy * 1.9 + fract(u_time * 3.7) * 59.0);
  glitter = pow(glitter, 12.0) * u_treble * u_audioActive * edgeMask;
  color += glitter * mix(u_brandAccent, vec3(1.0), 0.7) * 2.2;

  // ── Post-process ───────────────────────────────────────────────────
  color = aces(color);
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
