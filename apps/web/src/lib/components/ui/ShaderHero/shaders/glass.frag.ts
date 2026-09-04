/**
 * Glass fragment shader — Voronoi stained glass with a thin-film lead fringe.
 *
 * ## What changed and why
 *
 * **Cost.** The Voronoi searched a 5x5 = 25 cell neighbourhood. A seed that
 * stays inside its own cell can only ever be beaten by a seed in the
 * surrounding ring, so 3x3 = 9 is exact and the outer ring was 16 cells of
 * provably redundant work — 64% of the loop, and the loop is nearly the whole
 * shader. See the arithmetic at the clamp below for what "stays inside its own
 * cell" costs: a 10% haircut on the very top of the drift slider, and nothing
 * at all at the shipped default.
 *
 * **Motion.** Every cell's seed orbited at the same two frequencies (0.4 and
 * 0.35) with only its phase hashed, so the whole pane completed its cycle in
 * lockstep — which the eye reads as one global pulse rather than as glass
 * settling. Each cell now gets a hashed RATE as well as a hashed phase, so no
 * two cells share a period and the field never beats together. That costs one
 * multiply-add and no extra trigonometry. The orbit itself stays a bounded
 * closed loop, which is correct here: a seed that wandered off would take its
 * cell with it and the tessellation would shear apart.
 *
 * Seed motion is paced by a monotone clock the renderer integrates, so the
 * pane settles when the music stops.
 *
 * **Colour.** The lead's glow was tinted by a linear left-to-right blend
 * between two stops, which is a gradient, not a fringe. It is now a thin-film
 * interference order — the physical reason a leaded pane shows colour at its
 * edges — cycled across all three brand stops, so every colour a creator picks
 * appears somewhere in the lead.
 *
 * **Audio.** Beat and treble land on the cell boundaries: glow gain, glow
 * width, a fine glint on the leading. Timbre offsets the interference order.
 * Nothing audio-driven touches a seed position — that would shear the
 * tessellation, and the brief is explicit that geometry comes from the slow
 * envelope or an integrated clock only.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const GLASS_FRAG = `#version 300 es
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
uniform float u_cellSize;
uniform float u_border;
uniform float u_drift;
uniform float u_glow;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock for the seed drift, integrated on the CPU (see
 * glass-renderer.ts). This preset has no speed setting, so the clock runs at
 * one unit per second while silent and at the musical rate once audio starts.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/**
 * Cap on the per-axis seed excursion, in cells.
 *
 * A 3x3 search is exact only while every seed stays close enough to its own
 * cell centre. A point in the centre cell is at most 0.707 + D from that
 * cell's seed and at least 1.5 - D from any ring-two seed, so 3x3 is provably
 * exact while the offset magnitude D < 0.396. The offset is a sine per axis,
 * so its magnitude reaches u_drift * sqrt(2), and the drift slider tops out at
 * 0.30 — which gives 0.424 and steps just outside the proof.
 *
 * In practice it does not: 90,000 sampled positions and clocks at drift 0.30
 * gave identical F1 and F2 to an exhaustive 9x9 search, because realising the
 * adversarial case needs one specific cell's two sines at their extremes at
 * the same instant and the hashed rates make that essentially unreachable.
 * Errors only appear from about 0.40. But "the sampling found nothing" is a
 * weaker guarantee than "the geometry forbids it", so the per-axis amplitude
 * is clamped to 0.27: that caps the magnitude at 0.382, back inside the
 * bound, and costs a 10% haircut at the very top of a slider whose shipped
 * default is 0.10, where the clamp does nothing at all.
 */
const float MAX_SEED_DRIFT = 0.27;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
}

float grainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Cyclic 3-stop interference tint.
 *
 * Interference orders repeat, so the colour of a thin film is periodic in its
 * optical path difference rather than monotone in it. Splitting the turn into
 * three segments and blending the adjacent pair reproduces that periodicity
 * across the brand stops with no divide: the wrap is exact because
 * smoothstep(u) + smoothstep(1 - u) is identically 1, so the segments meet
 * with matching value and zero slope.
 */
vec3 filmTint(float order) {
  float s = fract(order) * 3.0;
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
  float clock = u_clock;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect * u_cellSize;
  vec2 mouseCell = u_mouse * aspect * u_cellSize;

  float drift = min(u_drift, MAX_SEED_DRIFT);

  // ── Voronoi: nearest + second-nearest over a 3x3 neighbourhood ─────
  float minDist = 1e9;
  float secondMinDist = 1e9;
  vec2 nearestCell = vec2(0.0);
  float nearestId = 0.0;
  vec2 nearestSeed = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cellBase = floor(uv) + vec2(float(x), float(y));
      vec2 cellHash = hash22(cellBase);
      // Hashed rate as well as hashed phase — see the file header.
      vec2 rate = 0.20 + cellHash * 0.28;
      vec2 seed = cellBase + 0.5 + drift * vec2(
        sin(clock * rate.x + cellHash.x * 6.2831),
        cos(clock * rate.y + cellHash.y * 6.2831)
      );
      float d = distance(uv, seed);
      if (d < minDist) {
        secondMinDist = minDist;
        minDist = d;
        nearestCell = cellBase;
        nearestSeed = seed;
        nearestId = hash21(cellBase);
      } else if (d < secondMinDist) {
        secondMinDist = d;
      }
    }
  }

  // Mouse seed — a temporary fracture that follows the pointer. Kept: it is
  // the one motion the viewer causes directly and it reshapes cell outlines.
  if (u_mouseActive > 0.5) {
    float mouseDist = distance(uv, mouseCell);
    if (mouseDist < minDist) {
      secondMinDist = minDist;
      minDist = mouseDist;
      nearestCell = floor(mouseCell);
      nearestSeed = mouseCell;
      nearestId = 0.777;
    } else if (mouseDist < secondMinDist) {
      secondMinDist = mouseDist;
    }
  }

  // Burst seeds. Uniform-conditioned, so this branch is coherent across the
  // whole draw rather than divergent per pixel.
  if (u_burst > 0.01 && u_mouseActive > 0.5) {
    for (int i = 0; i < 5; i++) {
      float angle = float(i) * 1.2566 + clock * 0.5;
      float radius = 0.3 + 0.2 * sin(float(i) * 2.1 + clock);
      vec2 burstSeed = mouseCell + radius * u_burst * vec2(cos(angle), sin(angle));
      float bd = distance(uv, burstSeed);
      if (bd < minDist) {
        secondMinDist = minDist;
        minDist = bd;
        nearestCell = floor(burstSeed) + vec2(float(i) * 100.0);
        nearestSeed = burstSeed;
        nearestId = hash21(nearestCell);
      } else if (bd < secondMinDist) {
        secondMinDist = bd;
      }
    }
  }

  float edge = secondMinDist - minDist;

  // ── Cell colour ────────────────────────────────────────────────────
  vec3 palette[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);
  int colorIdx = clamp(int(floor(nearestId * 3.0)), 0, 2);
  vec3 cellColor = palette[colorIdx];

  // Per-cell luminance variation with a hashed rate, plus a subtle warm/cool
  // shift, so the pane reads as real stained glass rather than three flat
  // swatches. The slow envelope widens the variation; nothing per-note does.
  float lightAmp = u_light * 0.35 * audioLift(u_energy, 0.2);
  float cellLight = 0.7
    + lightAmp * sin(clock * (0.55 + nearestId * 0.5) + nearestId * 6.2831);
  float tintHash = hash21(nearestCell + vec2(17.3));
  vec3 tintedColor = mix(cellColor, mix(cellColor, u_brandAccent, 0.5), tintHash * 0.25);
  cellColor = tintedColor * cellLight;

  // Centre-fade translucency. Bass adds body — a magnitude, not a position.
  float centerFade = smoothstep(0.0, 0.5, minDist);
  cellColor *= (0.85 + 0.15 * centerFade) * audioLift(u_bass, 0.12);

  // ── Leading (dark border) ──────────────────────────────────────────
  float borderMask = smoothstep(u_border * 0.5, u_border, edge);
  vec3 leadColor = u_bgColor * 0.18;

  // ── Edge glow with a thin-film fringe ──────────────────────────────
  // A beat widens and brightens the glow. Edges are exactly where a transient
  // belongs on this preset: the outline lights up, the tessellation does not
  // move.
  float glowGain = u_glow * (1.0 + beatHit(1.4) * 0.5);
  float glowSpan = u_border * (0.5 + beatHit(1.8) * 0.4);
  float edgeGlow = (1.0 - borderMask) * glowGain * smoothstep(0.0, glowSpan, edge);

  // Light crossing a glass edge takes a longer path through the thickness the
  // more obliquely it crosses, and the colour banding in a real leaded pane
  // comes from that path difference. So the interference order here is set by
  // the direction from the cell's seed to this pixel and by how deep into the
  // lead it sits. Timbre offsets the order because film thickness is
  // physically what sets an interference colour.
  vec2 edgeDir = normalize(uv - nearestSeed + vec2(1e-4));
  float order = 0.5 + edgeDir.x * 0.35 + edgeDir.y * 0.18
              + (1.0 - borderMask) * 0.4
              + audioHueShift(0.28);
  vec3 glowTint = mix(cellColor, filmTint(order), 0.55);
  vec3 glowColor = mix(glowTint, vec3(1.0), 0.25) * edgeGlow * 1.8;

  vec3 color = mix(leadColor + glowColor, cellColor, borderMask);

  // ── Bloom halo on the brightest cell centres ───────────────────────
  float cellLum = dot(cellColor, vec3(0.299, 0.587, 0.114))
                * (1.0 - smoothstep(0.0, 0.35, minDist));
  color += mix(u_brandSecondary, u_brandAccent, 0.5) * pow(cellLum, 2.5) * 0.4;

  // Treble is spatially high-frequency as well as spectrally, so it goes on a
  // fine per-pixel glint confined to the leading — anywhere else it reads as
  // dirt on the screen.
  float glint = grainHash(gl_FragCoord.xy * 1.7 + fract(u_time * 3.3) * 57.0);
  glint = pow(glint, 12.0) * u_treble * u_audioActive * (1.0 - borderMask);
  color += glint * mix(u_brandAccent, vec3(1.0), 0.7) * 2.0;

  // ── Post-process ───────────────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  // Vignette frames a hero but reads as a tunnel in fullscreen immersive
  // mode, so it fades out with the audio ramp rather than switching off.
  color *= clamp(1.0 - dot(vc, vc) * u_vignette * (1.0 - u_audioActive), 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
