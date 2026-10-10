import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import {
  compact,
  readBool,
  readItems,
  readText,
  readTextList,
} from '../../model/read';
import type { BlockDefinition, BlockField } from '../../model/types';

/**
 * The creator's note on a section that sells (pricing, call to action): their
 * own words, set under the text. Never the small print beside a price — that
 * is always the offer's own billing line (`derivedNote`), so it cannot
 * describe a different offer when the recommended one changes.
 */
export const offerNoteField: BlockField = {
  ...noteField,
  label: 'A short reassurance',
  hint: 'Optional. Shown under your text, like "Start whenever you like". Each price already says how it is paid.',
};

/**
 * Authored copy that DECORATES one real offer path. `id` names a canonical
 * path (`purchase`, `subscription-monthly`, `subscription-annual`,
 * `tier:<id>`); there is deliberately no price field — prices come only from
 * the live offer, so an entry can rename a path but never invent one.
 */
export interface PricingOfferCopy {
  id: string;
  name?: string;
  blurb?: string;
  bullets?: string[];
  best?: boolean;
}

export type PricingProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  offers?: PricingOfferCopy[];
};

export const pricingDefinition: BlockDefinition<PricingProps> = {
  type: 'pricing',
  label: 'Pricing',
  description:
    'The ways to join and what each costs, straight from your offer.',
  group: 'offer',
  icon: 'TagIcon',
  layouts: [
    layout(
      'cards',
      'Cards',
      'Every way to join side by side, with the one you recommend highlighted.'
    ),
    layout(
      'focus',
      'One clear offer',
      'Your recommended option up front, with the others listed underneath.'
    ),
    layout(
      'band',
      'Price strip',
      'A single strip with the price and the button.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    ctaLabelField,
    offerNoteField,
    {
      key: 'offers',
      label: 'Describe your options',
      hint: 'Prices always come from your Offer tab. Here you can rename an option and add a few points about it.',
      control: 'items',
      maxItems: 6,
      itemFields: [
        {
          key: 'id',
          label: 'Which option',
          hint: 'Choose one of the options set up in your Offer tab.',
          control: 'text',
          maxLength: 80,
        },
        { key: 'name', label: 'Name', control: 'text', maxLength: 60 },
        {
          key: 'blurb',
          label: 'One line about it',
          control: 'text',
          maxLength: 140,
        },
        {
          key: 'bullets',
          label: 'What is included',
          control: 'list',
          maxItems: 6,
        },
        { key: 'best', label: 'Recommend this option', control: 'toggle' },
      ],
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `Start ${courseTitle}`,
    body: 'Choose the way to join that suits you best.',
  }),
  sample: {
    heading: 'Choose how you join',
    body: 'Every option opens the full course from the first day.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      offers: readItems(
        raw,
        'offers',
        (entry) => {
          const id = readText(entry, 'id', 80);
          if (!id) return null;
          return compact({
            id,
            name: readText(entry, 'name', 60),
            blurb: readText(entry, 'blurb', 140),
            bullets: readTextList(entry, 'bullets', 6),
            best: readBool(entry, 'best'),
          });
        },
        6
      ),
    }),
};
