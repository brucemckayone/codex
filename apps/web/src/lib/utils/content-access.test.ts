/**
 * The display kind (`deriveContentAccessKind`) reads the subscribers-only
 * switch, never the plan set (Codex-2hxff.91).
 *
 * The safety rule: a gated item with no plan ticked is CLOSED, never free. The
 * Studio editor opens an item on this kind, so reading a closed item as
 * 'free' would make the next save send `isFree: true` and open it to everyone
 * (ContentForm keeps its own fail-closed guard too).
 */
import { describe, expect, it } from 'vitest';
import { deriveContentAccessKind } from './content-access';

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
