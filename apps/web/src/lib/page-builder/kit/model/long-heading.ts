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
