/**
 * Per-section editable-field model (Codex-2pryk.3.3 · WP-5).
 *
 * The pragmatic analog of `brand-editor/levels/*`: it declares which copy fields
 * the rail's config editor renders for each {@link CourseSectionType}, and which
 * `PageSection.props` key each reads/writes. Ported from the finished prototype's
 * inspector SCHEMA (`docs/design/course-journeys/prototype/builder.html`) so the
 * editor fields, the public renderer props, and the catalogue's seed copy all
 * speak ONE prop vocabulary.
 *
 * The app's more granular semantic types share field sets where the prototype
 * shared a renderer: `ache`/`turn`/`feel` reuse {@link PROSE_FIELDS}; `introVideo`/
 * `reel` reuse {@link VIDEO_FIELDS}. Keys are additive — extend a set without
 * breaking stored drafts (an unknown key is simply ignored on render).
 *
 * Pure + framework-free — no component imports — so it stays cheap to unit-test
 * and cheap to bundle in the editor chunk.
 */
import type { CourseSectionType } from '@codex/shared-types';
import type { JourneySellMediaSlot } from '$lib/page-builder/sell-media-store.svelte';

/**
 * The control a field renders as in the config editor.
 *
 * `text` / `textarea` / `select` write a STRING to `PageSection.props[key]`;
 * `media` writes a course sell-media column instead (see
 * {@link SectionFieldDef.mediaSlot}). The four added in F-C write non-string
 * shapes, and the shape is not cosmetic — the renderer's coercers reject the
 * wrong one outright rather than converting it:
 *
 * | control | writes | read by |
 * |---|---|---|
 * | `number` | a JS number | `typeof raw === 'number'` guards (`feel.previewDuration`) |
 * | `toggle` | a JS boolean | `fieldBool` (`=== true`) |
 * | `list` | `string[]` | `asStringArray` / `fieldStringArray` |
 * | `repeater` | `Record<string, unknown>[]` | `asObjectArray` + a per-field mapper |
 *
 * A `text` control pointed at `previewDuration` would write `"480"` and the
 * section would silently fall back to its default — which is exactly how these
 * keys came to be read-but-unwritable in the first place.
 *
 * NO EDITOR UI EXISTS FOR THE FOUR YET. `SectionEditor.svelte` is shared across
 * all eleven types and belongs to consolidation, so F-C declares the contract and
 * consolidation builds the controls. Until then these fields are inert in the
 * rail: `SectionEditor` renders the controls it knows and skips the rest.
 */
export type SectionFieldControl =
  | 'text'
  | 'textarea'
  | 'select'
  | 'media'
  | 'number'
  | 'toggle'
  | 'list'
  | 'repeater';

export interface SectionFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface SectionFieldDef {
  /**
   * The `PageSection.props` key this field reads/writes — EXCEPT when
   * {@link SectionFieldDef.mediaSlot} is set, in which case the control writes
   * the course sell-media column instead and `key` is only the `{#each}` key.
   */
  readonly key: string;
  readonly label: string;
  readonly control: SectionFieldControl;
  readonly placeholder?: string;
  /** Helper text shown under the control (optional/where-it-shows guidance). */
  readonly hint?: string;
  /** Choices for a `select` control. */
  readonly options?: readonly SectionFieldOption[];
  /**
   * For `control: 'media'` — which `courses` sell-media column this picker sets
   * (Codex-eqh0z).
   *
   * This is what makes the media control REAL. The live sections do not read a
   * clip out of `props`: `introVideo` reads `sellPreview.intro`, `reel` reads
   * `sellPreview.reel`, the hero reads `sellPreview.heroImageUrl` and the guide
   * reads `guidePortraitUrl` / `signatureUrl` — all projected from
   * `courses.*MediaId`. So a picker that wrote into `props` could never affect
   * what renders, which is exactly why the old control was a decorative text
   * input. Naming the slot here points the picker at the column the section
   * actually reads.
   *
   * A27 (Codex-wqxv4) added the last two of those columns. `hero` and the guide's
   * signature had NO slot at all, which is why F-C could declare
   * `hero.full-bleed` / `hero.poster` / `guide.letter` but not field them.
   */
  readonly mediaSlot?: JourneySellMediaSlot;
  /**
   * For `control: 'repeater'` — the fields of ONE entry in the object array.
   *
   * Nesting is allowed exactly one level deep: an entry field may be a `list`
   * (`invite.offers[].bullets`), but not another `repeater`. Nothing in the
   * renderer reads a doubly-nested array, and a two-level repeater is an editor
   * nobody can use.
   */
  readonly itemFields?: readonly SectionFieldDef[];
  /**
   * For `control: 'repeater'` / `'list'` — the singular noun for the add button
   * ("Add inclusion"), and what an empty state calls the thing.
   */
  readonly itemLabel?: string;
  /**
   * For `control: 'repeater'` / `'list'` — a cap the editor enforces. Set where
   * the RENDERER has a real limit (`asNumberedGroups` stops at 12) or where a
   * composition breaks down past a count, not as arbitrary tidiness.
   */
  readonly maxItems?: number;
}

const GENERIC_FIELDS: readonly SectionFieldDef[] = [
  {
    key: 'body',
    label: 'Body',
    control: 'textarea',
    placeholder: 'Section copy…',
  },
];

/**
 * The prose COPY base (ache/turn/feel). Still shared, because all three sections
 * carry the same three copy fields — but each type now spreads it and adds its
 * own repeatable content, because the research gives the three genuinely
 * different arrangements (§3) and `ache: list`, `turn: arc` and `feel: ledger`
 * each need items no flat copy field can hold.
 */
const PROSE_FIELDS: readonly SectionFieldDef[] = [
  { key: 'kicker', label: 'Kicker', control: 'text' },
  { key: 'heading', label: 'Heading', control: 'textarea' },
  { key: 'body', label: 'Body', control: 'textarea' },
];

/**
 * The prose POINTS list — one string per row, and the section splits each row on
 * an en/em dash into a lead and a gloss (`TurnSection`'s `toRoman` + dash split).
 *
 * A string list rather than a `{lead, gloss}` repeater on purpose: `turn.points`
 * is ALREADY read as `asStringArray`, and its dash convention already works. A
 * repeater would have meant a data shape change to a key the renderer reads
 * today, for no authoring gain.
 *
 * `turn.points` was read at `TurnSection:46` with nothing writing it, so the
 * roman-numeralled `arc` composition was permanently empty — one of the two
 * declared-but-unauthorable arrays in `05-bridge-table.md`.
 */
function pointsField(hint: string): SectionFieldDef {
  return {
    key: 'points',
    label: 'Points',
    control: 'list',
    itemLabel: 'point',
    maxItems: 8,
    placeholder: 'A lead — and the gloss after a dash',
    hint,
  };
}

/**
 * The prototype's cinematic frame (introVideo/reel). A FACTORY rather than a
 * shared constant because the two sections render DIFFERENT course columns —
 * `introVideo` the intro film, `reel` the practice reel — so their pickers must
 * target different slots even though every copy field is identical.
 *
 * `clip` stays a plain text field: it is the on-frame LABEL (what the prototype
 * overlays on the frame), and it already carries authored copy in stored drafts.
 * The picker is a separate, additional control so no existing label is orphaned.
 */
function videoFields(
  mediaSlot: JourneySellMediaSlot
): readonly SectionFieldDef[] {
  return [
    { key: 'kicker', label: 'Kicker', control: 'text' },
    { key: 'heading', label: 'Heading', control: 'text' },
    { key: 'sub', label: 'Sub-line', control: 'textarea' },
    {
      key: 'clipMedia',
      label: 'Video',
      control: 'media',
      mediaSlot,
      hint: 'Pick a ready video from your media library. This is what the section plays.',
    },
    {
      key: 'clip',
      label: 'On-frame label',
      control: 'text',
      hint: 'Small caption shown over the frame. Optional.',
    },
    { key: 'duration', label: 'Duration', control: 'text' },
  ];
}

/**
 * Field sets per course-section type, grounded in the prototype's inspector
 * schema. The renderer reads the same `PageSection.props` keys.
 */
export const SECTION_FIELDS: Readonly<
  Record<CourseSectionType, readonly SectionFieldDef[]>
> = {
  hero: [
    { key: 'eyebrow', label: 'Eyebrow', control: 'text' },
    { key: 'headline', label: 'Headline', control: 'textarea' },
    {
      key: 'accent',
      label: 'Accent ending',
      control: 'text',
      hint: 'Set in italic accent at the end of the headline. Leave blank for none.',
    },
    { key: 'sub', label: 'Sub-line', control: 'textarea' },
    {
      key: 'felt',
      label: 'Emphasis line',
      control: 'text',
      hint: 'A short line under the sub-line. Optional.',
    },
    { key: 'button', label: 'Primary button', control: 'text' },
    {
      key: 'quiet',
      label: 'Quiet link',
      control: 'text',
      hint: 'A secondary link beside the button. Optional.',
    },
    {
      key: 'trust',
      label: 'Trust line',
      control: 'text',
      hint: 'Small reassurance under the buttons. Optional.',
    },
    {
      key: 'heroMedia',
      label: 'Hero image',
      control: 'media',
      mediaSlot: 'heroMediaId',
      hint: 'The image the hero shows. Pick a ready item from your media library — its still frame is used.',
    },
    {
      key: 'bg',
      label: 'Background',
      control: 'select',
      hint: 'Uses the org brand shader unless overridden in Brand & theme.',
      options: [
        { value: 'ember', label: 'Glow · warm' },
        { value: 'blood', label: 'Glow · deep' },
        { value: 'still', label: 'Still · quiet' },
      ],
    },
  ],
  introVideo: videoFields('introVideoMediaId'),
  ache: [
    ...PROSE_FIELDS,
    pointsField(
      'One per row. Used by the List and Checklist layouts; ignored by the others.'
    ),
  ],
  turn: [
    ...PROSE_FIELDS,
    pointsField(
      'One per row. Used by the Arc and Numbered layouts; ignored by the others.'
    ),
    {
      key: 'from',
      label: 'From',
      control: 'textarea',
      hint: 'The left panel of the Before / after layout — where they are now.',
    },
    {
      key: 'to',
      label: 'To',
      control: 'textarea',
      hint: 'The right panel of the Before / after layout — where they could be.',
    },
  ],
  reel: videoFields('previewVideoMediaId'),
  map: [
    { key: 'eyebrow', label: 'Eyebrow', control: 'text' },
    { key: 'heading', label: 'Heading', control: 'textarea' },
    { key: 'sub', label: 'Sub-line', control: 'textarea' },
    {
      key: 'note',
      label: 'Closing note',
      control: 'textarea',
      hint: 'Shown under the map. The stages & practices come from the course editor.',
    },
  ],
  // `inclusions[]` was read at `FeelSection:46` via `asObjectArray` with NO editor
  // of any kind, so the "what's inside" list — half of what this section is for,
  // and the content four of the six compositions arrange — was permanently empty
  // on every page (`05-bridge-table.md`). Same for the free-taste player below:
  // `previewTitle` is its on/off switch and nothing could set it.
  feel: [
    ...PROSE_FIELDS,
    {
      key: 'inclusions',
      label: "What's inside",
      control: 'repeater',
      itemLabel: 'inclusion',
      maxItems: 12,
      hint: 'The Paired, Grid, Ledger and Stack layouts arrange these. A row with no label is dropped.',
      itemFields: [
        { key: 'label', label: 'Label', control: 'text' },
        {
          key: 'detail',
          label: 'Detail',
          control: 'text',
          hint: 'Optional second line.',
        },
      ],
    },
    {
      key: 'previewTitle',
      label: 'Free-taste title',
      control: 'text',
      hint: 'Set this to show the free preview player. Leave blank to hide it.',
    },
    { key: 'previewSub', label: 'Free-taste sub-line', control: 'text' },
    {
      key: 'previewDuration',
      label: 'Free-taste length',
      control: 'number',
      hint: 'Seconds. Drives the playhead; defaults to 480.',
    },
  ],
  proof: [
    { key: 'eyebrow', label: 'Eyebrow', control: 'text' },
    { key: 'heading', label: 'Heading', control: 'text' },
    { key: 'q1', label: 'Quote 1', control: 'textarea' },
    { key: 'n1', label: 'Name 1', control: 'text' },
    { key: 'c1', label: 'Context 1', control: 'text' },
    { key: 'q2', label: 'Quote 2', control: 'textarea' },
    { key: 'n2', label: 'Name 2', control: 'text' },
    { key: 'c2', label: 'Context 2', control: 'text' },
    { key: 'q3', label: 'Quote 3', control: 'textarea' },
    { key: 'n3', label: 'Name 3', control: 'text' },
    { key: 'c3', label: 'Context 3', control: 'text' },
    {
      key: 'trust',
      label: 'Trust line',
      control: 'text',
      hint: 'Aggregate reassurance under the quotes. Optional.',
    },
  ],
  guide: [
    { key: 'role', label: 'Role / eyebrow', control: 'text' },
    { key: 'heading', label: 'Heading', control: 'textarea' },
    { key: 'body', label: 'Bio', control: 'textarea' },
    {
      key: 'quote',
      label: 'Pull-quote',
      control: 'textarea',
      hint: 'Big italic quote. Optional.',
    },
    {
      key: 'portraitMedia',
      label: 'Portrait',
      control: 'media',
      mediaSlot: 'guidePortraitMediaId',
      hint: 'The still the guide section shows beside the bio.',
    },
    {
      key: 'clipMedia',
      label: 'Video',
      control: 'media',
      mediaSlot: 'guideVideoMediaId',
      hint: 'A talking-head clip. Optional.',
    },
    {
      key: 'signatureMedia',
      label: 'Signature',
      control: 'media',
      mediaSlot: 'signatureMediaId',
      hint: 'The sign-off mark at the foot of the Letter layout. Optional.',
    },
    {
      key: 'clip',
      label: 'On-frame label',
      control: 'text',
      hint: 'Small caption shown over the frame. Optional.',
    },
    { key: 'duration', label: 'Duration', control: 'text' },
    {
      key: 'facts',
      label: 'Credentials',
      control: 'repeater',
      itemLabel: 'credential',
      maxItems: 8,
      hint: 'The hairline-ruled fact list in the Credentials layout — years practising, students taught, qualifications.',
      itemFields: [
        { key: 'label', label: 'Label', control: 'text' },
        { key: 'detail', label: 'Detail', control: 'text' },
      ],
    },
  ],
  // FAQ STAYS ON THE NUMBERED VOCABULARY, deliberately. `FaqSection` prefers an
  // `items[]` array and falls back to `q1/a1…` — so declaring a repeater on
  // `items` would create a SECOND authoring path for the same content, and the
  // array wins. A creator opening a page authored as `q1/a1` would see an empty
  // repeater, add one entry, and silently lose the three Q&As the page had been
  // serving. Converting is a data migration, not a field declaration; it is
  // reported as its own task. `g1…` extends the EXISTING vocabulary instead, so
  // the Grouped layout is authorable with no shape change and no loss.
  faq: [
    { key: 'heading', label: 'Heading', control: 'text' },
    { key: 'q1', label: 'Question 1', control: 'text' },
    { key: 'a1', label: 'Answer 1', control: 'textarea' },
    {
      key: 'g1',
      label: 'Group 1',
      control: 'text',
      hint: 'Optional. Entries sharing a group are clustered by the Grouped layout.',
    },
    { key: 'q2', label: 'Question 2', control: 'text' },
    { key: 'a2', label: 'Answer 2', control: 'textarea' },
    { key: 'g2', label: 'Group 2', control: 'text' },
    { key: 'q3', label: 'Question 3', control: 'text' },
    { key: 'a3', label: 'Answer 3', control: 'textarea' },
    { key: 'g3', label: 'Group 3', control: 'text' },
  ],
  // NO `price` FIELD, deliberately (`05-bridge-table.md`, Codex-2pryk.2.4.3). It
  // existed and was removed: prices come ONLY from `JourneySalesContext.offer`,
  // which is derived from `courses.price_cents` and the monetisation tables, so an
  // authored price line let a page advertise a number nothing behind it agreed
  // with — a page still reading "£12 a month" after the offer moved to £29, on the
  // surface a buyer decides from. The renderer never read it (`coerce.ts` has no
  // `invite.price` alias, on purpose), so removing the field removes the only way
  // to author a new one. `risk` below is where a "what's included" line goes.
  invite: [
    { key: 'eyebrow', label: 'Eyebrow', control: 'text' },
    { key: 'heading', label: 'Heading', control: 'textarea' },
    {
      key: 'accent',
      label: 'Accent line',
      control: 'text',
      hint: 'A second line, italic accent. Optional.',
    },
    { key: 'sub', label: 'Sub-line', control: 'textarea' },
    { key: 'button', label: 'Button', control: 'text' },
    {
      key: 'risk',
      label: 'Risk-reversal',
      control: 'text',
      hint: 'Reassurance under the button. Optional.',
    },
    // `offers[]` DECORATES the real ways in — it never creates one. `readDecorations`
    // (offer-paths.ts) keys each entry by canonical path id and overlays the copy
    // onto a path `deriveOfferPaths` derived from `JourneySalesContext.offer`; an
    // entry naming no available path decorates nothing and is dropped. Price and
    // cadence are read from NEITHER this bag NOR any authored string — they follow
    // from the path, which is the invariant the deleted `price` field violated.
    //
    // It was read with no editor at all (`05-bridge-table.md`), so the Tiers and
    // Comparison-table layouts had nothing to arrange and the default copy could
    // never be changed.
    {
      key: 'offers',
      label: 'Ways in',
      control: 'repeater',
      itemLabel: 'way in',
      maxItems: 6,
      hint: 'Rewrites the copy on a real way in. Prices always come from the course, never from here.',
      itemFields: [
        {
          key: 'id',
          label: 'Which way in',
          control: 'select',
          hint: 'Must name a path the course actually offers, or the entry is ignored.',
          options: [
            { value: 'purchase', label: 'One-off purchase' },
            { value: 'subscription-monthly', label: 'Subscription · monthly' },
            { value: 'subscription-annual', label: 'Subscription · annual' },
          ],
        },
        { key: 'name', label: 'Name', control: 'text' },
        {
          key: 'who',
          label: 'Who it is for',
          control: 'text',
          hint: 'One line above the price.',
        },
        { key: 'blurb', label: 'Blurb', control: 'textarea' },
        {
          key: 'bullets',
          label: 'Bullets',
          control: 'list',
          itemLabel: 'bullet',
          maxItems: 6,
        },
        {
          key: 'best',
          label: 'Recommended',
          control: 'toggle',
          hint: 'Flags this way in as the recommended one.',
        },
      ],
    },
  ],
};

/** The editable fields for a section type; a generic body field for unknown types. */
export function fieldsForSectionType(type: string): readonly SectionFieldDef[] {
  return (
    (SECTION_FIELDS as Record<string, readonly SectionFieldDef[]>)[type] ??
    GENERIC_FIELDS
  );
}
