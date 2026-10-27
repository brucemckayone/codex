import { describe, expect, it } from 'vitest';
// Through the package index: the Studio's grant pickers import it from there.
import { isGrantableContent } from '../index';

/** No gate at all: free content. Each case overrides what it needs. */
const free = {
  courseOnly: false,
  isTeamOnly: false,
  isFollowerGated: false,
  includedInTierId: null,
  priceCents: null,
};
const TIER = '00000000-0000-0000-0000-0000000000aa';

describe('isGrantableContent (Codex-2hxff.21: only items a grant can open)', () => {
  it.each([
    ['paid', { ...free, priceCents: 1500 }],
    ['tier (subscribers)', { ...free, includedInTierId: TIER }],
    [
      'paid + tier hybrid',
      { ...free, priceCents: 1500, includedInTierId: TIER },
    ],
    [
      'tier with a zero price',
      { ...free, priceCents: 0, includedInTierId: TIER },
    ],
  ])('grants %s content', (_shape, c) => {
    expect(isGrantableContent(c)).toBe(true);
  });

  it.each([
    ['free (no price)', free],
    ['free (price 0)', { ...free, priceCents: 0 }],
    ['followers-only', { ...free, isFollowerGated: true }],
    ['team-only', { ...free, isTeamOnly: true }],
    ['course-only', { ...free, courseOnly: true }],
  ])('refuses %s content', (_shape, c) => {
    expect(isGrantableContent(c)).toBe(false);
  });

  // The gates that return before any entitlement is read win over a price or
  // a tier, as they do in decideContentAccess.
  it.each([
    ['course-only, priced', { ...free, courseOnly: true, priceCents: 1500 }],
    [
      'team-only, in a tier',
      { ...free, isTeamOnly: true, includedInTierId: TIER },
    ],
    [
      'followers-only, priced',
      { ...free, isFollowerGated: true, priceCents: 1500 },
    ],
  ])('refuses %s content', (_shape, c) => {
    expect(isGrantableContent(c)).toBe(false);
  });
});
