import type { PointerEffect } from './motion';
import { TRAIL_POINTS } from './motion-uniforms';

/**
 * The pointer, liquid (the owner's pick over the v3 smoke): each point of
 * its trail sends a ring out through the film, and the pointer itself is a
 * soft lens. Under reduced motion it gives way to none: its rings spread on
 * after the pointer stops, motion the visitor did not make, and the plan
 * says reduced motion shows stills (Codex-1yd58.7 review M5, 2026-11-21).
 */
export const pointerLiquid: PointerEffect = {
  id: 'liquid',
  axis: 'reel-pointer',
  label: 'Liquid',
  uniforms: ['u_trail', 'u_pointerOn', 'u_pointer'],
  phoneFallback: 'liquid',
  reducedMotionFallback: 'none',
  glsl: `void reelPointer(inout Motion mo, vec2 uv) {
  vec2 asp = aspectScale();
  for (int i = 0; i < ${TRAIL_POINTS}; i++) {
    vec4 q = u_trail[i];
    if (q.z <= 0.0) continue;
    vec2 d = (uv - q.xy) * asp;
    float r = length(d), ring = (r - q.w) / 0.03;
    mo.warp += d / max(r, 1e-4) / asp * q.z * 0.024 * exp(-ring * ring);
  }
  if (u_pointerOn > 0.5) {
    vec2 d = (uv - u_pointer) * asp;
    mo.warp -= d / asp * 0.32 * exp(-dot(d, d) / 0.007);
  }
}`,
};
