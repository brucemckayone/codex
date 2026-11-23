/**
 * The compositor's film passes for the Showreel's motion: one composed pass per
 * film frame, choice and context, made once, and with it the effects that pass
 * RUNS after the fallbacks, which the Showreel's driver moves the uniforms for.
 */
import { describe, expect, it } from 'vitest';
import { BAND_GLSL } from '../effects/film-band';
import { composeFilmPass } from '../effects/film-pass';
import { PORTRAIT_GLSL } from '../effects/frame-film-portrait';
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

  it('composes the portrait frame too, as the portrait frame places its film (fill, name and portrait)', () => {
    const passes = createFilmMotionPasses();
    const portrait = passes.passFor('film-portrait', choice, desk);
    expect(portrait?.pass.id.startsWith('film-portrait+')).toBe(true);
    expect(portrait?.running).toEqual(choice);
    // At rest it places the film and gives way as the plain portrait frame
    // does: its own placement and left fade, and no band at its foot, so the
    // piece shows top to bottom whatever the look's band.
    expect(portrait?.pass.glsl).toContain(PORTRAIT_GLSL);
    expect(portrait?.pass.glsl).toContain(
      'float frame = portraitShows(local);'
    );
    expect(portrait?.pass.glsl).toContain(
      'return texture(u_media, clamp(portraitUv(local), 0.0, 1.0)).rgb;'
    );
    expect(portrait?.pass.glsl).not.toContain(BAND_GLSL);
    expect(portrait?.pass.glsl).not.toContain('bandShows(');
    // where it is drawn, which the compositor sets per piece and stage
    // (`portrait.ts` `placedRect`)
    expect(portrait?.pass.uniforms).toContain('u_placed');
    expect(portrait?.pass.uniforms).not.toContain('u_band');
    const fill = passes.passFor('film-fill', choice, desk)?.pass.glsl ?? '';
    expect(fill).toContain(BAND_GLSL);
    expect(fill).toContain('float frame = bandShows(local);');
    expect(fill).not.toContain(PORTRAIT_GLSL);
    // The Name window has no band: its letters are the frame.
    const name = passes.passFor('film-name', choice, desk)?.pass.glsl ?? '';
    expect(name).not.toContain(BAND_GLSL);
  });
});
