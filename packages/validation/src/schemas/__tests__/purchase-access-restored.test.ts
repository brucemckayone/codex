/**
 * The late win's buyer email data (Codex-2hxff.70; late-win data design §6,
 * §7; buyer/emails.html 1-2): seven strings, the link a URL, and the two
 * composed parts never empty, since an empty one would ship a broken
 * sentence or a blank button.
 */

import { describe, expect, it } from 'vitest';
import {
  purchaseAccessRestoredDataSchema,
  templateDataSchemas,
} from '../notifications';

const ITEM = {
  userName: 'Ellen Marsh',
  contentTitle: 'Winter Light',
  accessSentence: "so it's back in your library and ready to watch.",
  amount: '£24.00',
  paidOn: '03/09/2026',
  itemUrl: 'https://hollow-oak.revelations.studio/content/winter-light',
  buttonLabel: 'Watch now',
};

describe('purchaseAccessRestoredDataSchema', () => {
  it('takes the item form and the course form', () => {
    expect(purchaseAccessRestoredDataSchema.parse(ITEM)).toEqual(ITEM);
    const course = {
      ...ITEM,
      contentTitle: 'Colour Grading Masterclass',
      accessSentence: 'so the course is open to you again.',
      buttonLabel: 'Go to the course',
    };
    expect(purchaseAccessRestoredDataSchema.parse(course)).toEqual(course);
  });

  it.each([
    ['a link that is not a URL', { itemUrl: '/content/winter-light' }],
    ['an empty sentence', { accessSentence: '' }],
    ['an empty button', { buttonLabel: '' }],
    ['no paid date', { paidOn: undefined }],
  ])('refuses %s', (_label, change) => {
    expect(
      purchaseAccessRestoredDataSchema.safeParse({ ...ITEM, ...change }).success
    ).toBe(false);
  });

  it('is the send schema for purchase-access-restored', () => {
    expect(templateDataSchemas['purchase-access-restored']).toBe(
      purchaseAccessRestoredDataSchema
    );
  });
});
