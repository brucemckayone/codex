/**
 * Tolerant readers for creator-authored section props.
 *
 * `landing_pages.sections[].props` is org-authored jsonb, so nothing about its
 * shape is trusted: a wrong type reads as ABSENT, never as a crash and never as
 * a coerced guess. Every `definition.coerce` is built from these.
 */

type Raw = Record<string, unknown>;

/** A trimmed, non-empty string, capped at `max` characters. */
export function readText(
  raw: Raw,
  key: string,
  max?: number
): string | undefined {
  const value = raw[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return max ? trimmed.slice(0, max) : trimmed;
}

/** Non-empty trimmed strings; absent when none survive. */
export function readTextList(
  raw: Raw,
  key: string,
  maxItems?: number
): string[] | undefined {
  const value = raw[key];
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const capped = maxItems ? out.slice(0, maxItems) : out;
  return capped.length > 0 ? capped : undefined;
}

/** Object entries mapped through `map`; an entry `map` rejects is dropped. */
export function readItems<T>(
  raw: Raw,
  key: string,
  map: (entry: Raw) => T | null,
  maxItems?: number
): T[] | undefined {
  const value = raw[key];
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const mapped = map(entry as Raw);
    if (mapped !== null) out.push(mapped);
    if (maxItems && out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

export function readBool(raw: Raw, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readOneOf<T extends string>(
  raw: Raw,
  key: string,
  values: readonly T[]
): T | undefined {
  const value = raw[key];
  return typeof value === 'string' &&
    (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Drops `undefined` values so a coerced object carries only authored keys. */
export function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

/** Plain text → paragraphs: a blank line starts a new one. */
export function paragraphs(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
