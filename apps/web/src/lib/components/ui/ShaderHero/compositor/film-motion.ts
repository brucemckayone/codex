/**
 * The Showreel's motion as the compositor takes it: the four effects chosen,
 * and this frame's values, which the Showreel writes in place every frame
 * (`showreelFeed.setMotion`). With motion, a film frame is drawn as its
 * composed film pass (`effects/film-pass.ts`); every other frame is drawn as it
 * is.
 *
 * What a pass RUNS can differ from what was chosen: a phone, reduced motion
 * and a missing name mask each fall back (`planMotion`). The compositor
 * writes what it ran into `running` as it draws, so the Showreel's driver
 * (`org-hero/showreel/reel-motion.ts`) moves the uniforms of the effects
 * that are actually drawn: it never runs an opening the pass has dropped,
 * nor packs the trail in a style no hook reads.
 */
import {
  composeFilmPass,
  FILM_FRAMES,
  type FilmPass,
} from './effects/film-pass';
import type { FilmFrameId, FrameId } from './effects/ids';
import type { MotionSet } from './effects/motion';
import type { MotionChoice } from './effects/motion-ids';
import { type MotionContext, planMotion } from './effects/motion-registry';
import type { MotionValues } from './effects/motion-uniforms';

export interface FilmMotion {
  /** One effect per axis, as the Showreel's settings name them. */
  readonly choice: MotionChoice;
  /** This frame's values: the Showreel writes them in place each frame. */
  readonly values: MotionValues;
  /**
   * The effects the last film pass ran, after the fallbacks; the compositor
   * writes it as it draws. Null before it has drawn this choice, or while it
   * draws no film frame with motion.
   */
  running: MotionChoice | null;
}

/** A film frame's pass, and the effects it runs. */
interface FilmMotionPass {
  readonly pass: FilmPass;
  readonly running: MotionChoice;
}

/** The ids of the effects a set runs. PURE. */
export function runningIds(set: MotionSet): MotionChoice {
  return {
    trans: set.trans.id,
    pointer: set.pointer.id,
    opening: set.opening.id,
    into: set.into.id,
  };
}

const isFilmFrame = (id: FrameId): id is FilmFrameId =>
  (FILM_FRAMES as readonly string[]).includes(id);

/**
 * The composed film passes, one per frame, choice and context, made once:
 * the pass a frame draws keeps its identity while nothing changes, and the
 * compositor's program cache keys on its id.
 */
export function createFilmMotionPasses() {
  const made = new Map<string, FilmMotionPass>();
  // The last answer, so a frame that changes nothing builds no key.
  let last: {
    frame: FilmFrameId;
    choice: MotionChoice;
    ctx: MotionContext;
    made: FilmMotionPass;
  } | null = null;
  return {
    /** The film pass `frame` draws with `choice` here; null for no film frame. */
    passFor(
      frame: FrameId,
      choice: MotionChoice,
      ctx: MotionContext
    ): FilmMotionPass | null {
      if (!isFilmFrame(frame)) return null;
      if (
        last &&
        last.frame === frame &&
        last.choice === choice &&
        last.ctx.phone === ctx.phone &&
        last.ctx.reducedMotion === ctx.reducedMotion &&
        last.ctx.hasMask === ctx.hasMask
      )
        return last.made;
      const key = `${frame}|${choice.trans}|${choice.pointer}|${choice.opening}|${choice.into}|${ctx.phone}|${ctx.reducedMotion}|${ctx.hasMask}`;
      let pass = made.get(key);
      if (!pass) {
        const set = planMotion(choice, ctx);
        pass = { pass: composeFilmPass(frame, set), running: runningIds(set) };
        made.set(key, pass);
      }
      last = { frame, choice, ctx: { ...ctx }, made: pass };
      return pass;
    },
  };
}
