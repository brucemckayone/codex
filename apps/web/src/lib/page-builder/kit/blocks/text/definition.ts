import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type TextProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
};

export const textDefinition: BlockDefinition<TextProps> = {
  type: 'text',
  label: 'Text',
  description: 'A few paragraphs in your own words.',
  group: 'story',
  icon: 'EditIcon',
  layouts: [
    layout(
      'statement',
      'Big statement',
      'A large opening line with your text beneath it.'
    ),
    layout(
      'columns',
      'Two columns',
      'Your heading on one side and your text on the other.'
    ),
    layout('centered', 'Centred', 'A short, centred passage.'),
  ],
  fields: [eyebrowField, headingField(140), { ...bodyField, maxLength: 3000 }],
  starter: ({ courseTitle }) => ({
    heading: `Why I made ${courseTitle}`,
    body: `I created ${courseTitle} to share what has helped the people I work with most.\n\nIt is the course I wish I had been given when I started.`,
  }),
  sample: {
    heading: 'It started with one quiet morning',
    body: 'For years I began every day already behind. Then I tried twenty minutes of nothing but breath and a notebook, and the rest of the day changed shape.\n\nThis course is those twenty minutes, taught properly, one week at a time.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 140),
      body: readText(raw, 'body', 3000),
    }),
};
