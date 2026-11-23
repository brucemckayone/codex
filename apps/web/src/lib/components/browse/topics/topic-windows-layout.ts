/**
 * Where each Shader windows plate sits (`TopicWindows.svelte`), as plain data,
 * so the component's CSS only maps attributes to spans.
 *
 * DESKTOP (sm and up) is a four-column bento whose lead topic spans 2x2. Every
 * row is filled edge to edge: the plates beside the lead share its 2x2 block
 * between them, and a short last row widens its plates to the full width. A
 * bento with holes in it reads as unfinished.
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
  /** Columns spanned at sm and up, of four. */
  cols: 1 | 2 | 4;
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

const ONE: Span = { cols: 1, rows: 1 };
const WIDE: Span = { cols: 2, rows: 1 };

/** The plates beside the lead share its 2x2 block: their spans, by how many. */
const BESIDE_LEAD: Span[][] = [
  [],
  [{ cols: 2, rows: 2 }],
  [WIDE, WIDE],
  [ONE, ONE, WIDE],
  [ONE, ONE, ONE, ONE],
];

/** A short last row of the rows of four below: its spans, by its length. */
const SHORT_ROW: Span[][] = [
  [],
  [{ cols: 4, rows: 1 }],
  [WIDE, WIDE],
  [ONE, ONE, WIDE],
];

/** Every plate's spans on the four-column desktop grid, in order. */
function desktopSpans(count: number): Span[] {
  if (count === 0) return [];
  const lead: Span = { cols: count === 1 ? 4 : 2, rows: 2 };
  const beside = BESIDE_LEAD[Math.min(count - 1, 4)] ?? [];
  const below = Math.max(count - 5, 0);
  const short = below % 4;
  const full: Span[] = Array.from({ length: below - short }, () => ONE);
  return [lead, ...beside, ...full, ...(SHORT_ROW[short] ?? [])];
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
 * A cover photo's `sizes`: a quarter of the content width per desktop column
 * (it tops out at `--container-max`, 80rem), half or all of a phone's. A photo
 * wider than its plate is cover-cropped, so drawn wider than the plate.
 */
export function photoSizes(plate: PlateLayout, url: string): string {
  const phone = plate.phoneWide ? 100 : 50;
  const slots = `(min-width: 80rem) ${20 * plate.cols}rem, (min-width: 40rem) ${25 * plate.cols}vw, ${phone}vw`;
  return coverCropSizes(slots, plate.cols / (plate.rows * DESKTOP_RATIO), url);
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
