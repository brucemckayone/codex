/**
 * Tiny pure prop-reading primitives for `upgrade.ts` and `prop-mappers.ts`.
 *
 * DELIBERATELY NOT imported from `render/coerce.ts`, even though the two are
 * near-identical in shape. `coerce.ts` belongs to the OLD `render/` renderer
 * tree the page-kit replaces; `section-catalog.ts` and `design-vocabulary.ts`
 * are contractually forbidden to `upgrade.ts` because they are deleted in
 * WP6/9 (docs/design/landing-builder/01-contract.md §3), and `coerce.ts` is
 * the same kind of soon-obsolete legacy file even though it was not named
 * explicitly. Re-implementing these few lines here keeps `upgrade.ts`'s only
 * dependencies on the stable `ids.ts`/`types.ts` contract, immune to any
 * future deletion in `render/` or `page-builder/*.ts`.
 *
 * INERT: no imports, no DOM. Every function is total — never throws, on any
 * input `unknown` can produce (upgrade.ts's whole job is surviving that).
 */

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty trimmed string, or undefined. */
export function readString(
  props: Record<string, unknown>,
  key: string
): string | undefined {
  const value = props[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** An array of non-empty strings (drops non-string / blank entries), or undefined. */
export function readStringArray(
  props: Record<string, unknown>,
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

/** First non-empty string among `keys`, in preference order. */
export function firstOf(
  props: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(props, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Non-empty parts joined as separate lines (`\n`) — for a heading + an
 *  appended accent ending that renders "on its own line" under it. */
export function joinLines(
  ...parts: (string | undefined)[]
): string | undefined {
  const nonEmpty = parts.filter((p): p is string => !!p);
  return nonEmpty.length > 0 ? nonEmpty.join('\n') : undefined;
}

/** Non-empty parts joined as separate PARAGRAPHS (`\n\n` — the v2 `body?`
 *  convention: "blank line = new paragraph"). */
export function joinParagraphs(
  ...parts: (string | undefined)[]
): string | undefined {
  const nonEmpty = parts.filter((p): p is string => !!p);
  return nonEmpty.length > 0 ? nonEmpty.join('\n\n') : undefined;
}

/**
 * Split ONE multi-line legacy textarea value into a paragraph array — for a
 * legacy `string` field whose v2 destination is a `string[]` (`turn.from`/
 * `to` → v2 transformation `before`/`after`). Splits on any run of blank
 * lines/newlines, trims, drops empty entries. Undefined for undefined input.
 */
export function splitParagraphs(
  text: string | undefined
): string[] | undefined {
  if (text === undefined) return undefined;
  const out = text
    .split(/[\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Collect numbered sibling keys into an array of records — the builder's
 * `q1/a1`, `q2/a2`… convention (mirrors `render/coerce.ts` `asNumberedGroups`,
 * re-implemented per the module header). `fields` maps a logical field name
 * onto its key PREFIX. Stops at `max`; a group with nothing present is
 * skipped, so a half-filled pair does not produce a blank entry.
 *
 * `read` defaults to the plain {@link readString} but a caller may supply a
 * seed-default-aware reader instead — it is handed the FULL composed key
 * (`q1`, `n2`, …), which is what a per-key seed-default lookup needs and
 * what `build`'s logical-field-named group cannot reconstruct on its own.
 */
export function readNumberedGroups<T>(
  props: Record<string, unknown>,
  fields: Readonly<Record<string, string>>,
  build: (group: Readonly<Record<string, string | undefined>>) => T | null,
  max = 12,
  read: (
    props: Record<string, unknown>,
    key: string
  ) => string | undefined = readString
): T[] | undefined {
  const out: T[] = [];
  for (let i = 1; i <= max; i++) {
    const group: Record<string, string | undefined> = {};
    let present = false;
    for (const [name, prefix] of Object.entries(fields)) {
      const value = read(props, `${prefix}${i}`);
      group[name] = value;
      if (value !== undefined) present = true;
    }
    if (!present) continue;
    const built = build(group);
    if (built !== null) out.push(built);
  }
  return out.length > 0 ? out : undefined;
}

/** An array of plain objects, each mapped through `map` and kept only when
 *  the mapper returns non-null. Undefined when nothing survives. */
export function readObjectArray<T>(
  value: unknown,
  map: (entry: Record<string, unknown>) => T | null
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const mapped = map(entry);
    if (mapped !== null) out.push(mapped);
  }
  return out.length > 0 ? out : undefined;
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

/** Field-level string-array reader for the object-array mappers above. */
export function fieldStringArray(
  record: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Field-level boolean reader for the object-array mappers above. */
export function fieldBool(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === true;
}
