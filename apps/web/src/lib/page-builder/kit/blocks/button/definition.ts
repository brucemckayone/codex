import { type ButtonAction, readButtonAction } from '../../model/button-action';
import { ctaLabelField, layout } from '../../model/fields';
import { compact, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export type ButtonProps = {
  ctaLabel?: string;
  /** Where it goes (03 X64). Absent: it joins, with the page's own price. */
  action?: ButtonAction;
};

export const buttonDefinition: BlockDefinition<ButtonProps> = {
  type: 'button',
  label: 'Button',
  description: 'The ask alone, inside the section above.',
  group: 'basics',
  icon: 'LogInIcon',
  layouts: [
    layout(
      'stack',
      'Price above',
      'The price, the button, then how billing works.'
    ),
    layout('row', 'One row', 'The price and the button side by side.'),
  ],
  fields: [
    {
      key: 'action',
      label: 'When someone presses it',
      control: 'action',
    },
    {
      ...ctaLabelField,
      hint: 'Leave empty to use the words for where it goes. Members joining see "Continue".',
    },
  ],
  starter: () => ({}),
  sample: {},
  coerce: (raw) =>
    compact({
      ctaLabel: readText(raw, 'ctaLabel', 40),
      action: readButtonAction(raw.action),
    }),
};
