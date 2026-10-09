/**
 * Legacy `variant` (composition) → nearest v2 layout, per legacy type
 * (contract §3: "Legacy `variant` → nearest v2 layout... The complete tables
 * live in Appendix A and are written by WP1 from the legacy catalogue's own
 * descriptions").
 *
 * Keyed by LEGACY type (not v2 — `upgrade.ts` looks this up before the type
 * map is applied). Each inner map covers EVERY id `section-catalog.ts` ever
 * assigned to that type: every CURRENT composition id (`SectionVariant.id`)
 * AND every RETIRED id (`LEGACY_SECTION_VARIANTS[type]`), because a real
 * stored page may hold either. A retired id is mapped to the SAME v2 layout
 * as the current composition it renames to (chained through
 * `LEGACY_SECTION_VARIANTS`, snapshotted here as data) — see "On retired ids'
 * baked-in axes" below for the one thing that chaining does NOT carry over.
 *
 * PROVISIONAL, by necessity, and said so plainly: v2's layouts do not exist
 * yet (WP2 has not designed `blocks/<type>/definition.ts`), so every mapping
 * below is a judgement call from the OLD variant's `hint` text and the NEW
 * layout's NAME — the only two things that exist to compare. Each choice is
 * commented; revise freely once WP2's actual layouts are visible, this table
 * has no other consumer to keep in step.
 *
 * On retired ids' baked-in axes: `hero.minimal`, for one example, used to
 * imply `density:'compact', accent:'none', motion:'none', type:'expressive'`
 * via its own CSS class, never through the stored `design` bag. This map
 * chains it to WHATEVER LAYOUT its rename target (`stage`) resolves to,
 * exactly as a plain rename would — it does NOT try to express "compact and
 * quiet" as a different, smaller-feeling v2 layout choice, and the section's
 * `design` axes are converted completely separately, from the section's OWN
 * literal `design` bag only (see `axis-style-map.ts`'s header) — so a
 * retired id's baked-in flavour is the one thing this migration genuinely
 * loses. Confirmed low-stakes: `minimal` is "Latent today (no page stores
 * minimal)" per `section-catalog.ts`'s own comment, and none of the three
 * sampled real rows use ANY retired id at all (all current-id, matching the
 * seed scripts' post-migration-0087/0089 state).
 */
export const LEGACY_VARIANT_MAP: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  hero: {
    // Current ids.
    stage: 'statement', // most common id on real pages; the v2 fallback default.
    'split-media': 'split', // name match.
    'full-bleed': 'cover', // media fills the section + scrim = "cover".
    oversized: 'statement', // "headline is the hero, no media" = statement's own definition.
    banner: 'centered', // compact single row, no media emphasis = the plainer bucket.
    poster: 'cover', // "framed plate" = media-prominent, closest to cover.
    // Retired ids, chained through their rename target.
    centered: 'statement', // → stage → statement.
    left: 'statement', // → stage → statement.
    minimal: 'statement', // → stage → statement (baked-in axes NOT carried; see header).
    split: 'split', // → split-media → split.
  },
  introVideo: {
    theatre: 'theatre', // name match.
    plain: 'theatre', // only 2 v2 layouts; theatre is the plainer/default bucket.
    split: 'split', // name match.
    bleed: 'theatre', // edge-to-edge is closer to the framed default than to split.
    card: 'theatre', // framed-in-panel = theatre's own "framed player" idea.
    // Retired ids.
    cinema: 'theatre', // → theatre.
    simple: 'theatre', // → plain → theatre.
  },
  ache: {
    column: 'statement', // one flowing measure, no list = the plain bucket.
    statement: 'statement', // name match.
    paired: 'split', // two columns = split.
    list: 'list', // name match.
    quote: 'statement', // a pull-quote treatment; no "quote" layout exists for problem.
    checklist: 'list', // ticked rows = a list variant.
    descent: 'list', // full-screen one-at-a-time reveal of the SAME points list.
    // Retired ids.
    centered: 'statement', // → column → statement.
    wide: 'statement', // → column → statement.
    twocol: 'split', // → paired → split.
  },
  turn: {
    // v2 layout names read as: columns = two-panel arrangement, steps =
    // sequential/staged, statement = one plain block — NOT "columns" (plural)
    // meaning the same thing as legacy's singular "column" composition.
    statement: 'statement', // name match.
    column: 'statement', // one measure, no panels/steps = the plain bucket.
    paired: 'columns', // "statement one side, lede the other" = two panels.
    arc: 'steps', // roman-numeralled staged list = "steps", exact conceptual match.
    'before-after': 'columns', // two panels: from / to.
    numbered: 'steps', // three numbered beats = staged.
    // Retired ids.
    centered: 'statement', // → column → statement.
    wide: 'statement', // → column → statement.
    twocol: 'columns', // → paired → columns.
  },
  reel: {
    theatre: 'feature', // framed/prominent = the "feature" bucket.
    plain: 'feature', // bare clip; only 2 v2 layouts, feature is the default.
    split: 'split', // name match.
    bleed: 'feature', // edge-to-edge = prominent = feature.
    card: 'feature', // framed-in-panel = feature.
    waveform: 'feature', // audio-first; no audio-specific v2 layout exists.
    // `strip` is DECLARED-BUT-UNAVAILABLE (never selectable; see
    // `section-catalog.ts`'s own `unavailable` comment on it) — omitted here,
    // since no stored page can hold it.
    // Retired ids.
    cinema: 'feature', // → theatre → feature.
    simple: 'feature', // → plain → feature.
  },
  map: {
    spine: 'timeline', // vertical progression = timeline, direct conceptual match.
    rows: 'accordion', // compact list-like rows = the plainer, listy bucket.
    cards: 'cards', // name match.
    table: 'accordion', // dense tabular info; closer to accordion than a card grid.
    timeline: 'timeline', // name match.
    'numbered-prose': 'accordion', // plain sequential text; simplest of the three.
    // Retired ids.
    descent: 'timeline', // → spine → timeline.
    list: 'accordion', // → rows → accordion.
    grid: 'cards', // → cards → cards.
  },
  feel: {
    paired: 'split', // feeling copy one side, inclusions the other = split.
    column: 'checklist', // single measure; inclusions render on as a list beneath.
    statement: 'checklist', // oversized line + inclusions running on quietly = same list bucket.
    grid: 'grid', // name match.
    ledger: 'checklist', // hairline-ruled label+detail rows = exactly a checklist.
    stack: 'checklist', // alternating bands read closer to a vertical sequence than a grid/split.
    // Retired ids.
    centered: 'checklist', // → column → checklist.
    wide: 'checklist', // → column → checklist.
    twocol: 'split', // → paired → split.
  },
  guide: {
    portrait: 'split', // portrait beside bio = split, direct conceptual match.
    column: 'centered', // bio only, no media, one measure = centered.
    quote: 'quote', // name match.
    credentials: 'split', // portrait + fact list = still a two-part arrangement.
    letter: 'centered', // signed letter, no portrait frame = one centred column.
    // Retired ids.
    centered: 'centered', // → column → centered.
  },
  proof: {
    // No retired ids at all for `proof` — `LEGACY_SECTION_VARIANTS` in
    // `section-catalog.ts` declares none.
    grid: 'grid', // name match.
    stack: 'featured', // one column, full measure = a prominent single treatment.
    spotlight: 'featured', // "one quote at large scale" IS the definition of featured.
    // v2 has had both compositions since 03 (E4), under the same names: the
    // masonry wall and the moving strip (03 §13 X14). Before that these went
    // to the nearest stand-in (grid, featured).
    wall: 'wall',
    marquee: 'marquee',
    pull: 'quote', // pull-quote, no card = name match.
  },
  faq: {
    // No retired ids for `faq` either.
    accordion: 'accordion', // name match.
    open: 'accordion', // every answer shown; still fundamentally an accordion list.
    boxed: 'accordion', // each entry its own panel; still a vertical list.
    paired: 'columns', // two-column Q/A rows = columns, direct conceptual match.
    grouped: 'accordion', // categorised accordions; still accordion at the core.
  },
  invite: {
    pool: 'focus', // the cinematic close, ONE path emphasised = "focus".
    banner: 'band', // compact horizontal strip = "band", name-level match.
    card: 'focus', // one quiet card, no atmosphere = a focused single-offer treatment.
    tiers: 'cards', // two-three plan columns = "cards", direct match.
    table: 'cards', // comparison matrix across paths; still a multi-card comparison.
    sticky: 'band', // persistent bottom bar + short in-flow section = band-like.
    // Retired ids.
    descent: 'focus', // → pool → focus.
  },
};
