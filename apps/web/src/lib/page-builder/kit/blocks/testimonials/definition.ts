import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

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
  items?: TestimonialItem[];
};

export const testimonialsDefinition: BlockDefinition<TestimonialsProps> = {
  type: 'testimonials',
  label: 'Testimonials',
  description: 'What members say, from your testimonials and any you add here.',
  group: 'proof',
  icon: 'HeartIcon',
  layouts: [
    layout('grid', 'Grid', 'Several short quotes together.'),
    layout(
      'featured',
      'One big quote',
      'One standout quote, with the others beside it.'
    ),
    layout('quote', 'Single quote', 'One quote, large and centred.'),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'items',
      label: 'Extra quotes',
      hint: 'Shown after the testimonials from your course.',
      control: 'items',
      maxItems: 9,
      itemFields: [
        { key: 'quote', label: 'Quote', control: 'textarea', maxLength: 500 },
        { key: 'name', label: 'Name', control: 'text', maxLength: 80 },
        {
          key: 'detail',
          label: 'Who they are',
          control: 'text',
          maxLength: 80,
        },
      ],
    },
  ],
  starter: () => ({ heading: 'What members say' }),
  sample: {
    heading: 'What members say',
    items: [
      {
        quote:
          'I have tried every morning routine going. This is the first one I still do.',
        name: 'Priya S.',
        detail: 'Spring group',
      },
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
