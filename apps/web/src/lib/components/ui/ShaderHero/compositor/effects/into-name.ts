import type { IntoEffect } from './motion';

/**
 * Into the film, through the name (the letter dive): the film draws into the
 * letters, then the view dives at constant speed into the name's thickest
 * stroke, its rim streaking in the brand's primary, until the film fills the
 * stage and the player takes over. The frame draws it through the name's veil
 * and the timeline drives it, so the hook adds nothing of its own.
 */
export const intoName: IntoEffect = {
  id: 'name',
  axis: 'reel-film',
  label: 'Through the name',
  uniforms: [],
  phoneFallback: 'name',
  reducedMotionFallback: 'fade',
  throughName: true,
  glsl: 'void reelInto(inout Motion mo, vec2 uv) {}',
};
