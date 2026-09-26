import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

/** The stages themselves are live course data; only the framing is authored. */
export type CurriculumProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
};

export const curriculumDefinition: BlockDefinition<CurriculumProps> = {
  type: 'curriculum',
  label: 'Curriculum',
  description: 'The stages of your course, straight from your curriculum.',
  group: 'details',
  icon: 'LayoutListIcon',
  layouts: [
    layout('timeline', 'Timeline', 'Each stage in order down the page.'),
    layout(
      'accordion',
      'Expandable list',
      'Stages that open to show what is inside.'
    ),
    layout('cards', 'Cards', 'Each stage in its own card.'),
  ],
  fields: [eyebrowField, headingField(120), { ...bodyField, maxLength: 500 }],
  starter: ({ courseTitle }) => ({
    heading: `Inside ${courseTitle}`,
    body: 'Here is how the course unfolds, stage by stage.',
  }),
  sample: {
    heading: 'Six weeks, one step at a time',
    body: 'Each stage builds on the last, so the practice grows with you.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 500),
    }),
};
