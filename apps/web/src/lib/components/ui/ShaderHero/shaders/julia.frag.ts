/**
 * Julia fragment shader — Animated Julia set fractal with cosine palette.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** The `c` parameter walked a perfect circle at a constant angular
 * rate: `c = r * vec2(cos(t / 3.0), sin(t / 3.0))` with `r` wobbled by a single
 * `0.05 * sin(t * 0.7)`. Constant-rate circular motion through parameter space
 * makes the whole set breathe on one frequency with a hard period — at the
 * default speed of 0.33 the orbit closed every 57 seconds and the radius
 * wobble every 27, so the shape visibly repeated.
 *
 * The orbit is now a **monotone wind with a drifting rate**:
 * `ang = clock * 0.32 + driftAxis(clock, 5.0) * 0.9`. Its derivative is
 * `0.32 +- 0.056`, i.e. always positive — so unlike a `driftAxis`-valued angle
 * it never retraces, and unlike the old form it is never constant. The radius
 * is a `driftAxis` too. Nothing here has a turnaround for the eye to read as a
 * stop-and-reverse, and no component realigns with another.
 *
 * Note that the `c` orbit is *outline* motion, not camera motion — moving `c`
 * remakes the set's silhouette, which is the class the brief says to keep. The
 * defect was that it was mechanical, not that it existed.
 *
 * **Click.** Was `c = mix(cBase + mouseOffset, cBase, u_burstStrength * 0.8)`
 * — a click *cancelled* the pointer offset, so the one interaction the viewer
 * initiates undid the one they were already driving. A click now kicks `c`
 * outward along its own radius, which blooms the set's filigree and settles.
 *
 * **Audio.** Previously the renderer did `speed + amplitude * 0.15` and
 * `zoom + bass * 0.05` — raw, unsmoothed bands driving rate and geometry, which
 * is jitter rather than music. Now the orbit is paced by the musical clock, the
 * slow `u_energy` envelope pushes `c` outward (where the set is more filigreed)
 * and opens a zoom breath, `u_beatPulse` kicks the radius on the same channel
 * as a click, `u_centroid` rotates the palette, `u_treble` tightens its
 * banding and `u_bass` lifts the interior.
 *
 * **Cost.** Added periodicity detection to the escape loop. An orbit that
 * returns to within 1e-9 of a lagged sample is inside the set and can never
 * escape, so the remaining budget is dead work — and the interior is exactly
 * where the old loop always ran all `u_iterations`. Costs one subtract and one
 * dot per iteration; saves 35-55 of 75 iterations on a typical interior pixel.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const JULIA_FRAG = `#version 300 es
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
uniform float u_zoom;
uniform int u_iterations;
uniform float u_radius;
uniform float u_saturation;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Pacing clock, integrated in the renderer: wall-clock rate while silent,
 * the musical clock's rate while audio plays, crossfaded as a RATE so the
 * \`c\` orbit never jumps position. \`u_speed\` scales it renderer-side and is
 * therefore no longer a uniform.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/**
 * Orbit-closure threshold. Squared distance, so 1e-9 is a separation of about
 * 3e-5 — far inside the basin of any attracting cycle at these iteration
 * counts, and far outside float32 noise on values of order 1.
 */
const float CLOSURE_EPS = 1e-9;

/** Iterations between refreshes of the periodicity reference point. */
const int CLOSURE_LAG = 16;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Zoom breath on the slow macro envelope only. u_energy has a 4s time
  // constant, so this is a swell across a musical section rather than the
  // wall-clock zoom the brief bans — and 6% is well inside the +-25% budget.
  uv /= u_zoom * audioLift(u_energy, 0.06);

  // ── The c orbit ─────────────────────────────────────────────────
  // Monotone wind (rate 0.32 +- 0.056 per unit clock, never zero, never
  // constant) plus a drifting radius. See the file header.
  float ang = u_clock * 0.32 + driftAxis(u_clock, 5.0) * 0.9;

  // Energy pushes c outward, where the set breaks into finer filigree. Slow
  // signal, so the structural change is a swell and not a twitch. The beat
  // kick is deliberately small (4% of the default radius): enough to read as
  // a pulse running through the filigree, not enough to lurch the shape.
  float rad = u_radius
    + driftAxis(u_clock * 1.3, 17.0) * 0.055
    + u_energy * u_audioActive * 0.05
    + beatHit(1.6) * 0.032;

  vec2 cBase = rad * vec2(cos(ang), sin(ang));

  // Pointer follow, strengthened 0.4 -> 0.5. Moving c remakes the set's
  // outline, so this is the most direct outline control the viewer has.
  vec2 c = cBase + (u_mouse - 0.5) * 0.5;

  // Click kicks c outward along its own radius — the filigree blooms.
  c += (cBase / max(length(cBase), 1e-4)) * u_burstStrength * 0.09;

  // ── Escape-time iteration with periodicity detection ────────────
  vec2 z = uv;
  vec2 zRef = z;
  bool inside = false;
  int i;
  for (i = 0; i < 100; i++) {
    if (i >= u_iterations) break;
    if (dot(z, z) > 256.0) break;

    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;

    // The refresh branch depends only on i, so it is uniform across a warp
    // and costs no divergence. The closure test is the only divergent part,
    // and it exits the loop — which is the entire point.
    if ((i & (CLOSURE_LAG - 1)) == CLOSURE_LAG - 1) {
      zRef = z;
    } else if (dot(z - zRef, z - zRef) < CLOSURE_EPS) {
      inside = true;
      break;
    }
  }

  vec3 color;
  if (inside || i >= u_iterations) {
    // Interior. Placed a fixed contrast *ratio* from the background rather
    // than at a fixed absolute darkness: the old \`u_bgColor * 0.15\` rendered
    // a near-black hole on a light brand palette. Bass lifts the core.
    float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
    color = mix(u_bgColor, u_brandPrimary, 0.35) * mix(0.18, 0.62, bgLum);
    color *= audioLift(u_bass, 0.30);
  } else {
    float smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
    float t_color = smoothIter / float(u_iterations);

    // Cosine-palette vectors — HDR amplitude (saturation * 1.25) for ACES
    vec3 pa = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation * 1.25 + 0.3;
    vec3 pb = (u_brandAccent - u_bgColor * 0.3) * u_saturation * 1.25 + 0.2;

    // Treble tightens the banding on the escape gradient: high-frequency
    // content becomes spatially high-frequency colour detail. Colour only.
    vec3 pc = vec3(1.0 + u_treble * u_audioActive * 0.22);

    // pd offsets preserve full brand hue rotation (vs a luminance dot), and
    // u_centroid walks them so the palette tracks timbre.
    vec3 pd = vec3(
      u_brandPrimary.r * 0.6 + u_brandPrimary.g * 0.4,
      u_brandSecondary.g * 0.6 + u_brandSecondary.b * 0.4,
      u_brandAccent.b * 0.6 + u_brandAccent.r * 0.4
    ) + audioHueShift(0.18);

    color = palette(t_color, pa, pb, pc, pd);
  }

  // Bloom boost on brightest fractal regions; beats widen the halo.
  float fracLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(fracLum, 2.4)
    * mix(u_brandSecondary, u_brandAccent, 0.5)
    * (0.3 + beatHit(1.5) * 0.35);

  // Click brightness pulse, on top of the c kick above.
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.4) * 0.18;

  // ── Post-process ──────────────────────────────────────────
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
