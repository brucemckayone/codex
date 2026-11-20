/**
 * Topographic Contour fragment shader — animated contour lines on a procedural heightfield.
 *
 * Shadertoy-grade polish pass:
 *  - iq value-noise FBM replaces sin×sin (topo isn't iq's warp, no
 *    aesthetic preservation requirement — value noise gives cleaner
 *    heightfields without interference patterns)
 *  - Smooth 4-stop palette (bg → primary → secondary → accent) via
 *    smoothstep weights; no per-pixel branching
 *  - ACES filmic tone map replaces min(x, 0.75) clip
 *  - HDR contour-line emission (> 1.0) lets ACES render bright lines
 *    with glowing edges; old 0.75 clip made every line equal brightness
 *  - Fill between lines gets a subtle height-tinted gradient instead of
 *    a flat heightColor * 0.15
 *  - Bloom halo on brightest contour lines (elevation-tinted)
 *  - Luminance-aware filmic grain
 *
 * WP-1d (Codex-1yd58): the terrain evolves IN PLACE. A bounded, slowly
 * moving domain warp reshapes the landforms around fixed homes, and each
 * finer octave circles its own small orbit, so the map breathes instead of
 * sliding: the old p += (0.3t, 0.2t) carried everything off to one side
 * forever. Every fifth contour is an index line (wider, brighter), and the
 * ground between lines carries a soft hillshade in the brand stops.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const TOPO_FRAG = `#version 300 es
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
uniform int u_lineCount;
uniform float u_lineWidth;
/**
 * Monotone pacing clock, integrated on the CPU by the renderer and already
 * scaled by speed. Replaces u_time * u_speed so motion advances with the
 * music, and so a speed change cannot retroactively rescale accumulated phase.
 */
uniform float u_clock;
uniform float u_scale;
uniform float u_elevation;
uniform int u_octaves;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- iq value noise --
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

// Each octave above the first circles a small orbit of its own: detail
// churns in place, and nothing travels (an orbit is bounded).
float fbm(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float totalAmp = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_octaves) break;
    float fi = float(i);
    vec2 orbit = fi * 0.35 * vec2(cos(t * (0.21 + 0.07 * fi) + fi), sin(t * (0.17 + 0.05 * fi) + 2.0 * fi));
    f += amp * valueNoise(p + orbit);
    totalAmp += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return totalAmp > 0.0 ? f / totalAmp : 0.0;
}

// A bounded warp (each component is noise in [-1, 1]) whose field drifts
// slowly through itself: the landforms it bends stay where they are.
vec2 terrainWarp(vec2 p, float t) {
  vec2 q = p * 0.45;
  return vec2(
    valueNoise(q + vec2(t * 0.23, 1.7)),
    valueNoise(q + vec2(4.1, -t * 0.19))
  );
}

/** Contour + index-line coverage for one height, AA'd by its own fwidth. */
float contourMask(float scaledHeight, float width) {
  float fw = fwidth(scaledHeight);
  float frac = fract(scaledHeight);
  float d = min(frac, 1.0 - frac);
  float halfWidth = width * 0.5;
  return 1.0 - smoothstep(fw * halfWidth, fw * (halfWidth + 1.0), d);
}

// -- Smooth 4-stop palette (bg → primary → secondary → accent) --
vec3 heightColor(float h) {
  h = clamp(h, 0.0, 1.0);
  if (h < 0.333) return mix(u_bgColor, u_brandPrimary, smoothstep(0.0, 0.333, h));
  if (h < 0.666) return mix(u_brandPrimary, u_brandSecondary, smoothstep(0.333, 0.666, h));
  return mix(u_brandSecondary, u_brandAccent, smoothstep(0.666, 1.0, h));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float t = u_clock;  // integrated musical clock, monotone by construction

  // Elevation swells with the slow macro envelope. Contour lines are a
  // DERIVATIVE readout of the height field, so they visibly redistribute as
  // elevation changes — bands migrate and crowd rather than merely brightening.
  // Driven by u_energy because a per-note change here would make every line on
  // screen jitter at once.
  float elevation = u_elevation * audioLift(u_energy, 0.30);

  // Beats brighten the lines without moving them. On a contour map the lines
  // ARE the subject, so a transient belongs on their intensity, not geometry.
  float lineGain = 1.0 + beatHit(1.6) * 0.55;
  vec2 uv = v_uv;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;
  p += terrainWarp(p, t) * 0.55;

  // Elevation scales the height field about its midpoint, so the contour
  // spacing changes rather than the whole map brightening. Audio reaches the
  // map through elevation (see above), computed from the slow envelope.
  // A SOFT ceiling (tanh), not a clamp: a hard clamp flattened every summit
  // into a blank plateau at high elevation, where a map keeps its rings.
  float height = fbm(p, t);
  height = 0.5 + 0.5 * tanh(height * elevation);

  // Mouse hill + burst
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float hoverHill = u_mouseActive * u_elevation * 0.15 * exp(-mouseDist * mouseDist * 20.0);
  float burstHill = u_burst * u_elevation * 0.3 * exp(-mouseDist * mouseDist * 8.0);
  height = clamp(height + hoverHill + burstHill, 0.0, 1.0);

  // ── Contour lines via fract + fwidth; every 5th is an index line ──
  float lineCountF = float(u_lineCount);
  float scaledHeight = height * lineCountF;
  float minorMask = contourMask(scaledHeight, u_lineWidth);
  // Every 5th contour. contourMask's width is in pixels at any scale.
  float indexMask = contourMask(scaledHeight / 5.0, u_lineWidth * 1.9);
  float lineMask = max(minorMask * 0.9, indexMask);

  // ── Soft hillshade: the height's screen-space slope, lit from the upper
  // left. Read off the derivatives the contour AA already needs.
  vec2 slope = vec2(dFdx(height), dFdy(height)) * u_resolution.y / u_scale;
  vec3 normal = normalize(vec3(-slope * 0.9, 1.0));
  float shade = dot(normal, normalize(vec3(-0.55, 0.6, 0.6)));

  // ── Colour by height (smooth palette) — HDR line emission ──
  vec3 base = heightColor(height);
  vec3 lineColor = base * mix(1.8, 2.6, indexMask) * lineGain;  // > 1 for ACES
  // The ground between lines (as before: bg low, the height's stop high),
  // now lit by the hill: shadowed slopes sink, lit ones lift.
  vec3 fillColor = mix(u_bgColor * 0.6, base * 0.3, height);
  // A gentle range: a deep shadow sank a light ground's darkest 5% and
  // took dark text with it (the contrast check, WP-1d).
  fillColor *= mix(0.85, 1.3, clamp(shade, 0.0, 1.0));

  vec3 color = mix(fillColor, lineColor, lineMask);

  // ── Bloom halo on brightest lines, tinted by elevation ──
  // Treble widens the halo. Contour lines are already the highest spatial
  // frequency on screen, so bright audio content belongs here rather than on
  // an added noise term.
  vec3 bloomTint = mix(u_brandPrimary, u_brandAccent, height);
  color += pow(lineMask * height, 2.2) * bloomTint
         * (0.4 + u_treble * u_audioActive * 0.5);

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
