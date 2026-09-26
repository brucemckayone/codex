import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readText, readTextList } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type InstructorProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  name?: string;
  role?: string;
  credentials?: string[];
  quote?: string;
};

export const instructorDefinition: BlockDefinition<InstructorProps> = {
  type: 'instructor',
  label: 'About you',
  description: 'Introduce yourself: who you are and why you teach this.',
  group: 'proof',
  icon: 'UserIcon',
  layouts: [
    layout(
      'split',
      'Side by side',
      'Your photo on one side, your story on the other.'
    ),
    layout(
      'quote',
      'Quote',
      'A large quote from you, with your name and photo.'
    ),
    layout('centered', 'Centred', 'Your photo and story, centred.'),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, label: 'Your story', maxLength: 1500 },
    {
      key: 'name',
      label: 'Your name',
      control: 'text',
      inline: true,
      maxLength: 80,
    },
    {
      key: 'role',
      label: 'What you do',
      control: 'text',
      inline: true,
      maxLength: 80,
    },
    { key: 'credentials', label: 'Credentials', control: 'list', maxItems: 6 },
    {
      key: 'quote',
      label: 'A line in your own words',
      control: 'textarea',
      inline: true,
      maxLength: 240,
    },
    {
      key: 'guidePortraitMediaId',
      label: 'Your photo',
      control: 'media',
      mediaSlot: 'guidePortraitMediaId',
    },
    {
      key: 'guideVideoMediaId',
      label: 'A short clip of you',
      control: 'media',
      mediaSlot: 'guideVideoMediaId',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: 'Meet your guide',
    body: `I created ${courseTitle} to share what has helped the people I work with most.`,
  }),
  sample: {
    heading: 'Hello, I am Maya',
    body: 'I have taught breath and movement for twelve years, first in studios and now online. This course is everything I teach in my one-to-one sessions, in the order I teach it.',
    name: 'Maya Linden',
    role: 'Breathwork teacher',
    credentials: ['Twelve years teaching', 'Over 4,000 students'],
    quote:
      'You do not need more discipline. You need a better first twenty minutes.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 1500),
      name: readText(raw, 'name', 80),
      role: readText(raw, 'role', 80),
      credentials: readTextList(raw, 'credentials', 6),
      quote: readText(raw, 'quote', 240),
    }),
};
