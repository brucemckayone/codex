import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readText, readTextList } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type TransformationProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  beforeLabel?: string;
  afterLabel?: string;
  before?: string[];
  after?: string[];
};

/** The canvas prompt where the change would be — shown only while editing. */
export const TRANSFORMATION_EMPTY =
  'Add a few before and after lines to show the change.';

export const transformationDefinition: BlockDefinition<TransformationProps> = {
  type: 'transformation',
  label: 'Before and after',
  description:
    'Show the change: where your visitor is now and where they will be.',
  group: 'story',
  icon: 'TrendingUpIcon',
  layouts: [
    layout(
      'columns',
      'Two columns',
      'Where they are now beside where they will be, line for line.'
    ),
    layout(
      'steps',
      'Change by change',
      'Each before joined to its after, one change per row.'
    ),
    layout(
      'statement',
      'Big statement',
      'The before lines quiet, the after lines large, one beneath the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(140),
    { ...bodyField, maxLength: 600 },
    {
      key: 'beforeLabel',
      label: 'Before title',
      hint: 'A few words above the before lines, like "Where you are now".',
      control: 'text',
      inline: true,
      maxLength: 40,
    },
    {
      key: 'before',
      label: 'Before',
      hint: 'One short line each. Each pairs with the after line in the same place.',
      control: 'list',
      maxItems: 6,
    },
    {
      key: 'afterLabel',
      label: 'After title',
      hint: 'A few words above the after lines, like "Where this takes you".',
      control: 'text',
      inline: true,
      maxLength: 40,
    },
    {
      key: 'after',
      label: 'After',
      hint: 'One short line each, in the same order as the before lines.',
      control: 'list',
      maxItems: 6,
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
    heading: `Where ${courseTitle} takes you`,
    beforeLabel: 'Where you are now',
    afterLabel: `After ${courseTitle}`,
    before: [
      'Starting over every Monday',
      'Unsure what to do next',
      'Figuring it out alone',
    ],
    after: [
      'A routine that holds',
      'A clear next step every day',
      'Guidance whenever you need it',
    ],
  }),
  sample: {
    heading: 'From running on empty to steady ground',
    beforeLabel: 'Where you are',
    afterLabel: 'Where this goes',
    before: [
      'Mornings that start in a rush',
      'A mind that will not settle',
      'Energy that is gone by noon',
    ],
    after: [
      'A quiet first twenty minutes',
      'Room to think before you react',
      'Energy that lasts into the evening',
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 140),
      body: readText(raw, 'body', 600),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      beforeLabel: readText(raw, 'beforeLabel', 40),
      afterLabel: readText(raw, 'afterLabel', 40),
      before: readTextList(raw, 'before', 6),
      after: readTextList(raw, 'after', 6),
    }),
};
