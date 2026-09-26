/**
 * The common fields (contract §2 "Common": eyebrow, heading, body, ctaLabel,
 * note), described once so every section's inspector names them the same way.
 * Plain English, sentence case — a creator never sees a design term.
 */
import type { BlockField, BlockLayout } from './types';

export const eyebrowField: BlockField = {
  key: 'eyebrow',
  label: 'Small label',
  hint: 'Optional. A few words above the heading, like "Six-week course".',
  control: 'text',
  inline: true,
  maxLength: 60,
};

export function headingField(maxLength = 140): BlockField {
  return {
    key: 'heading',
    label: 'Heading',
    control: 'text',
    inline: true,
    maxLength,
  };
}

export const bodyField: BlockField = {
  key: 'body',
  label: 'Text',
  hint: 'Leave a blank line to start a new paragraph.',
  control: 'textarea',
  inline: true,
  maxLength: 1200,
};

export const ctaLabelField: BlockField = {
  key: 'ctaLabel',
  label: 'Button text',
  hint: 'Leave empty to use "Join now". Members always see "Continue".',
  control: 'text',
  inline: true,
  maxLength: 40,
};

export const noteField: BlockField = {
  key: 'note',
  label: 'Small print under the button',
  hint: 'A short reassurance. Leave empty and we will describe how payment works.',
  control: 'text',
  inline: true,
  maxLength: 120,
};

/** `layouts` entries are written inline in each definition; this keeps the shape honest. */
export function layout(
  id: string,
  label: string,
  description: string
): BlockLayout {
  return { id, label, description };
}
