import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export interface BenefitItem {
  title: string;
  detail?: string;
  /** Atop the tile in `grid` (contract A5). */
  image?: ImageRef;
}

export type BenefitsProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  items?: BenefitItem[];
};

/** The canvas prompt where the items would be — shown only while editing. */
export const BENEFITS_EMPTY = 'Add what is included, one item at a time.';

export const benefitsDefinition: BlockDefinition<BenefitsProps> = {
  type: 'benefits',
  label: "What's included",
  description: 'Everything a member gets, set out clearly.',
  group: 'offer',
  icon: 'CheckCircleIcon',
  layouts: [
    layout(
      'grid',
      'Grid',
      'Each item in its own tile, with a line about it underneath.'
    ),
    layout(
      'checklist',
      'Checklist',
      'A compact list in two columns, with a tick beside each item.'
    ),
    layout(
      'split',
      'Side by side',
      'Your words on one side, the list on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(120),
    { ...bodyField, maxLength: 500 },
    {
      key: 'items',
      label: 'What is included',
      hint: 'A short name for each thing, and a line about it if you like.',
      control: 'items',
      maxItems: 9,
      itemFields: [
        { key: 'title', label: 'Item', control: 'text', maxLength: 80 },
        {
          key: 'detail',
          label: 'One line about it',
          control: 'text',
          maxLength: 160,
        },
        {
          key: 'image',
          label: 'Image',
          hint: 'Optional. Shown at the top of this item in the grid.',
          control: 'image',
          layouts: ['grid'],
        },
      ],
    },
    {
      ...ctaLabelField,
      hint: 'Optional. Add button text to show a join button here.',
    },
    {
      ...noteField,
      hint: 'Optional. A short reassurance under the button.',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `What is included in ${courseTitle}`,
    items: [
      {
        title: 'Step-by-step lessons',
        detail: 'Follow along at a pace that suits you.',
      },
      {
        title: 'Practices to keep',
        detail: 'Short exercises to use between lessons.',
      },
      {
        title: 'Everything in one place',
        detail: 'Pick up where you left off on any device.',
      },
    ],
  }),
  sample: {
    heading: 'Everything you need, nothing you do not',
    items: [
      {
        title: 'Six guided weeks',
        detail: 'One short practice a day, building week on week.',
      },
      {
        title: 'A practice library',
        detail: 'Twenty-four sessions you can return to any time.',
      },
      {
        title: 'Printable journal',
        detail: 'Prompts for the five minutes after each practice.',
      },
      {
        title: 'Audio for the walk',
        detail: 'Every session also comes as a download.',
      },
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 500),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      items: readItems(
        raw,
        'items',
        (entry) => {
          const title = readText(entry, 'title', 80);
          return title
            ? compact({
                title,
                detail: readText(entry, 'detail', 160),
                image: isImageRef(entry.image) ? entry.image : undefined,
              })
            : null;
        },
        9
      ),
    }),
};
