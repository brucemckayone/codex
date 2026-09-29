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
 * public sections read the richer array shapes (`beats[]`, `items[]`,
 * `testimonials[]`). Nothing ever reconciled the two contracts, so a creator
 * could fill a section in the builder, publish, and watch it vanish from the
 * public page (the array was never written → the section self-hid).
 *
 * This reader closes that gap at the READ boundary for the numbered-group shape.
 * Its siblings for the single-string and string-array shapes (`asStringFrom`,
 * `asStringsFrom`) were deleted with the legacy renderer (WP-9a); this one
 * stayed because `kit/model/legacy/read-helpers.ts` still calls it to read old
 * rows' numbered groups during the v1→v2 upgrade.
 */

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
 * failing.
 *
 * Read by `kit/model/legacy/prop-mappers.ts` and `render/editable.ts` — both
 * survived the legacy renderer's deletion (WP-9a); `aliasKeys()`, the wrapper
 * function that used to read this table for the legacy sections, did not (its
 * only callers were `JourneyRenderer`/`section-registry`, deleted with them).
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
  // `sub` is a seeder key the editor never declared (`PROSE_FIELDS` writes
  // `kicker`/`heading`/`body`), so the sentence the portal seeder authored under
  // it was unreadable AND unread. Six sections across both orgs store a real
  // paragraph there — "Grief is not a problem to be solved. These practices make
  // room for it to move." — on five published pages. Bridged onto `body`, which
  // still wins the preference list wherever a creator has since typed one.
  // Reported by WT-1 (round 3); NOT in `05-bridge-table.md`, which recorded
  // `AcheSection` as "already bridged, do nothing".
  ache: { eyebrow: ['eyebrow', 'kicker'], body: ['body', 'sub'] },
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
