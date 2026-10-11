import { describe, expect, it } from 'vitest';
import {
  accumulateTone,
  cellsUnder,
  emptyToneGrid,
  visibleBufferRegion,
} from '../tone-grid';

/** An RGBA frame for a grid, every cell `rgb`, or `at(cell)`. */
const frame = (
  cells: number,
  at: (cell: number) => [number, number, number]
) => {
  const data = new Uint8ClampedArray(cells * 4);
  for (let cell = 0; cell < cells; cell++) {
    const [r, g, b] = at(cell);
    data.set([r, g, b, 255], cell * 4);
  }
  return data;
};

describe('accumulateTone', () => {
  it("keeps each cell's darkest and lightest value per channel, and counts the frames", () => {
    const grid = emptyToneGrid(2, 1);
    accumulateTone(
      grid,
      frame(2, (cell) => (cell === 0 ? [10, 200, 30] : [100, 100, 100]))
    );
    accumulateTone(
      grid,
      frame(2, (cell) => (cell === 0 ? [50, 20, 30] : [90, 120, 80]))
    );
    expect([...grid.lo]).toEqual([10, 20, 30, 90, 100, 80]);
    expect([...grid.hi]).toEqual([50, 200, 30, 100, 120, 100]);
    expect(grid.samples).toBe(2);
  });
});

describe('cellsUnder', () => {
  const viewport = { width: 400, height: 200 };

  it('finds nothing before the first frame, or for a box off the window', () => {
    const grid = emptyToneGrid(4, 2);
    expect(
      cellsUnder(grid, { left: 0, top: 0, right: 400, bottom: 200 }, viewport)
    ).toEqual([]);
    accumulateTone(
      grid,
      frame(8, () => [1, 2, 3])
    );
    expect(
      cellsUnder(grid, { left: 0, top: -90, right: 400, bottom: -10 }, viewport)
    ).toEqual([]);
    expect(
      cellsUnder(grid, { left: 0, top: 210, right: 400, bottom: 260 }, viewport)
    ).toEqual([]);
  });

  it('returns every cell a box touches, each with its own extremes', () => {
    // 4 × 2 cells of 100 × 100px; cell n draws n in every channel.
    const grid = emptyToneGrid(4, 2);
    accumulateTone(
      grid,
      frame(8, (cell) => [cell, cell, cell])
    );
    const under = cellsUnder(
      grid,
      { left: 150, top: 120, right: 250, bottom: 180 },
      viewport
    );
    expect(under.map((c) => c.lo[0])).toEqual([5, 6]);
    expect(under.map((c) => c.hi[0])).toEqual([5, 6]);
  });

  it('clamps a box that runs past the window to its edge cells', () => {
    const grid = emptyToneGrid(4, 2);
    accumulateTone(
      grid,
      frame(8, (cell) => [cell, cell, cell])
    );
    const under = cellsUnder(
      grid,
      { left: 350, top: -50, right: 900, bottom: 50 },
      viewport
    );
    expect(under.map((c) => c.lo[0])).toEqual([3]);
  });
});

describe('visibleBufferRegion', () => {
  const viewport = { width: 1440, height: 900 };
  const buffer = { width: 2880, height: 1800 };

  it('is the whole buffer when the canvas fills the window', () => {
    expect(
      visibleBufferRegion({
        rect: { left: 0, top: 0, width: 1440, height: 900 },
        buffer,
        fit: 'fill',
        viewport,
      })
    ).toEqual({ sx: 0, sy: 0, sw: 2880, sh: 1800 });
  });

  it("is the window's part of a canvas run 40px past every edge and fitted to cover", () => {
    // The org layout's blurred canvas: 100% + 4 × 20px, margin −2 × 20px.
    const rect = { left: -40, top: -40, width: 1520, height: 980 };
    const k = Math.max(1520 / 2880, 980 / 1800);
    const left = -40 + (1520 - 2880 * k) / 2;
    const top = -40 + (980 - 1800 * k) / 2;
    const region = visibleBufferRegion({
      rect,
      buffer,
      fit: 'cover',
      viewport,
    });
    expect(region.sx).toBeCloseTo(-left / k, 6);
    expect(region.sy).toBeCloseTo(-top / k, 6);
    expect(region.sw).toBeCloseTo(1440 / k, 6);
    expect(region.sh).toBeCloseTo(900 / k, 6);
    // The window sits inside the buffer, centred.
    expect(region.sx + region.sw).toBeLessThan(2880);
    expect(region.sx).toBeCloseTo(2880 - (region.sx + region.sw), 6);
  });
});
