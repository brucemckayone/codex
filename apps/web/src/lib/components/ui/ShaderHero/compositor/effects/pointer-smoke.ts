import type { PointerEffect } from './motion';
import { TRAIL_POINTS } from './motion-uniforms';

/**
 * The pointer, smoke: the brand's smoke drifts over the film where the pointer
 * has been, a veil as thick as the smoke is dark, thinning over the words. One
 * soft field, the MAX of the trail's gaussians, never their sum or a cut-out: a
 * threshold reads as bitty clumps.
 *
 * Smoke WITH INERTIA: the field drifts on after the pointer stops. That motion
 * is the trail's, not this hook's: each point of `u_trail` is packed where its
 * carried velocity has taken it (`PointerTrail`,
 * `org-hero/showreel/reel-trail.ts`), so the GLSL draws the same field at rest
 * and in drift. Under reduced motion the trail packs it static, so it stays the
 * visitor's own motion.
 */
export const pointerSmoke: PointerEffect = {
  id: 'smoke',
  axis: 'reel-pointer',
  label: 'Smoke',
  uniforms: ['u_trail'],
  phoneFallback: 'smoke',
  reducedMotionFallback: 'smoke',
  glsl: `void reelPointer(inout Motion mo, vec2 uv) {
  vec2 asp = aspectScale();
  float veil = 0.0;
  for (int i = 0; i < ${TRAIL_POINTS}; i++) {
    vec4 q = u_trail[i];
    if (q.z <= 0.0) continue;
    vec2 d = (uv - q.xy) * asp;
    veil = max(veil, q.z * exp(-dot(d, d) / max(q.w * q.w, 1e-5)));
  }
  if (veil <= 0.0) return;
  float thick = mix(0.3, 0.92, smoothstep(0.15, 0.85, 1.0 - smokeLight(uv, 3.0)));
  float words = 1.0 - 0.5 * smoothstep(0.55, 0.9, 1.0 - uv.y);
  mo.shows *= 1.0 - clamp(veil * thick * words, 0.0, 1.0);
}`,
};
