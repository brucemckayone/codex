/**
 * A benefit's figure (Codex-61zsk.73): a short number the creator types in
 * place of its mark, "24", "£12", "98%", that the name reads on from ("24
 * practices to keep").
 *
 * Kept only whole: at most `FIGURE_MAX` characters with a digit in it. Cut
 * to length it would say another number ("1,000" as "1,00"), and with no
 * digit it is a word, which the name already is.
 */
import { runWeight } from '../../model/faces';

/** The most characters a figure has: as many as the inspector's field takes. */
export const FIGURE_MAX = 4;

export function readFigure(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const figure = value.trim();
  return figure.length <= FIGURE_MAX && /[0-9]/.test(figure)
    ? figure
    : undefined;
}

/** Signs a figure's face draws as wide as a digit (its tabular width). */
const DIGIT_WIDE = /^[0-9£$€+]$/u;
const ZERO = runWeight('0');

/**
 * How wide a figure is drawn, in its face's `0`s, rounded up: the
 * checklist's column for its widest. Its digits are tabular, each
 * a `0`; any other glyph is weighed as a heading's are (`model/faces.ts`),
 * one the table does not know as its widest letter, so "98%" is reckoned a
 * little wide, never narrow.
 */
export function figureZeros(figure: string): number {
  let zeros = 0;
  for (const glyph of figure) {
    zeros += DIGIT_WIDE.test(glyph) ? 1 : runWeight(glyph) / ZERO;
  }
  return Math.ceil(zeros * 100) / 100;
}
