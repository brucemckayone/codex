import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { SECTION_LAYOUTS } from '../../model/ids';
import { compact, firstItem, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';
import { unwrapQuote, voices } from './voices';

/** The layouts that draw the first quote larger than the rest. */
const LEADING_LAYOUTS: readonly string[] = ['featured', 'quote', 'wall'];

export interface TestimonialItem {
  quote: string;
  name?: string;
  detail?: string;
  /** Their face beside their name (Codex-61zsk.58); initials stand in for the rest. */
  photo?: ImageRef;
}

/**
 * Authored `items` are shown AFTER the course's live testimonials, so a creator
 * can add a quote from elsewhere without it displacing the real ones.
 */
export type TestimonialsProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  items?: TestimonialItem[];
};

/** The canvas prompt where the quotes would be — shown only while editing. */
export const TESTIMONIALS_EMPTY =
  'Add a few words from your members under “Quotes”, and they appear here.';

export const testimonialsDefinition: BlockDefinition<TestimonialsProps> = {
  type: 'testimonials',
  label: 'Testimonials',
  description:
    'What members say, from your course testimonials and any quotes you add here.',
  group: 'proof',
  icon: 'HeartIcon',
  layouts: [
    layout(
      'grid',
      'Grid',
      'Your quotes side by side, each given the same space.'
    ),
    layout(
      'featured',
      'Highlighted',
      'Your first quote large in a highlighted panel, the others in a row beneath.'
    ),
    layout(
      'quote',
      'Big quote',
      'Your first quote as large as it goes, centred. Any others follow quietly beneath.'
    ),
    layout(
      'marquee',
      'Moving strip',
      'Your quotes drift slowly across the page, with a button to pause them.'
    ),
    layout(
      'wall',
      'Wall',
      'Every quote on one wall of tiles, the first highlighted and short ones set large.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'items',
      label: 'Quotes',
      hint: 'Shown after the testimonials from your course. Use their own words, and their name only if they are happy to share it.',
      control: 'items',
      maxItems: 9,
      itemFields: [
        { key: 'quote', label: 'Quote', control: 'textarea', maxLength: 500 },
        {
          key: 'name',
          label: 'Name',
          hint: 'Optional, for example "Priya S."',
          control: 'text',
          maxLength: 80,
        },
        {
          key: 'detail',
          label: 'Who they are',
          hint: 'Optional, for example "Nurse, night shifts".',
          control: 'text',
          maxLength: 80,
        },
        {
          key: 'photo',
          label: 'Their photo',
          hint: 'Optional, and only if they are happy for you to use it. A small round photo beside their name; once one quote has a photo, the others show their initials.',
          control: 'image',
          decorative: true,
          // A circle beside the name, in every layout and Style.
          focalLayouts: Object.fromEntries(
            SECTION_LAYOUTS.testimonials.map((id) => [
              id,
              [
                { at: 'wide', ratio: '1 / 1' },
                { at: 'phone', ratio: '1 / 1' },
              ],
            ])
          ),
        },
      ],
    },
    ...optionalCtaFields,
  ],
  // No quotes: a starter never puts words in a real person's mouth. The
  // course's own testimonials fill it; the creator adds any others.
  starter: ({ courseTitle }) => ({
    heading: `What people say about ${courseTitle}`,
  }),
  sample: {
    heading: 'What members say',
    items: [
      {
        quote: 'Twenty minutes, and the whole day feels less loud.',
        name: 'Tom W.',
        detail: 'Nurse, night shifts',
      },
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      items: readItems(
        raw,
        'items',
        (entry) => {
          const quote = readText(entry, 'quote', 500);
          return quote
            ? compact({
                quote,
                name: readText(entry, 'name', 80),
                detail: readText(entry, 'detail', 80),
                photo: isImageRef(entry.photo) ? entry.photo : undefined,
              })
            : null;
        },
        9
      ),
    }),
  // The course's own testimonials come first, so a quote added here leads
  // only when the course has none.
  leadingItem: (raw, layout, context) =>
    LEADING_LAYOUTS.includes(layout) &&
    voices(context.testimonials).length === 0
      ? firstItem(raw, 'items', (entry) =>
          Boolean(unwrapQuote(readText(entry, 'quote', 500) ?? ''))
        )
      : null,
};
