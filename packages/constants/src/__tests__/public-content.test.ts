import { describe, expect, it } from 'vitest';
// Through the package index: the content service and the web import it there.
import { isPublicContent } from '../index';

/** Free, with no gate at all. Each case overrides what it needs. */
const open = {
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
};
const TIER = '00000000-0000-0000-0000-0000000000aa';

describe('isPublicContent (Codex-039vo: a body goes unchecked only when no gate applies)', () => {
  it('is public when free with no gate', () => {
    expect(isPublicContent(open)).toBe(true);
  });

  it('is public with a zero price (no price is not a gate)', () => {
    expect(isPublicContent({ ...open, priceCents: 0 })).toBe(true);
  });

  // Each of these is flagged free yet gated: the shapes isFree alone misread.
  // The course service writes the first on purpose; Codex-al9ft was the second.
  it.each([
    ['course-only', { ...open, courseOnly: true }],
    ['priced', { ...open, priceCents: 1500 }],
    ['purchasable', { ...open, isPurchasable: true }],
    ['tier-included', { ...open, includedInTierId: TIER }],
    ['followers-only', { ...open, isFollowerGated: true }],
    ['team-only', { ...open, isTeamOnly: true }],
  ])('is not public when flagged free but %s', (_gate, policy) => {
    expect(isPublicContent(policy)).toBe(false);
  });

  it.each([
    ['isFree false', { ...open, isFree: false }],
    ['isFree null', { ...open, isFree: null }],
    ['isFree missing', { courseOnly: false }],
  ])('is not public when %s (fails closed)', (_case, policy) => {
    expect(isPublicContent(policy)).toBe(false);
  });
});
