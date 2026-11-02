import type { SellPreview } from '../../../render/types';
import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { PAGE_STYLE_IDS, type PageStyleId } from '../../model/ids';
import { compact, readText, readTextList } from '../../model/read';
import { readStillFocus, type StillFocus } from '../../model/still-focus';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

export type InstructorProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  name?: string;
  role?: string;
  credentials?: string[];
  quote?: string;
  /** Where the portrait is cropped round on this page (`model/still-focus.ts`). */
  stillFocus?: StillFocus;
};

/** The Styles that draw the centred portrait square; the rest keep it 4:5. */
const SQUARE_CENTRED: readonly PageStyleId[] = ['bold', 'soft'];
const UPRIGHT_CENTRED = PAGE_STYLE_IDS.filter(
  (style) => !SQUARE_CENTRED.includes(style)
);

/** The guide's portrait, else the frame of their clip: the still the portrait draws. */
export function guideStill(
  preview: SellPreview | null | undefined
): string | null {
  return preview?.guidePortraitUrl ?? preview?.guideClip?.posterUrl ?? null;
}

/** The canvas's words for a portrait slot with nothing in it (creator-facing, A1). */
export const INSTRUCTOR_PROMPT =
  'Add your photo as the guide portrait in Settings → Media.';

export const instructorDefinition: BlockDefinition<InstructorProps> = {
  type: 'instructor',
  label: 'About you',
  description: 'Introduce yourself: who you are and why you teach this.',
  group: 'proof',
  icon: 'UserIcon',
  layouts: [
    layout(
      'split',
      'Side by side',
      'Your photo on one side, your story on the other.'
    ),
    layout(
      'quote',
      'Quote',
      'A line in your own words, large, signed with your name and photo.'
    ),
    layout(
      'centered',
      'Centred',
      'Your photo at the top, with your story centred beneath it.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, label: 'Your story', maxLength: 1500 },
    {
      key: 'name',
      label: 'Your name',
      control: 'text',
      inline: true,
      maxLength: 80,
    },
    {
      key: 'role',
      label: 'What you do',
      hint: 'For example "Breathwork teacher".',
      control: 'text',
      inline: true,
      maxLength: 80,
    },
    {
      key: 'credentials',
      label: 'Credentials',
      hint: 'Short facts about you, like "12 years teaching".',
      control: 'list',
      maxItems: 6,
    },
    {
      key: 'quote',
      label: 'A line in your own words',
      hint: 'Optional. One sentence in your own voice, shown as a quote.',
      control: 'textarea',
      inline: true,
      maxLength: 240,
    },
    ...optionalCtaFields,
    {
      key: 'guidePortraitMediaId',
      label: 'Your photo',
      control: 'media',
      mediaSlot: 'guidePortraitMediaId',
    },
    {
      key: 'guideVideoMediaId',
      label: 'A short clip of you',
      hint: 'Optional. Visitors can play it from your photo.',
      control: 'media',
      mediaSlot: 'guideVideoMediaId',
    },
  ],
  // No name, credentials or quote: a starter never puts words in the
  // creator's mouth or claims on their behalf.
  starter: ({ courseTitle }) => ({
    heading: 'Meet your guide',
    body: `I created ${courseTitle} to share what has helped the people I work with most.`,
  }),
  sample: {
    heading: 'Hello, I am Maya',
    body: 'I have taught breath and movement for twelve years, first in studios and now online. This course is everything I teach in my one-to-one sessions, in the order I teach it.',
    name: 'Maya Linden',
    role: 'Breathwork teacher',
    // Two that lead with a figure and one that does not, so the sample
    // shows the ledger's both kinds of row (Codex-61zsk.73).
    credentials: [
      '12 years teaching',
      '4,000+ students',
      'Trained in Mysore and London',
    ],
    quote:
      'You do not need more discipline. You need a better first twenty minutes.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 1500),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      name: readText(raw, 'name', 80),
      role: readText(raw, 'role', 80),
      credentials: readTextList(raw, 'credentials', 6),
      quote: readText(raw, 'quote', 240),
      stillFocus: readStillFocus(raw.stillFocus),
    }),
  // The portrait's frame in each layout, on every screen: split 4/5; the
  // quote's sign-off square; centred 4/5, but square where Bold and Soft draw
  // it so (InstructorBlock's Style rules).
  stillFocus: {
    focalLayouts: {
      split: [
        { at: 'wide', ratio: '4 / 5' },
        { at: 'phone', ratio: '4 / 5' },
      ],
      centered: [
        { at: 'wide', ratio: '4 / 5', styles: UPRIGHT_CENTRED },
        { at: 'phone', ratio: '4 / 5', styles: UPRIGHT_CENTRED },
        { at: 'wide', ratio: '1 / 1', styles: SQUARE_CENTRED },
        { at: 'phone', ratio: '1 / 1', styles: SQUARE_CENTRED },
      ],
      quote: [
        { at: 'wide', ratio: '1 / 1' },
        { at: 'phone', ratio: '1 / 1' },
      ],
    },
    still: (_raw, preview) => guideStill(preview),
  },
};
