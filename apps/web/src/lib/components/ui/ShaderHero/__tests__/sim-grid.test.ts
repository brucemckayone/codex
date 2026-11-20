import { describe, expect, it } from 'vitest';
import { FLOW_SIM_FRAG } from '../shaders/flow-sim.frag';
import {
  createStepClock,
  INPUT_PER_SECOND,
  inputStride,
  SIM_BASE,
  SIM_CELL,
  simGridChanged,
  simGridFor,
} from '../sim-grid';

describe('simGridFor', () => {
  it('is the square base grid for a square canvas', () => {
    expect(simGridFor(800, 800)).toEqual({
      w: SIM_BASE,
      h: SIM_BASE,
      aspect: 1,
    });
  });

  it('is the square grid before the canvas is laid out', () => {
    expect(simGridFor(0, 0)).toEqual({ w: SIM_BASE, h: SIM_BASE, aspect: 1 });
    expect(simGridFor(Number.NaN, 300)).toEqual({
      w: SIM_BASE,
      h: SIM_BASE,
      aspect: 1,
    });
  });

  it.each([
    ['16:9 desktop hero', 1440, 810],
    ['phone portrait', 390, 844],
    ['wide banner', 1920, 480],
  ])('takes the shape of a %s at about the same texel budget', (_name, w, h) => {
    const grid = simGridFor(w, h);
    // Sides tile the periodic seed exactly.
    expect(grid.w % SIM_CELL).toBe(0);
    expect(grid.h % SIM_CELL).toBe(0);
    // Shape within one cell of the canvas's.
    expect(Math.abs(grid.w / grid.h - w / h)).toBeLessThan(0.3);
    // Cost stays near the old 512x512 (within the rounding of two sides).
    expect(grid.w * grid.h).toBeGreaterThan(SIM_BASE * SIM_BASE * 0.8);
    expect(grid.w * grid.h).toBeLessThan(SIM_BASE * SIM_BASE * 1.25);
  });

  it('clamps shapes past 4:1 instead of building a sliver grid', () => {
    expect(simGridFor(10_000, 100)).toEqual(simGridFor(4000, 1000));
  });

  // WP-1d R3: lenia's 48-tap kernel runs at a 256² budget. Every caller that
  // passes no base keeps SIM_BASE, so the grids above are unchanged.
  it('takes a smaller texel budget when given one, in the same shape', () => {
    expect(simGridFor(1440, 810, SIM_BASE)).toEqual(simGridFor(1440, 810));
    expect(simGridFor(800, 800, 256)).toEqual({ w: 256, h: 256, aspect: 1 });
    for (const [w, h] of [
      [1440, 810],
      [390, 844],
    ]) {
      const grid = simGridFor(w, h, 256);
      expect(grid.w % SIM_CELL).toBe(0);
      expect(grid.h % SIM_CELL).toBe(0);
      expect(Math.abs(grid.w / grid.h - w / h)).toBeLessThan(0.45);
      expect(grid.w * grid.h).toBeGreaterThan(256 * 256 * 0.8);
      expect(grid.w * grid.h).toBeLessThan(256 * 256 * 1.25);
    }
  });

  // Review round 1, LOW 1: at a 256² budget, 64-texel sides made ovals on
  // tablets and desktops (768x1024 0.80, 1024x768 1.25, 1280x1024 0.80).
  // Lenia's seed is Gaussian blobs, not a periodic noise, so it rounds its
  // sides to 16 texels; every other caller keeps SIM_CELL.
  it.each([
    [768, 1024],
    [1024, 768],
    [1280, 1024],
    [390, 844],
  ])('stays round at 256² with 16-texel sides: %ix%i', (w, h) => {
    const grid = simGridFor(w, h, 256, 16);
    expect(grid.w % 16).toBe(0);
    expect(grid.h % 16).toBe(0);
    expect(Math.abs(grid.w / grid.h / (w / h) - 1)).toBeLessThan(0.15);
  });

  it('keeps 64-texel sides when no cell is given', () => {
    expect(simGridFor(1280, 1024, 256)).toEqual(
      simGridFor(1280, 1024, 256, SIM_CELL)
    );
    expect(simGridFor(1440, 810)).toEqual(
      simGridFor(1440, 810, SIM_BASE, SIM_CELL)
    );
  });
});

describe('simGridChanged', () => {
  const grid = simGridFor(390, 844);

  it('ignores an address bar moving a phone height a few percent', () => {
    expect(simGridChanged(grid, 390, 800)).toBe(false);
    expect(simGridChanged(grid, 390, 880)).toBe(false);
  });

  it('rebuilds on a real change of shape (a phone turned sideways)', () => {
    expect(simGridChanged(grid, 844, 390)).toBe(true);
  });

  it('ignores a canvas collapsing to 0 (a hidden container)', () => {
    expect(simGridChanged(simGridFor(1920, 1080), 0, 0)).toBe(false);
  });
});

describe('createStepClock', () => {
  const run = (hz: number, seconds: number, perSecond: number) => {
    const clock = createStepClock(perSecond);
    let total = 0;
    const frames = Math.round(seconds * hz);
    for (let f = 0; f < frames; f++) total += clock.tick(f / hz).steps;
    return total;
  };

  it('runs the same steps a second at 30, 60 and 120 Hz', () => {
    // 120 steps/s for 2 s ≈ 240 at every frame rate (±1 frame of carry).
    for (const hz of [60, 120]) {
      expect(Math.abs(run(hz, 2, 120) - 240)).toBeLessThanOrEqual(2);
    }
    // At 30 Hz each frame needs 4 steps: inside the per-frame cap.
    expect(Math.abs(run(30, 2, 120) - 240)).toBeLessThanOrEqual(4);
  });

  it('runs the old 2 steps a frame at 60 Hz, 1 at 120 Hz', () => {
    const c60 = createStepClock(120);
    c60.tick(0).steps;
    expect(c60.tick(1 / 60).steps).toBe(2);
    const c120 = createStepClock(120);
    c120.tick(0).steps;
    expect(c120.tick(1 / 120).steps).toBe(1);
  });

  it('advances on its first call, so a single frozen frame still steps', () => {
    expect(createStepClock(120).tick(123.4).steps).toBe(2);
    expect(createStepClock(60).tick(0).steps).toBe(1);
    // Even a clock slower than the nominal frame runs one step at first.
    expect(createStepClock(30).tick(0).steps).toBe(1);
  });

  it('redraws a frozen frame without stepping again', () => {
    const clock = createStepClock(120);
    clock.tick(2);
    expect(clock.tick(2)).toMatchObject({ steps: 0, dt: 0 });
  });

  it('reports the frame time, nominal on the first frame and clamped', () => {
    const clock = createStepClock(120);
    expect(clock.tick(10).dt).toBeCloseTo(1 / 60);
    expect(clock.tick(10.02).dt).toBeCloseTo(0.02);
    expect(clock.tick(20).dt).toBe(0.1);
  });

  it('caps catch-up after a long stall and never runs backwards', () => {
    const clock = createStepClock(120);
    clock.tick(0).steps;
    expect(clock.tick(5).steps).toBe(4); // a tab back from the background
    expect(clock.tick(4).steps).toBe(0); // time went backwards (a remount)
  });

  it('starts over after reset()', () => {
    const clock = createStepClock(120);
    clock.tick(0).steps;
    clock.tick(0.001).steps;
    clock.reset();
    expect(clock.tick(50).steps).toBe(2);
  });
});

describe('pointer input rate', () => {
  // Input on a stride of the step index, not per frame or per step.
  const pushesPerSecond = (hz: number, perSecond: number) => {
    const clock = createStepClock(perSecond);
    const stride = inputStride(perSecond);
    let pushes = 0;
    const frames = Math.round(2 * hz);
    for (let f = 0; f < frames; f++) {
      const { steps, first } = clock.tick(f / hz);
      for (let i = 0; i < steps; i++) if ((first + i) % stride === 0) pushes++;
    }
    return pushes / 2;
  };

  it.each([
    30, 60, 120,
  ])('is %i Hz-independent for flow and ripple (120 steps/s)', (hz) => {
    expect(
      Math.abs(pushesPerSecond(hz, 120) - INPUT_PER_SECOND)
    ).toBeLessThanOrEqual(2);
  });

  it.each([
    30, 60, 120,
  ])('is %i Hz-independent for suture (60 steps/s)', (hz) => {
    expect(
      Math.abs(pushesPerSecond(hz, 60) - INPUT_PER_SECOND)
    ).toBeLessThanOrEqual(2);
  });

  it("keeps the old 60 Hz behaviour: input on the first of each frame's 2 steps", () => {
    const clock = createStepClock(120);
    const stride = inputStride(120);
    clock.tick(0);
    const { steps, first } = clock.tick(1 / 60);
    expect(steps).toBe(2);
    expect([0, 1].map((i) => (first + i) % stride === 0)).toEqual([
      true,
      false,
    ]);
  });
});

describe('flow simulation (Codex-c48om)', () => {
  // The rendered proof lives in the shader lab sweep recorded on
  // Codex-1yd58.14: uncapped, curl 0.95 and 1.5 fell to the background
  // within 3 s in light and dark; capped, every curl 0.1-1.5 draws from
  // 0.5 s. WebGL is not available here, so this pins the mechanism.
  it('caps the per-step curl rotation', () => {
    expect(FLOW_SIM_FRAG).toMatch(
      /float sc = clamp\(-uCurl \* curl, -MAX_ROTATION, MAX_ROTATION\);/
    );
    expect(FLOW_SIM_FRAG).toMatch(/const float MAX_ROTATION = 0\.15;/);
  });
});
