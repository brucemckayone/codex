/**
 * Pearl fragment shader — Raymarched displaced sphere with a thin-film nacre.
 *
 * ## What changed and why
 *
 * **Motion.** The surface phase came straight off wall clock:
 * `t = u_time * u_speed`, feeding `sin(p.x * 2.0 + t)`. One frequency at a
 * visible rate, so the deformation crawled across the sphere at a constant
 * speed and turning `speed` up made it lurch. Worse, the click burst added
 * `u_burstStrength * 2.0` straight to `t`, which shoved the phase forward two
 * radians and then dragged it back as the burst decayed — a lurch out and a
 * lurch home. The phase is now three incommensurate drift components per axis
 * (`drift3`), paced by a monotone clock the renderer integrates, and the burst
 * feeds that clock's RATE instead of its position, so it can never reverse.
 *
 * The camera is deliberately still. This is a material shader: the subject is
 * the surface's optical behaviour, and moving the viewpoint to the beat is the
 * aggressive motion this pass exists to remove. What moves is the light (with
 * the pointer) and the surface itself.
 *
 * **Colour.** The old iridescence was a fresnel-to-hue ramp plus a cosine
 * palette with hardcoded 0.33/0.67 phase offsets — arbitrary hues that fought
 * whatever palette the creator picked. It is now a thin-film interference
 * model over the three brand stops, which is what actually makes nacre
 * iridescent, so the effect is physically motivated and every palette choice
 * stays visible. Film thickness is the natural place for timbral brightness,
 * because thickness is physically what sets an interference colour.
 *
 * **Cost.** 64 open-ended march steps, with background rays proving their miss
 * by marching until `totalDist > 10.0` — four to six SDF evaluations, so 24 to
 * 36 sines, spent on a pixel that was always going to be background. An
 * analytic bounding-sphere reject settles the same question in about ten ALU
 * ops. Rays that do enter run a 40-step dithered sphere trace confined to the
 * bounding interval, with a step floor and an epsilon that both scale with
 * that interval, so the trace can neither stall at a grazing angle nor
 * overshoot: the displaced SDF is not 1-Lipschitz and the old full-length
 * steps punched holes through bumps in the silhouette.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const PEARL_FRAG = `#version 300 es
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
uniform float u_displacement;
uniform float u_fresnel;
uniform float u_specular;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone surface-phase clock, integrated on the CPU (see pearl-renderer.ts).
 *
 * Already scaled by the preset speed setting, which is why there is no
 * u_speed uniform any more: speed multiplies the integration RATE rather than
 * the elapsed time, so changing it cannot retroactively rescale the phase the
 * surface has already drifted to. The click burst feeds the same rate.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Sphere-trace steps inside the bounding interval. Was 64, open-ended. */
const int MARCH_STEPS = 40;

/**
 * Under-relaxation on the sphere trace.
 *
 * The displacement adds a term whose partial derivatives reach 3.5, 4.2 and
 * 3.8 times the amplitude on x, y and z, so at the default amplitude the SDF
 * has a Lipschitz constant near 2 rather than 1. A full-length step is then
 * not conservative and can pass straight through a bump — visible as holes in
 * the silhouette, which the old march produced. The pessimistic bound asks for
 * 0.5; 0.7 is the practical value at which the holes are gone.
 */
const float RELAX = 0.7;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/**
 * Surface displacement.
 *
 * Amplitude and the three phases are PARAMETERS, not reads of a uniform plus
 * a global clock. Both are loop-invariant, and this runs 40 times in the march
 * plus six more in the normal estimate, so hoisting them out is 46 evaluations
 * that no longer recompute the same drift.
 */
float displace(vec3 p, float amp, vec3 ph) {
  return sin(p.x * 2.0 + ph.x) * sin(p.y * 3.0 + ph.y) * sin(p.z * 2.0 + ph.z) * amp
       + sin(p.x * 5.0 + ph.z) * sin(p.y * 4.0 + ph.x) * sin(p.z * 6.0 + ph.y) * amp * 0.3;
}

float sdf(vec3 p, float amp, vec3 ph) {
  return length(p) - 1.0 + displace(p, amp, ph);
}

vec3 calcNormal(vec3 p, float amp, vec3 ph) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    sdf(p + e.xyy, amp, ph) - sdf(p - e.xyy, amp, ph),
    sdf(p + e.yxy, amp, ph) - sdf(p - e.yxy, amp, ph),
    sdf(p + e.yyx, amp, ph) - sdf(p - e.yyx, amp, ph)
  ));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Thin-film interference across the three brand stops.
 *
 * Nacre is not a hue wheel. It is a stack of aragonite platelets, and the
 * colour at any point is whichever wavelengths reinforce after reflecting off
 * both faces of that stack. Two quantities decide it: the film's optical
 * thickness and the angle light takes through it — and interference orders
 * repeat, so colour is PERIODIC in that product rather than monotone in it.
 * That periodicity is why real nacre runs the same sequence of colours again
 * and again as you tilt it, and why a linear fresnel-to-hue ramp never looks
 * like a pearl.
 *
 * thick is optical thickness in interference orders; cosTheta the view/normal
 * cosine. The internal angle is compressed by refraction (the 2.1 is the
 * squared index of aragonite, about 1.45), so a grazing view stretches the
 * path far less than a bare 1/cos would suggest.
 *
 * The result cycles the three brand stops, so no hue is hardcoded and every
 * one of a creator's three colours is visible somewhere on the surface.
 */
vec3 nacre(float cosTheta, float thick) {
  float ct = sqrt(max(1.0 - (1.0 - cosTheta * cosTheta) / 2.1, 0.02));
  float order = fract(thick / ct) * 3.0;
  float seg = floor(order);
  float f = order - seg;
  // Cyclic 3-stop blend with no divide. The wrap is exact because
  // smoothstep(u) + smoothstep(1 - u) is identically 1, so the segment ends
  // meet with matching value and zero slope.
  float w = f * f * (3.0 - 2.0 * f);
  float g1 = step(0.5, seg);
  float g2 = step(1.5, seg);
  vec3 a = mix(mix(u_brandPrimary, u_brandSecondary, g1), u_brandAccent, g2);
  vec3 b = mix(mix(u_brandSecondary, u_brandAccent, g1), u_brandPrimary, g2);
  return mix(a, b, w);
}

void main() {
  float clock = u_clock;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= aspect;

  vec3 ro = vec3(0.0, 0.0, 3.5);
  vec3 rd = normalize(vec3(uv, -1.5));

  // Light follows the pointer. Kept and left at full strength: it is the one
  // motion the viewer causes directly, and on a material shader relighting is
  // the gesture that reads as touching the thing.
  vec3 lightDir = normalize(vec3(
    0.5 + (u_mouse.x - 0.5) * 1.5,
    0.8,
    1.0 + (u_mouse.y - 0.5) * 1.5
  ));

  // ── Surface deformation ──────────────────────────────────────────
  // Amplitude rides the SLOW envelope and nothing else. Displacement is
  // geometry, and geometry may only be driven by u_energy (tau about 4s) or
  // an integrated clock — a band would pump the whole silhouette per note.
  float amp = u_displacement * audioLift(u_energy, 0.22);

  // Phase drift replaces the old single sine. Peak rate is 0.062 per unit
  // clock per axis, so at amplitude 6.0 the phase moves at most 0.372 per
  // unit clock; against the renderer's 0.8/s idle rate that is 0.30 rad/s of
  // phase, and the bumps themselves travel at phase rate over spatial
  // frequency, about 0.15 world units per second. There is no turnaround the
  // eye can time because no single component dominates the sum.
  vec3 ph = drift3(clock, 3.7) * 6.0;

  // ── Analytic bounding sphere ─────────────────────────────────────
  // The surface satisfies length(p) <= 1 + 1.35 * amp, so a ray missing that
  // sphere can never hit the pearl. Rejecting those here costs about ten ALU
  // ops; the old march proved the same miss with four to six SDF evaluations,
  // which is 24 to 36 sines.
  float bR = 1.0 + amp * 1.35;
  float bb = dot(ro, rd);
  float cc = dot(ro, ro) - bR * bR;
  float disc = bb * bb - cc;

  float hitF = 0.0;
  vec3 p = ro;
  vec3 n = vec3(0.0, 0.0, 1.0);

  if (disc > 0.0) {
    float sq = sqrt(disc);
    float tFar = -bb + sq;
    float tNear = max(-bb - sq, 0.0);

    // Per-pixel dither on the entry point. A sphere trace leaves its residual
    // error as a stair-step in depth, which bands along the silhouette;
    // dithering the start turns that band into fine noise, and the film grain
    // below already masks noise at this amplitude. This is what makes 40
    // steps look like the old 64.
    float span = max(tFar - tNear, 1e-4);
    float dither = hash(gl_FragCoord.xy + fract(u_time * 0.37));

    // A pure sphere trace stalls at a grazing angle: the distance estimate
    // settles at some small closest-approach value and the ray creeps forward
    // by a fraction of it, exhausting the step budget without either hitting
    // or leaving. That reads as a dark fringe hugging the silhouette. Flooring
    // the step at one uniform sample of the interval makes the worst case a
    // plain 40-step scan of the bounding interval, which always terminates.
    //
    // Both the floor and the hit epsilon scale with the interval, which is the
    // property that makes this safe. The interval collapses toward zero
    // exactly at the silhouette, so the resolution automatically tightens
    // where the geometry is hardest and relaxes where it is easy: at the
    // centre the floor is about 0.06 world units against features roughly
    // 0.5 wide, and the epsilon fattens the surface by 0.03 on a unit sphere.
    float minStep = span / float(MARCH_STEPS);
    float eps = max(0.0015, minStep * 0.5);
    float td = tNear + dither * minStep;

    for (int i = 0; i < MARCH_STEPS; i++) {
      p = ro + rd * td;
      float d = sdf(p, amp, ph);
      if (d < eps) {
        hitF = 1.0;
        break;
      }
      if (td > tFar) break;
      td += max(d * RELAX, minStep);
    }

    if (hitF > 0.5) n = calcNormal(p, amp, ph);
  }

  // ── Background ───────────────────────────────────────────────────
  // The old form was mix(u_bgColor, white, 0.85): a near-white studio sweep
  // whatever the creator chose, which erased a dark palette's background
  // outright. Blend toward white only as far as the brand background is
  // already light, and lift a dark one just enough that the pearl's
  // silhouette still separates from it.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  vec3 bgBase = mix(
    u_bgColor * 1.18 + 0.035,
    mix(u_bgColor, vec3(1.0), 0.72),
    smootherstep(0.18, 0.62, bgLum)
  );

  float r2 = dot(uv, uv);
  vec3 bg = mix(
    bgBase + u_brandPrimary * 0.02,
    bgBase * 0.9,
    smoothstep(0.0, 2.0, r2)
  );

  vec3 color = bg;

  if (hitF > 0.5) {
    float ndv = max(dot(n, -rd), 0.0);
    float fr = pow(1.0 - ndv, u_fresnel);

    // Film thickness. Timbral brightness drives it because thickness is
    // physically what sets an interference colour: a bright, cymbal-heavy
    // passage thins the film and walks the nacre up an order, a dark one
    // thickens it. Typical music sits at centroid 0.25-0.5, so the realistic
    // excursion is about +13% on a base of 1.35 — inside the 25% budget, and
    // still a quarter turn around the 3-stop cycle, which is plainly visible.
    float thick = 1.35 + fr * 1.9 + audioHueShift(0.25);
    vec3 iriColor = nacre(ndv, thick);

    // Body colour under the film, from the brand stops rather than the old
    // hardcoded cosine palette.
    vec3 pearlBody = mix(u_brandPrimary, u_brandSecondary, 0.35) * 0.55;
    vec3 surfaceColor = mix(pearlBody, iriColor, 0.62);

    float diff = max(dot(n, lightDir), 0.0) * 0.6;

    vec3 refl = reflect(-lightDir, n);
    // HDR specular so ACES renders the glint as near-white. A beat sharpens
    // it — a light-side response, so a transient never moves geometry.
    float spec = pow(max(dot(refl, -rd), 0.0), 32.0)
               * u_specular * (3.5 + beatHit(1.6) * 1.1);

    // Bass adds weight to the rim, which is the brief's "body, thickness"
    // mapping applied to light rather than to shape.
    float rim = pow(1.0 - ndv, 2.0) * (0.45 + u_bass * 0.12 * u_audioActive);

    color = surfaceColor * (0.18 + diff)
          + mix(vec3(1.0), u_brandAccent, 0.15) * spec
          + iriColor * rim;

    // Treble is spatially high-frequency as well as spectrally, so it belongs
    // on a fine per-pixel glint on the shell — never on the shell's shape.
    float glint = hash(gl_FragCoord.xy * 1.9 + fract(u_time * 3.7) * 71.0);
    glint = pow(glint, 14.0) * u_treble * u_audioActive;
    color += glint * mix(u_brandAccent, vec3(1.0), 0.7) * 2.2;
  }

  // Click reads instantly as light, in addition to the forward surge it adds
  // to the phase clock in the renderer.
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5)
         * (0.1 + 0.18 * hitF);

  // ── Bloom halo around the silhouette ─────────────────────────────
  float silLum = dot(color, vec3(0.299, 0.587, 0.114)) * hitF;
  color += pow(silLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5)
         * (0.3 + beatHit(1.4) * 0.25);

  // ── Post-process ─────────────────────────────────────────────────
  color = aces(color);
  color = mix(bgBase, color, u_intensity);

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
