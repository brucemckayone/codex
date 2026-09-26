import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type CtaProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
};

export const ctaDefinition: BlockDefinition<CtaProps> = {
  type: 'cta',
  label: 'Call to action',
  description: 'A clear invitation to join, anywhere on the page.',
  group: 'offer',
  icon: 'ArrowRightIcon',
  layouts: [
    layout(
      'band',
      'Full-width band',
      'A big closing invitation across the whole page.'
    ),
    layout(
      'split',
      'Side by side',
      'Your words on one side, the price and button on the other.'
    ),
    layout(
      'compact',
      'Slim strip',
      'One line and a button, to sit between other sections.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 300 },
    ctaLabelField,
    noteField,
  ],
  starter: ({ courseTitle }) => ({
    heading: `Ready to begin ${courseTitle}?`,
    body: 'Join today and take the first step this week.',
  }),
  sample: {
    heading: 'Your first morning starts this week',
    body: 'Join today and the first practice is waiting for you.',
    note: 'Start whenever you like.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 300),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
    }),
};
