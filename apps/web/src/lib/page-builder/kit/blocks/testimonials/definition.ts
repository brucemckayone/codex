import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

export interface TestimonialItem {
  quote: string;
  name?: string;
  detail?: string;
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
              })
            : null;
        },
        9
      ),
    }),
};
