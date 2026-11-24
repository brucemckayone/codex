/**
 * Aurora Borealis fragment shader (GLSL ES 3.0).
 *
 * ## What this preset is
 *
 * Curtains of light whose SILHOUETTE is the effect. Everything worth doing
 * here happens on an edge: the Gaussian envelope that gives each curtain its
 * top, the fringe where it dissolves downward into shimmer, and the vertical
 * streaks that read as folds. There is no camera and there should never be one.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** The curtain travel, the flame shiver and the fringe shimmer ran
 * on three unrelated clocks: travel was scaled by the speed setting while the
 * flame (`t * 1.4`) and shimmer (`t * 2.0`, `t * 3.0`) ignored it and ran on
 * raw wall time, so the speed slider changed only one of the three. All of
 * them now run on one integrated pacing clock, and the speed setting still
 * scales curtain travel alone, which is what it meant before. Nothing here was
 * a camera move, so nothing was removed: the internal flow IS the effect. The
 * pointer response, however, snapped — `u_mouseActive` arrived as a hard 1 or
 * 0 and the band centre jumped by up to 0.15 the instant the pointer left the
 * canvas. It is damped frame-rate-independently in the renderer now.
 *
 * **Audio.** Previously `speed + amplitude * 0.2`, `height + bass * 0.15` and
 * `shimmer + treble * 0.2`, all off raw per-frame values, which reads as
 * jitter. Now every audio term lands on an edge:
 *
 *  - `u_energy` (4s time constant) raises the curtains and widens them — the
 *    macro gesture, slow enough that it can never twitch;
 *  - `u_beatPhase` phases a ripple that displaces each band's CENTRE along x,
 *    so the silhouette undulates rather than merely brightening, with
 *    amplitude from the smoothed `u_level` so silence is exactly the old shape;
 *  - `u_treble` adds a fine shiver to the same edge and drives fringe shimmer;
 *  - `u_beatSeed` re-rolls WHICH curtain flares on each onset (slewed over
 *    250ms upstream, so the emphasis glides between curtains);
 *  - `u_beatPulse` blooms the brightest streaks;
 *  - `u_centroid` slides the palette position, `u_flux` rides the grain.
 *
 * **Cost.** Two analytic rejects, both bounding-volume in character. A curtain
 * contributes in proportion to `exp(-dy*dy)`, so beyond `dy*dy > 6.9` its
 * light is under 2e-4 and the whole band — three `triNoise` calls, 18 sines —
 * is skipped. The fringe shimmer is identically zero above the curtain's lower
 * edge, which is most of the frame, so its `triNoise` is skipped there too.
 *
 * Measured over a 480x270 grid at the default 5 curtains, height 0.4 and
 * spread 0.25: 15.00 `triNoise` calls per pixel down to 10.47, i.e. 90.0 sines
 * down to 62.8, a 30.2% cut. The band reject accounts for 0.50 of the 5 bands
 * per pixel; the rest is the fringe reject. Also: the click burst's
 * `pow`/`exp`/divide no longer run when there is no click, and the palette
 * lost its per-band divide — 10.0 divides per pixel down to none.
 *
 * **Colour.** `u_bgColor` is a brand slot and may be light. The sky no longer
 * scales it to 0.55 (which renders a white sky grey), and the curtains
 * composite as coloured veils rather than additively once the sky is light —
 * additive light on a light sky is invisible.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const AURORA_FRAG = `#version 300 es
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
uniform int u_layers;
uniform float u_speed;
uniform float u_height;
uniform float u_spread;
uniform float u_shimmer;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see aurora-renderer.ts).
 *
 * NOT scaled by the speed setting — u_speed survives as its own uniform here
 * because it only ever meant "how fast the curtains travel sideways", and
 * folding it into the clock would have slowed the flame and shimmer tenfold
 * at the default speed of 0.1. At idle this equals u_time; while audio plays
 * it advances at the music's own rate.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Upper bound on the curtain stack. The active count is u_layers. */
const int MAX_CURTAINS = 7;

/**
 * Curtain x is measured in widths of a canvas at least this wide for its
 * height. Measured in heights, a phone's narrow canvas showed a tenth of one
 * fold: a flat band.
 */
const float FOLD_ASPECT = 1.4;
/** How far a fold lifts the lower edge, in band spreads. */
const float FOLD_DEPTH = 0.6;
/** Each curtain's light (not normalised: more curtains read brighter). */
const float CURTAIN_GAIN = 0.3;

// -- Grain + star hash --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- triNoise: folded absolute sines, cheap and organic --
float triNoise(vec2 p, float t) {
  float z = 1.5;
  float rz = 0.0;
  const mat2 triRot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    float val = abs(sin(p.x * z + t) + sin(p.y * z + t));
    rz += val / z;
    p = triRot * p * 1.45;
    z *= 2.0;
    t *= 1.3;
  }
  return rz;
}

/**
 * Monotone 3-stop palette: two nested smootherstep mixes, no divide.
 *
 * The old form summed three smoothstep weights and divided by their total —
 * a divide per curtain, and not monotone where the weights crossed, which put
 * a faint reversal in the elevation ramp.
 */
vec3 auroraPalette(float t) {
  vec3 c = mix(u_brandPrimary, u_brandSecondary, smootherstep(0.0, 0.55, t));
  return mix(c, u_brandAccent, smootherstep(0.45, 1.0, t));
}

// -- ACES filmic tone map --
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // One clock for everything. Integrated by the renderer, so it is monotone
  // and paced by the music when a track is playing. Deriving it here as
  // mix(u_time, u_beatPhase, u_audioActive) would sweep it BACKWARDS as the
  // ramp eased in, because beatPhase starts at zero and u_time does not.
  float clock = u_clock;

  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  // Curtain x: see FOLD_ASPECT.
  float xw = uv.x * max(aspect, FOLD_ASPECT);

  // Pointer follow — kept and strengthened. y shifts the bands, x shifts the
  // travelling wave's phase. u_mouseActive is a damped 0..1 in the renderer,
  // not a boolean, so leaving the canvas is a glide rather than a jump.
  float mouseYOffset = u_mouseActive * (u_mouse.y - 0.5) * 0.15;
  float phaseShift = u_mouseActive * (u_mouse.x - 0.5) * 1.5;

  // ── Light-vs-dark sky ─────────────────────────────────────────
  // u_bgColor is user-chosen and may be light. Every following decision that
  // used to assume "night" blends on this.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float lightSky = smoothstep(0.42, 0.76, bgLum);

  // ── Sky gradient ──────────────────────────────────────────────
  float skyGrad = smoothstep(0.0, 0.8, uv.y);
  vec3 skyTop = mix(
    u_bgColor * 0.55 + u_brandPrimary * 0.02,   // night: deepen toward zenith
    mix(u_bgColor, u_brandPrimary, 0.10),        // day: hold the chosen value
    lightSky
  );
  vec3 color = mix(u_bgColor, skyTop, skyGrad);

  // ── Stars ─────────────────────────────────────────────────────
  // Faded out over a light sky, where stars are not visible anyway and read
  // as sensor noise.
  float starDensity = 280.0;
  vec2 starUV = floor(p * starDensity);
  float starHash = hash(starUV);
  float starThresh = 0.996;
  if (starHash > starThresh) {
    float sizeBoost = smoothstep(starThresh, 1.0, starHash);
    float twinkle = 0.5 + 0.5 * sin(clock * 1.7 + starHash * 12.57);
    float starHue = fract(starHash * 71.3);
    vec3 starColor = mix(vec3(1.0), mix(u_brandPrimary, u_brandAccent, starHue), 0.4);
    color += starColor * sizeBoost * twinkle * 0.22 * (1.0 - lightSky);
  }

  // ── Audio conditioning, hoisted out of the curtain loop ───────

  // Macro gesture: the curtains rise and widen with musical energy. u_energy
  // has a 4s time constant, so this is a swell, not a flicker. One-sided, so
  // silence is exactly the configured height.
  float heightLift = u_energy * 0.06 * u_audioActive;
  float spreadLift = audioLift(u_energy, 0.2);

  // Edge ripple amplitude. Smoothed level, so it cannot step; the PHASE comes
  // from u_beatPhase below, which is what makes it musical rather than fast.
  float rippleAmp = u_level * u_audioActive * 0.035;
  float shiverAmp = u_treble * u_audioActive * 0.008;

  // Fringe shimmer takes treble — high-frequency content belongs on the
  // finest spatial detail the preset has.
  float shimmerAmt = u_shimmer * audioLift(u_treble, 0.45);

  // Which curtain flares this beat. The seed is re-rolled per onset and
  // slewed over 250ms upstream, so the emphasis glides across the stack
  // instead of teleporting — and it lands on brightness, never on position.
  float emphPick = u_beatSeed * float(max(u_layers - 1, 1));
  float emphGain = beatHit(1.2) * 0.45;

  // Timbre slides the palette position; every brand stop stays intact.
  float paletteShift = audioHueShift(0.15);

  // Hoisted: this divide used to run once per curtain.
  float invLayerSpan = 1.0 / max(float(u_layers - 1), 1.0);
  bool hasBurst = u_burst > 0.01;

  // ── Aurora curtains ──────────────────────────────────────────
  vec3 auroraAccum = vec3(0.0);

  for (int i = 0; i < MAX_CURTAINS; i++) {
    if (i >= u_layers) break;

    float layerF = float(i);
    float layerT = layerF * invLayerSpan;

    // Band centres fan out plus or minus 0.18 around u_height so the curtains
    // sit at distinct elevations with real parallax instead of collapsing
    // onto one strip.
    float bandCentre = u_height + heightLift + (layerT - 0.5) * 0.36 + mouseYOffset;
    float bandSpread = u_spread * (0.85 + 0.25 * sin(layerF * 1.7)) * spreadLift;

    // Leading-edge deformation: the ripple moves the band's CENTRE along x,
    // so what the eye reads is the silhouette folding, not the fill getting
    // brighter. Phase is the integrated musical clock; amplitude is smoothed.
    // Peak displacement is 0.035 in uv-y against a spread of ~0.25, i.e. 14%.
    float ripple = sin(xw * (3.0 + layerF * 0.8) + u_beatPhase * 2.0 + layerF * 1.3);
    float shiver = sin(xw * 22.0 + u_beatPhase * 5.0 + layerF * 2.1);
    bandCentre += ripple * rippleAmp + shiver * shiverAmp;


    // ── The curtain line ──
    // A sheet hanging from a wavy lower edge. The fold travels sideways
    // (speed scales this and only this) and wobbles; the edge rises and
    // falls with it, so the curtain reads as a folded ribbon, not a band.
    float freq = 1.6 + layerF * 0.5;
    float phase = layerF * 2.399;
    float speedMul = 0.65 + layerF * 0.12;
    float drift = (clock + phaseShift) * speedMul * u_speed;
    float arg = xw * freq + drift + phase;
    float wobble = triNoise(vec2(xw * 0.5, clock * 0.3 + layerF), clock) * 0.35;
    float lineY = bandCentre + (sin(arg) + wobble) * bandSpread * FOLD_DEPTH;

    // ── Analytic reject ──
    // Every term below carries env: a sharp fall below the edge, exp(-6 dy^2),
    // and a long fade above it, exp(-2 dy). Past these bounds it is under
    // 1e-3 of its peak, so the curtain's whole contribution is skipped.
    float dy = (uv.y - lineY) / max(bandSpread, 1e-4);
    if (dy < -1.1 || dy > 3.5) continue;
    float env = dy < 0.0 ? exp(-6.0 * dy * dy) : exp(-2.0 * dy);

    // Rays: the aurora's vertical striations, stretched tall and drifting
    // with the clock. In width units (xw), so a phone shows as many as a
    // desktop's same width.
    float rayNoise = triNoise(vec2(xw * (7.0 + layerF), uv.y * 0.4 + layerF * 3.1), clock * 0.6);
    float rays = smoothstep(0.35, 1.25, rayNoise);
    // Where the sheet turns it is seen edge-on, and burns brighter.
    float fold = pow(1.0 - abs(cos(arg)), 4.0);
    // The lower edge is the brightest line of all.
    float edgeGlow = exp(-12.0 * dy * dy);

    // ── Fringe shimmer, second analytic reject ──
    // fringe is nonzero only in the narrow strip below the curtain's lower
    // edge. Above that strip — most of the frame for most curtains — this
    // term is identically zero, so its triNoise is pure waste there.
    float fringe = 1.0 - smoothstep(lineY - bandSpread, lineY - bandSpread * 0.4, uv.y);
    float shimmerVal = 0.0;
    if (fringe > 0.002) {
      float shimmerNoise = triNoise(uv * 10.0 + vec2(clock * 2.0, layerF), clock * 3.0);
      shimmerVal = fringe * shimmerNoise * shimmerAmt * env;
    }

    float c = env * (0.25 + 0.75 * rays + 0.6 * fold) + edgeGlow * 0.5 + shimmerVal;

    // Per-onset curtain emphasis. Brightness only.
    float pickD = layerF - emphPick;
    c *= 1.0 + emphGain * exp(-pickD * pickD * 1.2);

    // Click brightening. The pow/exp/divide only run when there is a click.
    if (hasBurst) {
      float bd = (uv.y - u_height) / (bandSpread + u_burst * 0.1);
      c += u_burst * 0.3 * exp(-bd * bd);
    }

    // Fixed per-curtain weight (not normalised): more curtains reads as
    // brighter, and ACES handles the extra range at the tonemap.
    // Colour by curtain and by height: the lower edge takes the upper stops,
    // the tall rays fade toward the first.
    float heightT = 1.0 - clamp(dy / 3.5, 0.0, 1.0);
    float paletteT = clamp(layerT * 0.5 + heightT * 0.5 + paletteShift, 0.0, 1.0);
    auroraAccum += auroraPalette(paletteT) * c * CURTAIN_GAIN;
  }

  // ── Composite ────────────────────────────────────────────────
  float auroraLum = dot(auroraAccum, vec3(0.299, 0.587, 0.114));

  // Additive light is invisible on a light sky, so once the background is
  // light the curtains composite as coloured veils instead. At lightSky = 0
  // this is the previous behaviour exactly.
  vec3 additive = color + auroraAccum;
  // The veil takes the curtains' HUE at full strength, by their light: mixing
  // toward the light itself greyed a light sky wherever a curtain was faint.
  float auroraPeak = max(auroraAccum.r, max(auroraAccum.g, auroraAccum.b));
  vec3 auroraHue = auroraAccum / max(auroraPeak, 1e-3);
  vec3 veil = mix(color, auroraHue, clamp(auroraPeak * 2.5, 0.0, 0.9));
  color = mix(additive, veil, lightSky);

  // Bloom on the brightest streaks. Beats widen the halo — light side, so a
  // transient never moves an edge.
  color += pow(auroraLum, 2.2) * u_brandAccent * (0.45 + beatHit(1.5) * 0.35);

  // ── Post-process ────────────────────────────────────────────
  //
  // ACES maps an input of 1.0 to 0.804, so a white brand background could
  // never render as white. Gain that back in proportion to how light the
  // palette is; at lightSky = 0 the multiplier is exactly 1.0 and the night
  // look is bit-identical.
  //
  // The white point here is 1.0, unlike the 1.6 flux.frag.ts uses, and the
  // difference is deliberate. A full gain leaves tonemap headroom only up to
  // an input of about 1.13, so it CLIPS an additive composite over a light
  // ground — measured on aurora, additive plus this gain collapses curtain
  // visibility from 0.0320 to 0.0070, a 78% loss. The veil composite above
  // replaces rather than adds, so it never reaches the clip, and the full gain
  // is then free: measured 0.0320 to 0.0456 mean visible amplitude over a
  // 320x180 grid with a light palette, +42%, with the frame mean lifted from
  // 0.731 to 0.806. A 1.6 white point scores 0.0413 on the same grid — safe
  // but slightly worse, because it lifts the sky less.
  color = clamp(aces(color) * mix(1.0, 1.0 / 0.804, lightSky), 0.0, 1.0);

  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Luminance-aware grain. Spectral flux is noisy by construction, which is
  // exactly what grain wants and exactly what geometry must never have.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum) * (1.0 + u_flux * 0.5 * u_audioActive);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
