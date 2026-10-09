/**
 * The bento's arrangement (03 §3): which tile each item takes, by how many
 * there are. The wide bento is six columns; every count from one to nine is
 * designed so each row is full, the first item's tile is the largest, and a
 * two-row block turns to the other side from the one above it
 * (`bento.test.ts` packs each one).
 */

/**
 * A bento tile, as columns × rows of the six-column grid: `lead` 4×2, `side`
 * 2×2, `wide` 4×1, `half` 3×1, `small` 2×1. `whole` is a lone item across
 * the width.
 */
export type BentoTile = 'whole' | 'lead' | 'side' | 'wide' | 'half' | 'small';

export const BENTO_SPANS: Readonly<
  Record<BentoTile, readonly [columns: number, rows: number]>
> = {
  whole: [6, 2],
  lead: [4, 2],
  side: [2, 2],
  wide: [4, 1],
  half: [3, 1],
  small: [2, 1],
};

// Runs of tiles that each fill whole rows, placed in the items' order.
const OPENING_PAIR: readonly BentoTile[] = ['lead', 'side'];
const OPENING: readonly BentoTile[] = ['lead', 'small', 'small'];
const HALVES: readonly BentoTile[] = ['half', 'half'];
const THIRDS: readonly BentoTile[] = ['small', 'small', 'small'];
const BLOCK_TURNED: readonly BentoTile[] = ['small', 'small', 'side', 'wide'];

const BENTOS: readonly (readonly BentoTile[])[] = [
  [],
  ['whole'],
  OPENING_PAIR,
  OPENING,
  [...OPENING_PAIR, ...HALVES],
  [...OPENING, ...HALVES],
  [...OPENING, ...THIRDS],
  [...OPENING, ...BLOCK_TURNED],
  [...OPENING, ...THIRDS, ...HALVES],
  [...OPENING, ...BLOCK_TURNED, ...HALVES],
];

export function bentoTiles(count: number): BentoTile[] {
  const designed = BENTOS[Math.min(count, BENTOS.length - 1)];
  // The reader caps the list at nine; past that an item takes a small tile.
  return Array.from(
    { length: count },
    (_, index) => designed[index] ?? 'small'
  );
}
