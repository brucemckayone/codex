import { runWeight } from './faces';

/**
 * How long a heading drawn at display size is, in the kit's three tiers.
 *
 *   short  — up to 24 characters: a promise the largest display holds in
 *            every layout, whatever the face
 *   medium — 25–64: past what the narrowest measures hold at full size
 *            (a cover's column, a split's, the words beside a poster's
 *            picture), so a Style may step it down a little
 *   long   — over 64: beyond about four lines at its block's measure, a
 *            wall of type in any layout
 *
 * The blocks that draw one mark it. The hero's headline marks both tiers
 * (`data-medium`, `data-long`); the problem's statement marks only
 * `data-long`. The block's layout or a Style then steps the size down
 * through `--lp-display-scale`. One module for both, so the tiers mean the
 * same thing everywhere in the kit. The medium line is
 * measured: the longest headline Bold's cover holds above a 1440 × 900 fold
 * at full size in Archivo Black, the widest face in the gallery.
 */
const MEDIUM_HEADING_CHARS = 24;
const LONG_HEADING_CHARS = 64;

export function headingLength(
  text: string | undefined
): 'short' | 'medium' | 'long' {
  const chars = text?.length ?? 0;
  if (chars > LONG_HEADING_CHARS) return 'long';
  return chars > MEDIUM_HEADING_CHARS ? 'medium' : 'short';
}

export function isLongHeading(text: string | undefined): boolean {
  return headingLength(text) === 'long';
}

/** A run's width in units of an average lowercase letter, and its length. */
export interface RunSize {
  /** Drawn in capitals. */
  caps: number;
  /** Drawn as written. */
  text: number;
  /** Characters as drawn, each spaced by the Style's tracking. */
  chars: number;
}

export interface HeadingRuns {
  /** The heading's first run, which always opens the first line. */
  first: RunSize;
  /**
   * Its widest run after that, which may fall beside the picture: the widest
   * in each case, with the length of the widest as written.
   */
  widest: RunSize;
}

const NO_RUN: RunSize = { caps: 0, text: 0, chars: 0 };

const round = (weight: number) => Math.round(weight * 1000) / 1000;

function sizeOf(run: string): RunSize {
  return {
    caps: round(runWeight(run.toUpperCase())),
    text: round(runWeight(run)),
    chars: Array.from(run).length,
  };
}

/**
 * The runs a heading cannot break: between two places the browser may break
 * it, a space or just after a hyphen, a dash or a slash, the mark kept with
 * the run before it. Beside a poster's picture the widest of them, not the
 * heading's length, sets how large it can be (Codex-61zsk.33): a run wider
 * than its measure is cut mid-word. The first is apart, because it always
 * opens the first line, which runs above the picture at the column's width.
 */
export function headingRuns(text: string | undefined): HeadingRuns {
  const runs = (text ?? '')
    .split(/\s+/)
    .flatMap((word) => word.split(/(?<=[-‐–—/])/))
    .filter((run) => run.length > 0)
    .map(sizeOf);
  const [first = NO_RUN, ...rest] = runs;
  return { first, widest: rest.reduce(max, NO_RUN) };
}

/** The wider of two runs in each case, with the length of the wider as written. */
function max(a: RunSize, b: RunSize): RunSize {
  return {
    caps: Math.max(a.caps, b.caps),
    text: Math.max(a.text, b.text),
    chars: b.text > a.text ? b.chars : a.chars,
  };
}
