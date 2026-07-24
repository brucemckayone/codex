/**
 * Per-section editable-field model (Codex-2pryk.3.3 · WP-5).
 *
 * The pragmatic analog of `brand-editor/levels/*`: it declares which copy fields
 * the rail's config editor renders for each {@link CourseSectionType}. The exact
 * per-type prop schema is deliberately NOT frozen (SPEC §4.1 / `journey-queries`
 * comment: the WP-3 renderer + WP-5 editor co-own it), so this is EXTENSIBLE —
 * add fields here and the public renderer reads the same `PageSection.props`
 * keys. Unknown/absent types fall back to a generic body field.
 *
 * Pure + framework-free — no component imports — so it stays cheap to unit-test
 * and cheap to bundle in the editor chunk.
 */
import type { CourseSectionType } from '@codex/shared-types';

/** The control a field renders as in the config editor. */
export type SectionFieldControl = 'text' | 'textarea';

export interface SectionFieldDef {
  /** The `PageSection.props` key this field reads/writes. */
  readonly key: string;
  readonly label: string;
  readonly control: SectionFieldControl;
  readonly placeholder?: string;
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
 * Field sets per course-section type, grounded in the prototype's section copy
 * (`docs/design/course-journeys/prototype/`). Keys are additive: extend a set
 * without breaking stored drafts (an unknown key is simply ignored on render).
 */
export const SECTION_FIELDS: Readonly<
  Record<CourseSectionType, readonly SectionFieldDef[]>
> = {
  hero: [
    {
      key: 'kicker',
      label: 'Kicker',
      control: 'text',
      placeholder: 'A 6-week descent',
    },
    {
      key: 'headline',
      label: 'Headline',
      control: 'text',
      placeholder: 'Come home to stillness',
    },
    { key: 'subhead', label: 'Subhead', control: 'textarea' },
    {
      key: 'ctaLabel',
      label: 'Primary CTA label',
      control: 'text',
      placeholder: 'Begin the journey',
    },
  ],
  introVideo: [
    { key: 'headline', label: 'Headline', control: 'text' },
    {
      key: 'mediaId',
      label: 'Media id',
      control: 'text',
      placeholder: 'Sell/intro video id',
    },
    { key: 'caption', label: 'Caption', control: 'textarea' },
  ],
  ache: [
    { key: 'headline', label: 'Headline', control: 'text' },
    {
      key: 'body',
      label: 'Body',
      control: 'textarea',
      placeholder: 'Name the ache…',
    },
  ],
  turn: [
    { key: 'headline', label: 'Headline', control: 'text' },
    {
      key: 'body',
      label: 'Body',
      control: 'textarea',
      placeholder: 'The shift on offer…',
    },
  ],
  reel: [
    { key: 'headline', label: 'Headline', control: 'text' },
    { key: 'caption', label: 'Caption', control: 'textarea' },
  ],
  map: [
    {
      key: 'headline',
      label: 'Headline',
      control: 'text',
      placeholder: 'The descent',
    },
    { key: 'intro', label: 'Intro', control: 'textarea' },
  ],
  feel: [
    { key: 'headline', label: 'Headline', control: 'text' },
    { key: 'body', label: 'Body', control: 'textarea' },
    {
      key: 'freeTasteLabel',
      label: 'Free-taste label',
      control: 'text',
      placeholder: 'Take a free breath',
    },
  ],
  proof: [
    {
      key: 'headline',
      label: 'Headline',
      control: 'text',
      placeholder: 'What members say',
    },
  ],
  guide: [
    { key: 'name', label: 'Guide name', control: 'text' },
    { key: 'bio', label: 'Bio', control: 'textarea' },
    { key: 'mediaId', label: 'Guide video id', control: 'text' },
  ],
  faq: [
    {
      key: 'headline',
      label: 'Headline',
      control: 'text',
      placeholder: 'Questions',
    },
  ],
  invite: [
    {
      key: 'headline',
      label: 'Headline',
      control: 'text',
      placeholder: 'Join the journey',
    },
    { key: 'body', label: 'Body', control: 'textarea' },
    {
      key: 'ctaLabel',
      label: 'CTA label',
      control: 'text',
      placeholder: 'Enrol now',
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
