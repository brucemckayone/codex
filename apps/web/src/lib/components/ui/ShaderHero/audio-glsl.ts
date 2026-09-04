/**
 * Shared audio-reactive GLSL — the common vocabulary every preset speaks.
 *
 * Interpolate `AUDIO_UNIFORMS` into a fragment shader's uniform block and
 * `AUDIO_HELPERS` into its function section, then upload with
 * `uploadAudioUniforms()` from `./audio-uniforms`. The uniform names here and
 * the names uploaded there are one contract — change both or neither.
 *
 * ## Why a shared chunk
 *
 * Before this existed, each preset invented its own audio response: most did
 * `speed + amplitude * 0.15` and nothing else. Raw `amplitude` is noisy at
 * frame rate, so that reads as jitter rather than music, and every preset
 * jittered differently. Centralising the vocabulary means a fix to the
 * *feel* of audio response lands everywhere at once.
 *
 * ## The rules that make it read as musical rather than twitchy
 *
 * 1. **Never drive geometry from a raw band.** `u_flux` and per-frame band
 *    energy belong on colour, brightness, grain and detail density. Shape,
 *    camera and flow direction come from `u_energy` (slow) or `u_beatPhase`
 *    (integrated), which are C1-continuous by construction.
 * 2. **Gate everything on `u_audioActive`.** It is a smoothly ramped 0..1, not
 *    a boolean — so a preset eases into audio response instead of popping.
 *    Multiply every audio term by it and the silent case is exactly the
 *    pre-audio look.
 * 3. **`u_beatPhase` replaces `u_time` for internal motion**, not in addition
 *    to it. A preset that uses both runs at wall-clock rate with a wobble.
 * 4. **Budget the total displacement.** Audio should modulate an existing
 *    look by roughly ±25%, never redefine it. If audio can double a value,
 *    the silent state was too timid — raise the base instead.
 */

/**
 * Canonical audio uniform declarations. All are plain floats, all in 0..1
 * except `u_beatPhase` which grows without bound.
 *
 * Every preset declares the whole block even if it uses three of them —
 * unused uniforms are stripped by the GLSL compiler at zero cost, and a
 * uniform that is *sometimes* declared makes `uploadAudioUniforms` a
 * per-preset conditional instead of one shared call.
 */
export const AUDIO_UNIFORMS = /* glsl */ `
// ── Audio-reactive block (shared; see audio-glsl.ts) ──────────────
uniform float u_audioActive;  // 0..1 smooth ramp — gate ALL audio terms on this
uniform float u_bass;         // 0..1 smoothed low-band energy
uniform float u_mids;         // 0..1 smoothed mid-band energy
uniform float u_treble;       // 0..1 smoothed high-band energy
uniform float u_level;        // 0..1 smoothed overall amplitude
uniform float u_beatPulse;    // 0..1 transient spike, ~400ms half-life
uniform float u_energy;       // 0..1 slow macro envelope (tau ~4s)
uniform float u_flux;         // 0..1 positive spectral flux (noisy — colour only)
uniform float u_centroid;     // 0..1 spectral brightness (timbre, for hue)
uniform float u_beatPhase;    // musical clock, unbounded, energy-paced
uniform float u_beatSeed;     // stable pseudo-random 0..1, re-rolled per onset
`;

/**
 * Shared audio helper functions.
 *
 * Deliberately small and branch-free: these run per-fragment on mobile GPUs,
 * so every helper is a handful of ALU ops with no texture reads and no loops.
 */
export const AUDIO_HELPERS = /* glsl */ `
// ── Audio helpers (shared; see audio-glsl.ts) ─────────────────────

/**
 * Scale an audio signal into a bounded modulation around 1.0.
 * \`audioMod(u_bass, 0.25)\` returns 1.0 when silent and 0.75..1.25 with
 * audio — the standard way to make a magnitude breathe without letting it
 * run away. Gated on u_audioActive internally, so callers don't repeat it.
 */
float audioMod(float signal, float depth) {
  return 1.0 + (signal * 2.0 - 1.0) * depth * u_audioActive;
}

/**
 * One-sided version: 1.0 at silence, rising to 1.0 + depth at full signal.
 * Use where a value must never dip below its resting look (bloom, density).
 */
float audioLift(float signal, float depth) {
  return 1.0 + signal * depth * u_audioActive;
}

/**
 * Smooth, bounded pseudo-random drift in 0..1 — three incommensurate sines so
 * the sum never repeats on a short cycle and never has a corner. This is the
 * replacement for time-driven camera jerk: it is C-infinity continuous, so no
 * choice of speed can make it snap.
 *
 * \`seed\` decorrelates independent drifts (pass 0.0, 1.7, 3.3, ... for each).
 */
float smoothDrift(float t, float seed) {
  return (
      sin(t * 0.31 + seed * 1.7) * 0.5
    + sin(t * 0.19 + seed * 2.9 + 1.3) * 0.33
    + sin(t * 0.11 + seed * 4.1 + 2.7) * 0.17
  ) * 0.5 + 0.5;
}

/** Signed variant of smoothDrift, in -1..1. */
float smoothDriftSigned(float t, float seed) {
  return smoothDrift(t, seed) * 2.0 - 1.0;
}

/**
 * A slow "breath" in 0..1 that speeds up with musical energy. The standard
 * envelope for scale, bloom radius, and opacity pulsing — it reads as calm
 * because the rate is bounded and the shape is a raised sine, not a spike.
 */
float audioBreath(float phase) {
  return sin(phase * 6.2831853) * 0.5 + 0.5;
}

/**
 * Percussive envelope shaped for visual use: the raw beat pulse decays
 * exponentially, which visually reads as a soft bump. Raising it to a power
 * sharpens the attack and shortens the tail so a beat reads as a hit.
 */
float beatHit(float sharpness) {
  return pow(u_beatPulse, sharpness) * u_audioActive;
}

/**
 * Timbre-driven hue offset in -1..1. Bright material pushes one way, dark
 * material the other, around a neutral centre at centroid 0.25 (typical for
 * music). Slew-limited by the analyser's own smoothing, so safe on colour.
 */
float audioHueShift(float depth) {
  return (u_centroid - 0.25) * 2.0 * depth * u_audioActive;
}

/**
 * Blend a base colour toward a target by an audio signal, preserving the
 * base exactly at silence. Keeps every preset's palette recognisable while
 * still letting it move — the common failure is audio washing colour out.
 */
vec3 audioTint(vec3 base, vec3 target, float signal, float depth) {
  return mix(base, target, clamp(signal * depth * u_audioActive, 0.0, 1.0));
}
`;

/**
 * Convenience: the full audio block (uniforms + helpers) for shaders whose
 * uniform and function sections are adjacent. Most presets declare uniforms
 * near the top and helpers below, and should interpolate the two separately.
 */
export const AUDIO_GLSL = `${AUDIO_UNIFORMS}\n${AUDIO_HELPERS}`;
