/**
 * The tier picker's rules (Codex-2hxff.91): "and above" by MONTHLY price
 * (owner decision U1), hidden ticks never dropped, and the per-item guidance
 * note on the same yardstick, so the shortcut can never trigger the note.
 */

import { describe, expect, it } from 'vitest';
import {
  andAboveIds,
  hiddenTierIds,
  isAndAboveSelection,
  itemGaps,
  joinNames,
  offersAndAbove,
  selectFromTier,
  tiersByPrice,
  toggleTierId,
} from './select-from-tier';

// Created in this order (display order), deliberately NOT price order.
const PREMIUM = {
  id: 'premium',
  name: 'Premium',
  priceMonthly: 2000,
  sortOrder: 1,
};
const BASIC = { id: 'basic', name: 'Basic', priceMonthly: 500, sortOrder: 2 };
const PRO = { id: 'pro', name: 'Pro', priceMonthly: 1200, sortOrder: 3 };
const TIERS = [PREMIUM, BASIC, PRO];

describe('tiersByPrice', () => {
  it('lists cheapest first, whatever the display order', () => {
    expect(tiersByPrice(TIERS).map((t) => t.id)).toEqual([
      'basic',
      'pro',
      'premium',
    ]);
  });

  it('keeps display order between equal prices', () => {
    const twin = { id: 'twin', name: 'Twin', priceMonthly: 500, sortOrder: 0 };
    expect(tiersByPrice([BASIC, twin]).map((t) => t.id)).toEqual([
      'twin',
      'basic',
    ]);
  });
});

describe('the "and above" shortcut', () => {
  it('ticks the tier and every dearer one, by monthly price', () => {
    expect(andAboveIds('basic', TIERS)).toEqual(['basic', 'pro', 'premium']);
    expect(andAboveIds('pro', TIERS)).toEqual(['pro', 'premium']);
  });

  it('is not offered on the dearest tier', () => {
    expect(offersAndAbove('premium', TIERS)).toBe(false);
    expect(offersAndAbove('pro', TIERS)).toBe(true);
  });

  it('does not count an equal price as dearer', () => {
    const twin = { id: 'twin', name: 'Twin', priceMonthly: 1200, sortOrder: 4 };
    expect(andAboveIds('pro', [...TIERS, twin])).toEqual(['pro', 'premium']);
  });

  it('unticks the cheaper ones', () => {
    expect(selectFromTier(['basic', 'pro'], 'pro', TIERS).sort()).toEqual([
      'premium',
      'pro',
    ]);
  });

  it('keeps ticks on hidden tiers (not options here)', () => {
    const next = selectFromTier(['retired', 'basic'], 'pro', TIERS);
    expect(next).toContain('retired');
    expect(next).not.toContain('basic');
    expect(hiddenTierIds(next, TIERS)).toEqual(['retired']);
  });

  it('marks the shortcut whose set equals the ticks, ignoring hidden ticks', () => {
    expect(
      isAndAboveSelection(['premium', 'pro', 'retired'], 'pro', TIERS)
    ).toBe(true);
    expect(isAndAboveSelection(['premium', 'pro'], 'basic', TIERS)).toBe(false);
    expect(isAndAboveSelection(['basic', 'premium'], 'basic', TIERS)).toBe(
      false
    );
  });

  it('never produces a guidance note', () => {
    for (const tier of TIERS) {
      expect(itemGaps(selectFromTier([], tier.id, TIERS), TIERS)).toEqual([]);
    }
  });
});

describe('toggleTierId', () => {
  it('adds and removes one tier', () => {
    expect(toggleTierId(['basic'], 'pro')).toEqual(['basic', 'pro']);
    expect(toggleTierId(['basic', 'pro'], 'basic')).toEqual(['pro']);
  });
});

describe('itemGaps (the per-item guidance note)', () => {
  it('names a dearer unticked tier and the cheaper ticked ones', () => {
    // Winter Light: Basic and Premium, not Pro.
    const gaps = itemGaps(['basic', 'premium'], TIERS);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].dearer.id).toBe('pro');
    expect(gaps[0].cheaper.map((t) => t.id)).toEqual(['basic']);
  });

  it('gives one note per dearer tier missing the item', () => {
    const gaps = itemGaps(['basic'], TIERS);
    expect(gaps.map((gap) => gap.dearer.id)).toEqual(['pro', 'premium']);
    expect(gaps[1].cheaper.map((t) => t.id)).toEqual(['basic']);
  });

  it('says nothing when only a dearer tier has it, or nothing is ticked', () => {
    expect(itemGaps(['premium'], TIERS)).toEqual([]);
    expect(itemGaps([], TIERS)).toEqual([]);
  });

  it('does not treat an equal price as cheaper', () => {
    const twin = { id: 'twin', name: 'Twin', priceMonthly: 500, sortOrder: 4 };
    expect(itemGaps(['basic'], [BASIC, twin])).toEqual([]);
  });
});

describe('joinNames', () => {
  it('joins with "and", or "or"', () => {
    expect(joinNames(['Basic', 'Pro'])).toBe('Basic and Pro');
    expect(joinNames(['Basic', 'Pro', 'Premium'])).toBe(
      'Basic, Pro and Premium'
    );
    expect(joinNames(['Basic', 'Pro'], 'or')).toBe('Basic or Pro');
  });
});
