import type { MediaEffect } from './effect';

/**
 * The stills' push-in (on by default): a picture is drawn slowly in about its
 * centre over its piece (`../media-pass.ts` `pushZoom`), so the reel never
 * looks paused between films. Footage plays, so it is never pushed. Under
 * reduced motion it is dropped: the picture holds still.
 */
export const mediaPush: MediaEffect = {
  id: 'media-push',
  axis: 'media',
  label: 'Pictures push in',
  uniforms: ['u_scene', 'u_zoom'],
  amount: 1,
  phoneFallback: 'media-push',
  reducedMotionFallback: null,
  glsl: `void main() {
  // In about the centre, never out past the picture's edge.
  vec2 uv = 0.5 + (v_uv - 0.5) / max(u_zoom, 1.0);
  fragColor = vec4(texture(u_scene, uv).rgb, 1.0);
}`,
};
