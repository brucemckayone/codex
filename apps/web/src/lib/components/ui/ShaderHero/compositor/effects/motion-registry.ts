/**
 * The Showreel's motion effects by axis (Codex-1yd58.7), and which ones a
 * film frame runs here: the phone's fallback, then reduced motion's, then,
 * with no name to draw through, an effect that needs none.
 *
 * Plain data and strings, importing nothing from the app, as `registry.ts`
 * is, so `shaders:check` can bundle it in Node.
 */
import { intoFade } from './into-fade';
import { intoLiquid } from './into-liquid';
import { intoName } from './into-name';
import { intoSmoke } from './into-smoke';
import type {
  IntoEffect,
  MotionEffect,
  MotionSet,
  OpeningEffect,
  PointerEffect,
  TransEffect,
} from './motion';
import type {
  IntoId,
  MotionChoice,
  OpeningId,
  PointerId,
  TransId,
} from './motion-ids';
import { openingName } from './opening-name';
import { openingNone } from './opening-none';
import { pointerGlitch } from './pointer-glitch';
import { pointerLiquid } from './pointer-liquid';
import { pointerNone } from './pointer-none';
import { pointerSmoke } from './pointer-smoke';
import { transBurn } from './trans-burn';
import { transFade } from './trans-fade';
import { transGlitch } from './trans-glitch';
import { transLightLeak } from './trans-light-leak';
import { transLiquid } from './trans-liquid';

export const TRANS: Record<TransId, TransEffect> = {
  burn: transBurn,
  liquid: transLiquid,
  glitch: transGlitch,
  'light-leak': transLightLeak,
  fade: transFade,
};

export const POINTERS: Record<PointerId, PointerEffect> = {
  liquid: pointerLiquid,
  smoke: pointerSmoke,
  glitch: pointerGlitch,
  none: pointerNone,
};

export const OPENINGS: Record<OpeningId, OpeningEffect> = {
  name: openingName,
  none: openingNone,
};

export const INTOS: Record<IntoId, IntoEffect> = {
  name: intoName,
  smoke: intoSmoke,
  liquid: intoLiquid,
  fade: intoFade,
};

/** Every motion effect, for the gate and the tests. */
export const MOTION_EFFECTS: readonly MotionEffect[] = [
  ...Object.values(TRANS),
  ...Object.values(POINTERS),
  ...Object.values(OPENINGS),
  ...Object.values(INTOS),
];

export interface MotionContext {
  /** Under 768 CSS px wide. */
  readonly phone: boolean;
  readonly reducedMotion: boolean;
  /** A name mask is uploaded (`setNameMask`). */
  readonly hasMask: boolean;
}

/** With no name to draw through, the opening and the way in that need none. */
const NO_NAME = { opening: 'none', into: 'smoke' } as const;

/** The effect that runs in place of `id` here. */
function fallen<Id extends string>(
  table: Record<
    Id,
    { phoneFallback: Id; reducedMotionFallback: Id; throughName?: boolean }
  >,
  id: Id,
  ctx: MotionContext,
  noName: Id | null
): Id {
  let next = id;
  if (ctx.phone) next = table[next].phoneFallback;
  if (ctx.reducedMotion) next = table[next].reducedMotionFallback;
  if (noName !== null && !ctx.hasMask && table[next].throughName) {
    next = noName;
    if (ctx.reducedMotion) next = table[next].reducedMotionFallback;
  }
  return next;
}

/** The four effects a film frame runs for `choice` here. PURE. */
export function planMotion(
  choice: MotionChoice,
  ctx: MotionContext
): MotionSet {
  return {
    trans: TRANS[fallen(TRANS, choice.trans, ctx, null)],
    pointer: POINTERS[fallen(POINTERS, choice.pointer, ctx, null)],
    opening: OPENINGS[fallen(OPENINGS, choice.opening, ctx, NO_NAME.opening)],
    into: INTOS[fallen(INTOS, choice.into, ctx, NO_NAME.into)],
  };
}
