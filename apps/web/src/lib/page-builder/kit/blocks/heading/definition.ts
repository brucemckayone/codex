import { eyebrowField, headingField, layout } from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type HeadingProps = {
  eyebrow?: string;
  heading?: string;
};

/** The canvas's faint words where an empty heading would be. Never on the public page. */
export const HEADING_PROMPT = 'Type the heading for what follows';

export const headingDefinition: BlockDefinition<HeadingProps> = {
  type: 'heading',
  label: 'Heading',
  description: 'A chapter title that announces the section after it.',
  group: 'basics',
  icon: 'MenuIcon',
  layouts: [
    layout('start', 'At the start', 'Lined up with the start of the column.'),
    layout('center', 'Centred', 'In the middle of the page.'),
  ],
  fields: [
    eyebrowField,
    {
      ...headingField(140),
      hint: 'Joins the section below it. With no heading, visitors see nothing here.',
    },
  ],
  starter: () => ({}),
  sample: {
    eyebrow: 'Part two',
    heading: 'The practice',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 140),
    }),
};
