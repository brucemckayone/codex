/**
 * The compositor's film passes for the Showreel's motion (Codex-1yd58.7,
 * WP-6 wiring part 1): one composed pass per film frame, choice and
 * context, made once, and with it the effects that pass RUNS after the
 * fallbacks, which the Showreel's driver moves the uniforms for.
 */
import { describe, expect, it } from 'vitest';
import { composeFilmPass } from '../effects/film-pass';
import type { MotionChoice } from '../effects/motion-ids';
import { planMotion } from '../effects/motion-registry';
import { createFilmMotionPasses, runningIds } from '../film-motion';

const choice: MotionChoice = {
  trans: 'burn',
  pointer: 'glitch',
  opening: 'name',
  into: 'name',
};
const desk = { phone: false, reducedMotion: false, hasMask: true };

describe('createFilmMotionPasses', () => {
  it('gives no pass for a frame that draws no film', () => {
    const passes = createFilmMotionPasses();
    for (const frame of ['shader-only', 'through-name', 'name-glows'] as const)
      expect(passes.passFor(frame, choice, desk)).toBeNull();
  });

  it('composes the pass of the effects that run here, and says which they are', () => {
    const passes = createFilmMotionPasses();
    const ctx = { phone: false, reducedMotion: true, hasMask: false };
    const made = passes.passFor('film-fill', choice, ctx);
    const set = planMotion(choice, ctx);
    expect(made?.running).toEqual(runningIds(set));
    expect(made?.pass.id).toBe(composeFilmPass('film-fill', set).id);
    // Reduced motion and no name: fade, no glitch, no opening, the fade in.
    expect(made?.running).toEqual({
      trans: 'fade',
      pointer: 'none',
      opening: 'none',
      into: 'fade',
    });
    // On a desktop with a name, the choice runs as it is.
    expect(passes.passFor('film-name', choice, desk)?.running).toEqual(choice);
  });

  it('keeps a pass’s identity while nothing changes, and makes each one once', () => {
    const passes = createFilmMotionPasses();
    const first = passes.passFor('film-fill', choice, desk);
    // A new context object that says the same: the same pass.
    expect(passes.passFor('film-fill', choice, { ...desk })).toBe(first);
    const phone = passes.passFor('film-fill', choice, { ...desk, phone: true });
    expect(phone).not.toBe(first);
    // Back again: the one made before, not a new one.
    expect(passes.passFor('film-fill', choice, desk)).toBe(first);
    expect(passes.passFor('film-fill', { ...choice }, desk)).toBe(first);
  });
});
