import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

export type PreviewProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  caption?: string;
};

/** The canvas's words for a frame with no clip yet (creator-facing, A1). */
export const PREVIEW_PROMPT = 'Add your practice reel in Settings → Media.';

export const previewDefinition: BlockDefinition<PreviewProps> = {
  type: 'preview',
  label: 'Sneak peek',
  description: 'A short clip from inside the course.',
  group: 'details',
  icon: 'EyeIcon',
  layouts: [
    layout(
      'feature',
      'Clip first',
      'The clip large across the page, with your words beneath it.'
    ),
    layout(
      'split',
      'Side by side',
      'Your words beside a tall frame of the clip.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'caption',
      label: 'Caption',
      hint: 'Optional. Where the clip comes from, like "From week one".',
      control: 'text',
      inline: true,
      maxLength: 140,
    },
    ...optionalCtaFields,
    {
      key: 'previewVideoMediaId',
      label: 'Preview clip',
      hint: 'The same clip as the practice reel in Settings → Media.',
      control: 'media',
      mediaSlot: 'previewVideoMediaId',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `A taste of ${courseTitle}`,
    body: 'A short excerpt from one of the practices, so you know exactly what you are joining.',
  }),
  sample: {
    heading: 'Try the first practice',
    body: 'Thirty seconds from week one: the breath that starts every morning.',
    caption: 'From week one, “Arriving”.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      caption: readText(raw, 'caption', 140),
    }),
};
