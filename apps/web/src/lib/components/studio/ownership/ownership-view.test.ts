/**
 * The pure rules behind the ownership UI (Codex-2hxff.2). Each one decides
 * something the mockup is explicit about, so each is pinned here.
 */

import { describe, expect, it } from 'vitest';
import type { OwnershipLastOutcome, OwnershipView } from '$lib/types';
import {
  confirmNameMatches,
  estimatedOfferExpiry,
  formatShareBps,
  isOfferLive,
  OWNERSHIP_OFFER_TTL_DAYS,
  outcomeNote,
  ownershipCardMode,
  settingsAccess,
} from './ownership-view';

const OFFER = {
  offerId: '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37',
  offeredByName: 'Alex Morgan',
  expiresAt: '2026-10-20T10:00:00.000Z',
};

function view(overrides: Partial<OwnershipView> = {}): OwnershipView {
  return {
    owner: {
      userId: 'owner1',
      name: 'Alex Morgan',
      avatarUrl: null,
      ownerSince: '2026-03-02T00:00:00.000Z',
      payoutsReady: true,
    },
    viewerRole: 'owner',
    openOffer: null,
    ...overrides,
  };
}

describe('settingsAccess — the Settings guard', () => {
  it('waits while the role is unknown (ssr = false first render)', () => {
    expect(settingsAccess(undefined, null)).toBeUndefined();
    expect(settingsAccess(undefined, OFFER)).toBeUndefined();
  });

  it('gives owners and admins the full page', () => {
    expect(settingsAccess('owner', null)).toBe('full');
    expect(settingsAccess('admin', null)).toBe('full');
    expect(settingsAccess('admin', OFFER)).toBe('full');
  });

  it('widens ONLY for a creator holding an open offer', () => {
    expect(settingsAccess('creator', OFFER)).toBe('ownership-only');
    expect(settingsAccess('creator', null)).toBe('none');
    expect(settingsAccess('creator', undefined)).toBe('none');
  });

  it('never widens for members or subscribers, even with an offer', () => {
    expect(settingsAccess('member', OFFER)).toBe('none');
    expect(settingsAccess('subscriber', OFFER)).toBe('none');
    expect(settingsAccess(null, OFFER)).toBe('none');
  });
});

describe('ownershipCardMode', () => {
  const openOffer = {
    id: OFFER.offerId,
    recipient: { userId: 'sam', name: 'Sam Patel', payoutsReady: true },
    offeredBy: { userId: 'owner1', name: 'Alex Morgan' },
    offeredAt: '2026-10-13T10:00:00.000Z',
    expiresAt: OFFER.expiresAt,
  };

  it('owner sees the owner face, with or without an open offer', () => {
    expect(ownershipCardMode(view())).toBe('owner');
    expect(ownershipCardMode(view({ openOffer }))).toBe('owner');
  });

  it('a non-owner who is sent an open offer is its recipient', () => {
    expect(ownershipCardMode(view({ viewerRole: 'creator', openOffer }))).toBe(
      'recipient'
    );
    expect(ownershipCardMode(view({ viewerRole: 'admin', openOffer }))).toBe(
      'recipient'
    );
  });

  it('an admin with no offer is read-only', () => {
    expect(ownershipCardMode(view({ viewerRole: 'admin' }))).toBe('readonly');
  });

  it('a creator whose offer closed after the layout loaded', () => {
    expect(ownershipCardMode(view({ viewerRole: 'creator' }))).toBe(
      'offer-closed'
    );
  });
});

describe('outcomeNote — state 9', () => {
  const outcome = (o: Partial<OwnershipLastOutcome>): OwnershipLastOutcome => ({
    status: 'declined',
    recipientName: 'Sam Patel',
    at: '2026-10-15T10:00:00.000Z',
    withdrawnReason: null,
    ...o,
  });

  it('notes the outcomes the owner did not cause', () => {
    expect(outcomeNote(outcome({ status: 'declined' }))).toBe('declined');
    expect(outcomeNote(outcome({ status: 'expired' }))).toBe('expired');
    expect(
      outcomeNote(
        outcome({
          status: 'withdrawn',
          withdrawnReason: 'recipient_ineligible',
        })
      )
    ).toBe('ineligible');
  });

  it('is silent for an accepted offer, the owner cancelling, or none', () => {
    expect(outcomeNote(outcome({ status: 'accepted' }))).toBeNull();
    expect(
      outcomeNote(
        outcome({ status: 'withdrawn', withdrawnReason: 'owner_cancelled' })
      )
    ).toBeNull();
    expect(outcomeNote(null)).toBeNull();
    expect(outcomeNote(undefined)).toBeNull();
  });

  it('is silent for a support reassignment (only the CURRENT owner’s offers are sent)', () => {
    expect(
      outcomeNote(
        outcome({ status: 'withdrawn', withdrawnReason: 'support_reassigned' })
      )
    ).toBeNull();
  });
});

describe('confirmNameMatches — type the name (state 3A)', () => {
  it('matches trimmed and case-insensitively, like the server', () => {
    expect(confirmNameMatches('Studio Alpha', 'Studio Alpha')).toBe(true);
    expect(confirmNameMatches('  studio ALPHA ', 'Studio Alpha')).toBe(true);
  });

  it('rejects a partial or different name', () => {
    expect(confirmNameMatches('Studio', 'Studio Alpha')).toBe(false);
    expect(confirmNameMatches('Studio Alphas', 'Studio Alpha')).toBe(false);
    expect(confirmNameMatches('', 'Studio Alpha')).toBe(false);
  });

  it('never matches an empty organisation name', () => {
    expect(confirmNameMatches('', '')).toBe(false);
    expect(confirmNameMatches('  ', ' ')).toBe(false);
  });
});

describe('formatShareBps', () => {
  it('renders basis points as a percentage', () => {
    expect(formatShareBps(6000)).toBe('60%');
    expect(formatShareBps(7000)).toBe('70%');
    expect(formatShareBps(6250)).toBe('62.5%');
    expect(formatShareBps(3333)).toBe('33.33%');
    expect(formatShareBps(0)).toBe('0%');
    expect(formatShareBps(10000)).toBe('100%');
  });
});

describe('offer timing', () => {
  it('estimates expiry 7 days out', () => {
    const now = new Date('2026-10-13T10:00:00.000Z');
    expect(OWNERSHIP_OFFER_TTL_DAYS).toBe(7);
    expect(estimatedOfferExpiry(now).toISOString()).toBe(
      '2026-10-20T10:00:00.000Z'
    );
  });

  it('an offer is live strictly before its deadline', () => {
    const deadline = Date.parse(OFFER.expiresAt);
    expect(isOfferLive(OFFER.expiresAt, deadline - 1)).toBe(true);
    expect(isOfferLive(OFFER.expiresAt, deadline)).toBe(false);
    expect(isOfferLive(OFFER.expiresAt, deadline + 1)).toBe(false);
  });

  it('an unparseable deadline is not live', () => {
    expect(isOfferLive('not a date', 0)).toBe(false);
  });
});
