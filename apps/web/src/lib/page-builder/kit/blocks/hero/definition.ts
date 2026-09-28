import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readOneOf, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export const HERO_MEDIA_MODES = ['auto', 'image', 'video', 'none'] as const;
export type HeroMediaMode = (typeof HERO_MEDIA_MODES)[number];

export type HeroProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  media?: HeroMediaMode;
  watchLabel?: string;
  /** Replaces the course hero still (contract A5); a clip still plays over it. */
  image?: ImageRef;
};

export const heroDefinition: BlockDefinition<HeroProps> = {
  type: 'hero',
  label: 'Hero',
  description:
    'The first thing visitors see: your promise and the button to join.',
  group: 'opening',
  icon: 'SparkleIcon',
  max: 1,
  layouts: [
    layout(
      'statement',
      'Statement',
      'Your headline as big as it gets, with the image running full width below.'
    ),
    layout(
      'split',
      'Side by side',
      'Words on one side, your image or clip on the other.'
    ),
    layout(
      'cover',
      'Full-screen image',
      'Your image fills the screen with the words over it.'
    ),
    layout(
      'centered',
      'Centred',
      'Everything centred, with a wide image underneath.'
    ),
    layout(
      'poster',
      'Poster',
      'Your headline as large as it goes, set around an image that runs off the edge.'
    ),
  ],
  fields: [
    eyebrowField,
    {
      ...headingField(120),
      label: 'Headline',
      hint: 'Leave empty to use the course title.',
    },
    { ...bodyField, label: 'Text under the headline', maxLength: 400 },
    ctaLabelField,
    noteField,
    {
      key: 'secondaryLabel',
      label: 'Second button text',
      hint: 'Optional, for example "See what is inside".',
      control: 'text',
      maxLength: 40,
    },
    {
      key: 'secondaryHref',
      label: 'Second button link',
      hint: 'A web address, or a section on this page such as #curriculum.',
      control: 'url',
      maxLength: 500,
    },
    {
      key: 'heroMediaId',
      label: 'Hero image or clip',
      control: 'media',
      mediaSlot: 'heroMediaId',
    },
    {
      key: 'image',
      label: 'Your own image',
      hint: 'Replaces the course image here. When the hero plays a clip, pick "The image only" below to show this instead.',
      control: 'image',
      decorative: true,
    },
    {
      key: 'media',
      label: 'What to show',
      control: 'select',
      options: [
        {
          value: 'auto',
          label: 'The clip if there is one, otherwise the image',
        },
        { value: 'image', label: 'The image only' },
        { value: 'video', label: 'The clip, playing silently' },
        { value: 'none', label: 'No image' },
      ],
    },
    {
      key: 'watchLabel',
      label: 'Play button text',
      hint: 'Shown when the hero plays a clip. Leave empty for "Watch the film".',
      control: 'text',
      maxLength: 40,
    },
  ],
  starter: ({ courseTitle, courseLede }) => ({
    heading: courseTitle,
    body:
      courseLede?.trim() ||
      `Everything you need to begin ${courseTitle}, one clear step at a time.`,
  }),
  sample: {
    heading: 'Find your steady ground',
    body: 'A six-week practice for calmer mornings, clearer thinking and a body that feels like home.',
    note: 'Start whenever you like.',
    secondaryLabel: 'See what is inside',
    secondaryHref: '#curriculum',
    media: 'auto',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 120),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      secondaryLabel: readText(raw, 'secondaryLabel', 40),
      secondaryHref: readText(raw, 'secondaryHref', 500),
      media: readOneOf(raw, 'media', HERO_MEDIA_MODES),
      watchLabel: readText(raw, 'watchLabel', 40),
      image: isImageRef(raw.image) ? raw.image : undefined,
    }),
};
