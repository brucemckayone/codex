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

/**
 * What changes for the member, in three moments: the arc a story tells. Never
 * the syllabus, which is the curriculum's to tell (its starter is "How
 * {course} unfolds"), and words only: the creator adds the pictures. Made
 * afresh for each caller, so no two pages share a moment.
 */
function memberArc(): StoryStep[] {
  return [
    {
      heading: 'You arrive as you are.',
      body: 'No experience needed: the first session asks for twenty quiet minutes and nothing else.',
    },
    {
      heading: 'It starts to feel like yours.',
      body: 'Somewhere in the middle, the practice stops being something you follow and becomes something you do.',
    },
    {
      heading: 'You leave with it.',
      body: 'What you learn here keeps going after the last session: a practice you can come back to on your own.',
    },
  ];
}

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
        {
          key: 'image',
          label: 'Picture',
          control: 'image',
          // Each layout's frame at 1440 and 390, in the Style that cuts it most.
          focalLayouts: {
            scroll: [
              { at: 'wide', ratio: '1 / 1' },
              { at: 'phone', ratio: '4 / 5' },
            ],
            chapters: [
              { at: 'wide', ratio: '11 / 5' },
              { at: 'phone', ratio: '3 / 5' },
            ],
            strip: [
              { at: 'wide', ratio: '4 / 5' },
              { at: 'phone', ratio: '4 / 5' },
            ],
          },
        },
      ],
    },
  ],
  // The course's lede, where it has one, read as the body field reads it.
  starter: ({ courseLede }) =>
    compact({
      eyebrow: 'Your way through',
      heading: 'What changes for you',
      body: readText({ courseLede }, 'courseLede', 500),
      steps: memberArc(),
    }),
  sample: {
    eyebrow: 'Your way through',
    heading: 'What changes for you',
    body: 'Twenty minutes a day to start the day on your own terms.',
    steps: memberArc(),
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
