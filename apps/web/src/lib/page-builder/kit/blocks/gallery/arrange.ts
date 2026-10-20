/**
 * How the gallery arranges its pictures (03-expressive-contract §3, §7). Pure,
 * so every arrangement is tested at every count it can meet (1–12).
 */
import { columnSize, type PageImageVariant } from '../../../page-images';

/** One picture, resolved: its URL (none draws the kit's plate), its description, its caption. */
export interface Picture {
  url: string | null;
  alt: string;
  caption?: string;
  /** Where its subject is, for a frame that crops it (`storedFocus`). */
  focus?: { x: number; y: number };
  /** Its stored sizes (`pageImageSrcset`) and how wide its tile is drawn (`pictureSizes`). */
  srcset?: string;
  sizes?: string;
}

/**
 * A mosaic tile. The wide mosaic is four columns whose rows are four fifths
 * of a column deep, so a tile's span fixes its shape: `large` 3×2 (15:8),
 * `block` 2×2 (5:4), `tall` 1×2 (5:8), `wide` 2×1 (5:2), `small` 1×1 (5:4).
 * `single` is a lone picture across the whole width.
 */
export type MosaicTile =
  | 'single'
  | 'large'
  | 'block'
  | 'tall'
  | 'wide'
  | 'small';

/** Columns × rows of each tile on the four-column grid. */
export const MOSAIC_SPANS: Readonly<
  Record<
    Exclude<MosaicTile, 'single'>,
    readonly [columns: number, rows: number]
  >
> = {
  large: [3, 2],
  block: [2, 2],
  tall: [1, 2],
  wide: [2, 1],
  small: [1, 1],
};

// Runs of tiles that each fill whole rows, placed in the pictures' order.
const OPENING: readonly MosaicTile[] = ['large', 'small', 'small'];
const PAIR: readonly MosaicTile[] = ['wide', 'wide'];
const TRIO: readonly MosaicTile[] = ['wide', 'small', 'small'];
const TOWERS: readonly MosaicTile[] = ['tall', 'tall', 'block'];
const BLOCK: readonly MosaicTile[] = ['block', 'wide', 'small', 'small'];
const BLOCK_TURNED: readonly MosaicTile[] = ['wide', 'block', 'small', 'small'];

/**
 * The tiles for `count` pictures, the first always the largest. Designed per
 * count so every row is full, the set never ends on a stray tile, small tiles
 * never gather into a square of four, and a block alternates sides down the
 * page.
 */
const MOSAICS: readonly (readonly MosaicTile[])[] = [
  [],
  ['single'],
  ['large', 'tall'],
  OPENING,
  BLOCK,
  [...OPENING, ...PAIR],
  [...OPENING, ...TOWERS],
  [...OPENING, ...BLOCK_TURNED],
  [...OPENING, ...TOWERS, ...PAIR],
  [...OPENING, ...TOWERS, ...TRIO],
  [...OPENING, ...BLOCK_TURNED, ...TRIO],
  [...OPENING, ...TOWERS, ...TRIO, ...PAIR],
  [...OPENING, ...TOWERS, ...BLOCK, ...PAIR],
];

export function mosaicTiles(count: number): MosaicTile[] {
  const designed = MOSAICS[Math.min(count, MOSAICS.length - 1)];
  // The reader caps a gallery at twelve; past that a picture takes a small tile.
  return Array.from(
    { length: count },
    (_, index) => designed[index] ?? 'small'
  );
}

/**
 * Columns in the wide `grid`: as many as divide the set evenly, at most four,
 * and never four pictures in a row of four (two by two reads as a set). A
 * short last row is centred.
 */
export function gridColumns(count: number): 1 | 2 | 3 | 4 {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  if (count === 3 || count === 5 || count === 6 || count === 9) return 3;
  return 4;
}

/** The strip alternates a landscape and a portrait picture, starting wide. */
export function stripShape(index: number): 'wide' | 'tall' {
  return index % 2 === 0 ? 'wide' : 'tall';
}

const LARGE_TILES: ReadonlySet<MosaicTile> = new Set([
  'single',
  'large',
  'block',
  'wide',
]);

/**
 * `md` is 400px wide, narrower than a large tile on a desktop, so a picture
 * drawn wider than that takes `lg` (800px); every other picture keeps `md`
 * (03 §10's default).
 */
export function pictureVariant(
  layout: string,
  index: number,
  count: number
): PageImageVariant {
  if (layout === 'strip') return stripShape(index) === 'wide' ? 'lg' : 'md';
  if (layout === 'grid') return gridColumns(count) <= 2 ? 'lg' : 'md';
  return LARGE_TILES.has(mosaicTiles(count)[index]) ? 'lg' : 'md';
}

/** A mosaic tile's share of the column on four columns (from 48rem). */
const MOSAIC_WIDE_SHARE: Readonly<Record<MosaicTile, number>> = {
  single: 1,
  large: 0.75,
  block: 0.5,
  wide: 0.5,
  tall: 0.25,
  small: 0.25,
};

/**
 * How wide a picture's tile is drawn, as `sizes`, so it fetches from its
 * srcset the file its tile needs (Codex-61zsk.66). It follows the same
 * shapes as {@link pictureVariant}:
 * - a strip picture is a fixed height (`clamp(13rem, 8rem + 16cqi, 26rem)`)
 *   at 3:2 or 4:5;
 * - a grid divides the column by its row count from 60rem (Clean: three at
 *   most, a set of six in pairs), in two from 36rem;
 * - a mosaic tile spans its share of four columns from a 48rem column, and on
 *   two columns the first picture, and an even count's last, span both.
 * Each width is the column's at most (`columnSize`), never less than a Style
 * draws.
 */
export function pictureSizes(
  layout: string,
  index: number,
  count: number,
  style?: string
): string {
  if (layout === 'strip') {
    return stripShape(index) === 'wide'
      ? 'clamp(19.5rem, calc(12rem + 24vw), 39rem)'
      : 'clamp(10.4rem, calc(6.4rem + 12.8vw), 20.8rem)';
  }
  if (layout === 'grid') {
    if (count <= 1) return columnSize();
    // Clean hangs no more than three to a row, and a set of six in pairs.
    const columns = Math.max(gridColumns(count), 2);
    const wide =
      style === 'clean' ? (count === 6 ? 2 : Math.min(columns, 3)) : columns;
    return `(min-width: 60rem) ${columnSize(1 / wide)}, (min-width: 36rem) ${columnSize(0.5)}, ${columnSize()}`;
  }
  const tile = mosaicTiles(count)[index];
  if (!tile || tile === 'single') return columnSize();
  const spansBoth = index === 0 || (index === count - 1 && count % 2 === 0);
  return `(min-width: 53rem) ${columnSize(MOSAIC_WIDE_SHARE[tile])}, ${spansBoth ? columnSize() : columnSize(0.5)}`;
}
