import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type VideoProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  caption?: string;
};

export const videoDefinition: BlockDefinition<VideoProps> = {
  type: 'video',
  label: 'Video',
  description: 'Your introduction film, shown large.',
  group: 'opening',
  icon: 'FilmIcon',
  layouts: [
    layout(
      'theatre',
      'Big screen',
      'The film fills the width, with your words above it.'
    ),
    layout(
      'split',
      'Side by side',
      'The film on one side, your words on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'caption',
      label: 'Caption under the film',
      control: 'text',
      inline: true,
      maxLength: 140,
    },
    {
      key: 'introVideoMediaId',
      label: 'Introduction film',
      control: 'media',
      mediaSlot: 'introVideoMediaId',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `See what ${courseTitle} is like`,
    body: 'A short film about how the course works and who it is for.',
  }),
  sample: {
    heading: 'Two minutes, from me to you',
    body: 'How the six weeks are built, and what a morning in the course looks like.',
    caption: 'Filmed on the first morning of the spring group.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      caption: readText(raw, 'caption', 140),
    }),
};
