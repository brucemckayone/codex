/**
 * The layer budget costs nothing while it cuts nothing (WP-5b review r2,
 * L1r2; the reviewer's failing test, moved beside layer-budget.test.ts).
 *
 * `stackNow()` runs twice a frame, from `syncStack` (via `readyToDraw`) and
 * from `draw`, and each call goes through `layerBudget.apply`. Before the fix,
 * `apply` keyed the brand's layers on every call (`cutsOf` -> `layersKey`: a
 * map, a template string a layer, a join), so the flag-false path did work
 * the frame never did before: 120 reads of `layers` in the 60 frames below.
 * The spec is the budget commit's own claim that with `PHONE_LAYER_BUDGET`
 * false the path is exactly today's.
 */
import { describe, expect, it } from 'vitest';
import { createLayerBudget } from '../layer-budget';
import { BARE_STACK, type StackConfig } from '../stack-config';

/** A stack that counts each read of its layers. */
function countingStack(): { stack: StackConfig; reads: () => number } {
  let reads = 0;
  const layers: StackConfig['layers'] = [
    { id: 'grain', amount: null },
    { id: 'glow', amount: null },
  ];
  const stack: StackConfig = {
    ...BARE_STACK,
    get layers() {
      reads += 1;
      return layers;
    },
  };
  return { stack, reads: () => reads };
}

describe('the layer budget, cutting nothing', () => {
  it("reads nothing of the brand's layers, frame after frame, while off as shipped", () => {
    const budget = createLayerBudget(false);
    const { stack, reads } = countingStack();
    // A second of frames: syncStack and draw each call stackNow() -> apply().
    for (let frame = 0; frame < 60; frame++) {
      expect(budget.apply(stack)).toBe(stack);
      expect(budget.apply(stack)).toBe(stack);
      expect(budget.judges(stack)).toBe(false);
    }
    expect(reads()).toBe(0);
  });

  it('reads nothing in apply while on, until a cut is made', () => {
    const budget = createLayerBudget(true);
    const { stack, reads } = countingStack();
    for (let frame = 0; frame < 60; frame++) {
      expect(budget.apply(stack)).toBe(stack);
      expect(budget.apply(stack)).toBe(stack);
    }
    expect(reads()).toBe(0);
    // the first cut keys the layers, and apply draws the lighter stack
    expect(budget.cut(stack)).toEqual({ layer: 'glow', remaining: 1 });
    expect(budget.apply(stack).layers.map((l) => l.id)).toEqual(['grain']);
  });
});
