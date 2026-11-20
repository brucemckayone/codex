/**
 * Each layer's and blend's own strength, the amount a token that names it
 * without one draws at, and the layers dropped under reduced motion (WP-9).
 * The effect files carry the same facts beside their GLSL; they are mirrored
 * here so the stack parse and the brand editor read them without loading any
 * GLSL, and `effect-registry.test.ts` holds the two equal.
 */
import type { BlendId, LayerId } from './ids';

export const LAYER_AMOUNTS: Readonly<Record<LayerId, number>> = {
  grain: 0.6,
  halftone: 1,
  crt: 0.8,
  chroma: 0.7,
  glitch: 0.8,
  leak: 0.7,
  duotone: 1,
  dither: 1,
  ink: 1,
  glow: 0.7,
  mosaic: 0.4,
  liquid: 0.8,
  reeded: 1,
  monotone: 1,
  'shader-light': 1,
};

export const BLEND_AMOUNTS: Readonly<Record<BlendId, number>> = {
  mix: 0.5,
  screen: 0.6,
  multiply: 0.6,
  difference: 0.6,
  'smoke-key': 0.6,
};

/** Layers that draw nothing under reduced motion (`reducedMotionFallback: null`). */
export const MOVING_LAYER_IDS: ReadonlySet<LayerId> = new Set([
  'glitch',
  'liquid',
]);
