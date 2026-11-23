/**
 * The fallback MECHANISM. The brand stack's own effects all keep themselves on
 * a phone and under reduced motion, so this file swaps in a registry whose
 * fallbacks differ: a layer dropped on phones, a layer swapped for another
 * under reduced motion, a frame and a blend swapped.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../effects/registry', () => {
  const pass = (id: string, axis: string, over: object = {}) => ({
    id,
    axis,
    label: id,
    glsl: 'void main() {}',
    uniforms: ['u_scene'],
    amount: 0.5,
    phoneFallback: id,
    reducedMotionFallback: id,
    ...over,
  });
  return {
    BLENDS: {
      heavy: pass('heavy', 'blend', { phoneFallback: 'light' }),
      light: pass('light', 'blend'),
    },
    LAYERS: {
      costly: pass('costly', 'layer', { phoneFallback: null }),
      moving: pass('moving', 'layer', { reducedMotionFallback: 'still' }),
      still: pass('still', 'layer', { amount: 0.9 }),
      // Swapped on a phone for one that reduced motion then drops.
      chain: pass('chain', 'layer', { phoneFallback: 'pointer' }),
      pointer: pass('pointer', 'layer', { reducedMotionFallback: null }),
    },
    FRAMES: {
      'shader-only': pass('shader-only', 'frame'),
      film: pass('film', 'frame', { phoneFallback: 'shader-only' }),
    },
  };
});

import { planStack } from '../plan';
import type { StackConfig } from '../stack-config';

// The ids belong to the stand-in registry, not to the real one's types.
const stack = {
  second: 'flow',
  blend: 'heavy',
  blendAmount: null,
  layers: [
    { id: 'costly', amount: null },
    { id: 'moving', amount: 0.2 },
    { id: 'chain', amount: null },
  ],
  frame: 'film',
} as unknown as StackConfig;

const ids = (plan: ReturnType<typeof planStack>) => ({
  blend: plan.blend?.effect.id,
  layers: plan.layers.map((l) => [l.effect.id, l.amount]),
  frame: plan.frame.id,
});

const base = { hasSecond: true, hasMask: true };

describe('planStack fallbacks', () => {
  it('runs every effect as itself on a desktop with motion', () => {
    expect(
      ids(planStack(stack, { ...base, phone: false, reducedMotion: false }))
    ).toEqual({
      blend: 'heavy',
      layers: [
        ['costly', 0.5],
        ['moving', 0.2],
        ['chain', 0.5],
      ],
      frame: 'film',
    });
  });

  it('on a phone: drops a layer with no phone fallback, swaps the others', () => {
    expect(
      ids(planStack(stack, { ...base, phone: true, reducedMotion: false }))
    ).toEqual({
      blend: 'light',
      layers: [
        ['moving', 0.2],
        ['pointer', 0.5],
      ],
      frame: 'shader-only',
    });
  });

  it('under reduced motion: swaps a moving layer, keeping the brand’s amount', () => {
    expect(
      ids(planStack(stack, { ...base, phone: false, reducedMotion: true }))
    ).toEqual({
      blend: 'heavy',
      layers: [
        ['costly', 0.5],
        ['still', 0.2],
        ['chain', 0.5],
      ],
      frame: 'film',
    });
  });

  it('both: the phone fallback’s own reduced-motion fallback decides', () => {
    expect(
      ids(planStack(stack, { ...base, phone: true, reducedMotion: true }))
    ).toEqual({
      blend: 'light',
      layers: [['still', 0.2]],
      frame: 'shader-only',
    });
  });
});
