/**
 * When a heading drawn at display size is too long to stay one statement.
 *
 * Past this many characters a display heading runs beyond about four lines
 * at its block's measure and becomes a wall of type. The blocks that draw
 * one — the hero's headline, the problem's statement — mark it `data-long`,
 * and the block's layout or a Style steps its size down through
 * `--lp-display-scale`. One line for both, so "long" means the same thing
 * everywhere in the kit.
 */
const LONG_HEADING_CHARS = 64;

export function isLongHeading(text: string | undefined): boolean {
  return (text?.length ?? 0) > LONG_HEADING_CHARS;
}
