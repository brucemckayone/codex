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

export type ProblemProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  points?: string[];
};

/** The canvas prompt where the signs would be — shown only while editing. */
export const PROBLEM_EMPTY = 'Add the signs your visitor will recognise.';

export const problemDefinition: BlockDefinition<ProblemProps> = {
  type: 'problem',
  label: 'The problem',
  description: 'Name what your visitor is struggling with, in their words.',
  group: 'story',
  icon: 'AlertCircleIcon',
  layouts: [
    layout(
      'statement',
      'Big statement',
      'One large sentence that names the problem, with the signs beneath it.'
    ),
    layout(
      'list',
      'List',
      'The signs your visitor will recognise, large, one per line.'
    ),
    layout(
      'split',
      'Side by side',
      'Your words on one side, the signs listed on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(140),
    { ...bodyField, maxLength: 600 },
    {
      key: 'points',
      label: 'Signs they will recognise',
      hint: 'One short sentence each, in their own words.',
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
  starter: () => ({
    heading: 'You already know something has to change',
    body: 'Most people try to fix it alone, in the gaps between everything else. It rarely lasts, and that is not a failing.',
    points: [
      'You start strong, then life gets in the way.',
      'You know what to do, but it never quite sticks.',
      'You want a clear path, not another list of tips.',
    ],
  }),
  sample: {
    heading: 'Your mornings start before you do',
    body: 'The phone is in your hand before your feet touch the floor, and the day is already running you.',
    points: [
      'You wake up tired, even after a full night.',
      'Your head is busy long before the day begins.',
      'You have tried apps and routines that never stuck.',
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 140),
      body: readText(raw, 'body', 600),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      points: readTextList(raw, 'points', 6),
    }),
};
