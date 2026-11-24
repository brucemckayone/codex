/**
 * The Showreel's motion driver: the four motion settings turned into the values
 * the window's shader draws the film with, frame by frame. It moves the
 * uniforms of the effects the pass RUNS (`motion.running`, which the compositor
 * writes as it draws), so each test sets `running` as the compositor would.
 * Time is handed in.
 */
import { describe, expect, it } from 'vitest';
import { STILL_MOTION } from '$lib/components/ui/ShaderHero/__tests__/motion-fixtures';
import type { MotionChoice } from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import {
  restMotion,
  TRAIL_POINTS,
} from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';
import { NAME_FADE_PX } from '$lib/components/ui/ShaderHero/compositor/stage';
import { deepestPoint, type MaskPixels } from './deepest-point';
import { intoLength, LEAVE_MS, openingAt } from './name-motion';
import {
  motionChoice,
  OPEN_DEFER_MS,
  ReelMotion,
  type ReelMotionSetup,
} from './reel-motion';
import { CUT_TIMING, MIN_CUT_GAP_MS, REDUCED_CUT_TIMING } from './reel-reveal';
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
  it('draws the plain film frame: every value at rest', () => {
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

  it('rises only onto the piece the stage reports final: the old piece final never opens it', () => {
    let settled: string | null = 'a';
    const driver = new ReelMotion(setup(), { stageSettled: () => settled });
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 100);
    const v = driver.motion.values;
    const bottom = 100 + CUT_TIMING.outMs;
    driver.frame(bottom);
    expect(driver.stage).toBe(1);
    expect(driver.frame(bottom + 400), 'waits, asking each frame').toBe(true);
    expect(v.u_reveal, "'a' final, not 'b': still closed").toBe(0);
    settled = 'b';
    driver.frame(bottom + 500);
    driver.frame(bottom + 500 + CUT_TIMING.inMs / 2);
    expect(v.u_reveal, 'rising onto b').toBeGreaterThan(0);
    expect(v.u_reveal).toBeLessThan(1);
  });

  it('cuts in the short timing under reduced motion', () => {
    const driver = new ReelMotion(setup({ reducedMotion: true }));
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 2, 100);
    driver.frame(100 + REDUCED_CUT_TIMING.outMs);
    expect(driver.stage).toBe(2);
  });

  // A pick is stamped by the clock (`performance.now()`) when its handler
  // runs; a frame by the rAF time it BEGAN, which comes before a handler run
  // inside it. Its first frame then reads the piece still in full (reveal
  // 1). It must keep asking for frames, or the cut never runs, the stage
  // never names the piece, and its words never come in (the reduced-motion
  // pick that stayed on piece 01: e2e org-hero-showreel, lane A).
  it.each([
    ['a frame begun before the pick', 999],
    ['a frame stamped with the pick', 1000],
  ])('keeps asking for frames for a cut not yet falling: %s (reduced motion)', (_, at) => {
    const driver = new ReelMotion(setup({ reducedMotion: true }));
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 1000);
    expect(driver.frame(at)).toBe(true);
    expect(driver.stage).toBe(0);
    driver.frame(1000 + REDUCED_CUT_TIMING.outMs);
    expect(driver.stage).toBe(1);
  });

  it('keeps asking for frames for a fall MIN_CUT_GAP_MS holds off (a pick right after a pause cut one short)', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 1000); // starts at 1000
    driver.frame(1100);
    driver.pause(1100); // lands on b at once
    driver.play(1150);
    driver.follow(KEYS, 2, 1200); // falls from 1000 + MIN_CUT_GAP_MS
    expect(driver.frame(1210)).toBe(true);
    expect(driver.stage).toBe(1);
    driver.frame(1000 + MIN_CUT_GAP_MS + CUT_TIMING.outMs);
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

  // The words come in with their piece's picture, so a cut frozen by a pause
  // would keep them out, hidden, for the whole pause.
  it('a pause mid-fall shows the piece the cut was going to, at once and at rest', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.frame(0);
    // The reel moves on (or an index pick): the fall runs 1000 to 1640.
    driver.follow(KEYS, 1, 1000);
    driver.frame(1300);
    expect(driver.stageKey).toBe(KEYS[0]);
    expect(driver.motion.values.u_reveal).toBeLessThan(1);
    // The visitor pauses to read the new piece (or a press holds it).
    driver.pause(1300);
    expect(driver.stageKey).toBe(KEYS[1]);
    // At rest: nothing moves, so it asks for no frames, however long.
    expect(driver.frame(60_000)).toBe(false);
    expect(driver.stageKey).toBe(KEYS[1]);
    expect(driver.motion.values.u_reveal).toBe(1);
    // Play moves nothing on: the cut is done.
    driver.play(60_000);
    expect(driver.frame(60_000 + CUT_TIMING.outMs / 2)).toBe(false);
    expect(driver.motion.values.u_reveal).toBe(1);
    expect(driver.stage).toBe(1);
  });

  it('a pause in a rise with a pick waiting shows the waiting pick', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.frame(0);
    // The fall runs 1000 to 1640, the rise to 2790.
    driver.follow(KEYS, 1, 1000);
    driver.frame(1700);
    expect(driver.stageKey).toBe(KEYS[1]);
    // Picked during the rise: it waits for the rise to end...
    driver.follow(KEYS, 2, 1800);
    driver.frame(1850);
    expect(driver.stageKey).toBe(KEYS[1]);
    // ...but not for a pause.
    driver.pause(1900);
    driver.frame(60_000);
    expect(driver.stageKey).toBe(KEYS[2]);
    expect(driver.motion.values.u_reveal).toBe(1);
  });

  it('a pause in a rise with nothing waiting ends the rise on its piece', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 0, 0);
    driver.follow(KEYS, 1, 100);
    driver.frame(100 + CUT_TIMING.outMs + 200);
    expect(driver.motion.values.u_reveal).toBeLessThan(1);
    driver.pause(100 + CUT_TIMING.outMs + 200);
    expect(driver.frame(5000)).toBe(false);
    expect(driver.stage).toBe(1);
    expect(driver.motion.values.u_reveal).toBe(1);
  });

  it('a pause at rest changes nothing', () => {
    const driver = new ReelMotion(setup());
    runs(driver);
    driver.follow(KEYS, 2, 0);
    driver.frame(10);
    driver.pause(20);
    expect(driver.frame(30)).toBe(false);
    expect(driver.stage).toBe(2);
    expect(driver.motion.values.u_cut).toBe(0);
  });
});

describe('ReelMotion pointer', () => {
  it('packs the trail in the style the pass runs, and none for a pointer that reads none', () => {
    const driver = new ReelMotion(
      setup({ choice: { ...QUIET, pointer: 'smoke' } })
    );
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
    const driver = new ReelMotion(
      setup({ choice: { ...QUIET, pointer: 'smoke' } })
    );
    runs(driver);
    for (let t = 0; t <= 192; t += 16)
      driver.pointerMove(0.3 + t * 0.0005, 0.5, t, 1);
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
    for (let t = 0; t <= 192; t += 16)
      driver.pointerMove(0.3 + t * 0.0005, 0.5, t, 1);
    driver.frame(600);
    expect(slot(driver.motion.values.u_trail, 0)[0]).toBeCloseTo(0.396, 5);
  });
});

describe('ReelMotion opening', () => {
  const opening = (over: Partial<ReelMotionSetup> = {}) =>
    new ReelMotion(
      setup({
        frame: 'film-name',
        choice: { ...QUIET, opening: 'name' },
        ...over,
      })
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

  it('holds the words back while the opening runs, until they come in (wordsIn)', () => {
    // Corner/Wide: the letters breathe, dive, then the words come in.
    const driver = opening({ frame: 'film-fill' });
    driver.frame(0);
    expect(driver.wordsHeld, 'due, before the canvas shows the film').toBe(
      true
    );
    runs(driver);
    driver.open(100, 1.6);
    driver.frame(1000);
    expect(driver.wordsHeld, 'breathing').toBe(true);
    driver.frame(100 + 3600);
    expect(driver.wordsHeld, 'just past the dive').toBe(true);
    driver.frame(100 + 3800);
    expect(driver.wordsHeld, 'the words come in').toBe(false);
  });

  it('never holds the words where no opening runs', () => {
    const none = new ReelMotion(setup());
    none.frame(0);
    expect(none.wordsHeld, 'no opening chosen').toBe(false);
    const ruledOut = opening();
    runs(ruledOut, { opening: 'none' });
    ruledOut.open(100, 1.6);
    ruledOut.frame(100);
    expect(ruledOut.wordsHeld, 'the pass runs none').toBe(false);
    const still = opening({ moves: false });
    still.frame(0);
    expect(still.wordsHeld, 'a reel that never moves on').toBe(false);
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

  // Past the letters' fade there are no letters to open through: the opening
  // ends at once in its last frame, the film filling its stage, with no dive.
  const name = (v: ReelMotion['motion']['values']) => [
    v.u_nameZoom,
    v.u_nameAlpha,
    v.u_nameWeight,
    v.u_dive,
  ];
  const FILLING = [1, 1, 0, 0];

  it('scrolled past the letters’ fade, an opening running ends at once in the film filling its stage', () => {
    const driver = opening({ frame: 'film-fill' });
    const v = driver.motion.values;
    runs(driver);
    driver.open(0, 1.6);
    driver.frame(400);
    // Mid-opening: the letters fading in, the slow breath before the dive.
    expect(v.u_nameZoom).toBeGreaterThan(1);
    expect(v.u_nameWeight).toBe(1);
    expect(driver.scroll(NAME_FADE_PX)).toBe(true);
    expect(driver.frame(416)).toBe(false);
    expect(name(v)).toEqual(FILLING);
    // Back under the fade nothing restarts: one shot a visit.
    expect(driver.scroll(0)).toBe(false);
    driver.frame(3000);
    expect(name(v)).toEqual(FILLING);
  });

  it('scrolled within the letters’ fade, the opening runs its course', () => {
    const driver = opening({ frame: 'film-fill' });
    const v = driver.motion.values;
    runs(driver);
    driver.open(0, 1.6);
    driver.frame(400);
    expect(driver.scroll(NAME_FADE_PX - 1)).toBe(false);
    // Into the dive (it starts at 2.6 s).
    driver.frame(3000);
    expect(v.u_dive).toBeGreaterThan(0);
    expect(v.u_nameWeight).toBe(1);
  });

  it('scrolled past the letters’ fade before the canvas shows the film, it never opens', () => {
    const driver = opening({ frame: 'film-fill' });
    const v = driver.motion.values;
    runs(driver);
    driver.frame(0);
    // Waiting to open: the letters dark.
    expect(v.u_nameAlpha).toBe(0);
    expect(driver.scroll(200)).toBe(true);
    driver.frame(16);
    expect(name(v)).toEqual(FILLING);
    driver.open(100, 1.6);
    expect(driver.frame(100)).toBe(false);
    expect(name(v)).toEqual(FILLING);
  });

  it('a scroll with no opening running or due changes nothing', () => {
    const driver = opening({ frame: 'film-fill' });
    runs(driver);
    driver.open(0, 1.6);
    driver.frame(5000);
    expect(driver.scroll(200)).toBe(false);
  });

  it('never holds them under reduced motion or on the static path', () => {
    for (const over of [{ reducedMotion: true }, { moves: false }]) {
      const driver = opening(over);
      driver.frame(0);
      expect(driver.motion.values.u_nameAlpha, JSON.stringify(over)).toBe(1);
    }
  });

  it('is one shot a visit: an opening chosen after the canvas showed the film never holds the letters dark', () => {
    // None at first: the canvas shows the film, and that was the moment.
    const driver = new ReelMotion(setup({ frame: 'film-name' }));
    runs(driver);
    driver.open(100, 1.6);
    driver.frame(100);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
    // The editor's live preview switches the opening on.
    driver.configure(
      setup({ frame: 'film-name', choice: { ...QUIET, opening: 'name' } })
    );
    runs(driver);
    for (const at of [200, 1000, 5000]) {
      driver.frame(at);
      expect(driver.motion.values.u_nameAlpha, `at ${at}`).toBe(1);
    }
  });

  it('waits for the pass when it has not said what it runs, then opens', () => {
    const driver = opening();
    const v = driver.motion.values;
    // The canvas shows the film before the compositor drew this choice.
    driver.open(100, 1.6);
    // Never ruled out on a null: it waits dark, and asks for frames so a
    // frozen hero draws and the pass says.
    expect(driver.frame(116)).toBe(true);
    expect(v.u_nameAlpha).toBe(0);
    runs(driver);
    expect(driver.frame(132)).toBe(true);
    driver.frame(132 + 400);
    expect(v.u_nameAlpha).toBeGreaterThan(0);
    expect(v.u_nameAlpha).toBeLessThan(1);
    driver.frame(132 + 1400);
    expect(v.u_nameAlpha).toBe(1);
  });

  it('a pass that turns out to run no opening shows the letters at rest', () => {
    const driver = opening();
    driver.open(100, 1.6);
    driver.frame(116);
    runs(driver, { opening: 'none' });
    expect(driver.frame(132)).toBe(false);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });

  it('stops waiting when no pass ever says: the letters show at rest', () => {
    const driver = opening();
    driver.open(100, 1.6);
    expect(driver.frame(100 + OPEN_DEFER_MS - 16)).toBe(true);
    expect(driver.motion.values.u_nameAlpha).toBe(0);
    expect(driver.frame(100 + OPEN_DEFER_MS)).toBe(false);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });

  it('waits in the opening’s own first frame, so it starts from what shows', () => {
    for (const frame of ['film-fill', 'film-name', 'film-portrait'] as const) {
      const driver = opening({ frame });
      runs(driver);
      driver.frame(0);
      const v = driver.motion.values;
      const first = openingAt(0, frame !== 'film-name', 1);
      expect(
        [v.u_nameZoom, v.u_nameAlpha, v.u_nameWeight, v.u_dive],
        frame
      ).toEqual([first.zoom, first.alpha, first.weight, first.dive]);
      // The film held to the letters already: the opening's start, no pop.
      expect(v.u_nameWeight, frame).toBe(1);
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

  // Scrolled past the letters' fade (NAME_FADE_PX) there are no letters to dive
  // through, and those the canvas holds still are not where the page set them:
  // the way in goes straight to the film filling its stage.
  it.each([
    'film-name',
    'film-fill',
  ] as const)('on %s, scrolled past the letters, goes straight into the film filling: no dive', (frame) => {
    const mask = barMask();
    const driver = new ReelMotion(
      setup({ frame, choice: { ...QUIET, into: 'name' } }),
      { maskPixels: () => mask }
    );
    runs(driver);
    const v = driver.motion.values;
    driver.enterFilm(1000, 16 / 9, true);
    // The hand-off on the first frame: the film fills, held there.
    expect(driver.frame(1000)).toBe(false);
    expect(v.u_fill).toBe(1);
    expect(v.u_dive).toBe(0);
    driver.frame(1300);
    expect(v.u_dive).toBe(0);
    expect(v.u_fill).toBe(1);
    // It comes back as any way in does.
    driver.leaveFilm(5000);
    expect(driver.frame(5000 + LEAVE_MS)).toBe(false);
    expect(v.u_fill).toBe(0);
  });

  it('turns the smoke at its peak, the film filling its stage from there', () => {
    const driver = new ReelMotion(
      setup({ choice: { ...QUIET, into: 'smoke' } })
    );
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
    const driver = new ReelMotion(
      setup({ choice: { ...QUIET, into: 'smoke' } })
    );
    driver.enterFilm(0, 1.5);
    expect(driver.frame(520)).toBe(false);
    expect(driver.motion.values.u_into).toBe(0);
    expect(driver.motion.values.u_fill).toBe(0);
  });

  it('gives way to the film: an opening running stops', () => {
    const driver = new ReelMotion(
      setup({
        frame: 'film-name',
        choice: { ...QUIET, opening: 'name', into: 'fade' },
      })
    );
    runs(driver);
    driver.open(0, 1.6);
    driver.frame(200);
    driver.enterFilm(300, 1.6);
    driver.frame(300);
    expect(driver.motion.values.u_nameAlpha).toBe(1);
  });
});

// After a pause mid-cut, play resumes from the landed piece. A cut never turns
// round and cuts start at least MIN_CUT_GAP_MS apart (reel-reveal.ts).
describe('pause mid-cut, then play', () => {
  const keys = ['a', 'b', 'c'];
  const cutSetup: ReelMotionSetup = {
    choice: { trans: 'burn', pointer: 'none', opening: 'none', into: 'smoke' },
    frame: 'film-fill',
    phone: false,
    reducedMotion: false,
    moves: true,
  };
  const start = () => {
    const d = new ReelMotion(cutSetup);
    d.follow(keys, 0, 0);
    d.frame(0);
    return d;
  };

  it('a pause mid-fall lands on the heading piece, fully shown', () => {
    const d = start();
    d.follow(keys, 1, 1000); // fall 1000 -> 1640
    d.frame(1300);
    expect(d.stageKey).toBe('a');
    d.pause(1300);
    d.frame(1301);
    expect(d.stageKey).toBe('b');
    expect(d.motion.values.u_reveal).toBe(1);
    d.frame(60_000);
    expect(d.stageKey).toBe('b');
  });

  it('a pause in a rise lands on the pick waiting there', () => {
    const d = start();
    d.follow(keys, 1, 1000);
    d.frame(1700); // b rising
    d.follow(keys, 2, 1800); // waits
    d.pause(1900);
    d.frame(1901);
    expect(d.stageKey).toBe('c');
    expect(d.motion.values.u_reveal).toBe(1);
  });

  it('play moves nothing; the next cut starts from the landed piece', () => {
    const d = start();
    d.follow(keys, 1, 1000);
    d.frame(1300);
    d.pause(1300);
    d.play(9000);
    d.frame(9001);
    expect(d.stageKey).toBe('b');
    expect(d.motion.values.u_reveal).toBe(1); // no resumed half-fall
    const cutsBefore = d.motion.values.u_cut;
    d.follow(keys, 2, 10_000);
    d.frame(10_001);
    expect(d.stageKey).toBe('b');
    expect(d.motion.values.u_reveal).toBeGreaterThan(0.99);
    d.frame(10_000 + CUT_TIMING.outMs);
    expect(d.stageKey).toBe('c');
    expect(d.motion.values.u_cut).toBe(cutsBefore + 1);
  });

  it('a cut right after play keeps the three-a-second floor', () => {
    const d = start();
    d.follow(keys, 1, 1000); // the cut the pause ends started at 1000
    d.pause(1100);
    d.play(1150);
    d.follow(keys, 2, 1200); // would start 200 ms after the last start
    d.frame(1000 + MIN_CUT_GAP_MS - 1);
    expect(d.motion.values.u_reveal).toBe(1); // not started yet
    d.frame(1000 + MIN_CUT_GAP_MS + CUT_TIMING.outMs);
    expect(d.stageKey).toBe('c');
  });
});
