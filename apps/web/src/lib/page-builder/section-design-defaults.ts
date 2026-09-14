/**
 * PER-SECTION-TYPE DESIGN DEFAULTS — the page's RHYTHM, written at creation time.
 *
 * ── THE DEFECT THIS FIXES ──────────────────────────────────────────────────
 * Measured live on every published journey page in the dev database: all four
 * sections of `of-blood-and-bones/bone-deep` emitted BYTE-IDENTICAL axis values —
 *
 *   width:narrow density:airy surface:media edge:none align:center
 *   type:monumental accent:glow motion:drift media:bleed
 *
 * — and ZERO of the 28 stored sections carried a `design` key. A nine-axis design
 * system was expressing exactly ONE setting per axis, applied to every section on
 * the page. It read flat: four sections all narrow, centred, airy and monumental,
 * every one shouting at the same volume, with `surface: media` applied even to
 * `ache` and `map`, which have no media at all.
 *
 * ── THE MECHANISM WAS NEVER MISSING ────────────────────────────────────────
 * Per-section override is wired end to end and has been since F-B2:
 * `page-builder-store.svelte.ts` `setSectionDesignAxis` writes it,
 * `SectionEditor.svelte` exposes set + clear per axis per section (with an
 * "Inherited" pill and a hint), `pageSectionSchema.design` validates it, and
 * `render/SectionFrame.svelte` resolves it into the nine `data-jp-*` attributes.
 * Nothing ever WROTE the exception the store's own comment asks for — "a
 * deliberate exception (a vast hero over a compact FAQ) is good design".
 *
 * So this is a DEFAULT, not a repair, and deliberately not a new control: adding
 * one would duplicate a control that already exists and is already explained.
 *
 * ── THE PRINCIPLE ──────────────────────────────────────────────────────────
 * Alternate density and surface so the page breathes; reserve `monumental` for
 * the two ENDS; keep the middle restrained so the ends land. Read the density
 * column top to bottom — vast · airy · regular · regular · regular · airy ·
 * regular · compact · regular · compact · vast — and the surface column —
 * (look) · bare · tint · (look) · (look) · bare · panel · panel · tint · bare ·
 * invert, where `(look)` is hero / introVideo / reel taking the PAGE LOOK's own
 * ground (see the un-pinning note below the table). The page opens big in
 * whatever atmosphere the look asks for — `media`, and so `--jp-sec-atmos: 1`,
 * under Candlelit — quiets into a narrow ache, varies through a structured
 * middle, tightens at the FAQ, and closes big and inverted.
 *
 * ── FOUR THINGS THAT ARE LOAD-BEARING, AND WHY ─────────────────────────────
 *
 * (1) TYPED AGAINST `SectionDesign`, so a typo is a COMPILE error. Every axis in
 *     `sectionDesignSchema` is `z.enum(...).catch(undefined)` and `resolveAxis`
 *     drops an illegal value silently — deliberately, so a future client's new
 *     value cannot reach an attribute that matches no CSS rule. The cost is that
 *     `desnity: 'vast'` or `density: 'huge'` would DEGRADE INVISIBLY here rather
 *     than being rejected. The `Record<CourseSectionType, SectionDesign>`
 *     annotation is the only thing that makes such a typo loud, which is why it
 *     is stated explicitly rather than inferred. `section-design-defaults.test.ts`
 *     re-checks every value against `SECTION_DESIGN_VALUES` at runtime as well,
 *     because a future `as` cast anywhere in this file would silence the first
 *     check without the second noticing.
 *
 * (2) ABSENCE MEANS INHERITED, so a redundant key is a BUG, not a no-op.
 *     {@link sectionDesignForType} drops every axis whose table value equals what
 *     the section would have inherited anyway. Writing it would make the
 *     inspector's "Inherited" pill lie about an axis the creator never touched,
 *     and it is the absence — not a stored `undefined` — that the store's "clear
 *     DELETES the key" contract and the save round-trip both preserve.
 *
 * (3) `media` IS OMITTED WHERE NOTHING CONSUMES IT. Only four section components
 *     read the `--jp-media-*` family: `HeroSection`, `IntroVideoSection`,
 *     `ReelSection` and `GuideSection`. `FeelSection`'s header states the case
 *     for the rest outright — "`media` is DELIBERATELY unconsumed … there is no
 *     image, no video and no aspect ratio for `--jp-media-*` to shape, so
 *     claiming nine would have meant inventing a consumer (contract A50)". So the
 *     seven types with no media resolution get NO `media` key: a written value
 *     there could not change what renders, and `Codex-wqxv4` records the price
 *     this programme has already paid once for shipping a control that cannot.
 *
 * (4) CREATION ONLY. Nothing here migrates a stored page. A page created before
 *     this table keeps every byte of its rendered output; re-rhythming the seven
 *     published pages would silently restyle live sales pages and is a separate
 *     decision with its own review.
 *
 * ── IT IS A TASTE CALL ─────────────────────────────────────────────────────
 * The table is a judgement grounded in the axis vocabulary and the store's stated
 * intent. It is defensible; it is not the only defensible answer. That is why it
 * is ONE exported table in ONE file with no logic woven through it — changing the
 * house rhythm should be a diff in this table and nothing else.
 */

import type { CourseSectionType, SectionDesign } from '@codex/shared-types';

/**
 * The house rhythm: one axis bag per catalogue section type.
 *
 * The annotation is `Record<CourseSectionType, …>` (not `Partial<…>`) so ADDING a
 * twelfth section type to the catalogue fails `pnpm typecheck` here until it is
 * given a rhythm — a new type silently inheriting the flat page bag is exactly
 * the state this table exists to end.
 *
 * `media` appears on the four types that resolve it and nowhere else (note 3
 * above). `guide: media 'frame'` is the axis default, so on a page with no
 * page-level look it is dropped as redundant — it is stated anyway because it is
 * the value guide's plate WANTS, and the page look it must survive is the one
 * that sets `media: bleed`.
 *
 * ── WHY hero / introVideo / reel NO LONGER PIN `media` ─────────────────────
 * They used to, all three at `bleed`, and between them and `guide` that covered
 * EVERY section which consumes the media axis — Guide reads `--jp-media-*` 20
 * times, IntroVideo 22, Reel 22, Hero 12, and the other seven types read it
 * zero times outside prose. So the PAGE LOOK'S `media` VALUE COULD NEVER PAINT
 * on a template-seeded page: it was overridden on all four sections that could
 * express it and inherited only by the seven that ignore it.
 *
 * That made a whole axis inert for the looks. Quiet Studio's `media: inset` is
 * THE MAT, its one exclusive axis value and its entire signature; Open Air and
 * Full Send ride `mask`; Plain Facts rides `none`. None of them could reach a
 * single pixel.
 *
 * Removing the three is a no-op for Candlelit, which is the reason it is safe to
 * do here rather than behind a decision: Candlelit's page look IS `media:
 * bleed`, so hero, introVideo and reel now INHERIT the same `bleed` they were
 * pinned to. `guide` keeps its key for the reason stated above — it is the one
 * of the four whose pin is a deliberate defence against a `bleed` page look, not
 * a restatement of it.
 *
 * ── AND WHY THE SAME THREE NO LONGER PIN `surface` ─────────────────────────
 * Same rows, same mechanism, one measurement further on. All three pinned
 * `surface: media`, which is CANDLELIT'S OWN page value — so the ground of the
 * three sections that carry a page's images was fixed at Candlelit's under every
 * look, `--jp-sec-atmos: 1` included. `surface` is a primary axis value for ALL
 * EIGHT looks in the binding signature brief (`docs/design/look-polish/
 * 00-signature-brief.md` §3), and each look's mandated value is exactly its own
 * page-level surface: media · bare · bare · tint · panel · panel · invert ·
 * panel, in preset order. Measured on Open Air, whose signature is THE WASH:
 * `surface: tint` and `edge: soft` are both halves of it and they co-occurred on
 * ONE of eleven sections (`guide`) — never on the hero, the section a creator
 * judges the look by. The three slots freed here could not vary by look AT ALL
 * before; `look-reach.test.ts` ratchets the total and this can only raise it.
 *
 * No-op for Candlelit by the same construction as `media`: its page look IS
 * `surface: media`, so `sectionDesignForType` already dropped the key as
 * redundant on a Candlelit page, and the three now INHERIT the `media` they were
 * pinned to — same attribute, same atmosphere, byte for byte. The test below
 * asserts it rather than leaving it to this paragraph.
 *
 * `invite: surface 'invert'` IS NOT PART OF THIS and must not be swept in with
 * it: `invert` is not Candlelit's value, so that key is genuinely stored and
 * genuinely resolves on a Candlelit page, and deleting it would move the
 * benchmark. Open Air's closing CTA therefore still resolves `invert` rather
 * than its own `tint`; the only Candlelit-safe fix for that end of the page is a
 * `surface` line in the look's own `designByType` (`design-vocabulary.ts`).
 */
export const SECTION_DESIGN_BY_TYPE: Readonly<
  Record<CourseSectionType, Readonly<SectionDesign>>
> = {
  // The two ENDS carry `monumental`. Everything between them is quieter so that
  // the ends read as arrival and departure rather than as more of the same.
  hero: {
    width: 'full',
    density: 'vast',
    edge: 'none',
    align: 'center',
    type: 'monumental',
    accent: 'glow',
    motion: 'drift',
  },
  // Narrow and bare, straight after the widest and loudest section on the page.
  // `surface: bare` also un-does the measured absurdity of the flat page bag:
  // `surface: media` on a section that has never had media.
  ache: {
    width: 'narrow',
    density: 'airy',
    surface: 'bare',
    edge: 'none',
    align: 'center',
    type: 'expressive',
    accent: 'text',
    motion: 'fade',
  },
  // The pivot. `align: start` from here to the FAQ: the middle of the page is
  // read, not beheld, and a left edge is what a reader's eye returns to.
  turn: {
    width: 'text',
    density: 'regular',
    surface: 'tint',
    edge: 'hairline',
    align: 'start',
    type: 'balanced',
    accent: 'text',
    motion: 'rise',
  },
  introVideo: {
    width: 'wide',
    density: 'regular',
    edge: 'none',
    align: 'center',
    type: 'balanced',
    accent: 'glow',
    motion: 'fade',
  },
  reel: {
    width: 'full',
    density: 'regular',
    edge: 'none',
    align: 'start',
    type: 'expressive',
    accent: 'edge',
    motion: 'drift',
  },
  // `motion: stagger` because the map IS a sequence — the choreography carries
  // the same meaning as the composition.
  map: {
    width: 'wide',
    density: 'airy',
    surface: 'bare',
    edge: 'none',
    align: 'start',
    type: 'balanced',
    accent: 'edge',
    motion: 'stagger',
  },
  feel: {
    width: 'wide',
    density: 'regular',
    surface: 'panel',
    edge: 'soft',
    align: 'start',
    type: 'balanced',
    accent: 'fill',
    motion: 'fade',
  },
  // Compact and accent-less: testimonials are evidence, and evidence that shouts
  // reads as advertising.
  proof: {
    width: 'wide',
    density: 'compact',
    surface: 'panel',
    edge: 'hairline',
    align: 'start',
    type: 'restrained',
    accent: 'none',
    motion: 'stagger',
  },
  guide: {
    width: 'text',
    density: 'regular',
    surface: 'tint',
    edge: 'soft',
    align: 'start',
    type: 'balanced',
    accent: 'text',
    motion: 'fade',
    media: 'frame',
  },
  // The tightest section on the page, immediately before the widest gesture.
  faq: {
    width: 'text',
    density: 'compact',
    surface: 'bare',
    edge: 'hairline',
    align: 'start',
    type: 'restrained',
    accent: 'none',
    motion: 'fade',
  },
  invite: {
    width: 'narrow',
    density: 'vast',
    surface: 'invert',
    edge: 'none',
    align: 'center',
    type: 'monumental',
    accent: 'fill',
    motion: 'rise',
  },
};

/**
 * The rhythm bag to STORE on a newly-created section of `type` — every axis where
 * the house rhythm differs from what that section would inherit anyway, and
 * nothing else.
 *
 * @param type the section type. An unknown/widened type gets `undefined`: the
 *   renderer skips it, so there is no rhythm to express.
 * @param inherited the FULLY RESOLVED look the section would render in with no
 *   `design` bag of its own — i.e. `resolveDesign(section, page)`. Pass it, not
 *   the raw page bag: an axis the page leaves unset still resolves to the axis
 *   default, and a key equal to THAT is just as redundant as one equal to the
 *   page's own value. Omitted only by a caller that has no page context.
 * @returns a bag with at least one key, or `undefined` when the rhythm is
 *   entirely redundant — because absence is how "inherited" is represented, and
 *   an empty `{}` is not the same thing to a reader of the stored jsonb.
 */
export function sectionDesignForType(
  type: string,
  inherited?: Readonly<SectionDesign> | null,
  /**
   * THE LOOK'S OWN OPINION ABOUT THIS SECTION TYPE, which wins over the shared
   * rhythm. Without it a page look reaches almost nothing: the rhythm below
   * states a value for 89 of 99 type/axis slots and a section's value beats the
   * page's in `resolveAxis`'s source order, so `hero` was `surface: media` +
   * `accent: glow` under EVERY look. `look-reach.test.ts` measures the
   * consequence — it was 10 of 99 axis slots varying by look, and all ten were
   * `media`.
   *
   * That is why only one look read well: the absolute values in the table were
   * chosen for Candlelit, so every look rendered Candlelit's treatment.
   *
   * An override is dropped when it equals what the page look already resolves,
   * by the same rule the rhythm uses, so "inherited" keeps meaning inherited and
   * the inspector's pill stays honest. A look that passes nothing is unchanged
   * byte for byte — which is how Candlelit stays the fixed point.
   */
  override?: Readonly<Partial<SectionDesign>> | null
): SectionDesign | undefined {
  const rhythm = SECTION_DESIGN_BY_TYPE[type as CourseSectionType];
  if (!rhythm) return undefined;

  // The look's opinion layered over the shared rhythm. Spread order IS the
  // precedence rule: the rhythm gives the page its internal variety, and the
  // look overrides the axes that carry its signature.
  const wanted: Readonly<SectionDesign> = override
    ? { ...rhythm, ...override }
    : rhythm;

  const design: SectionDesign = {};
  let written = 0;
  // Iterating the TABLE's own keys rather than a hand-written axis list: a second
  // list is how an axis ends up selectable in the editor and unstyled on the
  // page, and the annotation above already constrains these keys to the nine.
  for (const key of Object.keys(wanted) as (keyof SectionDesign)[]) {
    const value = wanted[key];
    if (value === undefined) continue;
    if (inherited && inherited[key] === value) continue;
    // One assignment per axis would be nine near-identical lines; the cast is
    // confined to this statement and the key/value pair is provably from the same
    // axis of the same typed table.
    (design as Record<string, string>)[key] = value;
    written += 1;
  }
  return written > 0 ? design : undefined;
}
