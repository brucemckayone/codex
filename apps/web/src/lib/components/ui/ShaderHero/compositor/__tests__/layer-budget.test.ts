/**
 * The phone budget for the LAYERS (Codex-1yd58.12, WP-11 decision prep):
 * `judgeBudget` judged only stacks with a second preset, so a layers-only
 * stack (up to six after WP-8's dedupe; glow reads 13 texels a pixel, ink
 * 10) was never budgeted. Behind `PHONE_LAYER_BUDGET`, which the owner's
 * iPhone measurement decides, a slow window cuts the last layer still drawn.
 */
import { describe, expect, it } from 'vitest';
import { createLayerBudget, PHONE_LAYER_BUDGET } from '../layer-budget';
import { BARE_STACK, type StackConfig } from '../stack-config';

const stackOf = (...ids: string[]): StackConfig => ({
  ...BARE_STACK,
  layers: ids.map((id) => ({ id, amount: null })) as StackConfig['layers'],
});
const ids = (stack: StackConfig) => stack.layers.map((l) => l.id);

describe('createLayerBudget', () => {
  it('is off until the owner’s iPhone measurement decides', () => {
    expect(PHONE_LAYER_BUDGET).toBe(false);
    const budget = createLayerBudget(false);
    const stack = stackOf('grain', 'glow');
    expect(budget.judges(stack)).toBe(false);
    expect(budget.cut(stack)).toBeNull();
    expect(budget.apply(stack)).toBe(stack);
  });

  it('cuts the last layer still drawn first, one a breach, until none is left', () => {
    const budget = createLayerBudget(true);
    const stack = stackOf('grain', 'glow', 'ink');
    expect(budget.judges(stack)).toBe(true);

    expect(budget.cut(stack)).toEqual({ layer: 'ink', remaining: 2 });
    expect(ids(budget.apply(stack))).toEqual(['grain', 'glow']);
    expect(budget.cut(stack)).toEqual({ layer: 'glow', remaining: 1 });
    expect(budget.cut(stack)).toEqual({ layer: 'grain', remaining: 0 });
    expect(ids(budget.apply(stack))).toEqual([]);
    // nothing left to cut, so nothing left to judge
    expect(budget.judges(stack)).toBe(false);
    expect(budget.cut(stack)).toBeNull();
  });

  it('keeps what it draws the same object while nothing changes (the plan caches by identity)', () => {
    const budget = createLayerBudget(true);
    const stack = stackOf('grain', 'glow');
    // uncut: the stack itself
    expect(budget.apply(stack)).toBe(stack);
    budget.cut(stack);
    const cut = budget.apply(stack);
    expect(cut).not.toBe(stack);
    expect(budget.apply(stack)).toBe(cut);
    // the rest of the stack is the brand's
    expect({ ...cut, layers: stack.layers }).toEqual(stack);
  });

  it('judges a stack with other layers afresh, and the same layers re-read as the same', () => {
    const budget = createLayerBudget(true);
    budget.cut(stackOf('grain', 'glow'));
    // the poll re-reads the brand: an equal stack keeps its cut
    expect(ids(budget.apply(stackOf('grain', 'glow')))).toEqual(['grain']);
    // the brand changed its layers: nothing of the new one is cut yet
    const next = stackOf('grain', 'crt');
    expect(budget.apply(next)).toBe(next);
    expect(budget.cut(next)).toEqual({ layer: 'crt', remaining: 1 });
  });

  it('judges nothing without a layer', () => {
    const budget = createLayerBudget(true);
    expect(budget.judges(BARE_STACK)).toBe(false);
    expect(budget.cut(BARE_STACK)).toBeNull();
    expect(budget.apply(BARE_STACK)).toBe(BARE_STACK);
  });
});
