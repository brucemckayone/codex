/**
 * What the org's moving background has drawn, part by part (landing-builder
 * 03 X54). ShaderHero samples its own frame, scaled down to one pixel per
 * cell of a grid laid over the window, and keeps each cell's darkest and
 * lightest value per channel, so a page can ask how dark or light the shader
 * gets behind a given box: the page kit's live veil.
 *
 * A cell is about 30px square at 1440×900, so its sample averages about as
 * much of the frame as the shader's own blur does (a 20px blur averages more),
 * and the extremes kept are at least as far apart as the ones seen.
 */

export const TONE_COLS = 48;
export const TONE_ROWS = 30;

/** sRGB, 0–255 per channel. */
export type ToneRgb = [number, number, number];

export interface ToneGrid {
  readonly cols: number;
  readonly rows: number;
  /** Row-major, three channels per cell: the darkest value each has drawn. */
  readonly lo: Uint8ClampedArray;
  /** And the lightest. */
  readonly hi: Uint8ClampedArray;
  /** Frames folded in since the grid was last cleared. */
  samples: number;
}

export function emptyToneGrid(cols = TONE_COLS, rows = TONE_ROWS): ToneGrid {
  return {
    cols,
    rows,
    lo: new Uint8ClampedArray(cols * rows * 3).fill(255),
    hi: new Uint8ClampedArray(cols * rows * 3),
    samples: 0,
  };
}

/** Folds one sampled frame (RGBA, `cols × rows`, row-major) into the grid. */
export function accumulateTone(grid: ToneGrid, rgba: ArrayLike<number>): void {
  const cells = grid.cols * grid.rows;
  for (let cell = 0; cell < cells; cell++) {
    for (let c = 0; c < 3; c++) {
      const value = rgba[cell * 4 + c] ?? 0;
      const at = cell * 3 + c;
      if (value < (grid.lo[at] ?? 255)) grid.lo[at] = value;
      if (value > (grid.hi[at] ?? 0)) grid.hi[at] = value;
    }
  }
  grid.samples++;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The part of a canvas's drawing buffer the window shows, as a source
 * rectangle for `drawImage`. Under a blur the org layout runs the canvas past
 * the window's edges and fits the buffer with `object-fit: cover`; otherwise
 * the buffer fills its box. Clamped to the buffer.
 */
export function visibleBufferRegion({
  rect,
  buffer,
  fit,
  viewport,
}: {
  rect: Box;
  buffer: { width: number; height: number };
  fit: string;
  viewport: { width: number; height: number };
}): { sx: number; sy: number; sw: number; sh: number } {
  let kx = rect.width / buffer.width;
  let ky = rect.height / buffer.height;
  let left = rect.left;
  let top = rect.top;
  if (fit === 'cover') {
    const k = Math.max(kx, ky);
    left += (rect.width - buffer.width * k) / 2;
    top += (rect.height - buffer.height * k) / 2;
    kx = k;
    ky = k;
  }
  const sx = Math.max(0, -left / kx);
  const sy = Math.max(0, -top / ky);
  return {
    sx,
    sy,
    sw: Math.min(buffer.width - sx, viewport.width / kx),
    sh: Math.min(buffer.height - sy, viewport.height / ky),
  };
}

/**
 * The extremes of every cell a box in the window (CSS px) touches. None
 * before the first frame is folded in, and none for a box off the window.
 */
export function cellsUnder(
  grid: ToneGrid,
  box: { left: number; top: number; right: number; bottom: number },
  viewport: { width: number; height: number }
): { lo: ToneRgb; hi: ToneRgb }[] {
  if (grid.samples === 0) return [];
  // Off the window, the clamped span is empty (its first cell past its last).
  const span = (from: number, to: number, size: number, count: number) => {
    const first = Math.max(0, Math.floor((from / size) * count));
    const last = Math.min(count - 1, Math.floor((to / size) * count));
    return [first, last] as const;
  };
  const [c0, c1] = span(box.left, box.right, viewport.width, grid.cols);
  const [r0, r1] = span(box.top, box.bottom, viewport.height, grid.rows);
  const out: { lo: ToneRgb; hi: ToneRgb }[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const at = (row * grid.cols + col) * 3;
      out.push({
        lo: [grid.lo[at] ?? 0, grid.lo[at + 1] ?? 0, grid.lo[at + 2] ?? 0],
        hi: [
          grid.hi[at] ?? 255,
          grid.hi[at + 1] ?? 255,
          grid.hi[at + 2] ?? 255,
        ],
      });
    }
  }
  return out;
}
