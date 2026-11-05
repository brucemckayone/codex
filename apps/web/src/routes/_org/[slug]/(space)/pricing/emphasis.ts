/**
 * A message with some of its values in bold, without putting markup in the
 * message: "You keep **Pro** until **12 November**; nothing is charged
 * today." (the change-plan dialog, Codex-2hxff.16).
 *
 * The message renders with each emphasised value wrapped in a private-use
 * marker, then splits on the marker. A translation may put the values in any
 * order, and a value is never parsed as markup, so a plan named `<b>` stays
 * text.
 */

const MARK = '\u{E000}';

export interface MessagePart {
  text: string;
  strong: boolean;
}

export function emphasise<P extends Record<string, string>>(
  message: (params: P) => string,
  params: P,
  strong: readonly (keyof P)[]
): MessagePart[] {
  const marked: Record<string, string> = { ...params };
  for (const key of strong) {
    const value = String(params[key]).replaceAll(MARK, '');
    marked[key as string] = `${MARK}${value}${MARK}`;
  }
  return message(marked as P)
    .split(MARK)
    .map((text, i) => ({ text, strong: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
