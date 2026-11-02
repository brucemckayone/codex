/**
 * A credential that leads with a figure (Codex-61zsk.73): "20 years
 * teaching", "4,000+ students", "98% finish the course", "£12 a class". The
 * guide's ledger sets the figure on its own line and the words under it.
 *
 * The figure is a whole number (grouped in threes by commas, or not at all),
 * perhaps with decimals, with a leading `£` or a trailing `+` or `%`; a space
 * and words follow it, starting with a letter. A bare year from 1900 to 2099
 * is a date, not a figure ("2019 Yoga Alliance graduate"), and so stays as
 * words, as does a number alone ("500") or with letters on it ("1st in her
 * class").
 *
 * Not the stats block's `parseFigure` (`motion/count-up.ts`): that one takes
 * any signs before the number and any words after it with no space, and
 * reads "£2000" and "1900+" as years, because a stat's figure stands alone.
 */

export interface CredentialFigure {
  figure: string;
  words: string;
}

const LEADS =
  /^(£?(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d+)?[+%]?)\s+(\p{L}.*)$/su;

const YEAR = /^(?:19|20)\d\d$/;

export function credentialFigure(text: string): CredentialFigure | null {
  const match = LEADS.exec(text);
  if (!match) return null;
  const [, figure, words] = match;
  if (YEAR.test(figure)) return null;
  return { figure, words };
}
