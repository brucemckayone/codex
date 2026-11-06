/**
 * The Publish step's access group (Codex-a6ofh.2.4): the old form's rules,
 * on the one value the draft session saves.
 */
import { describe, expect, it } from 'vitest';
import type { DraftAccess } from './draft-session.svelte';
import { priceText, withKind, withPrice } from './publish-access';

const PAID: DraftAccess = { kind: 'paid', priceCents: 1200, tierIds: ['t1'] };

describe('withKind', () => {
  it('a kind with no price and no plans clears both', () => {
    for (const kind of ['free', 'followers', 'team'] as const) {
      expect(withKind(PAID, kind)).toEqual({
        kind,
        priceCents: 0,
        tierIds: [],
      });
    }
  });

  it('plans never read stay unread', () => {
    expect(withKind({ ...PAID, tierIds: null }, 'free')).toEqual({
      kind: 'free',
      priceCents: 0,
      tierIds: null,
    });
  });

  it('a kind that sells or is in plans keeps the price and the ticks', () => {
    expect(withKind(PAID, 'subscribers')).toEqual({
      kind: 'subscribers',
      priceCents: 1200,
      tierIds: ['t1'],
    });
  });
});

describe('withPrice', () => {
  it('reads pounds as pence, rounded', () => {
    expect(withPrice(PAID, '12').priceCents).toBe(1200);
    expect(withPrice(PAID, '4.995').priceCents).toBe(500);
  });

  it('what cannot be read is £0, as the form had it', () => {
    expect(withPrice(PAID, '').priceCents).toBe(0);
    expect(withPrice(PAID, 'abc').priceCents).toBe(0);
  });
});

describe('priceText', () => {
  it('says a price as the field shows it', () => {
    expect(priceText(1200)).toBe('12.00');
    expect(priceText(0)).toBe('0.00');
  });
});
