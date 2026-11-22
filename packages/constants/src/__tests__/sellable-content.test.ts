import { describe, expect, it } from 'vitest';
// Through the package index: checkout and the content page import them there.
import { canBeSold, PRICE_LIMITS, requiresPayoutsToPublish } from '../index';

const ORG = '00000000-0000-0000-0000-0000000000a1';

/** Sold on its own, in an org, at £15. Each case overrides what it needs. */
const sellable = {
  isPurchasable: true,
  priceCents: 1500,
  courseOnly: false,
  isTeamOnly: false,
  isFollowerGated: false,
  isTierGated: false,
  organizationId: ORG,
};

describe('canBeSold (Codex-2hxff.14: checkout only for items a purchase opens)', () => {
  it.each([
    ['paid, in an org', sellable],
    ['paid, orgless', { ...sellable, organizationId: null }],
    ['paid + tier hybrid', { ...sellable, isTierGated: true }],
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
      { ...sellable, organizationId: null, isTierGated: true },
    ],
  ])('refuses %s content', (_shape, c) => {
    expect(canBeSold(c)).toBe(false);
  });
});

describe('requiresPayoutsToPublish (Codex-2hxff.14: any priced item)', () => {
  it.each([
    ['priced', { priceCents: 1500, isTierGated: false }],
    ['in a tier', { priceCents: null, isTierGated: true }],
    ['priced and in a tier', { priceCents: 1500, isTierGated: true }],
  ])('needs payouts for %s content', (_shape, c) => {
    expect(requiresPayoutsToPublish(c)).toBe(true);
  });

  it.each([
    ['unpriced', { priceCents: null, isTierGated: false }],
    ['priced 0', { priceCents: 0, isTierGated: false }],
  ])('does not need payouts for %s content', (_shape, c) => {
    expect(requiresPayoutsToPublish(c)).toBe(false);
  });
});

/**
 * canBeSold reads the access decision's branch table (Codex-z1t3c), so a new
 * branch has to be classified before checkout can sell into it. Before that it
 * was a hand-written list of negations: this is that form, frozen, and the
 * table below proves the two agree on every flag combination.
 */
function canBeSoldAsHandWritten(c: Parameters<typeof canBeSold>[0]): boolean {
  return (
    c.isPurchasable &&
    (c.priceCents ?? 0) >= PRICE_LIMITS.MIN_CENTS &&
    !c.courseOnly &&
    !c.isTeamOnly &&
    !c.isFollowerGated &&
    !(c.organizationId == null && c.isTierGated)
  );
}

const BOTH = [false, true] as const;
const PRICES = [
  null,
  0,
  PRICE_LIMITS.MIN_CENTS - 1,
  PRICE_LIMITS.MIN_CENTS,
  1500,
] as const;

const everyFlagCombination = BOTH.flatMap((isPurchasable) =>
  PRICES.flatMap((priceCents) =>
    BOTH.flatMap((courseOnly) =>
      BOTH.flatMap((isTeamOnly) =>
        BOTH.flatMap((isFollowerGated) =>
          BOTH.flatMap((isTierGated) =>
            [null, ORG].map((organizationId) => ({
              isPurchasable,
              priceCents,
              courseOnly,
              isTeamOnly,
              isFollowerGated,
              isTierGated,
              organizationId,
            }))
          )
        )
      )
    )
  )
);

describe('canBeSold reads the branch table, as the hand-written rule did', () => {
  it('covers every flag combination', () => {
    expect(everyFlagCombination).toHaveLength(2 * PRICES.length * 2 ** 5);
  });

  it('agrees with the hand-written rule on every flag combination', () => {
    const disagreements = everyFlagCombination.filter(
      (c) => canBeSold(c) !== canBeSoldAsHandWritten(c)
    );
    expect(disagreements).toEqual([]);
  });

  it('sells some combinations and refuses others (the table is not vacuous)', () => {
    const sold = everyFlagCombination.filter((c) => canBeSold(c));
    expect(sold.length).toBeGreaterThan(0);
    expect(sold.length).toBeLessThan(everyFlagCombination.length);
  });
});
