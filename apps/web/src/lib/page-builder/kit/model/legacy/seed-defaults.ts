/**
 * The UNAUTHORED-copy detector (contract §3: "a prop whose value equals the
 * legacy catalogue's seed default for that key is dropped — this is what
 * removes the stray 'Cancel anytime'").
 *
 * PROVENANCE — every entry below comes from exactly one of TWO places:
 *
 *  1. `section-catalog.ts` `SECTION_CATALOG[type].defaultProps` — the copy a
 *     freshly-added section starts with in the builder.
 *  2. `packages/database/scripts/seed-portals.ts` `buildSections()` — the
 *     FIXED literals it writes for EVERY seeded portal, identically (`button:
 *     'Begin'`, `risk: 'Cancel anytime'`, `ache.eyebrow: 'Why this'`, …). Its
 *     per-portal `spec.title`/`spec.lede`/`spec.kicker`/`spec.stages…join`
 *     interpolations are excluded: those vary per portal and are that
 *     portal's own — if seed-standing-in-for-a-creator — copy, not a
 *     placeholder.
 *
 * `packages/database/scripts/seed-journey-content.ts` `COPY` is DELIBERATELY
 * NOT a source, despite the task brief naming "the two seed scripts" and this
 * file's first draft including it. Reversed after `upgrade.test.ts` proved the
 * concrete cost against the REAL `bone-deep` row: that script's whole and
 * explicitly-stated purpose is to replace generic placeholder copy with
 * specific, deliberately-authored, brand-voiced prose (its own header:
 * "demo data that reads as real copy at real lengths is the whole point").
 * Treating ITS OUTPUT as the same kind of "nobody meant this" scaffolding as
 * `section-catalog.ts`'s defaults or `seed-portals.ts`'s uniform literals
 * inverts that script's purpose — and does so concretely: with `COPY`'s
 * `ache.body` ("You have done the reading…") in this table, `upgrade.ts`
 * dropped that specific, well-written paragraph and fell back to `sub` (a
 * duplicate lede sentence shared with the hero section) — a real quality
 * regression on the one page the script touches, for a "risk" (an unrelated
 * creator coincidentally typing one of these exact sentences) that is nil
 * either way. `seed-portals.ts`'s literals do not have this problem: they are
 * short, generic, and IDENTICAL across every portal by construction — the
 * same "no one specific creator chose these words" property `catalogue`
 * defaults have, which `COPY`'s long, portal-specific-voiced sentences do
 * not.
 *
 * ONLY non-empty strings, matching `section-catalog.ts`'s own
 * `seededSections()` precedent exactly: `hero.accent`/`felt`/`quiet`/`trust`
 * and `guide.quote` seed `''` in the catalogue, and an empty string was never
 * really "seeded content" — dropping it would achieve nothing, so it is left
 * out here too.
 *
 * `hero.bg` / `introVideo.duration` / `reel.duration` / `guide.duration` are
 * deliberately ABSENT from this table: those keys have no v2 destination at
 * all (see `prop-mappers.ts`), so they are dropped unconditionally by the
 * mapper regardless of value — tracking their seed value here would be dead
 * data.
 *
 * Keyed by LEGACY type, then LEGACY prop key (not the v2 key) — the check
 * runs on the raw stored value BEFORE alias resolution.
 */
export const SEED_DEFAULT_VALUES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  hero: {
    eyebrow: ['Your eyebrow'],
    headline: ['A headline that names the promise'],
    sub: ['A sub-line that expands on it in a sentence or two.'],
    button: ['Get started', 'Begin'],
  },
  introVideo: {
    kicker: ['The film'],
    heading: ['Meet the work'],
    sub: ['A short introduction in their own words.'],
    clip: ['Intro film'],
  },
  ache: {
    kicker: ['If this is you'],
    // `eyebrow`/`heading` are `seed-portals.ts`'s FIXED literals (identical
    // for all four portals — only `sub`, which it sets to `spec.lede`, ever
    // varies). Not present in the catalogue at all (which seeds `kicker`,
    // never `eyebrow`, for this type).
    eyebrow: ['Why this'],
    heading: ['Name the ache.', 'You already know the shape of it.'],
    body: [
      'Describe the problem or longing this journey speaks to — in their words, not yours.',
    ],
  },
  turn: {
    kicker: ['What changes'],
    heading: ['The shift on offer.'],
    body: [
      'Not insight — practice. Name the change this journey makes possible.',
    ],
  },
  reel: {
    kicker: ['In motion'],
    heading: ['See it in motion'],
    sub: ['A real practice, unhurried — exactly as you would meet it.'],
    clip: ['Practice preview'],
  },
  map: {
    // `seed-portals.ts` writes the SAME `eyebrow`/`heading` the catalogue
    // does (one entry each, deduplicated) and its own distinct `note`.
    eyebrow: ['The whole path'],
    heading: ["Everything you'll walk."],
    sub: [
      'Gated depths with a pool of practices in each — settle one ground before the next opens.',
    ],
    note: ['One door is already ajar.', 'The first ground is already open.'],
  },
  feel: {
    kicker: ['What to expect'],
    heading: ['How it feels.'],
    body: [
      'No performance, no getting it right. Just you, a quiet room, and a pace the body sets.',
    ],
  },
  proof: {
    // `seed-portals.ts` never creates a `proof` section — catalogue-only.
    eyebrow: ['From the circle'],
    heading: ['What people say.'],
    q1: ['A short, specific testimonial in their words.'],
    n1: ['First L.'],
    c1: ['member'],
    q2: ['Another testimonial that speaks to a different fear.'],
    n2: ['Second L.'],
    c2: ['new member'],
    q3: ['A third that names a concrete result.'],
    n3: ['Third L.'],
    c3: ['months in'],
    trust: ['2,400 and counting'],
  },
  guide: {
    // `seed-portals.ts` never creates a `guide` section — catalogue-only.
    // `quote` seeds `''` in the catalogue (excluded — empty) and has no
    // other source, so it carries no entries here at all.
    role: ['Your guide'],
    heading: ['Who holds this'],
    body: ['A short bio that establishes credibility and warmth.'],
    clip: ['Meet your guide'],
  },
  faq: {
    // `seed-portals.ts` never creates a `faq` section — catalogue-only.
    heading: ['The honest answers'],
    q1: ['A common question?'],
    a1: ['A clear, reassuring answer.'],
    q2: ['Another question?'],
    a2: ['Another answer.'],
    q3: ['One more?'],
    a3: ['One more answer.'],
  },
  invite: {
    // `seed-portals.ts` writes the SAME `eyebrow`/`accent`/`sub` the
    // catalogue does (deduplicated) plus its own distinct `risk` and `button`
    // (the catalogue's own `button` default, 'Get started', is also kept —
    // either could be the stored value depending on which source wrote it).
    eyebrow: ['Begin'],
    heading: ['The ground'],
    accent: ['is waiting.'],
    sub: ['One key opens everything that grows from here.'],
    button: ['Get started', 'Begin'],
    risk: ['Start free · cancel anytime', 'Cancel anytime'],
  },
};

/**
 * Is `value` a known seed/placeholder literal for this (legacy type, legacy
 * key)? Strict `===` against the set, matching `section-catalog.ts`'s own
 * `seededSections()` precedent — one character of editing clears the key.
 */
export function isSeedDefault(
  type: string,
  key: string,
  value: string | undefined
): boolean {
  if (value === undefined) return false;
  return (SEED_DEFAULT_VALUES[type]?.[key] ?? []).includes(value);
}
