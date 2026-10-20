/**
 * The Button section's words (03 X64): the label each action starts with and
 * the canvas's warnings (the inspector's own words are in `messages/en.json`). They live
 * beside the block until `kit/model/copy.ts` takes them (contract A1), as the
 * preview block's do.
 */
import type { ButtonActionId } from '../../model/ids';

/** The label a Button shows for each action until the creator writes one. */
export const BUTTON_LABELS: Readonly<Record<ButtonActionId, string>> = {
  join: 'Join now',
  section: 'Read on',
  preview: 'Watch the preview',
  link: 'Find out more',
};

export const BUTTON_COPY = {
  /** The canvas's line under a joining Button while the journey has no price. */
  noPrice: 'Your price shows here once the journey has one (the Pricing tab).',
  /** The canvas's warning for a Button whose section is gone or hidden. */
  deadSection:
    'The section this button goes to is hidden or deleted. Visitors will not see this button until you choose another.',
  /** The canvas's warning for a preview Button on a page with no preview film. */
  noPreview:
    'This journey has no preview film. Visitors will not see this button until you add one.',
  /** The canvas's warning for a stored action this page cannot read. */
  unreadable:
    'Visitors will not see this button: where it goes could not be read. Choose again.',
  /** Said after a link's label, so a screen reader knows it leaves the page. */
  newTab: '(opens in a new tab)',
} as const;
