import { describe, expect, it } from 'vitest';
// Through the package index: checkout and the content page import them there.
import { canBeSold, PRICE_LIMITS, requiresPayoutsToPublish } from '../index';

const ORG = '00000000-0000-0000-0000-0000000000a1';
const TIER = '00000000-0000-0000-0000-0000000000aa';

/** Sold on its own, in an org, at £15. Each case overrides what it needs. */
const sellable = {
  isPurchasable: true,
  priceCents: 1500,
  courseOnly: false,
  isTeamOnly: false,
  isFollowerGated: false,
  includedInTierId: null,
  organizationId: ORG,
};

describe('canBeSold (Codex-2hxff.14: checkout only for items a purchase opens)', () => {
  it.each([
    ['paid, in an org', sellable],
    ['paid, orgless', { ...sellable, organizationId: null }],
    ['paid + tier hybrid', { ...sellable, includedInTierId: TIER }],
    [
      'exactly the minimum price',
      { ...sellable, priceCents: PRICE_LIMITS.MIN_CENTS },
    ],
  ])('sells %s content', (_shape, c) => {
    expect(canBeSold(c)).toBe(true);
  });

  it.each([
    ['not marked purchasable', { ...sellable, isPurchasable: false }],
    ['unpriced', { ...sellable, priceCents: null }],
    ['priced 0', { ...sellable, priceCents: 0 }],
    [
      'below the minimum price',
      { ...sellable, priceCents: PRICE_LIMITS.MIN_CENTS - 1 },
    ],
    ['course-only', { ...sellable, courseOnly: true }],
    ['team-only', { ...sellable, isTeamOnly: true }],
    ['followers-only', { ...sellable, isFollowerGated: true }],
    [
      'orgless with a tier (denied to everyone)',
      { ...sellable, organizationId: null, includedInTierId: TIER },
    ],
  ])('refuses %s content', (_shape, c) => {
    expect(canBeSold(c)).toBe(false);
  });
});

describe('requiresPayoutsToPublish (Codex-2hxff.14: any priced item)', () => {
  it.each([
    ['priced', { priceCents: 1500, includedInTierId: null }],
    ['in a tier', { priceCents: null, includedInTierId: TIER }],
    ['priced and in a tier', { priceCents: 1500, includedInTierId: TIER }],
  ])('needs payouts for %s content', (_shape, c) => {
    expect(requiresPayoutsToPublish(c)).toBe(true);
  });

  it.each([
    ['unpriced', { priceCents: null, includedInTierId: null }],
    ['priced 0', { priceCents: 0, includedInTierId: null }],
  ])('does not need payouts for %s content', (_shape, c) => {
    expect(requiresPayoutsToPublish(c)).toBe(false);
  });
});
