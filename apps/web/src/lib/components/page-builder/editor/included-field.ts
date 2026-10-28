/**
 * The pure half of the pricing section's "What's included" control
 * (Codex-61zsk.73): the rows as the inspector edits them, and what typing
 * into one writes. The stored shape is the pricing block's
 * (`blocks/pricing/included.ts`); the one difference is that a line still
 * being written is kept here, as `ListField` keeps one, where the block
 * skips it.
 */
import {
  INCLUDED_FACTS,
  type IncludedRow,
} from '$lib/page-builder/kit/blocks/pricing/included';
import { compact, readOneOf } from '$lib/page-builder/kit/model/read';
import { readEntries } from './field-values';

/** Where a row's words come from, as its tag says: Live, Rewritten, Your line. */
export type IncludedKind = 'live' | 'rewritten' | 'own';

export function kindOf(row: IncludedRow): IncludedKind {
  if (!row.fact) return 'own';
  return row.text === undefined ? 'live' : 'rewritten';
}

/**
 * The stored rows, unfinished lines kept, or null when none are stored (the
 * page draws the course's own lines). A row that names no known fact and has
 * no words is not a row.
 */
export function editableRows(value: unknown): IncludedRow[] | null {
  if (!Array.isArray(value)) return null;
  return readEntries(value).flatMap((entry) => {
    const fact = readOneOf(entry, 'fact', INCLUDED_FACTS);
    const text = typeof entry.text === 'string' ? entry.text : undefined;
    return fact || text !== undefined ? [compact({ fact, text })] : [];
  });
}

/**
 * A line is one line: its field wraps to show it whole, but a break pasted
 * into it is a space, as the page would draw it.
 */
export function oneLine(text: string): string {
  return text.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ');
}

/**
 * A row as typed into. A fact's own line typed back makes it live again, so
 * a creator who undoes a rewrite by hand gets the counting line back.
 */
export function retyped(
  row: IncludedRow,
  text: string,
  live: string | null
): IncludedRow {
  if (!row.fact) return { text };
  return text === live ? { fact: row.fact } : { fact: row.fact, text };
}
