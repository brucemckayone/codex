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

/**
 * BUILDER-SHAPE BRIDGE (Codex-2pryk.3.x · flat→array normalisation).
 *
 * The page builder + `section-catalog` `defaultProps` author sections as FLAT,
 * numbered keys (`{kicker, heading, body}`, `{q1, a1, q2, a2, …}`), while the
 * public sections below read the richer array shapes (`beats[]`, `items[]`,
 * `testimonials[]`). Nothing ever reconciled the two contracts, so a creator
 * could fill a section in the builder, publish, and watch it vanish from the
 * public page (the array was never written → the section self-hid).
 *
 * These three readers close that gap at the READ boundary: the array shape still
 * wins when present, and the flat keys are the fallback. No migration, no change
 * to the sections' own prop contracts, and existing pages start rendering on the
 * next load.
 */

/** First non-empty string among `keys`, in preference order. */
export function asStringFrom(
  props: SectionProps,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = asString(props, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Every non-empty string at `keys`, in order — used to synthesise a short list
 * from discrete flat fields (e.g. ache `beats` ← `[heading, body]`). Undefined
 * when none are present, so callers keep their `{#if list}` self-hide guard.
 */
export function asStringsFrom(
  props: SectionProps,
  keys: readonly string[]
): string[] | undefined {
  const out: string[] = [];
  for (const key of keys) {
    const value = asString(props, key);
    if (value !== undefined) out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Collect numbered sibling keys into an array of records — the builder's
 * `q1/a1`, `q2/a2`… convention. `fields` maps a logical field name onto its key
 * PREFIX (`{ question: 'q', answer: 'a' }` reads `q1`+`a1`, `q2`+`a2`, …).
 * Iteration stops at `max`; each index is passed through `map`, and a null
 * result drops that entry (so a half-filled pair is skipped, not rendered blank).
 */
export function asNumberedGroups<T>(
  props: SectionProps,
  fields: Readonly<Record<string, string>>,
  map: (group: Record<string, string | undefined>, index: number) => T | null,
  max = 12
): T[] | undefined {
  const out: T[] = [];
  for (let i = 1; i <= max; i += 1) {
    const group: Record<string, string | undefined> = {};
    let present = false;
    for (const [name, prefix] of Object.entries(fields)) {
      const value = asString(props, `${prefix}${i}`);
      group[name] = value;
      if (value !== undefined) present = true;
    }
    if (!present) continue;
    const mapped = map(group, i);
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
