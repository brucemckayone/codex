import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText, readTextList } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type TransformationProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  beforeLabel?: string;
  afterLabel?: string;
  before?: string[];
  after?: string[];
};

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
      'Before and after',
      'Two columns: where they are now and where they will be.'
    ),
    layout('steps', 'Step by step', 'The change as a short sequence.'),
    layout(
      'statement',
      'Big statement',
      'One sentence that captures the change.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(140),
    { ...bodyField, maxLength: 600 },
    {
      key: 'beforeLabel',
      label: 'Before heading',
      control: 'text',
      inline: true,
      maxLength: 40,
    },
    { key: 'before', label: 'Before', control: 'list', maxItems: 6 },
    {
      key: 'afterLabel',
      label: 'After heading',
      control: 'text',
      inline: true,
      maxLength: 40,
    },
    { key: 'after', label: 'After', control: 'list', maxItems: 6 },
  ],
  starter: ({ courseTitle }) => ({
    heading: `How ${courseTitle} changes things`,
    beforeLabel: 'Before',
    afterLabel: 'After',
    before: [
      'Starting over every Monday',
      'Unsure what to do next',
      'Doing it all alone',
    ],
    after: [
      'A routine that holds',
      'A clear next step every day',
      'Guidance along the way',
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
      beforeLabel: readText(raw, 'beforeLabel', 40),
      afterLabel: readText(raw, 'afterLabel', 40),
      before: readTextList(raw, 'before', 6),
      after: readTextList(raw, 'after', 6),
    }),
};
