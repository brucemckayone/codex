/**
 * The phone budget for the stack's LAYERS (Codex-1yd58.12, WP-11 decision
 * prep; the WP-8 review, 2026-11-20). `judgeBudget` judges a stack with a
 * second preset (`budget.ts`): it drops the second, the heaviest pass. A
 * layers-only stack was never judged, though it holds up to six distinct
 * layers after WP-8's dedupe (glow reads 13 texels a pixel, ink 10).
 *
 * Behind `PHONE_LAYER_BUDGET`: on a phone whose frames break the budget
 * (`createFrameBudget`'s window), once there is no second preset left to
 * drop, each slow window cuts the LAST layer still drawn, the one laid on
 * top, logged (`reportLayerBudget`), and the lighter stack is judged afresh.
 * A stack cut to nothing is bare and takes today's path. The cuts last the
 * session, like the second's drop, and count against the brand's layers as
 * they are: a brand that changes its layers is judged afresh.
 *
 * PURE: ShaderHero holds one and asks it what to draw.
 */
import type { LayerId } from './effects/ids';
import type { StackConfig } from './stack-config';

/**
 * OFF until the owner's iPhone measurement decides (WP-11): whether a
 * layers-only stack can miss the frame rate there, and so whether to cut.
 */
export const PHONE_LAYER_BUDGET = false;

/** One cut: the layer dropped, and how many are left drawing. */
export interface LayerCut {
  readonly layer: LayerId;
  readonly remaining: number;
}

export interface LayerBudget {
  /** Whether a slow window should cut this stack: on, and a layer left. */
  judges(stack: StackConfig): boolean;
  /** Cut the last layer still drawn, or null with none left (or off). */
  cut(stack: StackConfig): LayerCut | null;
  /**
   * The brand's stack less its cut layers: the same object, unread, while
   * nothing is cut (so with the flag off the frame does exactly what it did
   * before), and the same cut copy while neither changes (the compositor
   * plans once per stack, by identity).
   */
  apply(stack: StackConfig): StackConfig;
}

/** The brand's layers as a key: an equal list re-read by the poll is the same. */
const layersKey = (stack: StackConfig): string =>
  stack.layers.map(({ id, amount }) => `${id}:${amount ?? ''}`).join(',');

export function createLayerBudget(enabled: boolean): LayerBudget {
  /** The layers the cuts count against, and how many are cut from the end. */
  let cutKey = '';
  let cuts = 0;
  let applied: { from: StackConfig; cuts: number; stack: StackConfig } | null =
    null;

  const cutsOf = (stack: StackConfig): number =>
    layersKey(stack) === cutKey ? cuts : 0;

  return {
    judges(stack) {
      return enabled && stack.layers.length - cutsOf(stack) > 0;
    },

    cut(stack) {
      if (!enabled) return null;
      const key = layersKey(stack);
      if (key !== cutKey) {
        cutKey = key;
        cuts = 0;
      }
      const remaining = stack.layers.length - cuts - 1;
      if (remaining < 0) return null;
      cuts += 1;
      return { layer: stack.layers[remaining].id, remaining };
    },

    apply(stack) {
      // Nothing cut, which is always so while the flag is off: today's stack,
      // read for nothing. This runs twice a frame (syncStack and draw), so no
      // key is built until a cut has been made (WP-5b review r2, L1r2).
      if (cuts === 0) return stack;
      const n = cutsOf(stack);
      if (n === 0) return stack;
      if (applied?.from !== stack || applied.cuts !== n) {
        applied = {
          from: stack,
          cuts: n,
          stack: { ...stack, layers: stack.layers.slice(0, -n) },
        };
      }
      return applied.stack;
    },
  };
}
