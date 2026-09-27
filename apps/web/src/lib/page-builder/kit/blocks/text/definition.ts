import { type ImageRef, isImageRef } from '../../../page-images';
import {
  bodyField,
  ctaLabelField,
  eyebrowField,
  headingField,
  layout,
  noteField,
} from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type TextProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  /** Beside the words in `columns`, above them otherwise (contract A5). */
  image?: ImageRef;
};

/** The canvas prompt where the text would be — shown only while editing. */
export const TEXT_EMPTY =
  'Add your text. Leave a blank line to start a new paragraph.';

export const textDefinition: BlockDefinition<TextProps> = {
  type: 'text',
  label: 'Text',
  description: 'A few paragraphs in your own words.',
  group: 'story',
  icon: 'EditIcon',
  layouts: [
    layout(
      'statement',
      'Big statement',
      'Your first paragraph in large type, with the rest beneath it.'
    ),
    layout(
      'columns',
      'Two columns',
      'Your heading on one side and your text on the other.'
    ),
    layout('centered', 'Centred', 'A calm passage in the middle of the page.'),
  ],
  fields: [
    eyebrowField,
    headingField(140),
    { ...bodyField, maxLength: 3000 },
    {
      ...ctaLabelField,
      hint: 'Optional. Add button text to show a join button here.',
    },
    {
      ...noteField,
      hint: 'Optional. A short reassurance under the button.',
    },
    {
      key: 'image',
      label: 'Image',
      hint: 'Optional. Sits beside your text in two columns, and above it in the other layouts.',
      control: 'image',
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: `Why I made ${courseTitle}`,
    body: `I created ${courseTitle} to share what has helped the people I work with most.\n\nIt is the course I wish I had been given when I started.`,
  }),
  sample: {
    heading: 'It started with one quiet morning',
    body: 'For years I began every day already behind. Then I tried twenty minutes of nothing but breath and a notebook, and the rest of the day changed shape.\n\nThis course is those twenty minutes, taught properly, one week at a time.',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 140),
      body: readText(raw, 'body', 3000),
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
      image: isImageRef(raw.image) ? raw.image : undefined,
    }),
};
