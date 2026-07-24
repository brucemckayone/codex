/**
 * Safe prop coercion for the public journey renderer (Codex-2pryk.3.1 · WP-3).
 *
 * `PageSection.props` is a frozen `Record<string, unknown>` config bag — the
 * renderer must NEVER trust its shape (it is org-authored data that round-trips
 * through jsonb). These pure guards pull typed, defaulted values out of it so a
 * malformed/absent field degrades to a fallback rather than throwing during SSR.
 *
 * INERT: no imports, no DOM — safe under the CE-4 PUBLIC_LIB_ROOT boundary.
 */
import type { SectionProps } from '$lib/page-builder';

/** A non-empty trimmed string, or undefined. */
export function asString(props: SectionProps, key: string): string | undefined {
  const value = props[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** An array of non-empty strings (drops non-string / blank entries), or undefined. */
export function asStringArray(
  props: SectionProps,
  key: string
): string[] | undefined {
  const value = props[key];
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * An array of plain objects, each mapped through `map` and kept only when the
 * mapper returns a non-null value. Returns undefined when nothing survives, so
 * callers can `{#if items}` guard. Used for FAQ entries, offers, inclusions.
 */
export function asObjectArray<T>(
  props: SectionProps,
  key: string,
  map: (entry: Record<string, unknown>) => T | null
): T[] | undefined {
  const value = props[key];
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const mapped = map(entry as Record<string, unknown>);
    if (mapped !== null) out.push(mapped);
  }
  return out.length > 0 ? out : undefined;
}

/** A boolean prop with an explicit default (non-boolean values fall back). */
export function asBool(
  props: SectionProps,
  key: string,
  fallback = false
): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** Field-level string reader for the object-array mappers above. */
export function fieldString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Field-level boolean reader for the object-array mappers above. */
export function fieldBool(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === true;
}
