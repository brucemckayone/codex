/**
 * The Showreel's motion drivers (Codex-1yd58.7): the cut between pieces,
 * the pointer's trail and the swipe that drives it on a phone, where a dive
 * into the name falls in, and the timelines of the opening and the way into
 * the film. Every one is pure, so time is handed in.
 */
import { describe, expect, it } from 'vitest';
import {
  INTO_IDS,
  OPENING_IDS,
  POINTER_IDS,
  TRANS_IDS,
} from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import { TRAIL_POINTS } from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';
import { HERO_OPTION_VALUES } from '../hero-config';
import { deepestPoint, diveDepth, type MaskPixels } from './deepest-point';
import {
  DIVE_MS,
  intoAt,
  intoLength,
  LEAVE_MS,
  leaveAt,
  openingAt,
} from './name-motion';
import { CUT_TIMING, REDUCED_CUT_TIMING, RevealClock } from './reel-reveal';
import {
  PHONE_TRAIL_POINTS,
  PointerTrail,
  SwipeGate,
  TRAIL_LIFE_MS,
} from './reel-trail';

const FULL_CUT = CUT_TIMING.outMs + CUT_TIMING.inMs;

describe('RevealClock', () => {
  it('rests on its piece, fully shown', () => {
    const clock = new RevealClock(0);
    expect(clock.at(5000)).toEqual({ reveal: 1, shown: 0, cuts: 0 });
  });

  it("falls, swaps at the bottom, then rises (the mock's 640 ms in, 1150 ms out)", () => {
    const clock = new RevealClock(0);
    clock.cut(1, 1000);
    expect(clock.at(1000).reveal).toBe(1);
    expect(clock.at(1320)).toEqual({ reveal: 1 - 0.5 ** 3, shown: 0, cuts: 0 });
    expect(clock.at(1640)).toEqual({ reveal: 0, shown: 1, cuts: 1 });
    expect(clock.at(1640 + 575).reveal).toBeCloseTo(1 - 0.5 ** 3, 10);
    expect(clock.at(1000 + FULL_CUT)).toEqual({ reveal: 1, shown: 1, cuts: 1 });
  });

  it('retargets a pick made during the fall: the fall goes on', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    const before = clock.at(300).reveal;
    clock.cut(2, 300);
    expect(clock.at(300).reveal).toBe(before);
    expect(clock.at(CUT_TIMING.outMs).shown).toBe(2);
    expect(clock.at(CUT_TIMING.outMs).cuts).toBe(1);
  });

  it('holds a pick made during the rise until the rise ends; the latest wins', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    clock.cut(2, 800);
    clock.cut(3, 900);
    expect(clock.at(FULL_CUT - 1).shown).toBe(1);
    expect(clock.at(FULL_CUT).reveal).toBe(1);
    expect(clock.at(FULL_CUT + CUT_TIMING.outMs)).toEqual({
      reveal: 0,
      shown: 3,
      cuts: 2,
    });
  });

  it('drops a waiting pick of the piece already on show', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    clock.cut(2, 800);
    clock.cut(1, 900);
    expect(clock.at(FULL_CUT + 100)).toEqual({ reveal: 1, shown: 1, cuts: 1 });
  });

  it('never turns a cut round, however fast the picks come (WCAG 2.3.1)', () => {
    const clock = new RevealClock(0);
    let pick = 0;
    let last = 1;
    let falling = false;
    const bottoms: number[] = [];
    for (let t = 0; t <= 12000; t += 5) {
      if (t % 37 === 0) {
        pick = (pick + 1 + (t % 3)) % 6;
        clock.cut(pick, t);
      }
      const { reveal } = clock.at(t);
      if (reveal < last) falling = true;
      if (falling && reveal > last) {
        bottoms.push(t);
        falling = false;
      }
      last = reveal;
    }
    expect(bottoms.length).toBeGreaterThan(4);
    for (let i = 1; i < bottoms.length; i++) {
      const gap = (bottoms[i] ?? 0) - (bottoms[i - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(FULL_CUT - 5);
    }
  });

  it('stops where it is when paused, and carries on from there', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    clock.pause(320);
    const held = clock.at(320).reveal;
    expect(clock.at(5000).reveal).toBe(held);
    clock.play(5000);
    expect(clock.at(5000).reveal).toBe(held);
    expect(clock.at(5320)).toEqual({ reveal: 0, shown: 1, cuts: 1 });
  });

  it('starts a cut picked while paused only on play', () => {
    const clock = new RevealClock(0);
    clock.pause(0);
    clock.cut(1, 100);
    expect(clock.at(2000).reveal).toBe(1);
    clock.play(2000);
    expect(clock.at(2000 + CUT_TIMING.outMs).shown).toBe(1);
  });

  it('says which piece the cut under way is going to: its target, a pick waiting in the rise, or the piece at rest (R2-M1)', () => {
    const clock = new RevealClock(0);
    expect(clock.headingTo(0)).toBe(0);
    clock.cut(1, 100);
    // Mid-fall: the target, though the stage still shows the last piece.
    expect(clock.headingTo(300)).toBe(1);
    expect(clock.at(300).shown).toBe(0);
    // A pick in the fall retargets it.
    clock.cut(2, 400);
    expect(clock.headingTo(500)).toBe(2);
    // In the rise, a pick waits, and it is what the cut is going to.
    const rise = 100 + CUT_TIMING.outMs + 50;
    expect(clock.at(rise).shown).toBe(2);
    clock.cut(0, rise);
    expect(clock.headingTo(rise + 10)).toBe(0);
    // At rest: the piece shown.
    const done = rise + CUT_TIMING.inMs + CUT_TIMING.outMs + CUT_TIMING.inMs;
    expect(clock.at(done)).toMatchObject({ reveal: 1, shown: 0 });
    expect(clock.headingTo(done)).toBe(0);
  });

  it('jumps with no cut', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    clock.jump(4);
    expect(clock.at(10)).toEqual({ reveal: 1, shown: 4, cuts: 0 });
  });

  it('cuts in 400 ms under reduced motion', () => {
    const clock = new RevealClock(0, REDUCED_CUT_TIMING);
    clock.cut(1, 0);
    expect(clock.at(200)).toEqual({ reveal: 0, shown: 1, cuts: 1 });
    expect(clock.at(400).reveal).toBe(1);
  });
});

describe('PointerTrail', () => {
  const out = () => new Float32Array(TRAIL_POINTS * 4);
  const slot = (a: Float32Array, i: number) => [...a.slice(i * 4, i * 4 + 4)];

  it('lays a point only once the pointer has moved a step', () => {
    const trail = new PointerTrail();
    trail.move(0.5, 0.5, 0, 1);
    trail.move(0.505, 0.5, 10, 1);
    const packed = trail.pack(10, 'liquid', out());
    expect(slot(packed, 1)[0]).toBeCloseTo(0.5, 6);
    expect(slot(packed, 2)).toEqual([0, 0, 0, 0]);
    trail.move(0.52, 0.5, 20, 1);
    expect(slot(trail.pack(20, 'liquid', out()), 2)[0]).toBeCloseTo(0.52, 6);
  });

  it('measures the step aspect-true', () => {
    const wide = new PointerTrail();
    wide.move(0.5, 0.5, 0, 2);
    wide.move(0.507, 0.5, 1, 2);
    expect(slot(wide.pack(1, 'liquid', out()), 2)[0]).toBeCloseTo(0.507, 6);
  });

  it('sends a widening, fading ring out from each liquid point; the pointer is no point', () => {
    const trail = new PointerTrail();
    trail.move(0.25, 0.75, 0, 1);
    const young = slot(trail.pack(0, 'liquid', out()), 1);
    expect(young.map((v) => +v.toFixed(4))).toEqual([0.25, 0.75, 0.9, 0.012]);
    const old = slot(trail.pack(1000, 'liquid', out()), 1);
    expect(old[2]).toBeLessThan(young[2] ?? 0);
    expect(old[3]).toBeGreaterThan(young[3] ?? 0);
    expect(slot(trail.pack(1000, 'liquid', out()), 0)).toEqual([0, 0, 0, 0]);
  });

  it('puts the pointer first in the smoke, and lets each puff rise and spread', () => {
    const trail = new PointerTrail();
    trail.move(0.25, 0.5, 0, 1);
    const packed = trail.pack(1000, 'smoke', out());
    expect(slot(packed, 0).map((v) => +v.toFixed(4))).toEqual([
      0.25, 0.5, 1.03, 0.12,
    ]);
    const puff = slot(packed, 1);
    expect(puff[1]).toBeGreaterThan(0.5);
    expect(puff[3]).toBeGreaterThan(0.09 * 1.1);
    // Smoke with inertia (WP-6): the head no longer vanishes with the
    // pointer; it stays, fading, where the smoke drifted to
    // (`reel-trail-inertia.test.ts` pins the drift and the fade).
    trail.leave(1000);
    const head = slot(trail.pack(1000, 'smoke', out()), 0);
    expect(head.slice(0, 2).map((v) => +v.toFixed(4))).toEqual([0.25, 0.5]);
    expect(head[2]).toBeGreaterThan(0);
    expect(slot(trail.pack(1000, 'smoke', out()), 1)[2]).toBeGreaterThan(0);
  });

  it(`forgets a point after ${TRAIL_LIFE_MS} ms`, () => {
    const trail = new PointerTrail();
    trail.move(0.5, 0.5, 0, 1);
    expect(
      slot(trail.pack(TRAIL_LIFE_MS - 1, 'liquid', out()), 1)[2]
    ).toBeGreaterThan(0);
    expect(slot(trail.pack(TRAIL_LIFE_MS, 'liquid', out()), 1)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('keeps the newest points, fewer on a phone', () => {
    const count = (trail: PointerTrail) => {
      const packed = trail.pack(100, 'liquid', out());
      let n = 0;
      for (let i = 0; i < TRAIL_POINTS; i++)
        if ((packed[i * 4 + 2] ?? 0) > 0) n++;
      return { n, newest: packed[n * 4] };
    };
    const desk = new PointerTrail();
    const phone = new PointerTrail(PHONE_TRAIL_POINTS);
    for (let i = 0; i < 40; i++) {
      desk.move(i * 0.02, 0.5, i, 1);
      phone.move(i * 0.02, 0.5, i, 1);
    }
    expect(count(desk).n).toBe(TRAIL_POINTS - 1);
    expect(count(phone).n).toBe(PHONE_TRAIL_POINTS - 1);
    expect(count(phone).newest).toBeCloseTo(39 * 0.02, 6);
  });

  it('clears every slot it does not fill', () => {
    const trail = new PointerTrail();
    const packed = out().fill(7);
    trail.pack(0, 'liquid', packed);
    expect([...packed].every((v) => v === 0)).toBe(true);
  });
});

describe('SwipeGate', () => {
  it('drives the effect once a touch goes sideways, for the rest of the gesture', () => {
    const gate = new SwipeGate();
    gate.down(100, 100);
    expect(gate.move(104, 101)).toBe(false);
    expect(gate.move(115, 104)).toBe(true);
    expect(gate.move(118, 140)).toBe(true);
  });

  it('leaves a vertical swipe to the page', () => {
    const gate = new SwipeGate();
    gate.down(100, 100);
    expect(gate.move(103, 120)).toBe(false);
    expect(gate.move(160, 122)).toBe(false);
  });

  it('decides each gesture afresh, and none without a touch down', () => {
    const gate = new SwipeGate();
    expect(gate.move(50, 50)).toBe(false);
    gate.down(0, 0);
    gate.move(0, 30);
    gate.up();
    gate.down(0, 0);
    expect(gate.move(30, 0)).toBe(true);
  });
});

/** A mask `w` × `h` with the letters where `on(x, y)` (row 0 at the top). */
function maskOf(
  w: number,
  h: number,
  on: (x: number, y: number) => boolean
): MaskPixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (on(x, y)) data[(y * w + x) * 4] = 255;
  return { data, width: w, height: h };
}

describe('deepestPoint', () => {
  it('finds no point in an empty mask', () => {
    expect(deepestPoint(maskOf(20, 10, () => false))).toBeNull();
  });

  it('lands in the middle of a bar, its radius half the bar', () => {
    const p = deepestPoint(
      maskOf(100, 50, (x, y) => x >= 10 && x < 90 && y >= 20 && y < 30)
    );
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(0.5, 1);
    expect(p?.y).toBeCloseTo(1 - 25 / 50, 1);
    expect((p?.radius ?? 0) * 50).toBeGreaterThan(4);
    expect((p?.radius ?? 0) * 50).toBeLessThan(6.5);
  });

  it('lands in the thicker of two strokes, though the thin one is nearer the middle', () => {
    const p = deepestPoint(
      maskOf(
        120,
        60,
        (x, y) =>
          (x >= 55 && x < 60 && y >= 5 && y < 55) ||
          (x >= 90 && x < 110 && y >= 10 && y < 50)
      )
    );
    expect(p?.x).toBeGreaterThan(90 / 120);
    expect(p?.x).toBeLessThan(110 / 120);
  });

  it('lands on the ring of an O, never in its hole', () => {
    const p = deepestPoint(
      maskOf(80, 80, (x, y) => {
        const r = Math.hypot(x - 40, y - 40);
        return r >= 20 && r < 34;
      })
    );
    const r = Math.hypot(((p?.x ?? 0) - 0.5) * 80, ((p?.y ?? 0) - 0.5) * 80);
    expect(r).toBeGreaterThan(22);
    expect(r).toBeLessThan(32);
  });

  it('counts beyond the image as outside the letters', () => {
    const p = deepestPoint(maskOf(40, 40, () => true));
    expect(p?.radius ?? 0).toBeLessThanOrEqual(21 / 40);
  });

  it('dives deep enough for the letter to cover the farthest corner', () => {
    const p = { x: 0.2, y: 0.7, radius: 0.01 };
    const depth = diveDepth(p, 16 / 9);
    const far = Math.hypot((1 - 0.2) * (16 / 9), 0 - 0.7);
    expect(depth * p.radius).toBeGreaterThan(far);
    expect(diveDepth({ x: 0.5, y: 0.5, radius: 0.5 }, 1)).toBe(4);
    expect(diveDepth({ x: 0.5, y: 0.5, radius: 0 }, 1)).toBe(160);
  });
});

describe('openingAt', () => {
  const depth = 60;

  it('fades the film into the letters from nothing, with no jump', () => {
    expect(openingAt(0, true, depth)).toMatchObject({
      zoom: 1,
      alpha: 0,
      weight: 1,
      dive: 0,
    });
    expect(openingAt(800, true, depth).alpha).toBe(1);
  });

  it('on the Name layout stays in the letters: no zoom, done by 1.3 s', () => {
    for (const ms of [0, 400, 1000, 1299])
      expect(openingAt(ms, false, depth).zoom).toBe(1);
    expect(openingAt(1100, false, depth).wordsIn).toBe(true);
    expect(openingAt(1300, false, depth).done).toBe(true);
  });

  it(`breathes, then dives the full depth in ${DIVE_MS} ms, always deeper`, () => {
    expect(openingAt(2600, true, depth).zoom).toBeCloseTo(1.03, 10);
    let last = 0;
    for (let ms = 0; ms <= 2600 + DIVE_MS; ms += 20) {
      const { zoom } = openingAt(ms, true, depth);
      expect(zoom).toBeGreaterThanOrEqual(last);
      last = zoom;
    }
    expect(openingAt(2600 + DIVE_MS, true, depth).zoom).toBeCloseTo(depth, 6);
  });

  it('ends at rest, the words in', () => {
    const end = openingAt(10000, true, depth);
    expect(end).toEqual({
      zoom: 1,
      alpha: 1,
      weight: 0,
      dive: 0,
      wordsIn: true,
      done: true,
    });
  });
});

describe('intoAt', () => {
  const depth = 50;

  it('starts every way into the film at rest, so the press never jumps', () => {
    for (const kind of INTO_IDS)
      for (const frame of [
        'film-fill',
        'film-name',
        'film-portrait',
      ] as const) {
        const start = intoAt(0, kind, frame, depth);
        expect(start, `${kind} ${frame}`).toMatchObject({
          zoom: 1,
          alpha: 1,
          dive: 0,
          into: 0,
          fill: 0,
          handOff: false,
        });
        expect(start.weight).toBe(
          frame === 'film-name' && kind === 'name' ? 1 : 0
        );
      }
  });

  it('hands off within 1.2 s, the film filling the stage', () => {
    for (const kind of INTO_IDS)
      for (const frame of [
        'film-fill',
        'film-name',
        'film-portrait',
      ] as const) {
        const length = intoLength(kind, frame);
        expect(length).toBeLessThanOrEqual(1200);
        expect(intoAt(length - 1, kind, frame, depth).handOff).toBe(false);
        expect(intoAt(length, kind, frame, depth)).toMatchObject({
          fill: 1,
          handOff: true,
          into: 0,
          dive: 0,
        });
      }
  });

  it('dives through the name in no more than the research allows', () => {
    for (const frame of ['film-fill', 'film-name', 'film-portrait'] as const) {
      const dives: number[] = [];
      for (let ms = 0; ms <= 1300; ms += 10)
        if (intoAt(ms, 'name', frame, depth).dive > 0) dives.push(ms);
      expect((dives.at(-1) ?? 0) - (dives[0] ?? 0)).toBeLessThanOrEqual(
        DIVE_MS
      );
    }
  });

  it('draws the film into the letters before the dive on the Corner and Wide layouts', () => {
    expect(intoAt(300, 'name', 'film-fill', depth)).toMatchObject({
      weight: 1,
      zoom: 1,
    });
    expect(intoAt(1199, 'name', 'film-fill', depth).zoom).toBeGreaterThan(
      depth * 0.9
    );
  });

  it('turns the smoke and the liquid at their peak, the film filling the stage from there', () => {
    expect(intoAt(519, 'smoke', 'film-fill', depth).fill).toBe(0);
    expect(intoAt(520, 'smoke', 'film-fill', depth)).toMatchObject({
      into: 1,
      fill: 1,
    });
    expect(intoAt(480, 'liquid', 'film-name', depth)).toMatchObject({
      into: 1,
      fill: 1,
    });
  });

  it('lets the band and the letters return as the player closes', () => {
    expect(leaveAt(0)).toBe(1);
    expect(leaveAt(LEAVE_MS)).toBe(0);
  });
});

describe('the settings', () => {
  it("name only effects the compositor has (light-leak waits for the wiring's setting)", () => {
    for (const v of HERO_OPTION_VALUES['reel-trans'])
      expect(TRANS_IDS).toContain(v);
    for (const v of HERO_OPTION_VALUES['reel-pointer'])
      expect(POINTER_IDS).toContain(v);
    for (const v of HERO_OPTION_VALUES['reel-opening'])
      expect(OPENING_IDS).toContain(v);
    for (const v of HERO_OPTION_VALUES['reel-film'])
      expect(INTO_IDS).toContain(v);
  });
});
