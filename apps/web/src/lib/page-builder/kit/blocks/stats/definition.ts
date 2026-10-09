import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readBool, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

export interface StatItem {
  value: string;
  label: string;
}

export type StatsProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  items?: StatItem[];
  /** Show the course's own numbers (stages, practices) from its curriculum. */
  live?: boolean;
};

/** The canvas's words for a section with no numbers yet (creator-facing, A1). */
export const STATS_PROMPT =
  'Turn on “Show my course numbers”, or add numbers of your own.';

export const statsDefinition: BlockDefinition<StatsProps> = {
  type: 'stats',
  label: 'Numbers',
  description: 'A few numbers that tell the story at a glance.',
  group: 'proof',
  icon: 'LayoutGridIcon',
  layouts: [
    layout(
      'row',
      'In a row',
      'Big numbers side by side under your heading, divided by fine lines.'
    ),
    layout(
      'grid',
      'Tiles',
      'Your heading on one side and the numbers in tiles on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 300 },
    {
      key: 'live',
      label: 'Show my course numbers',
      hint: 'Adds how many stages and practices your course has, straight from your curriculum.',
      control: 'toggle',
    },
    {
      key: 'items',
      label: 'Your own numbers',
      hint: 'Shown after your course numbers. Keep each one short, like "4,000+" and "students taught".',
      control: 'items',
      maxItems: 4,
      itemFields: [
        { key: 'value', label: 'Number', control: 'text', maxLength: 12 },
        {
          key: 'label',
          label: 'What it counts',
          control: 'text',
          maxLength: 60,
        },
      ],
    },
    ...optionalCtaFields,
  ],
  // Only the course's own counts: a starter never makes claims (students,
  // ratings) on the creator's behalf.
  starter: ({ courseTitle }) => ({
    heading: `${courseTitle} at a glance`,
    live: true,
  }),
  sample: {
    heading: 'Twenty minutes a day, for six weeks',
    live: true,
    items: [
      { value: '4,000+', label: 'students taught' },
      { value: '20 min', label: 'a day' },
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 300),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      live: readBool(raw, 'live'),
      items: readItems(
        raw,
        'items',
        (entry) => {
          const value = readText(entry, 'value', 12);
          const label = readText(entry, 'label', 60);
          return value && label ? { value, label } : null;
        },
        4
      ),
    }),
};
