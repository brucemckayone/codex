import { describe, expect, it } from 'vitest';
// Through the package index, as the services import them.
import {
  canBeSold,
  contentAccessKindToPolicy,
  deriveContentAccessKind,
  isClosedToNewViewers,
  isGrantableContent,
  isPublicContent,
  requiresPayoutsToPublish,
} from '../index';

/**
 * Codex-2hxff.91 (design §2.4 #9): the tier SWITCH is the gate, whatever the
 * ticks say. An item behind the switch with no tier ticked is CLOSED: never
 * public, sellable only when on sale, grantable, and it still needs payouts.
 */
const closed = {
  isFree: false,
  isPurchasable: false,
  priceCents: null,
  isTierGated: true,
  courseOnly: false,
  isFollowerGated: false,
  isTeamOnly: false,
  organizationId: '00000000-0000-0000-0000-0000000000a1',
};

describe('a closed item (gated, no tier ticked)', () => {
  it('is never public, even when flagged free', () => {
    expect(isPublicContent(closed)).toBe(false);
    expect(isPublicContent({ ...closed, isFree: true })).toBe(false);
  });

  it('is grantable, needs payouts, and is shown as subscribers', () => {
    expect(isGrantableContent(closed)).toBe(true);
    expect(requiresPayoutsToPublish(closed)).toBe(true);
    expect(deriveContentAccessKind(closed)).toBe('subscribers');
  });

  it('is sellable only with a one-time price on sale', () => {
    expect(canBeSold(closed)).toBe(false);
    expect(canBeSold({ ...closed, isPurchasable: true, priceCents: 499 })).toBe(
      true
    );
  });

  it('is closed to new viewers only with no tick and no price on sale', () => {
    expect(isClosedToNewViewers(closed, 0)).toBe(true);
    expect(isClosedToNewViewers(closed, 1)).toBe(false);
    expect(
      isClosedToNewViewers(
        { ...closed, isPurchasable: true, priceCents: 499 },
        0
      )
    ).toBe(false);
    // A price below the minimum is not on sale (canBeSold refuses it).
    expect(
      isClosedToNewViewers(
        { ...closed, isPurchasable: true, priceCents: 50 },
        0
      )
    ).toBe(true);
    expect(isClosedToNewViewers({ ...closed, isTierGated: false }, 0)).toBe(
      false
    );
  });

  it('cannot be sold when orgless (the orgless_tier_gate deny)', () => {
    expect(
      canBeSold({
        ...closed,
        isPurchasable: true,
        priceCents: 499,
        organizationId: null,
      })
    ).toBe(false);
  });
});

describe('contentAccessKindToPolicy and the switch', () => {
  it('turns the switch on for subscribers, ticked or not', () => {
    expect(contentAccessKindToPolicy('subscribers').isTierGated).toBe(true);
    expect(
      contentAccessKindToPolicy('subscribers', { tierCount: 2 }).isTierGated
    ).toBe(true);
  });

  it('turns it on for paid only when a tier is ticked', () => {
    expect(contentAccessKindToPolicy('paid').isTierGated).toBe(false);
    expect(
      contentAccessKindToPolicy('paid', { priceCents: 499, tierCount: 1 })
        .isTierGated
    ).toBe(true);
  });

  it('keeps it off for every other kind', () => {
    for (const kind of ['free', 'followers', 'team', 'course'] as const) {
      expect(
        contentAccessKindToPolicy(kind, { tierCount: 3 }).isTierGated,
        kind
      ).toBe(false);
    }
  });
});
