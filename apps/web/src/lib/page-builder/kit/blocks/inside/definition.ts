import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

/**
 * The practices themselves are live course data (`context.stages`); only the
 * framing is authored. A pure showcase (03 X63): no button, no links.
 */
export type InsideProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
};

/** The canvas prompt where the practices would be — shown only while editing. */
export const INSIDE_EMPTY =
  'Your practices appear here. Add them on the Curriculum tab.';

export const insideDefinition: BlockDefinition<InsideProps> = {
  type: 'inside',
  label: "What's inside",
  description:
    'Every practice in your course as a picture to swipe through, in order, straight from your curriculum.',
  group: 'details',
  icon: 'LibraryIcon',
  layouts: [
    layout(
      'carousel',
      'Carousel',
      'A row of practice cards that visitors swipe through, each with its picture, kind, length and stage.'
    ),
  ],
  fields: [eyebrowField, headingField(120), { ...bodyField, maxLength: 300 }],
  starter: ({ courseTitle }) => ({
    heading: "What's inside",
    body: `Every practice in ${courseTitle}, in the order you'll meet them.`,
  }),
  sample: {
    heading: "What's inside",
    body: "Every practice in Steady Ground, in the order you'll meet them.",
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 300),
    }),
};
