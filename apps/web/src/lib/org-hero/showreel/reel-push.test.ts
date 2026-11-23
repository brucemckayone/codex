/**
 * The stills' push-in runs on the REEL's clock, never the page's: paused, held
 * or in a hidden tab, the reel holds, and the push-in holds with it, then goes
 * on from where it was.
 */
import { describe, expect, it } from 'vitest';
import {
  PUSH_SECONDS,
  pushZoom,
} from '$lib/components/ui/ShaderHero/compositor/stage';
import { PIECE_MS, ReelClock } from './reel-clock.svelte';
import { pieceSeconds } from './reel-push';

describe('pieceSeconds', () => {
  it('is how far the reel has played the piece on show, in seconds', () => {
    const clock = new ReelClock(3, true);
    const seconds = pieceSeconds(clock);
    expect(seconds()).toBe(0);
    clock.tick(2500);
    expect(seconds()).toBeCloseTo(2.5, 10);
    // the next piece starts from 0
    clock.next();
    expect(seconds()).toBe(0);
  });

  it('holds while the reel is paused: 1 s in, 5 s paused, then on from 1.021 with no snap', () => {
    const clock = new ReelClock(3, true);
    const seconds = pieceSeconds(clock);
    clock.tick(1000);
    const held = pushZoom(seconds());
    expect(held).toBeCloseTo(1.021, 3);

    clock.togglePause();
    clock.tick(5000);
    expect(pushZoom(seconds())).toBe(held);

    clock.togglePause();
    clock.tick(16);
    const next = pushZoom(seconds());
    expect(next).toBeGreaterThan(held);
    expect(next - held).toBeLessThan(0.001);
  });

  it('holds while the reel is held (the pointer over its words)', () => {
    const clock = new ReelClock(3, true);
    const seconds = pieceSeconds(clock);
    clock.tick(1000);
    clock.hold('pointer', true);
    clock.tick(4000);
    expect(seconds()).toBeCloseTo(1, 10);
  });

  it('pushes in over exactly one piece', () => {
    expect(PUSH_SECONDS * 1000).toBe(PIECE_MS);
  });
});
