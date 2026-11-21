/**
 * The passes over the piece's own picture (WP-5b, Codex-1yd58.6): the
 * stills' push-in, then the look's surface over the footage (`reel-surface`:
 * duotone, your colour or grain). They run on the film or still BEFORE its
 * film frame, into a target the frame then samples as `u_media`, so they
 * treat the piece alone: the brand's picture round it is untouched, in every
 * film frame (fill, the name window, the portrait placement) alike.
 *
 * A treatment over the frame's output (the plan's first sketch, a slot after
 * the frame) would also restyle the shader round the film, and would need
 * the frame's coverage to keep off it; the owner's board treated only the
 * footage. A surface-only layer that reads the shader beside the film
 * (`layer-shader-light`) cannot run here, and is not one of the owner's
 * surfaces.
 *
 * The planning is PURE (under test); `createMediaRunner` only sequences the
 * passes, with the compositor's own target and draw handed in.
 */
import type { FBO } from '../webgl-utils';
import type { MediaEffect } from './effects/effect';
import { type MediaPassId, SURFACE_PASS } from './effects/ids';
import { MEDIA } from './effects/registry';
import type { FilmLook } from './stage';

type Size = readonly [number, number];

/** How long a picture takes to push in: one piece (`reel-clock` PIECE_MS). */
export const PUSH_SECONDS = 7;
/** How far it is drawn in by then: 8% (the v4 mock's and the 5b board's). */
export const PUSH_DEPTH = 0.08;

/** The push-in's zoom `elapsed` seconds into a piece: eased out, then held. */
export function pushZoom(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / PUSH_SECONDS));
  return 1 + PUSH_DEPTH * (1 - (1 - t) * (1 - t));
}

export interface MediaStep {
  readonly effect: MediaEffect;
  readonly amount: number;
  /** `u_zoom` for this pass: the push-in's, 1 for any other. */
  readonly zoom: number;
}

export interface MediaContext {
  /** Under 768 CSS px wide. */
  readonly phone: boolean;
  /** `prefers-reduced-motion`: the stack draws one still frame. */
  readonly reducedMotion: boolean;
  /** The piece is a picture, not footage. */
  readonly still: boolean;
  /** Seconds since this piece's picture was attached. */
  readonly elapsed: number;
}

/** What runs in place of `id` here, as in the plan; null: dropped. */
function fallen(id: MediaPassId, ctx: MediaContext): MediaEffect | null {
  let next: MediaPassId | null = id;
  if (ctx.phone) next = MEDIA[next].phoneFallback;
  if (next !== null && ctx.reducedMotion)
    next = MEDIA[next].reducedMotionFallback;
  return next === null ? null : MEDIA[next];
}

/** The passes the look draws on the piece's picture, in order ([] for none). */
export function planMedia(
  look: FilmLook | null,
  ctx: MediaContext
): MediaStep[] {
  if (!look) return [];
  const steps: MediaStep[] = [];
  if (look.push && ctx.still) {
    const push = fallen('media-push', ctx);
    if (push)
      steps.push({
        effect: push,
        amount: push.amount,
        zoom: pushZoom(ctx.elapsed),
      });
  }
  const surface = look.surface ?? 'none';
  if (surface !== 'none') {
    const effect = fallen(SURFACE_PASS[surface], ctx);
    if (effect) steps.push({ effect, amount: effect.amount, zoom: 1 });
  }
  return steps;
}

/**
 * The size the treated picture is drawn at: the size the stage shows it at,
 * so a grain is a screen pixel. Filling (or in the name window) it covers
 * the stage; placed (`film-portrait`), it is the stage's height. Capped at
 * the canvas's longest side, and never under 1.
 */
export function treatedSize(
  media: Size,
  rect: Size,
  output: Size,
  placed = false
): Size {
  const [mw, mh] = [Math.max(media[0], 1), Math.max(media[1], 1)];
  const shown = placed ? rect[1] / mh : Math.max(rect[0] / mw, rect[1] / mh);
  const cap = Math.max(output[0], output[1], 1) / Math.max(mw, mh);
  const scale = Math.min(shown, cap);
  return [
    Math.max(1, Math.round(mw * scale)),
    Math.max(1, Math.round(mh * scale)),
  ];
}

export interface MediaRunner {
  /**
   * Draw `steps` from `input`, ping-pong in its own two targets. The treated
   * picture, or null when none drew (the frame then samples the piece as it
   * is). `target` may throw (an allocation that failed): the caller's to catch.
   */
  run(
    steps: readonly MediaStep[],
    input: WebGLTexture,
    size: Size,
    deps: {
      target(old: FBO | null, size: Size): FBO;
      draw(
        step: MediaStep,
        input: WebGLTexture,
        into: FBO,
        size: Size
      ): boolean;
    }
  ): WebGLTexture | null;
  /** Forget its targets, deleting each with `destroy` when given. */
  drop(destroy: ((target: FBO) => void) | null): void;
}

export function createMediaRunner(): MediaRunner {
  let ping: FBO | null = null;
  let pong: FBO | null = null;
  return {
    run(steps, input, size, deps) {
      if (steps.length === 0) return null;
      ping = deps.target(ping, size);
      if (steps.length > 1) pong = deps.target(pong, size);
      let from = input;
      let drawn: FBO | null = null;
      for (const step of steps) {
        // Ping-pong: never draw into the target being read.
        const into = drawn === ping ? pong : ping;
        if (into && deps.draw(step, from, into, size)) {
          drawn = into;
          from = into.tex;
        }
      }
      return drawn ? drawn.tex : null;
    },
    drop(destroy) {
      if (destroy) {
        for (const target of [ping, pong]) {
          if (target) destroy(target);
        }
      }
      ping = null;
      pong = null;
    },
  };
}
