/**
 * The Change access sheet's rules and lines (Codex-a6ofh.3.5, mockups L2b, L2b′).
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import {
  type AccessPiece,
  accessChangeLines,
  selectionOrg,
  sharedPrice,
} from './access-change';

const ORG = 'org-1';

function piece(id: string, fields: Partial<AccessPiece> = {}): AccessPiece {
  return {
    id,
    title: `Piece ${id}`,
    organizationId: ORG,
    isFree: true,
    isPurchasable: false,
    priceCents: null,
    isTierGated: false,
    isFollowerGated: false,
    isTeamOnly: false,
    holderCount: 0,
    ...fields,
  };
}

const sold = (id: string, priceCents: number, holderCount = 0) =>
  piece(id, { isFree: false, isPurchasable: true, priceCents, holderCount });

describe('selectionOrg (owner R3)', () => {
  it('is the org every piece is in', () => {
    expect(selectionOrg([piece('a'), piece('b')])).toBe(ORG);
  });

  it('is none for a personal piece, or pieces of two orgs', () => {
    expect(
      selectionOrg([piece('a'), piece('b', { organizationId: null })])
    ).toBeNull();
    expect(
      selectionOrg([piece('a'), piece('b', { organizationId: 'org-2' })])
    ).toBeNull();
    expect(selectionOrg([])).toBeNull();
  });
});

describe('sharedPrice (D-b5)', () => {
  it('is the one price every piece is sold at', () => {
    expect(sharedPrice([sold('a', 800), sold('b', 800)])).toBe(800);
  });

  it('is none when they differ, or one is not for sale', () => {
    expect(sharedPrice([sold('a', 800), sold('b', 1200)])).toBeNull();
    expect(sharedPrice([sold('a', 800), piece('b')])).toBeNull();
  });
});

describe('accessChangeLines', () => {
  it('Buy once names the one price it changes, and that its buyers keep watching (L2b)', () => {
    const lines = accessChangeLines([sold('a', 800, 3), piece('b')], {
      kind: 'paid',
      priceCents: 1200,
      tierIds: null,
    });
    expect(lines).toEqual([
      {
        tone: 'info',
        text: `${m.studio_content_access_reprice_one({
          title: 'Piece a',
          from: '£8.00',
          to: '£12.00',
        })} ${m.studio_content_access_buyers_keep({ count: 3 })}`,
      },
    ]);
  });

  it('Buy once says each piece keeps its tiers, when one has some', () => {
    const lines = accessChangeLines(
      [piece('a', { isFree: false, isTierGated: true })],
      {
        kind: 'paid',
        priceCents: 1200,
        tierIds: null,
      }
    );
    expect(lines.map((line) => line.text)).toContain(
      m.studio_content_access_keeps_tiers()
    );
  });

  it('Subscribers with no price says how many stop being sold (L2b′)', () => {
    const lines = accessChangeLines([sold('a', 800, 3), piece('b')], {
      kind: 'subscribers',
      priceCents: 0,
      tierIds: ['t1'],
    });
    expect(lines).toEqual([
      {
        tone: 'info',
        text: `${m.studio_content_access_stops_sold_one()} ${m.studio_content_access_buyers_keep({ count: 3 })}`,
      },
    ]);
  });

  it('Followers warns that a bought piece will be left alone (R1)', () => {
    const lines = accessChangeLines([sold('a', 800, 2), sold('b', 500)], {
      kind: 'followers',
      priceCents: 0,
      tierIds: null,
    });
    expect(lines[0]).toEqual({
      tone: 'warning',
      text: m.studio_content_access_left_alone_one({ title: 'Piece a' }),
    });
    // Only the unbought piece stops being sold; the bought one stays as it is.
    expect(lines[1]?.text).toBe(m.studio_content_access_stops_sold_one());
  });

  it('says nothing for a change that touches no price', () => {
    expect(
      accessChangeLines([piece('a')], {
        kind: 'team',
        priceCents: 0,
        tierIds: null,
      })
    ).toEqual([]);
  });
});
