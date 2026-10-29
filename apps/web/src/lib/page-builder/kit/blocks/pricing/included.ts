/**
 * "What's included" (Codex-61zsk.73, contract A7): the lines a single way in
 * stands beside. They say what the course holds, where the card used to fill
 * itself with three ways of saying "yours to keep".
 *
 * The course's own lines are counted from its curriculum (`courseFacts`), so
 * they stay live: add a practice and "24 practices" counts it. The creator
 * may reword any of them, add their own, reorder, delete or switch the list
 * off, and the section's `included` prop says which:
 *
 *   absent           the course's own lines, all live
 *   `[]`             no list: the card stands alone
 *   `{ fact }`       that line, live
 *   `{ fact, text }` the creator's words for that fact, which stop counting
 *   `{ text }`       the creator's own line ("Printable workbook")
 *
 * A live line with nothing true to say is left out, never guessed: no length
 * unless every video and audio practice has one (readings are not timed, and
 * the line says what was), and nothing at all for a course with no practices
 * yet ("3 stages" with nothing in them oversells).
 *
 * Every layout draws it beside a single way in, each in its own form: beside
 * the lone card in `cards`, under the card in `focus`, and along the strip in
 * `band`. Beside two or more, the list's first lines are the one-off's own
 * points instead (`ownedPoints`), so its card says what a buyer would own.
 */
import type { OfferPath } from '../../../offer-paths';
import { COPY } from '../../model/copy';
import type { CourseFacts } from '../../model/facts';
import { compact, readItems, readOneOf, readText } from '../../model/read';
import { PRICING_COPY } from './copy';

export const INCLUDED_FACTS = ['stages', 'practices', 'length', 'mix'] as const;
export type IncludedFact = (typeof INCLUDED_FACTS)[number];

/** One stored line: a fact, the creator's words, or both (see above). */
export interface IncludedRow {
  fact?: IncludedFact;
  text?: string;
}

/** The most lines a list holds, and the longest one line may be. */
export const INCLUDED_MAX = 8;
export const INCLUDED_LINE_MAX = 80;

/**
 * Whether the block draws the list beside `paths` ways in: only beside one,
 * the one way in the list describes. The block and the inspector both ask
 * here, so the inspector's note can never disagree with the canvas.
 */
export function drawsIncluded(paths: number): boolean {
  return paths === 1;
}

/** How many of the lines a one-off's card carries beside other cards. */
export const OWNED_POINTS_MAX = 3;

/**
 * A path as its card draws it among `paths` ways in. Beside other cards the
 * one-off has no points of its own (offer-paths.ts derives none, so it stops
 * repeating its billing line), and the memberships beside it list theirs:
 * its card takes the first of the course's lines (`lines`, the same reading
 * as the list, so `[]` gives none), which is what a buyer would own. Points
 * the creator wrote for it stay theirs. Alone, a card gets none: the list
 * stands beside it. The checkout's own cards are not drawn through here.
 */
export function ownedPoints(
  path: OfferPath,
  lines: readonly string[],
  paths: number
): OfferPath {
  if (drawsIncluded(paths) || path.kind !== 'purchase') return path;
  if (path.bullets.length > 0) return path;
  return { ...path, bullets: lines.slice(0, OWNED_POINTS_MAX) };
}

/** What the course says for `fact`, or null when it has nothing true to say. */
export function factLine(
  fact: IncludedFact,
  facts: CourseFacts
): string | null {
  if (facts.practices === 0) return null;
  switch (fact) {
    case 'stages':
      return COPY.course.stages(facts.stages);
    case 'practices':
      return COPY.course.practices(facts.practices);
    case 'length':
      return facts.seconds === null
        ? null
        : PRICING_COPY.length(facts.seconds, facts.kinds);
    case 'mix':
      return PRICING_COPY.mix(facts.kinds);
  }
}

/** The course's own lines as live rows: every fact with something to say. */
export function courseRows(facts: CourseFacts): IncludedRow[] {
  return INCLUDED_FACTS.filter((fact) => factLine(fact, facts) !== null).map(
    (fact) => ({ fact })
  );
}

/** The lines a visitor reads, in the creator's order. */
export function includedLines(
  rows: readonly IncludedRow[] | undefined,
  facts: CourseFacts
): string[] {
  const lines: string[] = [];
  for (const row of rows ?? courseRows(facts)) {
    const line = row.text ?? (row.fact ? factLine(row.fact, facts) : null);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * The stored rows, read as `readItems` reads a list but for one thing: an
 * empty list is kept, because `[]` is the creator switching the list off,
 * not an absent key. A row names a known fact, has words, or both; anything
 * else is dropped, and a fact is drawn once, by the first row naming it.
 */
export function readIncluded(
  raw: Record<string, unknown>
): IncludedRow[] | undefined {
  if (!Array.isArray(raw.included)) return undefined;
  const named = new Set<IncludedFact>();
  return (
    readItems(
      raw,
      'included',
      (entry) => {
        const fact = readOneOf(entry, 'fact', INCLUDED_FACTS);
        const text = readText(entry, 'text', INCLUDED_LINE_MAX);
        if (!fact && !text) return null;
        if (fact && named.has(fact)) return null;
        if (fact) named.add(fact);
        return compact({ fact, text });
      },
      INCLUDED_MAX
    ) ?? []
  );
}
