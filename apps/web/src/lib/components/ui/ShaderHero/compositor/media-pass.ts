/**
 * The passes over the piece's own picture: the stills' push-in, then the look's
 * surface over the footage (`reel-surface`: duotone, your colour or grain).
 * They run on the film or still BEFORE its film frame, into a target the frame
 * then samples as `u_media`, so they treat the piece alone: the brand's picture
 * round it is untouched, in every film frame (fill, the name window, the
 * portrait placement) alike.
 *
 * A treatment over the frame's output (a slot after the frame) would also
 * restyle the shader round the film, and would need the frame's coverage to
 * keep off it; the surfaces treat only the footage. A surface-only layer that
 * reads the shader beside the film (`layer-shader-light`) cannot run here, and
 * is not one of the surfaces.
 *
 * The planning is PURE (under test); `createMediaRunner` only sequences the
 * passes, with the compositor's own target and draw handed in.
 */
import type { FBO } from '../webgl-utils';
import type { MediaEffect } from './effects/effect';
import { type MediaPassId, SURFACE_PASS } from './effects/ids';
import { MEDIA } from './effects/registry';
import type { PlacedRect } from './portrait';
import { type FilmLook, pushZoom } from './stage';

type Size = readonly [number, number];

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
    // by the reel's clock, which holds when the reel holds
    if (push)
      steps.push({
        effect: push,
        amount: push.amount,
        zoom: pushZoom(look.push()),
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
 * the stage, capped at the canvas's longest side. Placed (`film-portrait`),
 * it is the width `placed` draws it at (`portrait.ts` `placedRect`, the
 * frame's `u_placed`), so the shader never scales it up; the frame trims its
 * top and bottom, so the cap holds the part that shows to the canvas's
 * longest side, not the whole. Never under 1.
 */
export function treatedSize(
  media: Size,
  rect: Size,
  output: Size,
  placed: PlacedRect | null = null
): Size {
  const [mw, mh] = [Math.max(media[0], 1), Math.max(media[1], 1)];
  const longest = Math.max(output[0], output[1], 1);
  const scale = placed
    ? Math.min(
        ((placed.x1 - placed.x0) * rect[0]) / mw,
        longest / Math.max(mw, mh * (1 - placed.crop))
      )
    : Math.min(
        Math.max(rect[0] / mw, rect[1] / mh),
        longest / Math.max(mw, mh)
      );
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
