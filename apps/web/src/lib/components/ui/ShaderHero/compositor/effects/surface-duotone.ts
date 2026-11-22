import type { MediaEffect } from './effect';

/**
 * Duotone in the brand, over the footage: the piece's light, a touch more
 * contrasted, mapped from the brand's dark through its primary to a pale of the
 * primary. The three stops are worked out once a frame from the brand's OWN
 * tokens (`../duotone.ts`, under test): never literal black or white, and a
 * primary near either drawn toward mid-grey. Still: no clock.
 */
export const surfaceDuotone: MediaEffect = {
  id: 'surface-duotone',
  axis: 'media',
  label: 'Duotone in the brand',
  uniforms: ['u_scene', 'u_amount', 'u_toneDeep', 'u_toneMid', 'u_tonePale'],
  amount: 0.9,
  phoneFallback: 'surface-duotone',
  reducedMotionFallback: 'surface-duotone',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float g = clamp((luma(c) - 0.5) * 1.12 + 0.5, 0.0, 1.0);
  vec3 d = g < 0.5
    ? mix(u_toneDeep, u_toneMid, g * 2.0)
    : mix(u_toneMid, u_tonePale, g * 2.0 - 1.0);
  fragColor = vec4(mix(c, d, u_amount), 1.0);
}`,
};
