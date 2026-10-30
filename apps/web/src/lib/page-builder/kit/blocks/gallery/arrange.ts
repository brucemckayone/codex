/**
 * How the gallery arranges its pictures (03-expressive-contract §3, §7). Pure,
 * so every arrangement is tested at every count it can meet (1–12).
 */
import { clampedSizes } from '$lib/utils/image';
import {
  columnSizes,
  type PageImageVariant,
  readSize,
  resolvePageImageUrl,
} from '../../../page-images';

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
  /** What the lightbox shows (`fullPicture`); none without a CDN base. */
  full?: { url: string; w?: number; h?: number };
}

/** A tile's press: which picture, counted from 0, and the tile focus returns to. */
export type OpenPicture = (index: number, from: HTMLElement) => void;

/**
 * The picture the lightbox shows: the largest file its reference has, `xl`
 * (1600w) where it records its size, else `lg` (800w, `resolvePageImageUrl`),
 * with that size so the frame knows its shape before the file arrives.
 */
export function fullPicture(
  ref: unknown,
  cdnBase: string | null | undefined
): Picture['full'] {
  const url = resolvePageImageUrl(ref, 'xl', cdnBase);
  if (!url) return undefined;
  const size = readSize(ref);
  return size ? { url, w: size.w, h: size.h } : { url };
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

const CAPTION_OVER: ReadonlySet<MosaicTile> = new Set([
  'single',
  'large',
  'wide',
]);

/**
 * Where a mosaic tile's caption sits. Only the broad tiles have the room to
 * carry words on the picture's foot; a square, tall or small one has its
 * caption beneath, as the grid's and the strip's are. On a phone every tile
 * but the first drops its caption from view (`GalleryMosaic`), and the
 * lightbox shows it.
 */
export function mosaicCaption(tile: MosaicTile): 'over' | 'under' {
  return CAPTION_OVER.has(tile) ? 'over' : 'under';
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

/** How many grid pictures share a row from 60rem. */
function gridRow(count: number, style?: string): number {
  const columns = Math.max(gridColumns(count), 2);
  if (style !== 'clean') return columns;
  // Clean hangs no more than three to a row, and a set of six in pairs.
  if (count === 6) return 2;
  return Math.min(columns, 3);
}

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
 * Each width is the column's at most (`columnSizes`), never less than a Style
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
      ? clampedSizes(19.5, { rem: 12, vw: 24 }, 39)
      : clampedSizes(10.4, { rem: 6.4, vw: 12.8 }, 20.8);
  }
  if (layout === 'grid') {
    if (count <= 1) return columnSizes();
    return columnSizes(1, [
      [60, 1 / gridRow(count, style)],
      [36, 0.5],
    ]);
  }
  const tile = mosaicTiles(count)[index];
  if (!tile || tile === 'single') return columnSizes();
  const spansBoth = index === 0 || (index === count - 1 && count % 2 === 0);
  return columnSizes(spansBoth ? 1 : 0.5, [[53, MOSAIC_WIDE_SHARE[tile]]]);
}
