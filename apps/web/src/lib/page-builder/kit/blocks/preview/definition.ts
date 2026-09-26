import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type PreviewProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  caption?: string;
};

export const previewDefinition: BlockDefinition<PreviewProps> = {
  type: 'preview',
  label: 'Sneak peek',
  description: 'A short clip from inside the course.',
  group: 'details',
  icon: 'EyeIcon',
  layouts: [
    layout('feature', 'Feature', 'A large clip with a short line beneath it.'),
    layout(
      'split',
      'Side by side',
      'The clip on one side, your words on the other.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'caption',
      label: 'Caption',
      control: 'text',
      inline: true,
      maxLength: 140,
    },
    {
      key: 'previewVideoMediaId',
      label: 'Preview clip',
      control: 'media',
      mediaSlot: 'previewVideoMediaId',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `A taste of ${courseTitle}`,
    body: 'Watch a short excerpt from one of the lessons.',
  }),
  sample: {
    heading: 'Try the first practice',
    body: 'Thirty seconds from week one: the breath that starts every morning.',
    caption: 'From week one, "Arriving".',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      caption: readText(raw, 'caption', 140),
    }),
};
