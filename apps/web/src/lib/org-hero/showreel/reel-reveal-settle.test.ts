/**
 * The cut opens only onto a piece that is ready (the owner's testing,
 * 2026-11-23, on a phone: the shader closed over the picture, then it
 * "flashes right to the next image"). At the cut's bottom the stage shows
 * the next piece; the reveal waits there, closed, until that piece's media
 * is final (`ready`), at most SETTLE_MAX_MS, then rises in full.
 */
import { describe, expect, it } from 'vitest';
import { CUT_TIMING, RevealClock, SETTLE_MAX_MS } from './reel-reveal';

const { outMs, inMs } = CUT_TIMING;

describe('the cut waits, closed, for the next piece to be ready', () => {
  it('opens at its bottom, as before, when the piece is ready', () => {
    const clock = new RevealClock(0);
    clock.cut(1, 0);
    expect(clock.at(outMs).reveal).toBe(0);
    expect(clock.at(outMs + inMs / 2).reveal).toBeGreaterThan(0.5);
    expect(clock.at(outMs + inMs).reveal).toBe(1);
  });

  it('holds closed while the piece is not ready, then rises in full from when it is', () => {
    let ready = false;
    const asked: number[] = [];
    const clock = new RevealClock(0);
    clock.ready = (shown) => {
      asked.push(shown);
      return ready;
    };
    clock.cut(1, 0);
    expect(clock.at(outMs + 400).reveal, 'held closed past the bottom').toBe(0);
    expect(clock.at(outMs + 400).shown, 'the stage shows the next piece').toBe(
      1
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked), 'asked about the next piece only').toEqual(
      new Set([1])
    );
    expect(clock.cutting(outMs + 400), 'the loop keeps asking').toBe(true);

    ready = true;
    const opens = outMs + 500;
    expect(clock.at(opens).reveal).toBe(0);
    const half = clock.at(opens + inMs / 2).reveal;
    expect(half, 'a whole rise from then').toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(clock.at(opens + inMs).reveal).toBe(1);
    expect(clock.cutting(opens + inMs + 1)).toBe(false);
  });

  it('a pick while it waits closed aims it at the pick at once, with no new dip', () => {
    const clock = new RevealClock(0);
    clock.ready = () => false;
    clock.cut(1, 0);
    const before = clock.at(outMs + 100);
    expect(before.shown).toBe(1);
    clock.cut(2, outMs + 200);
    const after = clock.at(outMs + 250);
    expect(after.shown, 'the stage on the pick').toBe(2);
    expect(after.reveal, 'still closed').toBe(0);
    expect(after.cuts, 'no new dip').toBe(before.cuts);
  });

  it('rises at SETTLE_MAX_MS when the piece never readies', () => {
    const clock = new RevealClock(0);
    clock.ready = () => false;
    clock.cut(1, 0);
    expect(clock.at(outMs + SETTLE_MAX_MS - 1).reveal).toBe(0);
    expect(clock.at(outMs + SETTLE_MAX_MS + inMs).reveal).toBe(1);
  });
});
