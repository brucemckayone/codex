import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readBool, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export interface StatItem {
  value: string;
  label: string;
}

export type StatsProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  items?: StatItem[];
  /** Show the course's own numbers (stages, practices) from its curriculum. */
  live?: boolean;
};

export const statsDefinition: BlockDefinition<StatsProps> = {
  type: 'stats',
  label: 'Numbers',
  description: 'A few numbers that tell the story at a glance.',
  group: 'proof',
  icon: 'LayoutGridIcon',
  layouts: [
    layout('row', 'Row', 'Your numbers in a single line.'),
    layout('grid', 'Grid', 'Your numbers in tiles.'),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 300 },
    {
      key: 'live',
      label: 'Show my course numbers',
      hint: 'The number of stages and practices, straight from your curriculum.',
      control: 'toggle',
    },
    {
      key: 'items',
      label: 'Your own numbers',
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
  ],
  starter: () => ({ live: true }),
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
