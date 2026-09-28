import { describe, expect, it } from 'vitest';
import { BENTO_SPANS, bentoTiles } from './bento';

type Span = readonly [columns: number, rows: number];

/**
 * CSS grid's (sparse) auto-placement: each tile goes at the first free slot
 * at or after the previous tile's, row by row. Returns, per cell, the index
 * of the tile that covers it (-1 for a hole).
 */
function pack(columns: number, spans: readonly Span[]): number[][] {
  const cells: number[][] = [];
  const taken = (row: number, column: number) =>
    (cells[row]?.[column] ?? -1) >= 0;
  const fits = (row: number, column: number, [w, h]: Span) => {
    if (column + w > columns) return false;
    for (let r = row; r < row + h; r++)
      for (let c = column; c < column + w; c++) if (taken(r, c)) return false;
    return true;
  };
  let row = 0;
  let column = 0;
  spans.forEach((span, index) => {
    while (!fits(row, column, span)) {
      column += 1;
      if (column + span[0] > columns) {
        column = 0;
        row += 1;
      }
    }
    for (let r = row; r < row + span[1]; r++) {
      cells[r] ??= Array.from({ length: columns }, () => -1);
      for (let c = column; c < column + span[0]; c++) cells[r][c] = index;
    }
  });
  return cells;
}

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('bento', () => {
  it.each(
    COUNTS
  )('%i items fill every row of the six-column bento, in their own order', (count) => {
    const tiles = bentoTiles(count);
    expect(tiles).toHaveLength(count);
    const spans = tiles.map((tile) => BENTO_SPANS[tile]);
    for (const row of pack(6, spans)) expect(row).not.toContain(-1);
  });

  it.each(
    COUNTS.filter((n) => n > 1)
  )('%i items: the first tile is the largest, strictly', (count) => {
    const [first, ...rest] = bentoTiles(count).map((tile) => BENTO_SPANS[tile]);
    for (const span of rest) {
      expect(first[0] * first[1]).toBeGreaterThan(span[0] * span[1]);
    }
  });

  it('turns a second tall block to the other side from the first', () => {
    for (const count of [7, 9]) {
      const tiles = bentoTiles(count);
      const cells = pack(
        6,
        tiles.map((tile) => BENTO_SPANS[tile])
      );
      const side = tiles.indexOf('side');
      expect(side).toBeGreaterThan(0);
      // The lead holds the left of the first rows; the block, the right later.
      expect(cells[0][0]).toBe(0);
      expect(cells.find((row) => row.includes(side))?.at(-1)).toBe(side);
    }
  });
});
