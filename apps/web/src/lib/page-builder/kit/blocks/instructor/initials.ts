/**
 * The guide's initials, for the medallion that holds a missing portrait's
 * place: the first letter of the first word of the name and of the last, in
 * capitals — "Maya Linden" is "ML", "Maya" is "M". Empty when the name has no
 * letter at all; there is then no medallion.
 */
const LETTER = /\p{L}/u;

export function initials(name: string | undefined): string {
  const letters = (name ?? '')
    .split(/\s+/)
    .map((word) => Array.from(word).find((char) => LETTER.test(char)))
    .filter((letter): letter is string => letter !== undefined);
  if (letters.length === 0) return '';
  const ends = letters.length > 1 ? [letters[0], letters.at(-1)] : [letters[0]];
  return ends.join('').toLocaleUpperCase();
}
