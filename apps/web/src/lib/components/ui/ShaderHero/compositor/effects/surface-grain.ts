import type { MediaEffect } from './effect';
import { layerGrain } from './layer-grain';

/**
 * Film grain, over the footage (WP-5b, owner 2026-11-21): the stack's grain,
 * drawn on the piece's own picture, so the shader round it stays clean. The
 * picture's target is the size it is shown at (`../media-pass.ts`
 * `treatedSize`), so a grain is a screen pixel, as the stack's is. Not a
 * flash (zero-mean noise); under reduced motion the one still frame keeps it.
 */
export const surfaceGrain: MediaEffect = {
  ...layerGrain,
  id: 'surface-grain',
  axis: 'media',
  label: 'Film grain',
  phoneFallback: 'surface-grain',
  reducedMotionFallback: 'surface-grain',
};
