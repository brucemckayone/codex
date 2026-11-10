/**
 * The display kind (`deriveContentAccessKind`) reads the subscribers-only
 * switch, never the plan set (Codex-2hxff.91).
 *
 * The safety rule: a gated item with no plan ticked is CLOSED, never free. The
 * Studio editor opens an item on this kind, so reading a closed item as
 * 'free' would make the next save send `isFree: true` and open it to everyone.
 */
import { describe, expect, it } from 'vitest';
import { accessGroupToFlags, deriveContentAccessKind } from './content-access';

describe('deriveContentAccessKind', () => {
  it('a gated item is subscribers, with or without a plan ticked', () => {
    expect(deriveContentAccessKind({ isTierGated: true })).toBe('subscribers');
    expect(deriveContentAccessKind({ isTierGated: true, isFree: false })).toBe(
      'subscribers'
    );
  });

  it('a gated item with a price is paid (the hybrid; the badge stacks its plans)', () => {
    expect(
      deriveContentAccessKind({
        isTierGated: true,
        isPurchasable: true,
        priceCents: 499,
      })
    ).toBe('paid');
  });

  it('the switch off is free (no other gate)', () => {
    expect(deriveContentAccessKind({ isTierGated: false, isFree: true })).toBe(
      'free'
    );
    expect(deriveContentAccessKind({})).toBe('free');
  });

  it('team and followers still win, as before', () => {
    expect(
      deriveContentAccessKind({ isTierGated: true, isTeamOnly: true })
    ).toBe('team');
    expect(
      deriveContentAccessKind({ isTierGated: true, isFollowerGated: true })
    ).toBe('followers');
  });
});

// The write-boundary inverse, which the Publish step saves through
// (Codex-a6ofh.2.4): each kind sends its own flags, and an untouched plan set
// is left out so the server keeps the ticks.
describe('accessGroupToFlags', () => {
  const ORG = 'org-1';

  it('round-trips through the display kind for every kind', () => {
    for (const kind of [
      'free',
      'paid',
      'followers',
      'subscribers',
      'team',
    ] as const) {
      const flags = accessGroupToFlags(
        { kind, priceCents: kind === 'paid' ? 1200 : 0, tierIds: ['t1'] },
        ORG
      );
      expect(deriveContentAccessKind(flags)).toBe(kind);
    }
  });

  it('a paid piece whose plans were never touched leaves the set and the switch out', () => {
    const flags = accessGroupToFlags(
      { kind: 'paid', priceCents: 1200, tierIds: null },
      ORG
    );
    expect(flags).not.toHaveProperty('includedInTierIds');
    expect(flags).not.toHaveProperty('isTierGated');
  });

  it('a paid piece in no plan is simply for sale, not closed', () => {
    expect(
      accessGroupToFlags({ kind: 'paid', priceCents: 1200, tierIds: [] }, ORG)
    ).toMatchObject({
      isPurchasable: true,
      isTierGated: false,
    });
  });

  it('subscribers with no price is never purchasable', () => {
    expect(
      accessGroupToFlags(
        { kind: 'subscribers', priceCents: 0, tierIds: ['t1'] },
        ORG
      )
    ).toMatchObject({
      isTierGated: true,
      isPurchasable: false,
      priceCents: null,
      includedInTierIds: ['t1'],
    });
  });

  it('personal content never sends a plan set', () => {
    expect(
      accessGroupToFlags(
        { kind: 'subscribers', priceCents: 0, tierIds: ['t1'] },
        null
      )
    ).not.toHaveProperty('includedInTierIds');
  });
});
