import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

/** The stages themselves are live course data; only the framing is authored. */
export type CurriculumProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
};

/** The canvas prompt where the stages would be — shown only while editing. */
export const CURRICULUM_EMPTY =
  'Your stages appear here. Add them on the Curriculum tab.';

export const curriculumDefinition: BlockDefinition<CurriculumProps> = {
  type: 'curriculum',
  label: 'Curriculum',
  description:
    'The stages of your course and what is in each, straight from your curriculum.',
  group: 'details',
  icon: 'LayoutListIcon',
  layouts: [
    layout(
      'timeline',
      'Timeline',
      'Each stage in order down the page, numbered, with its practices beside it.'
    ),
    layout(
      'accordion',
      'Expandable list',
      'Numbered stages that open to show their practices, so a long course stays easy to scan.'
    ),
    layout('cards', 'Cards', 'Each stage in its own card, side by side.'),
    layout(
      'map',
      'Journey map',
      'Your stages as stops along a drawn route, each opening to show its practices.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(120),
    { ...bodyField, maxLength: 500 },
    ...optionalCtaFields,
  ],
  starter: ({ courseTitle }) => ({
    heading: `How ${courseTitle} unfolds`,
    body: 'Each stage builds on the one before, so you always know what comes next.',
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
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
    }),
};
