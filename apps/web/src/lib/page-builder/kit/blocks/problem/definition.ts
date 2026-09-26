import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText, readTextList } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type ProblemProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  points?: string[];
};

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
      'One powerful sentence that names the problem.'
    ),
    layout(
      'list',
      'List',
      'The signs your visitor will recognise, one per line.'
    ),
    layout(
      'split',
      'Side by side',
      'Your words on one side, the list on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(140),
    { ...bodyField, maxLength: 600 },
    {
      key: 'points',
      label: 'Signs they will recognise',
      hint: 'One short sentence each.',
      control: 'list',
      maxItems: 6,
    },
  ],
  starter: () => ({
    heading: 'You already know something has to change',
    body: 'Most people try to fix it alone, in the gaps between everything else. It rarely lasts.',
    points: [
      'You start strong, then life gets in the way.',
      'You know what to do but cannot make it stick.',
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
      points: readTextList(raw, 'points', 6),
    }),
};
