/**
 * Tunnel fragment shader — Apollonian fractal tunnel flythrough.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Camera motion.** The old centreline was `vec3(cos(z * u_twist) * 16.0, 0.0, z)`
 * — a single cosine at amplitude 16. Because `tunnelSDF` evaluates
 * `cameraPath(p.z)`, that curve is simultaneously the bore's shape *and* the
 * camera's path, so its derivative is the shot's yaw: `dx/dz = 16 * u_twist`
 * peaked at 1.12, i.e. the view swung +-48 degrees, on one frequency, with a
 * 45-second period. Every turnaround read as a stop-and-reverse. It is now a
 * two-component incommensurate drift with peak `dx/dz` of 0.331 (+-19 degrees)
 * and a peak yaw rate of 0.077 rad/s against the old 0.157 — half the rate, a
 * third of the swing, and no perceptible loop. A second (vertical) axis was
 * added at different frequencies again; the old path had `y = 0` always, so the
 * tunnel only ever snaked sideways.
 *
 * **Why two components and not `drift3()`.** `pathOffset` is called once per
 * march step, not once per pixel. The shared three-component `driftAxis` would
 * cost 3 sines per axis per step — 432 extra transcendentals per pixel at 72
 * steps. Two components already remove the single dominant turnaround that
 * reads as jerk, and 0.077/0.043 are mutually incommensurate so the sum's
 * period is effectively unbounded. This is a deliberate departure from the
 * shared helper, forced by the SDF's call site.
 *
 * **Forward travel.** Was `u_time * u_speed`, i.e. wall-clock, plus
 * `u_burstStrength * 5.0` — a click teleported the camera 5 units forward and
 * then, as the burst decayed, dragged it back. Travel is now integrated in the
 * renderer as a monotone distance whose *rate* crossfades to the musical
 * clock's rate, so a click is a surge that never reverses and entering
 * immersive mode changes the pace rather than jumping the position.
 *
 * **Audio.** Previously none. Bass opens the bore (an aperture response — the
 * walls pull away on a kick), beats add a forward surge through the renderer's
 * travel integrator, `u_centroid` rotates the palette phase with timbre,
 * `u_beatPulse` widens the bloom, and treble adds per-pixel sparkle to the
 * bright cores only.
 *
 * **Cost.** 128 march steps to 72, bought with a per-pixel dither on the start
 * offset and a raised per-step accumulation (0.05 to 0.088) so total energy is
 * preserved. That removes 56 Apollonian evaluations per pixel — each one up to
 * `u_fractal` (default 6) iterations of a `mod`, a reciprocal and two vector
 * scales. `tunnelPalette` lost its per-step divide: the old three-weight
 * normalised blend is now a partition-of-unity built from `smootherstep`, which
 * sums to exactly 1 by construction and is C2 rather than C0 at the stops.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const TUNNEL_FRAG = `#version 300 es
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
uniform int u_fractal;
uniform float u_radius;
uniform float u_brightness;
uniform float u_twist;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone forward distance, integrated in the renderer. Replaces
 * \`u_time * u_speed\`: the renderer crossfades the *rate* between wall-clock
 * and the musical clock, so switching to audio never jumps the position.
 * \`u_speed\` is therefore consumed renderer-side and no longer a uniform.
 */
uniform float u_travel;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Was 128. Dithered start offset buys the difference back — see the header. */
const int MARCH_STEPS = 72;

/**
 * March cut-off. Was 50, where \`exp(-0.08 * t)\` has already fallen to 0.018;
 * at 42 it is 0.035, so the discarded tail is under 1% of accumulated energy.
 */
const float MAX_DIST = 42.0;

/**
 * Minimum step. Raised from 0.01 so 72 steps still cover comparable distance
 * in the high-detail regions where the SDF stalls.
 */
const float MIN_STEP = 0.014;

/**
 * Tunnel centreline offset, a function of z ONLY.
 *
 * It must stay purely spatial: \`tunnelSDF\` evaluates it at each sample's z, so
 * any time dependence here would make the whole tunnel writhe rather than the
 * camera travel through a fixed curve.
 *
 * Two incommensurate components per axis (see the file header for why not
 * three). Peak rates per unit k: x = 1.2*0.077 + 0.6*0.043 = 0.118,
 * y = 0.7*0.061 + 0.35*0.037 = 0.056. With \`dk/dz = u_twist * 40\` (2.8 at the
 * default twist of 0.07) that is a peak yaw of 0.331 rad and pitch of 0.157.
 */
vec2 pathOffset(float z) {
  float k = z * u_twist * 40.0;
  return vec2(
    sin(k * 0.077 + 1.7) * 1.2 + sin(k * 0.043 + 0.9) * 0.6,
    sin(k * 0.061 + 4.1) * 0.7 + sin(k * 0.037 + 2.4) * 0.35
  );
}

vec3 cameraPath(float z) {
  return vec3(pathOffset(z), z);
}

float apollonian(vec3 p) {
  float b = u_radius;
  float s;
  float w = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_fractal) break;
    p = mod(p + b, 2.0 * b) - b;
    s = 2.0 / max(dot(p, p), 0.001);
    p *= s;
    w *= s;
  }
  return length(p) / w - 0.01;
}

/** \`bore\` is hoisted out of the SDF so the audio/burst aperture is computed once. */
float tunnelSDF(vec3 p, float bore) {
  float tube = bore - length(p.xy - pathOffset(p.z));
  return max(tube, apollonian(p));
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

/**
 * Cyclic 3-stop palette with no divide.
 *
 * The old form summed three \`smoothstep\` weights and divided by the total,
 * because smoothstepped triangles are not a partition of unity. A linear
 * triangular basis on three equally spaced pivots *is* — and \`smootherstep\`
 * satisfies S(x) + S(1-x) = 1 exactly, so warping each linear weight through it
 * preserves the sum while making the ramp C2. Result: 72 divides per pixel
 * removed and no crease where two stops meet.
 */
vec3 tunnelPalette(float t) {
  t = fract(t);
  float d0 = min(t, 1.0 - t);
  float e1 = abs(t - 0.33333);
  float e2 = abs(t - 0.66667);
  float d1 = min(e1, 1.0 - e1);
  float d2 = min(e2, 1.0 - e2);
  float w0 = smootherstep(0.0, 1.0, max(0.0, 1.0 - 3.0 * d0));
  float w1 = smootherstep(0.0, 1.0, max(0.0, 1.0 - 3.0 * d1));
  float w2 = smootherstep(0.0, 1.0, max(0.0, 1.0 - 3.0 * d2));
  return u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2;
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  vec3 ro = cameraPath(u_travel);
  // Look 1.5 units ahead rather than 1.0: on a gentler curve the shorter
  // baseline made the aim direction noisy relative to the bend.
  vec3 fwd = normalize(cameraPath(u_travel + 1.5) - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);

  // Pointer follow, strengthened from 0.5 to 0.62. This is the one motion the
  // viewer causes directly, and here it swings the bore's silhouette across the
  // fractal walls — the class of motion the brief says to keep and strengthen.
  vec2 aim = (u_mouse - 0.5) * 0.62;
  vec3 rd = normalize(fwd + (uv.x + aim.x) * right + (uv.y + aim.y) * up);

  // Aperture. Bass opens the bore, so a kick pulls the walls away; one-sided,
  // so silence is exactly the resting geometry. 0.18 sits inside the +-25%
  // budget. Click widens it too — a silhouette response, not a position jump.
  float bore = u_radius * 1.5
    * audioLift(u_bass, 0.18)
    * (1.0 + u_burstStrength * 0.22);

  // Timbre rotates the palette phase: bright material walks the tunnel's
  // colour one way, dark material the other, around a neutral centre.
  float hueShift = audioHueShift(0.12);

  // Per-pixel dither on the start offset. This is what makes 72 steps look
  // like 128 — the stair-step banding becomes fine noise, which the film grain
  // below already masks.
  float dither = hash(gl_FragCoord.xy + fract(u_time * 0.37));

  vec3 acc = vec3(0.0);
  float t = dither * MIN_STEP * 4.0;

  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = tunnelSDF(p, bore);

    if (d < 0.001) break;
    if (t > MAX_DIST) break;

    // Dither the step index too, or the palette and rib phases reintroduce
    // exactly the banding the start offset removed.
    float fi = float(i) + dither;

    vec3 marchColor = tunnelPalette(0.04 * fi + 0.12 * p.z + hueShift);

    // Luminance ribs. Floor of 0.5 kept so dark ribs still accumulate.
    marchColor *= 0.75 + 0.25 * cos(0.05 * fi + 0.5 * p.z);

    // Per-step gain raised 0.05 -> 0.088 so 72 steps carry the same total
    // energy as the old 128 (128 * 0.05 == 72 * 0.0889).
    acc += marchColor * exp(-0.08 * t) * 0.088 * u_brightness;

    t += max(d, MIN_STEP);
  }

  // ── Background ────────────────────────────────────────────────
  // Relative to u_bgColor throughout, so a light brand background stays light.
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgGrad = mix(
    u_bgColor + u_brandPrimary * 0.03,
    u_bgColor * 0.8,
    smoothstep(0.0, 1.4, r2)
  );

  float lumAcc = dot(acc, vec3(0.299, 0.587, 0.114));

  // Bloom on the brightest cores; beats widen the halo, which is a light-side
  // response so a transient never moves geometry.
  acc += pow(lumAcc, 2.3)
    * mix(u_brandSecondary, u_brandAccent, 0.5)
    * (0.3 + beatHit(1.5) * 0.4);

  // Click brightness pulse.
  acc += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.4) * 0.25;

  // Treble sparkle — high-frequency content on a high-frequency spatial term,
  // and only where the tunnel is already lit or it reads as dirt on the glass.
  float sparkle = hash(gl_FragCoord.xy * 1.7 + fract(u_time * 3.1) * 91.0);
  sparkle = pow(sparkle, 12.0) * u_treble * u_audioActive;
  acc += sparkle * mix(u_brandAccent, vec3(1.0), 0.6) * min(lumAcc, 1.0) * 2.5;

  // ── Composite ─────────────────────────────────────────────────
  // Additive-over-background rather than a flat mix. \`cover\` is the tunnel's
  // own opacity, so voids show the background at full strength: on a light
  // brand the empty bore stays light instead of being forced toward black.
  float cover = 1.0 - exp(-lumAcc * 2.5);
  vec3 color = aces(bgGrad * (1.0 - cover) + acc);
  color = mix(bgGrad, color, u_intensity);

  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
