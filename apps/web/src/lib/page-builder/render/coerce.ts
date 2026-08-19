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

/**
 * The first non-empty string among `keys`, split into PARAGRAPHS — the bridge for
 * a builder `textarea` field whose renderer counterpart is a string array.
 *
 * Added for `guide`: the builder's field is labelled "Bio" and writes the flat
 * string `body`, while `GuideSection` reads `bio` as a `string[]`. `asStringArray`
 * discards a plain string outright, so the guide's ENTIRE biography rendered as
 * nothing — the most severe of the seven copy-loss cases in `Codex-tqr51`.
 *
 * Splits on any run of newlines, so a creator who presses Enter once between
 * paragraphs gets two paragraphs and one who presses it twice gets the same. A
 * single-line value yields a one-entry array, which is exactly what the array
 * shape means. Undefined when nothing survives, so callers keep their `{#if}`
 * self-hide guard.
 */
export function asParagraphsFrom(
  props: SectionProps,
  keys: readonly string[]
): string[] | undefined {
  const text = asStringFrom(props, keys);
  if (text === undefined) return undefined;
  const out = text
    .split(/[\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * THE BUILDER→RENDERER KEY MAP — the read-boundary reconciliation, in one place.
 *
 * Verified against the database (audit §B): the builder's names ARE what is stored
 * (`hero.{sub, button, quiet}`, `map.{heading, note}`, `guide.{role, body}`), and
 * the public renderer's own vocabulary (`subheadline`, `ctaLabel`, `title`,
 * `foot`, `bio`) is the LATER invention. So the renderer's name stays first in
 * every preference list (a page authored against it still wins) and the builder's
 * name is the fallback that makes existing pages render.
 *
 * Confirmed live loss this closes: the golden page stores `hero.button` =
 * "Get started", `HeroSection` read only `ctaLabel`, and the served HTML showed
 * the hardcoded `'Begin the journey'` — a creator's CTA label replaced by
 * hardcoded English on a real page.
 *
 * WHY A TABLE and not 15 inline literals: seven component work-packages read
 * these keys in seven worktrees. A hand-copied preference list drifts, and a
 * drifted list is invisible — it degrades to the hardcoded fallback rather than
 * failing. One table also gives `section-fields.test.ts` a machine-readable
 * source for the round-trip guard ("every writable key is read").
 *
 * NOT here, deliberately:
 *   - `invite.price` — pricing comes ONLY from `JourneySalesContext.offer`
 *     (Codex-2pryk.2.4.3). The FIELD should be deleted, never bridged; reading it
 *     would re-introduce a page advertising a price that does not exist.
 *   - media slots (`clipMedia`, `portraitMedia`) — not `props` keys at all; they
 *     write `courses.*MediaId` and arrive through the render context.
 *   - keys whose renderer prop does not exist yet (`hero.accent`, `hero.felt`,
 *     `hero.bg`, `invite.accent`, `introVideo.clip`, `*.duration`). Those need new
 *     markup, which is the owning component WP's job, not a read-boundary alias.
 */
export const SECTION_PROP_ALIASES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  hero: {
    subheadline: ['subheadline', 'sub'],
    ctaLabel: ['ctaLabel', 'button'],
    secondaryLabel: ['secondaryLabel', 'quiet'],
  },
  introVideo: { eyebrow: ['eyebrow', 'kicker'] },
  ache: { eyebrow: ['eyebrow', 'kicker'] },
  turn: {
    eyebrow: ['eyebrow', 'kicker'],
    statement: ['statement', 'heading'],
    lede: ['lede', 'body'],
  },
  reel: { eyebrow: ['eyebrow', 'kicker'], tag: ['tag', 'clip'] },
  map: { title: ['title', 'heading'], foot: ['foot', 'note'] },
  feel: { eyebrow: ['eyebrow', 'kicker'] },
  proof: { trustLabel: ['trustLabel', 'trust'] },
  guide: { eyebrow: ['eyebrow', 'role'], bio: ['bio', 'body'] },
  faq: {},
  invite: {
    ctaLabel: ['ctaLabel', 'button'],
    priceNote: ['priceNote', 'risk'],
  },
};

/**
 * The preference list for one section type's prop — the {@link SECTION_PROP_ALIASES}
 * entry, or just the prop's own name when no alias is declared. Total, so a call
 * site never has to branch on whether an alias exists.
 */
export function aliasKeys(type: string, prop: string): readonly string[] {
  return SECTION_PROP_ALIASES[type]?.[prop] ?? [prop];
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
