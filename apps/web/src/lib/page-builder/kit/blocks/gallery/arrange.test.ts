import { describe, expect, it } from 'vitest';
import {
  fullPicture,
  gridColumns,
  MOSAIC_SPANS,
  mosaicCaption,
  mosaicTiles,
  pictureSizes,
  pictureVariant,
  stripShape,
} from './arrange';
import { MAX_GALLERY_ITEMS } from './definition';

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

const COUNTS = Array.from({ length: MAX_GALLERY_ITEMS }, (_, i) => i + 1);

/** The narrow mosaic (two columns): the first picture 2×2, a last picture left alone spans the row. */
function narrowSpans(count: number): Span[] {
  return Array.from({ length: count }, (_, index): Span => {
    if (index === 0) return [2, 2];
    if (index === count - 1 && (index + 1) % 2 === 0) return [2, 1];
    return [1, 1];
  });
}

describe('mosaic', () => {
  it('draws a lone picture across the whole width', () => {
    expect(mosaicTiles(1)).toEqual(['single']);
  });

  it.each(
    COUNTS.filter((n) => n > 1)
  )('%i pictures fill every row of the wide mosaic, in their own order', (count) => {
    const tiles = mosaicTiles(count);
    expect(tiles).toHaveLength(count);
    const spans = tiles.map(
      (tile) => MOSAIC_SPANS[tile as keyof typeof MOSAIC_SPANS]
    );
    for (const row of pack(4, spans)) expect(row).not.toContain(-1);
    // The first picture is the largest, strictly.
    const area = ([w, h]: Span) => w * h;
    for (const span of spans.slice(1)) {
      expect(area(spans[0])).toBeGreaterThan(area(span));
    }
  });

  it.each(
    COUNTS.filter((n) => n > 1)
  )('%i pictures fill every row of the narrow mosaic', (count) => {
    for (const row of pack(2, narrowSpans(count)))
      expect(row).not.toContain(-1);
  });

  it.each(
    COUNTS.filter((n) => n > 1)
  )('%i pictures never gather four small tiles into a square, which reads as a plain grid', (count) => {
    const tiles = mosaicTiles(count);
    const cells = pack(
      4,
      tiles.map((tile) => MOSAIC_SPANS[tile as keyof typeof MOSAIC_SPANS])
    );
    for (let r = 0; r + 1 < cells.length; r++) {
      for (let c = 0; c + 1 < 4; c++) {
        const square = new Set([
          cells[r][c],
          cells[r][c + 1],
          cells[r + 1][c],
          cells[r + 1][c + 1],
        ]);
        const allSmall = [...square].every((i) => tiles[i] === 'small');
        expect(square.size === 4 && allSmall).toBe(false);
      }
    }
  });
});

describe('grid', () => {
  it.each(
    COUNTS.filter((n) => n > 1)
  )('%i pictures never leave one alone on the last row', (count) => {
    const columns = gridColumns(count);
    const last = count - (Math.ceil(count / columns) - 1) * columns;
    expect(last).toBeGreaterThanOrEqual(2);
  });

  it('sets two by two rather than four in a row', () => {
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(8)).toBe(4);
  });
});

describe('pictureVariant', () => {
  it('takes the large file only for pictures drawn wider than the medium one', () => {
    // Mosaic of five: large, small, small, wide, wide.
    expect([0, 1, 2, 3, 4].map((i) => pictureVariant('mosaic', i, 5))).toEqual([
      'lg',
      'md',
      'md',
      'lg',
      'lg',
    ]);
    expect(pictureVariant('mosaic', 0, 1)).toBe('lg');
    expect(pictureVariant('grid', 0, 2)).toBe('lg');
    expect(pictureVariant('grid', 0, 6)).toBe('md');
    expect([0, 1, 2].map((i) => pictureVariant('strip', i, 3))).toEqual([
      'lg',
      'md',
      'lg',
    ]);
  });

  it('alternates the strip between landscape and portrait, starting wide', () => {
    expect([0, 1, 2, 3].map(stripShape)).toEqual([
      'wide',
      'tall',
      'wide',
      'tall',
    ]);
  });
});

describe('pictureSizes (Codex-61zsk.66)', () => {
  it('a strip picture is its fixed height at its shape', () => {
    expect(pictureSizes('strip', 0, 5)).toBe(
      '(min-width: 112.5rem) 39rem, (min-width: 31.25rem) calc(12rem + 24vw), 19.5rem'
    );
    expect(pictureSizes('strip', 1, 5)).toBe(
      '(min-width: 112.5rem) 20.8rem, (min-width: 31.25rem) calc(6.4rem + 12.8vw), 10.4rem'
    );
  });

  it('a grid divides the column by its row from 60rem, in two from 36rem', () => {
    expect(pictureSizes('grid', 0, 1)).toBe('(min-width: 82rem) 82rem, 100vw');
    expect(pictureSizes('grid', 0, 3)).toBe(
      '(min-width: 82rem) 27.33rem, (min-width: 60rem) 33.33vw, (min-width: 36rem) 50vw, 100vw'
    );
    expect(pictureSizes('grid', 0, 4)).toBe(
      '(min-width: 82rem) 41rem, (min-width: 36rem) 50vw, 100vw'
    );
  });

  it('a mosaic tile takes its share of four columns, and on two the first spans both', () => {
    const tiles = mosaicTiles(5);
    expect(tiles[0]).toBe('large');
    expect(pictureSizes('mosaic', 0, 5)).toBe(
      '(min-width: 82rem) 61.5rem, (min-width: 53rem) 75vw, 100vw'
    );
    expect(pictureSizes('mosaic', 1, 5)).toMatch(/, 50vw$/);
    expect(pictureSizes('mosaic', 0, 1)).toBe(
      '(min-width: 82rem) 82rem, 100vw'
    );
  });

  // The pictures that take `lg` are the ones drawn wide: on the wide layout
  // each declares at least half the column, and an `md` one a third at most.
  it('agrees with pictureVariant on which pictures are the large ones', () => {
    const wideShare = (sizes: string) => Number(/([\d.]+)vw/.exec(sizes)?.[1]);
    for (let count = 2; count <= 12; count++) {
      for (const layout of ['mosaic', 'grid']) {
        for (let index = 0; index < count; index++) {
          const share = wideShare(pictureSizes(layout, index, count));
          const large = pictureVariant(layout, index, count) === 'lg';
          expect(
            large ? share >= 50 : share <= 33.34,
            `${layout} ${index}/${count}: ${share}vw`
          ).toBe(true);
        }
      }
      for (let index = 0; index < count; index++) {
        const large = pictureVariant('strip', index, count) === 'lg';
        expect(pictureSizes('strip', index, count)).toContain(
          large ? '39rem' : '20.8rem'
        );
      }
    }
  });
});

describe('pictureSizes under Clean (Codex-61zsk.66)', () => {
  // Clean never hangs more than three to a row, and a set of six in pairs
  // (style-clean.css), so its grid declares those shares, not the base ones.
  it('a set of six is drawn in pairs, and four or more in threes', () => {
    expect(pictureSizes('grid', 0, 6, 'clean')).toBe(
      '(min-width: 82rem) 41rem, (min-width: 36rem) 50vw, 100vw'
    );
    expect(pictureSizes('grid', 0, 7, 'clean')).toBe(
      '(min-width: 82rem) 27.33rem, (min-width: 60rem) 33.33vw, (min-width: 36rem) 50vw, 100vw'
    );
    expect(pictureSizes('grid', 0, 7)).toBe(
      '(min-width: 82rem) 20.5rem, (min-width: 60rem) 25vw, (min-width: 36rem) 50vw, 100vw'
    );
  });
});

describe('mosaicCaption (p3n §4)', () => {
  it('lays a caption over the broad tiles only, and under every other', () => {
    expect(
      (['single', 'large', 'wide', 'block', 'tall', 'small'] as const).map(
        (tile) => [tile, mosaicCaption(tile)]
      )
    ).toEqual([
      ['single', 'over'],
      ['large', 'over'],
      ['wide', 'over'],
      ['block', 'under'],
      ['tall', 'under'],
      ['small', 'under'],
    ]);
  });
});

describe('fullPicture: what the lightbox shows (p3n §4)', () => {
  const CDN = 'https://cdn.test';
  const key = 'landing-pages/p1/images/g1';

  it('is the xl file, with its size, for a reference that records one', () => {
    expect(fullPicture({ key, w: 3000, h: 2000 }, CDN)).toEqual({
      url: `${CDN}/${key}/xl.webp`,
      w: 3000,
      h: 2000,
    });
  });

  it('is the lg file, with no size, for one uploaded before xl existed', () => {
    expect(fullPicture({ key }, CDN)).toEqual({ url: `${CDN}/${key}/lg.webp` });
    // A size that is not two whole pixel counts is no size at all.
    expect(fullPicture({ key, w: 3000 }, CDN)).toEqual({
      url: `${CDN}/${key}/lg.webp`,
    });
  });

  it('is nothing without a CDN base or a real reference', () => {
    expect(fullPicture({ key, w: 3000, h: 2000 }, null)).toBeUndefined();
    expect(fullPicture({ alt: 'no key' }, CDN)).toBeUndefined();
  });
});
