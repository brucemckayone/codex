import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export interface StoryStep {
  heading: string;
  body?: string;
  image?: ImageRef;
}

export type StoryProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  steps?: StoryStep[];
};

/** The canvas prompt where the steps would be — shown only while editing. */
export const STORY_EMPTY = 'Add the moments of the journey, one at a time.';

export const MAX_STORY_STEPS = 8;

export const storyDefinition: BlockDefinition<StoryProps> = {
  type: 'story',
  label: 'Story',
  description: 'The journey told in moments, each with its own picture.',
  group: 'story',
  icon: 'CompassIcon',
  layouts: [
    layout(
      'scroll',
      'Scroll story',
      'The picture beside the words changes as visitors read each moment.'
    ),
    layout(
      'chapters',
      'Chapters',
      'Each moment fills the width, with its picture behind the words.'
    ),
    layout(
      'strip',
      'Strip',
      'The moments in a row that visitors swipe through.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(120),
    { ...bodyField, maxLength: 500 },
    {
      key: 'steps',
      label: 'Moments',
      hint: 'Each moment of the journey in order: a short heading, a few words and a picture.',
      control: 'items',
      maxItems: MAX_STORY_STEPS,
      itemFields: [
        { key: 'heading', label: 'Heading', control: 'text', maxLength: 100 },
        {
          key: 'body',
          label: 'A few words',
          control: 'textarea',
          maxLength: 400,
        },
        { key: 'image', label: 'Picture', control: 'image' },
      ],
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `How ${courseTitle} unfolds`,
    steps: [
      {
        heading: 'Where you begin',
        body: 'Arrive as you are. The first stage meets you there.',
      },
      {
        heading: 'What starts to shift',
        body: 'Small practices, repeated, begin to change how the days feel.',
      },
      {
        heading: 'Where you arrive',
        body: 'You leave with a practice of your own, and the way back to it.',
      },
    ],
  }),
  sample: {
    heading: 'How the six weeks unfold',
    steps: [
      {
        heading: 'Week one: arriving',
        body: 'Ten quiet minutes a day to notice where you are starting from.',
      },
      {
        heading: 'Weeks two to four: the work',
        body: 'The practices deepen, one small step at a time.',
      },
      {
        heading: 'Weeks five and six: your own practice',
        body: 'You shape a routine that fits the life you actually have.',
      },
    ],
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 500),
      steps: readItems(
        raw,
        'steps',
        (entry) => {
          const heading = readText(entry, 'heading', 100);
          return heading
            ? compact({
                heading,
                body: readText(entry, 'body', 400),
                image: isImageRef(entry.image) ? entry.image : undefined,
              })
            : null;
        },
        MAX_STORY_STEPS
      ),
    }),
};
