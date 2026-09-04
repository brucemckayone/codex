/**
 * Nebula fragment shader — layered volumetric cosmic dust with a star field.
 *
 * ## What changed in the 2026-09 overhaul
 *
 * **Motion.** Every dust layer rotated at a constant angular rate:
 * `rotAngle = depthFrac * 1.5 + t * 0.3`, i.e. a mechanical sweep whose rate
 * the speed slider multiplied. Replaced by `driftAxis()` — three incommensurate
 * low-frequency components with an analytically bounded derivative, so the
 * layers wobble instead of turning and no choice of speed can make them snap.
 * Peak angular rate is now 0.062 * 0.5 * 0.55 = 0.017 rad per unit clock
 * (0.002 rad/s at the default speed of 0.12), against 0.3 * 0.12 = 0.036 rad/s
 * before. The linear streaming term is kept — that is the medium flowing, not a
 * camera — but is now paced by the integrated clock, so the nebula settles when
 * the music stops. Mouse wind is kept and is the one motion the viewer causes.
 *
 * **Audio.** Previously `speed + amplitude * 0.15` and `wind + bass * 0.2`, both
 * off the raw per-frame amplitude, which reads as jitter. Now: the pacing clock
 * is the differentiated musical clock (see nebula-renderer.ts), `u_bass` lifts
 * the medium's density, `u_energy` opens the depth palette out, `u_centroid`
 * slides the whole depth ramp toward the accent end so colour tracks timbre,
 * `u_treble` drives per-star flare (high-frequency content belongs on points,
 * not on the volume), `u_beatPulse` blooms the cloud cores, and `u_flux` rides
 * the grain. Colour cycling via `computeImmersiveColours()` was dropped: the
 * three brand stops ARE the depth cue here, so cycling them fights it.
 *
 * **Cost.** Measured over a 480x270 grid at four clock positions, this preset
 * is NOT the 16-step hog it looks like: at the default density of 0.8 the
 * alpha early-exit stops the march after a mean of 2.5 of 8 layers, because
 * `layerAlpha` reaches 0.95 in three dense layers. The cost blows up at LOW
 * density instead — at 0.2 the exit never fires and all 8 layers run, 24 value
 * noise lookups per pixel.
 *
 * So the work went to the worst case. The stack is split into a near march at
 * three noise octaves and a far march at two: far layers are attenuated by
 * depth and mostly sit behind accumulated alpha, so the third octave is not
 * worth its four hash evaluations there. Measured effect: 24.00 to 20.00
 * lookups per pixel at density 0.2 (-16.7%), 23.21 to 19.51 at 0.4 (-15.9%),
 * and exactly zero at 0.8 and above — the far layers are already unreached, so
 * the split is free there rather than a win. It is two loops rather than a
 * branch inside one so the saving cannot depend on a driver declining to
 * flatten a ternary over two function calls.
 *
 * Unconditional wins: two divides per layer are gone (the normalised 3-weight
 * palette became two nested `smootherstep` mixes, and the depth reciprocal is
 * hoisted) — 4.90 divides per pixel at the default density, now none — and the
 * star field's per-star branch became a smoothstep gate. Per-pixel dither on
 * the layer depth turns the discrete stack's concentric banding into fine
 * noise, which the film grain masks; it costs about 3% more layers marched
 * (2.45 to 2.52) because a dithered depth lowers some layer alphas.
 *
 * **Colour.** The background was `u_bgColor * 0.35` to `u_bgColor * 0.18`,
 * which turns a light brand background into mid grey. It now deepens toward
 * black only in proportion to how dark the chosen background already is, and
 * the tonemap gains back the 0.804 that ACES costs a white sky.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const NEBULA_FRAG = `#version 300 es
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
uniform int u_depth;
uniform float u_wind;
uniform float u_stars;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see nebula-renderer.ts).
 *
 * Already scaled by the preset's speed setting, which is why there is no
 * u_speed uniform any more: speed multiplies the integration RATE rather than
 * the elapsed time, so changing it cannot retroactively rescale the position
 * the dust has already drifted to.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

/** Upper bound on the layer stack. The active count is u_depth (default 8). */
const int MAX_LAYERS = 16;

// ── Value noise (iq construction) ─────────────────────────────────
float hash1(vec2 p) {
  p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
  return -1.0 + 2.0 * fract(p.x * p.y * (p.x + p.y));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash1(i + vec2(0.0, 0.0)), hash1(i + vec2(1.0, 0.0)), u.x),
    mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/** Hash for grain and the star field. */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

/** Three octaves — the near half of the stack, where fine detail reads. */
float fbm3(vec2 p) {
  float f = 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p); p = octaveRot * p * 2.03;
  f += 0.125 * noise(p);
  return f / 0.875;
}

/**
 * Two octaves — the far half. Those layers are attenuated by depth and mostly
 * sit behind accumulated alpha, so the third octave's 0.125 weight is not
 * worth its four hash evaluations.
 *
 * This buys nothing at the default density of 0.8: the alpha early-exit
 * already stops the march inside the near half, so the far loop never runs.
 * It pays at low density, where the exit never fires and all 8 layers do run —
 * 16.7% fewer noise lookups at density 0.2. That is the case that decides
 * whether this preset holds frame rate, so it is the case worth optimising.
 */
float fbm2(vec2 p) {
  float f = 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p);
  return f / 0.750;
}

/**
 * Monotone 3-stop depth palette: two nested smootherstep mixes, no divide.
 * The old form summed three smoothstep weights and divided by their total,
 * which cost a divide per layer and was not monotone where the weights
 * crossed. spread widens the mid stop and is driven by the slow audio
 * envelope, so a busy passage shows more of the secondary colour.
 */
vec3 nebulaPalette(float t, float spread) {
  float lo = 0.55 - spread * 0.15;
  float hi = 0.45 + spread * 0.15;
  vec3 c = mix(u_brandPrimary, u_brandSecondary, smootherstep(0.0, lo, t));
  return mix(c, u_brandAccent, smootherstep(hi, 1.0, t));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Grid-based star field with twinkle, branch-free.
 *
 * The old version wrapped the whole per-star body in an
 * if (starBright > threshold) test, which both diverged inside a wave and put
 * a hard edge on the star population — a star at the threshold popped in at
 * full brightness. A smoothstep gate is cheaper on a GPU and fades stars in.
 *
 * sparkle carries smoothed treble: it adds a second, faster twinkle component
 * and a small size lift, so high-frequency musical content shows up as points
 * of light rather than as movement in the volume.
 *
 * Twinkle deliberately runs on wall time, not the musical clock. Stars are
 * ambient — a night sky that freezes mid-scintillation when a track pauses
 * reads as a dropped frame, not as a musical choice.
 */
float starField(vec2 uv, float starDensity, float t, float sparkle) {
  if (starDensity <= 0.0) return 0.0;

  // Loop-invariant: hoisted out of the two layers, and the reciprocal
  // replaces a divide that used to run per layer.
  float threshold = 1.0 - starDensity * 0.3;
  float invRange = 1.0 / max(1.0 - threshold, 0.001);

  float stars = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float scale = 30.0 + float(layer) * 20.0;
    vec2 cell = floor(uv * scale);
    vec2 frac = fract(uv * scale);
    vec2 starPos = vec2(hash(cell), hash(cell + vec2(127.1, 311.7)));
    float d = length(frac - starPos);

    float starBright = hash(cell + vec2(42.0, 17.0));
    float rel = clamp((starBright - threshold) * invRange, 0.0, 1.0);
    float lit = smoothstep(threshold, threshold + 0.015, starBright);

    float twinkle = 0.7 + 0.3 * sin(t * (2.0 + starBright * 3.0) + starBright * 6.28);
    twinkle += sparkle * (0.5 + 0.5 * sin(t * 9.0 + starBright * 21.0));

    float sizeMul = mix(0.04, 0.08, rel) * (1.0 + sparkle * 0.3);
    stars += smoothstep(sizeMul, 0.0, d) * twinkle * rel * lit;
  }
  return clamp(stars, 0.0, 1.4);
}

/**
 * Where one dust layer samples the noise field.
 *
 * Factored out so the near-field and far-field marches differ ONLY in octave
 * count. The layer rotation is seeded from the coherent layer index rather
 * than the dithered depth, so neighbouring pixels rotate together and the
 * dither surfaces as fine grain in density instead of as swirl noise.
 */
vec2 layerSample(vec2 gasUv, float layerT, float layerDepth, vec2 flow) {
  float rotAngle = layerT * 1.5 + driftAxis(u_clock * 0.5, 7.3 + layerT * 4.0) * 0.55;
  float cR = cos(rotAngle);
  float sR = sin(rotAngle);
  mat2 layerRot = mat2(cR, -sR, sR, cR);
  return layerRot * (gasUv * u_scale * layerDepth) + flow;
}

/**
 * Composite one dust layer front-to-back. The FBM sample arrives as an
 * argument so the caller picks the octave count without a branch in here.
 */
void addLayer(
  float n, float depthFrac, float density, float paletteShift, float spread,
  inout vec3 acc, inout float accAlpha
) {
  float cloudDensity = smoothstep(0.05, 0.45, n * 0.5 + 0.5);

  // Rim light at cloud boundaries — the classic nebula edge glow.
  float edgeGlow = smoothstep(0.1, 0.3, cloudDensity) * smoothstep(0.7, 0.5, cloudDensity);

  vec3 layerColor = nebulaPalette(clamp(depthFrac + paletteShift, 0.0, 1.0), spread);
  layerColor += edgeGlow * mix(u_brandAccent, vec3(1.0), 0.3) * 0.5;

  float layerAlpha = cloudDensity * density * (1.0 - accAlpha) * (1.0 - depthFrac * 0.3);
  acc += layerColor * layerAlpha;
  accAlpha += layerAlpha;
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse wind. Kept and unchanged — pointer follow is the one motion the
  // viewer causes directly, and it reads as responsive rather than as drift.
  vec2 windOffset = (u_mouse - 0.5) * u_wind;
  vec2 gasUv = uv + windOffset;

  // ── Pacing clock ────────────────────────────────────────────────
  // Integrated by the renderer, never derived here. The obvious in-shader
  // form, mix(u_time * k, u_beatPhase, u_audioActive), is WRONG: u_beatPhase
  // starts at zero when the analyser is created while u_time may already be
  // at 60s, so easing the ramp 0 to 1 sweeps the clock backwards and the whole
  // nebula lurches in reverse the moment playback starts. The renderer
  // differentiates the musical clock and integrates the resulting RATE, so
  // position is monotone by construction.
  float clock = u_clock;

  // Streaming flow — the medium moving, not a camera. Unbounded on purpose
  // (dust drifts past), but paced by the clock so it settles with the track.
  vec2 flow = vec2(clock * 0.7, clock * 0.5);

  // Bass thickens the medium. One-sided, so silence is the resting look and
  // audio can only ever add body.
  float density = u_density * audioLift(u_bass, 0.3);

  // Slow macro envelope opens the depth palette out. u_energy has a 4s time
  // constant, so this can never twitch.
  float spread = u_energy * u_audioActive;

  // Timbre slides the whole depth ramp toward the accent end: brighter
  // material reads as a hotter nebula. Shifting the ramp position keeps all
  // three brand stops intact, which cycling the stops themselves would not.
  float paletteShift = audioHueShift(0.18);

  // Smoothed treble, gated on the ramp — drives star flare only.
  float sparkle = u_treble * u_audioActive;

  // ── Stars ─────────────────────────────────────────────────────
  float stars = starField(v_uv, u_stars, u_time, sparkle);
  float starTintHash = hash(floor(v_uv * 30.0) + vec2(17.3));
  vec3 starColor = mix(
    mix(u_brandPrimary * 1.2, vec3(1.0), 0.75),
    mix(u_brandAccent * 1.2, vec3(1.0), 0.75),
    starTintHash
  ) * stars;

  // ── Layer march, front to back ────────────────────────────────
  vec3 accColor = vec3(0.0);
  float accAlpha = 0.0;

  int layerCount = max(u_depth, 1);
  // Hoisted: this divide used to run once per layer.
  float invSpan = 1.0 / float(max(layerCount - 1, 1));

  // Per-pixel dither on the layer depth, in units of one layer step. The
  // stack is discrete, so without this the depth palette and the parallax
  // scale step in visible concentric bands; dithered, they read as fine
  // noise that the film grain below already masks.
  float layerDither = (hash(gl_FragCoord.xy * 1.13 + fract(u_time * 0.29) * 57.0) - 0.5);

  // Near half: three octaves.
  int nearCount = (layerCount + 1) / 2;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= nearCount || accAlpha > 0.95) break;
    float layerT = float(i) * invSpan;
    float depthFrac = clamp(layerT + layerDither * invSpan, 0.0, 1.0);
    vec2 samplePos = layerSample(gasUv, layerT, 1.0 + depthFrac * 3.0, flow);
    addLayer(fbm3(samplePos), depthFrac, density, paletteShift, spread, accColor, accAlpha);
  }

  // Far half: two octaves.
  for (int i = 0; i < MAX_LAYERS; i++) {
    int li = i + nearCount;
    if (li >= layerCount || accAlpha > 0.95) break;
    float layerT = float(li) * invSpan;
    float depthFrac = clamp(layerT + layerDither * invSpan, 0.0, 1.0);
    vec2 samplePos = layerSample(gasUv, layerT, 1.0 + depthFrac * 3.0, flow);
    addLayer(fbm2(samplePos), depthFrac, density, paletteShift, spread, accColor, accAlpha);
  }

  // ── Click burst ────────────────────────────────────────────
  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    vec2 toMouse = uv - burstUv;
    float burstDist = dot(toMouse, toMouse);
    float burst = u_burstStrength * exp(-burstDist * 8.0);
    accColor += mix(u_brandAccent, vec3(1.0), 0.6) * burst * 2.5;
    accAlpha = min(accAlpha + burst * 0.5, 1.0);
  }

  // ── Background ────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);

  // u_bgColor may be light: this is a brand slot, not a constant. The old
  // form scaled it to 0.18..0.35, which renders a white sky as mid grey. Deep
  // space is now reached by darkening in PROPORTION to how dark the chosen
  // background already is, so a light palette keeps its own value.
  float bgLum = dot(u_bgColor, vec3(0.299, 0.587, 0.114));
  float lightSky = smoothstep(0.42, 0.76, bgLum);
  vec3 deepCentre = mix(u_bgColor * 0.35 + u_brandPrimary * 0.03, u_bgColor, lightSky);
  vec3 deepEdge = mix(u_bgColor * 0.18, u_bgColor * 0.92, lightSky);
  vec3 spaceColor = mix(deepCentre, deepEdge, smoothstep(0.0, 1.6, r2));

  vec3 background = spaceColor + starColor;
  vec3 color = background * (1.0 - accAlpha) + accColor;

  // ── Bloom on bright cloud cores ───────────────────────────────
  // Beats widen the halo. A transient on the light side never moves geometry.
  float cloudLum = dot(accColor, vec3(0.299, 0.587, 0.114));
  color += pow(cloudLum, 2.5) * mix(u_brandSecondary, u_brandAccent, 0.5) * (0.3 + beatHit(1.5) * 0.4);

  // ── Post-process ────────────────────────────────────────────
  //
  // ACES maps an input of 1.0 to 0.804, so a white brand background could
  // never render as white. Gain that back in proportion to how light the
  // palette is; at lightSky = 0 the multiplier is exactly 1.0 and the
  // dark-sky look is bit-identical.
  //
  // White point 1.6 rather than 1.0. A full gain leaves headroom only up to an
  // input of about 1.13, which clips the additive core bloom below against a
  // light ground — the failure mode measured on clouds, where the full-gain
  // form cost 47% of within-cloud contrast.
  const float ACES_WHITE = 0.8862;   // aces(1.6)
  color = clamp(aces(color) * mix(1.0, 1.0 / ACES_WHITE, lightSky), 0.0, 1.0);

  color = mix(u_bgColor, color, u_intensity);

  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  // Luminance-aware grain. Spectral flux is noisy by construction, which is
  // exactly right for grain and wrong for anything structural.
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum) * (1.0 + u_flux * 0.5 * u_audioActive);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
