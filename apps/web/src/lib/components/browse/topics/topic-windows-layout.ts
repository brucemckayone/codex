/**
 * Where each Shader windows plate sits (`TopicWindows.svelte`), as plain data,
 * so the component's CSS only maps attributes to spans.
 *
 * DESKTOP (sm and up) is a bento on a TWELVE-column track, whose lead topic
 * spans half the width and two rows (the "2x2" of a four-column look). Every
 * row is filled edge to edge, and NO plate sits alone on a row: a bento with
 * holes reads as unfinished, and a lone plate stretched across the width crops
 * its photo to a strip (owner, 2026-11-24: "re-flow the bento"). So:
 *   - the plates beside the lead share its half-width block (1 to 4 of them);
 *   - the rest go in equal rows of 2 to 4 (12 divides by all three);
 *   - at 6 topics the four-beside rule would leave the 6th alone, so the lead
 *     takes two wide plates beside it and the other three make a row.
 * Rows are sized from a quarter of the width whatever the track, so the heights
 * are the four-column ones.
 *
 * PHONE (below sm) is two columns, the lead full width. It shows the first
 * `PHONE_CAP` topics and a "Show all N" tile until that is pressed. The active
 * topic always shows, so the plate the grid is filtered by never hides. A plate
 * or tile left alone in the last row spans both columns.
 */

import { coverCropSizes } from '$lib/utils/image';

/** Topics a phone shows before "Show all N". */
export const PHONE_CAP = 6;

/** A desktop row's height over a column's width: the CSS `--_ratio` at lg (16:10). */
const DESKTOP_RATIO = 0.625;

export interface PlateLayout {
  /** Columns spanned at sm and up, of twelve. */
  cols: 3 | 4 | 6 | 12;
  /** Rows spanned at sm and up. */
  rows: 1 | 2;
  /** Spans both phone columns. */
  phoneWide: boolean;
  /** Hidden on a phone: beyond the cap while the list is collapsed. */
  overflow: boolean;
}

export interface WindowsLayout {
  plates: PlateLayout[];
  /** The phone's Show all / Show fewer tile; `null` when every topic shows. */
  toggle: { wide: boolean } | null;
}

type Span = Pick<PlateLayout, 'cols' | 'rows'>;

const QUARTER: Span = { cols: 3, rows: 1 };
const HALF: Span = { cols: 6, rows: 1 };

/** The plates beside the lead share its half-width block: their spans, by how many. */
const BESIDE_LEAD: Span[][] = [
  [],
  [{ cols: 6, rows: 2 }],
  [HALF, HALF],
  [QUARTER, QUARTER, HALF],
  [QUARTER, QUARTER, QUARTER, QUARTER],
];

/**
 * A row of 1 to 4 plates: each one's share of the twelve columns. A row of one
 * is the strip the layout avoids (`desktopSpans`), named so a slip shows up as
 * one rather than as a missing span.
 */
const ROW_COLS = { 1: 12, 2: 6, 3: 4, 4: 3 } as const;

/**
 * `rest` plates in as few rows of at most four as fit, as even as they go, so
 * no row of two or more plates holds one: 5 is 3 + 2, 9 is 3 + 3 + 3.
 */
function rowsBelow(rest: number): Span[] {
  if (rest === 0) return [];
  const rows = Math.ceil(rest / 4);
  const base = Math.floor(rest / rows);
  const longer = rest % rows;
  return Array.from({ length: rows }, (_, row) => {
    const size = (row < longer ? base + 1 : base) as 1 | 2 | 3 | 4;
    return Array.from(
      { length: size },
      (): Span => ({ cols: ROW_COLS[size], rows: 1 })
    );
  }).flat();
}

/** Every plate's spans on the twelve-column desktop grid, in order. */
function desktopSpans(count: number): Span[] {
  if (count === 0) return [];
  const lead: Span = { cols: count === 1 ? 12 : 6, rows: 2 };
  // Four beside the lead unless that would leave a single plate below it.
  const besideCount = count === 6 ? 2 : Math.min(count - 1, 4);
  const beside = BESIDE_LEAD[besideCount] ?? [];
  return [lead, ...beside, ...rowsBelow(count - 1 - besideCount)];
}

/**
 * The layout of `count` plates.
 *
 * @param activeIndex - The active topic's index, or -1 for none.
 * @param expanded - The phone's "Show all N" is pressed.
 */
export function layoutWindows(
  count: number,
  activeIndex: number,
  expanded: boolean
): WindowsLayout {
  // A tile in place of a single plate would hide nothing: cap only when it
  // hides two or more.
  const capped = count > PHONE_CAP + 1;
  const plates: PlateLayout[] = desktopSpans(count).map((span, index) => ({
    ...span,
    phoneWide: index === 0,
    overflow:
      capped && !expanded && index >= PHONE_CAP && index !== activeIndex,
  }));

  // The phone's half-width cells: every shown plate but the lead, and the tile.
  const shown = plates.filter((plate) => !plate.overflow);
  const halves = shown.length - 1 + (capped ? 1 : 0);
  const lastAlone = halves % 2 === 1;
  // Odd halves means at least one beside the lead, so `last` is not the lead.
  const last = shown.at(-1);
  if (lastAlone && !capped && last) last.phoneWide = true;
  return {
    plates,
    toggle: capped ? { wide: lastAlone } : null,
  };
}

/**
 * A cover photo's `sizes`: its twelfths of the content width on desktop (which
 * tops out at `--container-max`, 80rem), half or all of a phone's. A photo
 * wider than its plate is cover-cropped, so drawn wider than the plate. A row
 * is a quarter-column high, so a plate's aspect is its quarters over its rows.
 */
export function photoSizes(plate: PlateLayout, url: string): string {
  const phone = plate.phoneWide ? 100 : 50;
  const share = plate.cols / 12;
  const slots = `(min-width: 80rem) ${Math.round(80 * share)}rem, (min-width: 40rem) ${Math.round(100 * share)}vw, ${phone}vw`;
  return coverCropSizes(
    slots,
    plate.cols / 3 / (plate.rows * DESKTOP_RATIO),
    url
  );
}

/**
 * The ghost initial of a coverless plate: the name's first character,
 * upper-cased. Whole code points, so a name opening on an astral character
 * does not leave half a surrogate pair. Empty for a blank name.
 */
export function initialOf(name: string): string {
  const [first = ''] = name.trim();
  return first.toLocaleUpperCase();
}
