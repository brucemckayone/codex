/**
 * The Showreel's motion as the compositor takes it (Codex-1yd58.7): the four
 * effects chosen, and this frame's values, which the Showreel writes in
 * place every frame (`showreelFeed.setMotion`). With motion, a film frame is
 * drawn as its composed film pass (`effects/film-pass.ts`); every other
 * frame is drawn as it is.
 */
import {
  composeFilmPass,
  FILM_FRAMES,
  type FilmPass,
} from './effects/film-pass';
import type { FilmFrameId, FrameId } from './effects/ids';
import type { MotionChoice } from './effects/motion-ids';
import { type MotionContext, planMotion } from './effects/motion-registry';
import type { MotionValues } from './effects/motion-uniforms';

export interface FilmMotion {
  /** One effect per axis, as the Showreel's settings name them. */
  readonly choice: MotionChoice;
  /** This frame's values: the Showreel writes them in place each frame. */
  readonly values: MotionValues;
}

const isFilmFrame = (id: FrameId): id is FilmFrameId =>
  (FILM_FRAMES as readonly string[]).includes(id);

/**
 * The composed film passes, one per frame, choice and context, made once:
 * the pass a frame draws keeps its identity while nothing changes, and the
 * compositor's program cache keys on its id.
 */
export function createFilmMotionPasses() {
  const made = new Map<string, FilmPass>();
  // The last answer, so a frame that changes nothing builds no key.
  let last: {
    frame: FilmFrameId;
    choice: MotionChoice;
    ctx: MotionContext;
    pass: FilmPass;
  } | null = null;
  return {
    /** The film pass `frame` draws with `choice` here; null for no film frame. */
    passFor(
      frame: FrameId,
      choice: MotionChoice,
      ctx: MotionContext
    ): FilmPass | null {
      if (!isFilmFrame(frame)) return null;
      if (
        last &&
        last.frame === frame &&
        last.choice === choice &&
        last.ctx.phone === ctx.phone &&
        last.ctx.reducedMotion === ctx.reducedMotion &&
        last.ctx.hasMask === ctx.hasMask
      )
        return last.pass;
      const key = `${frame}|${choice.trans}|${choice.pointer}|${choice.opening}|${choice.into}|${ctx.phone}|${ctx.reducedMotion}|${ctx.hasMask}`;
      const pass =
        made.get(key) ?? composeFilmPass(frame, planMotion(choice, ctx));
      made.set(key, pass);
      last = { frame, choice, ctx, pass };
      return pass;
    },
  };
}
