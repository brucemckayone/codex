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

/** The control a field renders as in the config editor. */
export type SectionFieldControl = 'text' | 'textarea' | 'select' | 'media';

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
   * `sellPreview.reel`, and the guide reads `portraitUrl` — all projected from
   * `courses.*MediaId`. So a picker that wrote into `props` could never affect
   * what renders, which is exactly why the old control was a decorative text
   * input. Naming the slot here points the picker at the column the section
   * actually reads.
   */
  readonly mediaSlot?: JourneySellMediaSlot;
}

const GENERIC_FIELDS: readonly SectionFieldDef[] = [
  {
    key: 'body',
    label: 'Body',
    control: 'textarea',
    placeholder: 'Section copy…',
  },
];

/** Shared "prose" field set — the prototype's one text renderer (ache/turn/feel). */
const PROSE_FIELDS: readonly SectionFieldDef[] = [
  { key: 'kicker', label: 'Kicker', control: 'text' },
  { key: 'heading', label: 'Heading', control: 'textarea' },
  { key: 'body', label: 'Body', control: 'textarea' },
];

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
  ache: PROSE_FIELDS,
  turn: PROSE_FIELDS,
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
  feel: PROSE_FIELDS,
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
      key: 'clip',
      label: 'On-frame label',
      control: 'text',
      hint: 'Small caption shown over the frame. Optional.',
    },
    { key: 'duration', label: 'Duration', control: 'text' },
  ],
  faq: [
    { key: 'heading', label: 'Heading', control: 'text' },
    { key: 'q1', label: 'Question 1', control: 'text' },
    { key: 'a1', label: 'Answer 1', control: 'textarea' },
    { key: 'q2', label: 'Question 2', control: 'text' },
    { key: 'a2', label: 'Answer 2', control: 'textarea' },
    { key: 'q3', label: 'Question 3', control: 'text' },
    { key: 'a3', label: 'Answer 3', control: 'textarea' },
  ],
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
    {
      key: 'price',
      label: 'Price line',
      control: 'text',
      hint: 'Wrap the amount in the offer. e.g. Included with membership · £12 a month',
    },
    { key: 'button', label: 'Button', control: 'text' },
    {
      key: 'risk',
      label: 'Risk-reversal',
      control: 'text',
      hint: 'Reassurance under the button. Optional.',
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
