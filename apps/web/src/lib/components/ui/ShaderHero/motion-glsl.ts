/**
 * Shared motion GLSL — the fix for jerky camera movement.
 *
 * ## The defect this exists to remove
 *
 * Several raymarched presets animate the camera straight off wall-clock time:
 * `ro.xz += vec2(sin(u_time), cos(u_time)) * 3.0` or a rotation matrix built
 * from `u_time * speed`. Two things go wrong.
 *
 * 1. **Rate, not shape.** A single sine at a visible frequency reads as a
 *    mechanical sweep, and turning `speed` up makes it a lurch. The motion has
 *    no acceleration profile, so the eye reads the turnaround at each extreme
 *    as a stop-and-reverse.
 * 2. **Amplitude coupled to nothing.** Because the base motion is already at
 *    the edge of comfortable, any audio term added on top overshoots.
 *
 * The replacement principle: **the camera should orbit on a slow, non-repeating
 * path with bounded angular velocity, and it should always be looking at
 * something.** A path built from incommensurate low-frequency sines has no
 * perceptible turnaround because no single component dominates, and its
 * derivative is bounded analytically rather than by hoping.
 *
 * ## Choosing amplitudes
 *
 * Angular velocity, not position, is what reads as jerk. For a component
 * `A*sin(w*t)` the peak angular rate is `A*w`. Keep the *sum* of `A*w` across
 * components under ~0.25 rad/s for a background and the motion reads as drift;
 * above ~0.6 rad/s it reads as a camera move and competes with the content
 * sitting on top of the hero.
 */

/**
 * Camera and easing helpers. Interpolate into a fragment shader's function
 * section, after `AUDIO_HELPERS` if both are used (`orbitCamera` optionally
 * consumes audio uniforms, but nothing here requires them).
 */
export const MOTION_HELPERS = /* glsl */ `
// ── Motion helpers (shared; see motion-glsl.ts) ───────────────────

/**
 * Bounded, non-repeating scalar drift in -1..1 with an analytically bounded
 * derivative. Three incommensurate components: peak rate is
 * 0.6*0.077 + 0.3*0.043 + 0.1*0.029 ~= 0.062 per unit t, so scaling by an
 * amplitude A gives a peak rate of 0.062*A directly.
 *
 * The frequencies are mutual irrationals, so the sum's period is effectively
 * unbounded — no visible loop even over several minutes.
 */
float driftAxis(float t, float seed) {
  return sin(t * 0.077 + seed * 1.7) * 0.6
       + sin(t * 0.043 + seed * 3.1 + 0.9) * 0.3
       + sin(t * 0.029 + seed * 5.3 + 2.2) * 0.1;
}

/** Two decorrelated drift axes as a vec2 — the common case for camera offset. */
vec2 drift2(float t, float seed) {
  return vec2(driftAxis(t, seed), driftAxis(t, seed + 11.3));
}

/** Three decorrelated drift axes. */
vec3 drift3(float t, float seed) {
  return vec3(
    driftAxis(t, seed),
    driftAxis(t, seed + 11.3),
    driftAxis(t, seed + 23.7)
  );
}

/**
 * Build an orbiting camera basis that always looks at \`target\`.
 *
 * Because the camera is reconstructed from a look-at every frame rather than
 * accumulating a rotation, drift in position can never turn into drift in
 * aim — the classic cause of a shot slowly sliding off its subject.
 *
 * \`radius\` is the orbit distance, \`sway\` the drift amplitude in world units
 * (keep it well under radius — a third is generous), \`t\` the pacing clock
 * (prefer u_beatPhase when audio is active).
 *
 * Writes the basis into ro/forward/right/up.
 */
void orbitCamera(
  float t, float seed, float radius, float sway, vec3 target,
  out vec3 ro, out vec3 forward, out vec3 right, out vec3 up
) {
  vec3 wander = drift3(t, seed) * sway;
  // Base orbit is itself a drift, not a constant rotation — a constant yaw
  // rate is exactly the mechanical sweep this helper replaces.
  float az = driftAxis(t * 0.6, seed + 41.0) * 3.14159265;
  float el = driftAxis(t * 0.45, seed + 67.0) * 0.35;
  ro = target + vec3(
    cos(az) * cos(el) * radius,
    sin(el) * radius,
    sin(az) * cos(el) * radius
  ) + wander;

  forward = normalize(target - ro);
  // World up is +Y; guard the degenerate case where forward is near-vertical,
  // which would make the cross product vanish and flip the frame.
  vec3 worldUp = abs(forward.y) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  right = normalize(cross(worldUp, forward));
  up = cross(forward, right);
}

/**
 * Cubic ease-in-out on 0..1. Zero derivative at both ends, so a value eased
 * with this can be chained into another animation without a corner.
 */
float easeInOut(float x) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5;
}

/**
 * Smootherstep — Perlin's C2-continuous variant. Unlike smoothstep its second
 * derivative also vanishes at the ends, which matters when the result drives
 * a position: smoothstep's acceleration discontinuity is visible on slow moves.
 */
float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/**
 * Soft maximum — blends rather than corners where two values cross. Use in
 * place of max() wherever a visible crease appears at the crossover, e.g.
 * combining two distance fields or two brightness contributions.
 */
float softMax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(a, b, h) + k * h * (1.0 - h);
}

/** Soft minimum (polynomial smooth-min) — the SDF blending workhorse. */
float softMin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
`;
