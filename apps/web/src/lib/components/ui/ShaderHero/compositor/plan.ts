/**
 * Which passes a stack runs this frame (Codex-1yd58.4): the stack's effects
 * with the phone and reduced-motion fallbacks applied, each with its amount.
 * PURE, so the choices are under test without a GL context.
 */
import type { BlendEffect, FrameEffect, LayerEffect } from './effects/effect';
import { FILM_FILL_FRAME, PASSTHROUGH_FRAME } from './effects/ids';
import { BLENDS, FRAMES, LAYERS } from './effects/registry';
import type { StackConfig } from './stack-config';

export interface PlannedPass<E> {
  readonly effect: E;
  readonly amount: number;
}

export interface StackPlan {
  /** Null when no second preset is drawing. */
  readonly blend: PlannedPass<BlendEffect> | null;
  readonly layers: readonly PlannedPass<LayerEffect>[];
  readonly frame: FrameEffect;
}

export interface PlanContext {
  /** Under 768 CSS px wide. */
  readonly phone: boolean;
  /** `prefers-reduced-motion`: the stack draws one still frame. */
  readonly reducedMotion: boolean;
  /** A second preset has drawn into its target this frame. */
  readonly hasSecond: boolean;
  /** A name mask is uploaded (`setNameMask`). */
  readonly hasMask: boolean;
}

/**
 * The id that runs in place of `id` here: its phone fallback on a phone, then
 * that one's reduced-motion fallback under reduced motion. Null: dropped.
 */
function fallen<
  Id extends string,
  E extends { phoneFallback: Id | null; reducedMotionFallback: Id | null },
>(table: Record<Id, E>, id: Id, ctx: PlanContext): Id | null {
  let next: Id | null = id;
  if (ctx.phone) next = table[next].phoneFallback;
  if (next !== null && ctx.reducedMotion)
    next = table[next].reducedMotionFallback;
  return next;
}

export function planStack(stack: StackConfig, ctx: PlanContext): StackPlan {
  let blend: StackPlan['blend'] = null;
  if (ctx.hasSecond) {
    const effect = BLENDS[fallen(BLENDS, stack.blend, ctx) ?? stack.blend];
    blend = { effect, amount: stack.blendAmount ?? effect.amount };
  }

  const layers: PlannedPass<LayerEffect>[] = [];
  for (const layer of stack.layers) {
    const id = fallen(LAYERS, layer.id, ctx);
    if (id === null) continue;
    const effect = LAYERS[id];
    // A swapped-in layer keeps the strength the brand asked for.
    layers.push({ effect, amount: layer.amount ?? effect.amount });
  }

  let frame = FRAMES[fallen(FRAMES, stack.frame, ctx) ?? stack.frame];
  // A name frame with no name to draw through draws the picture as it is,
  // or, a film frame, the film filling its stage.
  if (!ctx.hasMask && frame.uniforms.includes('u_mask')) {
    const film = frame.uniforms.includes('u_media');
    frame = FRAMES[film ? FILM_FILL_FRAME : PASSTHROUGH_FRAME];
  }
  return { blend, layers, frame };
}
