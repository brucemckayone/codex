/**
 * The Showreel's motion driver (Codex-1yd58.7, WP-6 wiring part 1): the
 * four motion settings turned into the values the window's shader draws the
 * film with, frame by frame. It moves the uniforms of the effects the pass
 * RUNS (`motion.running`, which the compositor writes as it draws), so each
 * test sets `running` as the compositor would. Time is handed in.
 */
import { describe, expect, it } from 'vitest';
import {
  type MotionChoice,
  STILL_MOTION,
} from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import {
  restMotion,
  TRAIL_POINTS,
} from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';
import { deepestPoint, type MaskPixels } from './deepest-point';
import { intoLength, LEAVE_MS } from './name-motion';
import { CUT_TIMING, REDUCED_CUT_TIMING } from './reel-reveal';
import { motionChoice, ReelMotion, type ReelMotionSetup } from './reel-motion';
import { PHONE_TRAIL_POINTS } from './reel-trail';

const QUIET: MotionChoice = { ...STILL_MOTION, trans: 'burn' };

function setup(over: Partial<ReelMotionSetup> = {}): ReelMotionSetup {
  return {
    choice: QUIET,
    frame: 'film-fill',
    phone: false,
    reducedMotion: false,
    moves: true,
    ...over,
  };
}

/** The compositor drew the film pass for `running`. */
function runs(driver: ReelMotion, running: Partial<MotionChoice> = {}) {
  driver.motion.running = { ...driver.motion.choice, ...running };
}

const slot = (a: Float32Array, i: number) => [...a.slice(i * 4, i * 4 + 4)];
const KEYS = ['a', 'b', 'c'];

describe('motionChoice', () => {
  it('reads one effect per axis from the hero’s settings', () => {
    expect(
      motionChoice({
        'reel-trans': 'liquid',
        'reel-pointer': 'smoke',
        'reel-opening': 'name',
        'reel-film': 'smoke',
      })
    ).toEqual({
      trans: 'liquid',
      pointer: 'smoke',
      opening: 'name',
      into: 'smoke',
    });
  });
});

describe('ReelMotion at rest', () => {
  it('draws WP-5’s frame: every value at rest', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    expect(driver.frame(0)).toBe(false);
    expect(driver.motion.values).toEqual(restMotion());
  });

  it('keeps its motion for the same choice, and makes a new one, same values, for another', () => {
    const driver = new ReelMotion(setup());
    const first = driver.motion;
    driver.configure(setup({ choice: { ...QUIET } }));
    expect(driver.motion).toBe(first);
    runs(driver);
    driver.configure(setup({ choice: { ...QUIET, pointer: 'liquid' } }));
    expect(driver.motion).not.toBe(first);
    expect(driver.motion.values).toBe(first.values);
    // The compositor has not drawn the new choice yet.
    expect(driver.motion.running).toBeNull();
  });
});

describe('ReelMotion between pieces', () => {
  it('falls through the brand’s picture, swaps the stage at the bottom, then rises', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 100);
    const v = driver.motion.values;
    expect(driver.frame(100 + CUT_TIMING.outMs / 2)).toBe(true);
    expect(v.u_reveal).toBeGreaterThan(0);
    expect(v.u_reveal).toBeLessThan(1);
    expect(driver.stage).toBe(0);
    driver.frame(100 + CUT_TIMING.outMs);
    expect(driver.stage).toBe(1);
    expect(v.u_cut).toBe(1);
    expect(v.u_reveal).toBe(0);
    expect(driver.frame(100 + CUT_TIMING.outMs + CUT_TIMING.inMs)).toBe(false);
    expect(v.u_reveal).toBe(1);
  });

  it('cuts in the short timing under reduced motion', () => {
    const driver = new ReelMotion(setup({ reducedMotion: true }));
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 2, 100);
    driver.frame(100 + REDUCED_CUT_TIMING.outMs);
    expect(driver.stage).toBe(2);
  });

  it('starts on the clock’s piece, and shows a piece a refresh moved at its new place, no cut', () => {
    const driver = new ReelMotion(setup());
    // Before it hears the reel, it names no piece by key.
    expect(driver.stageKey).toBeNull();
    driver.follow(KEYS, 1, 0);
    expect(driver.stage).toBe(1);
    expect(driver.stageKey).toBe(KEYS[1]);
    driver.follow(['z', ...KEYS], 2, 10);
    expect(driver.stage).toBe(2);
    // The same piece, by key, at its new place.
    expect(driver.stageKey).toBe(KEYS[1]);
    driver.frame(20);
    expect(driver.motion.values.u_reveal).toBe(1);
    expect(driver.stage).toBe(2);
  });

  it('shows a piece picked while paused at once, with no cut, and none on play', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.pause(50);
    driver.follow(KEYS, 2, 100);
    // Without this a cut would wait at its start, the stage on the old piece.
    expect(driver.stage).toBe(2);
    expect(driver.stageKey).toBe(KEYS[2]);
    expect(driver.frame(120)).toBe(false);
    expect(driver.motion.values.u_reveal).toBe(1);
    driver.play(3000);
    expect(driver.frame(3000 + CUT_TIMING.outMs / 2)).toBe(false);
    expect(driver.motion.values.u_reveal).toBe(1);
    expect(driver.stage).toBe(2);
  });

  it('a pick while paused mid-cut ends the cut on the picked piece', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 100);
    driver.frame(100 + CUT_TIMING.outMs / 2);
    driver.pause(100 + CUT_TIMING.outMs / 2);
    // Back to the first, as the stage still shows: the held cut must not
    // carry on to the second once play comes.
    driver.follow(KEYS, 0, 500);
    driver.play(600);
    driver.frame(600 + CUT_TIMING.outMs + CUT_TIMING.inMs);
    expect(driver.stage).toBe(0);
    expect(driver.motion.values.u_cut).toBe(0);
  });

  it('names the piece going out by key until the cut’s bottom, then the one coming in', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 2, 100);
    driver.frame(100 + CUT_TIMING.outMs / 2);
    expect(driver.stageKey).toBe(KEYS[0]);
    driver.frame(100 + CUT_TIMING.outMs);
    expect(driver.stageKey).toBe(KEYS[2]);
  });

  it('stops a cut where it is while the reel is paused, and carries it on', () => {
    const driver = new ReelMotion(setup());
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 100);
    driver.frame(420);
    const held = driver.motion.values.u_reveal;
    driver.pause(420);
    // Paused, nothing moves, so it asks for no frames.
    expect(driver.frame(2000)).toBe(false);
    expect(driver.motion.values.u_reveal).toBeCloseTo(held, 9);
    driver.play(2000);
    driver.frame(2000 + 320);
    expect(driver.stage).toBe(1);
  });
});

describe('ReelMotion pointer', () => {
  it('packs the trail in the style the pass runs, and none for a pointer that reads none', () => {
    const driver = new ReelMotion(setup({ choice: { ...QUIET, pointer: 'smoke' } }));
    const v = driver.motion.values;
    driver.pointerMove(0.5, 0.5, 0, 1);
    runs(driver);
    driver.frame(0);
    expect(slot(v.u_trail, 0)[2]).toBeCloseTo(1.03, 5);
    expect(v.u_pointerOn).toBe(1);
    // The pass fell back to liquid's style: the trail follows it.
    runs(driver, { pointer: 'liquid' });
    driver.frame(0);
    expect(slot(v.u_trail, 0)).toEqual([0, 0, 0, 0]);
    expect(slot(v.u_trail, 1)[2]).toBeCloseTo(0.9, 5);
    for (const reads of ['glitch', 'none'] as const) {
      runs(driver, { pointer: reads });
      driver.frame(0);
      expect([...v.u_trail].every((x) => x === 0)).toBe(true);
    }
    driver.motion.running = null;
    driver.frame(0);
    expect([...v.u_trail].every((x) => x === 0)).toBe(true);
    driver.pointerLeave(10);
    driver.frame(10);
    expect(v.u_pointerOn).toBe(0);
  });

  it('asks for frames while the smoke drifts on after the pointer stops, and none once it rests', () => {
    const driver = new ReelMotion(setup({ choice: { ...QUIET, pointer: 'smoke' } }));
    runs(driver);
    for (let t = 0; t <= 192; t += 16) driver.pointerMove(0.3 + t * 0.0005, 0.5, t, 1);
    expect(driver.frame(300)).toBe(true);
    expect(slot(driver.motion.values.u_trail, 0)[0]).toBeGreaterThan(0.396);
    expect(driver.frame(3400)).toBe(false);
  });

  it('is driven by a sideways touch on a phone, never a vertical one', () => {
    const driver = new ReelMotion(
      setup({ phone: true, choice: { ...QUIET, pointer: 'smoke' } })
    );
    runs(driver);
    const v = driver.motion.values;
    driver.touchDown(100, 400);
    driver.touchMove(104, 400, 0.27, 0.53, 10, 0.46);
    driver.frame(10);
    expect(v.u_pointerOn).toBe(0);
    driver.touchMove(118, 401, 0.3, 0.52, 20, 0.46);
    driver.frame(20);
    expect(v.u_pointerOn).toBe(1);
    driver.touchUp(30);
    driver.touchDown(100, 400);
    driver.touchMove(101, 418, 0.26, 0.5, 40, 0.46);
    driver.frame(40);
    expect(v.u_pointerOn).toBe(0);
  });

  it('keeps fewer trail points on a phone', () => {
    const driver = new ReelMotion(
      setup({ phone: true, choice: { ...QUIET, pointer: 'liquid' } })
    );
    runs(driver);
    for (let i = 0; i < 40; i++) driver.pointerMove(i * 0.02, 0.5, i, 1);
    driver.frame(50);
    let points = 0;
    for (let i = 0; i < TRAIL_POINTS; i++)
      if ((driver.motion.values.u_trail[i * 4 + 2] ?? 0) > 0) points++;
    expect(points).toBe(PHONE_TRAIL_POINTS - 1);
  });

  it('keeps the smoke static under reduced motion', () => {
    const driver = new ReelMotion(
      setup({ reducedMotion: true, choice: { ...QUIET, pointer: 'smoke' } })
    );
    runs(driver);
    for (let t = 0; t <= 192; t += 16) driver.pointerMove(0.3 + t * 0.0005, 0.5, t, 1);
    driver.frame(600);
    expect(slot(driver.motion.values.u_trail, 0)[0]).toBeCloseTo(0.396, 5);
  });
});

describe('ReelMotion opening', () => {
  const opening = (over: Partial<ReelMotionSetup> = {}) =>
    new ReelMotion(
      setup({ frame: 'film-name', choice: { ...QUIET, opening: 'name' }, ...over })
    );

  it('holds the letters dark until the canvas shows the film, then fades the film into them', () => {
    const driver = opening();
    const v = driver.motion.values;
    driver.frame(0);
    expect(v.u_nameAlpha).toBe(0);
    runs(driver);
    driver.open(100, 1.6);
    expect(driver.frame(100)).toBe(true);
    expect(v.u_nameAlpha).toBe(0);
    driver.frame(500);
    expect(v.u_nameAlpha).toBeGreaterThan(0);
    expect(v.u_nameAlpha).toBeLessThan(1);
    // In the Name window the film stays in the letters: no dive.
    expect(v.u_nameZoom).toBe(1);
    expect(driver.frame(1400)).toBe(false);
    expect(v.u_nameAlpha).toBe(1);
  });

  it('opens once a visit', () => {
    const driver = opening();
    runs(driver);
    driver.open(100, 1.6);
    driver.frame(1400);
    driver.open(2000, 1.6);
    expect(driver.frame(2000)).toBe(false);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });

  it('shows the letters at once where the pass runs no opening (no mask)', () => {
    const driver = opening();
    runs(driver, { opening: 'none' });
    driver.open(100, 1.6);
    driver.frame(100);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });

  it('never holds them under reduced motion or on the static path', () => {
    for (const over of [{ reducedMotion: true }, { moves: false }]) {
      const driver = opening(over);
      driver.frame(0);
      expect(driver.motion.values.u_nameAlpha, JSON.stringify(over)).toBe(1);
    }
  });
});

describe('ReelMotion into the film', () => {
  /** A bar of letters, white on black, 40 x 20. */
  function barMask(): MaskPixels {
    const width = 40;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 5; y < 15; y++)
      for (let x = 5; x < 35; x++) data[(y * width + x) * 4] = 255;
    return { data, width, height };
  }

  it('dives into the name’s deepest point, holds the film filling its stage, and gives it back', () => {
    const mask = barMask();
    const driver = new ReelMotion(
      setup({ frame: 'film-name', choice: { ...QUIET, into: 'name' } }),
      { maskPixels: () => mask }
    );
    runs(driver);
    const v = driver.motion.values;
    driver.enterFilm(1000, 16 / 9);
    expect(driver.frame(1000)).toBe(true);
    expect(v.u_nameZoom).toBe(1);
    expect(v.u_fill).toBe(0);
    const point = deepestPoint(mask);
    expect(v.u_nameCentre).toEqual([point?.x, point?.y]);
    driver.frame(1600);
    expect(v.u_dive).toBeGreaterThan(0);
    expect(v.u_nameZoom).toBeGreaterThan(1);
    // The hand-off: the film fills its stage, and holds there.
    const length = intoLength('name', 'film-name');
    expect(driver.frame(1000 + length)).toBe(false);
    expect(v.u_fill).toBe(1);
    expect(v.u_dive).toBe(0);

    driver.leaveFilm(5000);
    expect(driver.frame(5000)).toBe(true);
    expect(v.u_fill).toBe(1);
    expect(v.u_nameZoom).toBe(1);
    expect(driver.frame(5000 + LEAVE_MS)).toBe(false);
    expect(v.u_fill).toBe(0);
  });

  it('turns the smoke at its peak, the film filling its stage from there', () => {
    const driver = new ReelMotion(setup({ choice: { ...QUIET, into: 'smoke' } }));
    runs(driver);
    const v = driver.motion.values;
    driver.enterFilm(0, 1.5);
    driver.frame(520);
    expect(v.u_into).toBeCloseTo(1, 6);
    expect(v.u_fill).toBe(1);
    driver.frame(intoLength('smoke', 'film-fill'));
    expect(v.u_into).toBeCloseTo(0, 6);
    expect(v.u_fill).toBe(1);
  });

  it('moves nothing into a film no pass draws', () => {
    const driver = new ReelMotion(setup({ choice: { ...QUIET, into: 'smoke' } }));
    driver.enterFilm(0, 1.5);
    expect(driver.frame(520)).toBe(false);
    expect(driver.motion.values.u_into).toBe(0);
    expect(driver.motion.values.u_fill).toBe(0);
  });

  it('gives way to the film: an opening running stops', () => {
    const driver = new ReelMotion(
      setup({ frame: 'film-name', choice: { ...QUIET, opening: 'name', into: 'fade' } })
    );
    runs(driver);
    driver.open(0, 1.6);
    driver.frame(200);
    driver.enterFilm(300, 1.6);
    driver.frame(300);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });
});
