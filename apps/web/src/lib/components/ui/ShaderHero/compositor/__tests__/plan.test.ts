/**
 * Which passes a stack runs (Codex-1yd58.4): the blend only while a second
 * preset draws, the layers in order with their amounts, the frame, and the
 * name frames' fall back to shader only until a name mask is set.
 */
import { describe, expect, it } from 'vitest';
import { BLENDS, FRAMES, LAYERS } from '../effects/registry';
import { type PlanContext, planStack } from '../plan';
import { BARE_STACK, type StackConfig } from '../stack-config';

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  phone: false,
  reducedMotion: false,
  hasSecond: true,
  hasMask: true,
  ...over,
});

const stack: StackConfig = {
  ...BARE_STACK,
  second: 'flow',
  blend: 'smoke-key',
  blendAmount: 0.8,
  layers: [
    { id: 'grain', amount: 0.3 },
    { id: 'grain', amount: null },
  ],
  frame: 'name-glows',
};

describe('planStack', () => {
  it('runs the blend, the layers in order, then the frame', () => {
    const plan = planStack(stack, ctx());
    expect(plan.blend).toEqual({ effect: BLENDS['smoke-key'], amount: 0.8 });
    expect(plan.layers).toEqual([
      { effect: LAYERS.grain, amount: 0.3 },
      // No amount named: the layer's own.
      { effect: LAYERS.grain, amount: LAYERS.grain.amount },
    ]);
    expect(plan.frame).toBe(FRAMES['name-glows']);
  });

  it('runs no blend while the second preset is not drawing', () => {
    expect(planStack(stack, ctx({ hasSecond: false })).blend).toBeNull();
  });

  it('gives a blend with no amount named its own', () => {
    const plan = planStack({ ...stack, blendAmount: null }, ctx());
    expect(plan.blend?.amount).toBe(BLENDS['smoke-key'].amount);
  });

  it('draws a name frame as shader only until there is a name mask', () => {
    expect(planStack(stack, ctx({ hasMask: false })).frame).toBe(
      FRAMES['shader-only']
    );
    expect(
      planStack({ ...stack, frame: 'through-name' }, ctx({ hasMask: false }))
        .frame
    ).toBe(FRAMES['shader-only']);
    expect(planStack(stack, ctx({ hasMask: true })).frame).toBe(
      FRAMES['name-glows']
    );
  });

  it('applies the phone and reduced-motion fallbacks (WP-3’s effects keep themselves)', () => {
    for (const over of [
      { phone: true },
      { reducedMotion: true },
      { phone: true, reducedMotion: true },
    ]) {
      const plan = planStack(stack, ctx(over));
      expect(plan.blend?.effect).toBe(BLENDS['smoke-key']);
      expect(plan.layers.map((l) => l.effect)).toEqual([
        LAYERS.grain,
        LAYERS.grain,
      ]);
      expect(plan.frame).toBe(FRAMES['name-glows']);
    }
  });
});
