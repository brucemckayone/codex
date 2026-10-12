import { afterEach, describe, expect, it, vi } from 'vitest';
import { shaderTone, TONE_SETTLE_SAMPLES } from '../shader-tone';
import { TONE_COLS, TONE_ROWS } from '../tone-grid';

const frame = (v: number) =>
  new Uint8ClampedArray(TONE_COLS * TONE_ROWS * 4).fill(v);

afterEach(() => {
  shaderTone.onHold(null);
  shaderTone.onDemand(null);
  shaderTone.clear();
});

describe('shaderTone', () => {
  it('is wanted while any page asks, and each release counts once', () => {
    const wake = vi.fn();
    shaderTone.onDemand(wake);
    const one = shaderTone.demand();
    const two = shaderTone.demand();
    expect(wake).toHaveBeenCalledTimes(2);
    one();
    one();
    expect(shaderTone.wanted).toBe(true);
    two();
    expect(shaderTone.wanted).toBe(false);
  });

  it('tells its listeners of each frame and each clear, and keeps the extremes', () => {
    const heard = vi.fn();
    const stop = shaderTone.subscribe(heard);
    shaderTone.record(frame(40));
    shaderTone.record(frame(200));
    expect(heard).toHaveBeenCalledTimes(2);
    expect([shaderTone.grid.lo[0], shaderTone.grid.hi[0]]).toEqual([40, 200]);
    expect(shaderTone.grid.samples).toBe(2);

    shaderTone.clear();
    expect(heard).toHaveBeenCalledTimes(3);
    expect(shaderTone.grid.samples).toBe(0);
    // An empty grid has nothing to clear, and says nothing.
    shaderTone.clear();
    expect(heard).toHaveBeenCalledTimes(3);

    stop();
    shaderTone.record(frame(10));
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('is settled after one still frame, or after watching a moving shader for a while', () => {
    shaderTone.record(frame(90), { still: true, blur: 0 });
    expect(shaderTone.settled).toBe(true);
    shaderTone.clear();
    for (let i = 1; i < TONE_SETTLE_SAMPLES; i++)
      shaderTone.record(frame(90), { still: false, blur: 20 });
    expect(shaderTone.settled).toBe(false);
    shaderTone.record(frame(90), { still: false, blur: 20 });
    expect(shaderTone.settled).toBe(true);
    expect(shaderTone.blur).toBe(20);
  });

  // 03 X62: a page's motion dial holds the org's moving background still.
  it('is held while any page holds it, telling the shader only as the first takes hold and the last lets go', () => {
    const told = vi.fn();
    shaderTone.onHold(told);
    const one = shaderTone.hold();
    const two = shaderTone.hold();
    expect(shaderTone.held).toBe(true);
    expect(told.mock.calls).toEqual([[true]]);
    one();
    one();
    expect(shaderTone.held).toBe(true);
    two();
    expect(shaderTone.held).toBe(false);
    expect(told.mock.calls).toEqual([[true], [false]]);
  });
});
