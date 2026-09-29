/**
 * Pure helpers behind the inspector's field controls: list arithmetic and the
 * readings a control needs from a raw, creator-authored props bag.
 */
import type { BlockField } from '$lib/page-builder/kit';

/** `list` with the entry at `from` moved to `to` (both in bounds). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Deep equality in the JSON sense (key order and `undefined` keys ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const bag = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(bag)
        .filter((key) => bag[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(bag[key])])
    );
  }
  return value;
}

/** An `items` field's entries as objects; anything else in the array is skipped. */
export function readEntries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  );
}

/**
 * What a collapsed item row is called: its first filled text field (a
 * benefit's title, a quote, a question), else nothing — the caller falls back
 * to "Item 3".
 */
export function entryTitle(
  entry: Record<string, unknown>,
  fields: readonly BlockField[]
): string | null {
  for (const field of fields) {
    if (field.control !== 'text' && field.control !== 'textarea') continue;
    const text = entry[field.key];
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return null;
}

/** An item field's fields, minus any hidden for the section's layout. */
export function fieldsForLayout(
  fields: readonly BlockField[],
  layout: string
): BlockField[] {
  return fields.filter(
    (field) => !field.layouts || field.layouts.includes(layout)
  );
}
