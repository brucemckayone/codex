/**
 * The Change access sheet's rules and lines (Codex-a6ofh.3.5, mockups L2b, L2b′).
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import {
  type AccessPiece,
  accessChangeLines,
  ownersKeepLine,
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
    courseOnly: false,
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
        text: `${m.studio_content_access_reprice_one({
          title: 'Piece a',
          from: '£8.00',
          to: '£12.00',
        })} ${m.studio_content_access_buyers_keep({ count: 3 })}`,
      },
    ]);
  });

  it('says everyone keeps watching for several pieces people have, never a sum of people', () => {
    // One course's buyers are in each lesson's count: 3 + 4 is not 7 people.
    const lines = accessChangeLines([sold('a', 800, 3), sold('b', 800, 4)], {
      kind: 'paid',
      priceCents: 1200,
      tierIds: null,
    });
    expect(lines[0]?.text).toBe(
      `${m.studio_content_access_reprice_many({ count: 2, to: '£12.00' })} ${m.studio_content_access_buyers_keep_all()}`
    );
  });

  it('says everyone keeps watching on a line about several pieces, though one is held', () => {
    const lines = accessChangeLines([sold('a', 800, 3), sold('b', 800)], {
      kind: 'paid',
      priceCents: 1200,
      tierIds: null,
    });
    expect(lines[0]?.text).toBe(
      `${m.studio_content_access_reprice_many({ count: 2, to: '£12.00' })} ${m.studio_content_access_buyers_keep_all()}`
    );
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
        text: `${m.studio_content_access_stops_sold_one()} ${m.studio_content_access_buyers_keep({ count: 3 })}`,
      },
    ]);
  });

  // Owner D2 (Codex-a6ofh.6, mockup LN5): owners keep a piece whose access
  // moves, so a move to Followers or Team only leaves none alone.
  it('Followers takes every piece off sale, and the people who have one keep it', () => {
    const lines = accessChangeLines([sold('a', 800, 2), sold('b', 500)], {
      kind: 'followers',
      priceCents: 0,
      tierIds: null,
    });
    expect(lines).toEqual([
      {
        text: `${m.studio_content_access_stops_sold({ count: 2 })} ${m.studio_content_access_buyers_keep_all()}`,
      },
    ]);
  });

  it('Team only on one piece says by how many people', () => {
    expect(
      accessChangeLines([sold('a', 800, 2)], {
        kind: 'team',
        priceCents: 0,
        tierIds: null,
      })
    ).toEqual([
      {
        text: `${m.studio_content_access_stops_sold_one()} ${m.studio_content_access_buyers_keep({ count: 2 })}`,
      },
    ]);
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

describe('ownersKeepLine (LN5)', () => {
  const followers = {
    kind: 'followers',
    priceCents: 0,
    tierIds: null,
  } as const;

  it('says a piece on sale stops being sold, and its owners keep it (the mockup)', () => {
    expect(ownersKeepLine(sold('a', 499, 57), followers)).toBe(
      m.studio_leaving_access_owners_keep({ count: 57 })
    );
    expect(
      ownersKeepLine(sold('a', 499, 1), { ...followers, kind: 'team' })
    ).toBe(m.studio_leaving_access_owners_keep_one());
  });

  it('says nothing for a piece nobody owns, one not on sale, or another choice', () => {
    expect(ownersKeepLine(sold('a', 499), followers)).toBeNull();
    expect(
      ownersKeepLine(piece('a', { holderCount: 3 }), followers)
    ).toBeNull();
    expect(
      ownersKeepLine(sold('a', 499, 57), { ...followers, kind: 'free' })
    ).toBeNull();
  });
});
