/**
 * Org Studio → Payouts: "Held for 14 days" and the bank line
 * (Codex-2hxff.29, .30). Only the organisation's share is the owner's money;
 * a bank day has run once 08:00 London has passed.
 */

import { describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import {
  heldCard,
  heldForBank,
  heldRowsOf,
  isOwnerShare,
  orgCauseLine,
  ownerBalanceOf,
  ownerBankLine,
} from './payouts-view';

// Wednesday 28 Oct 2026, 09:00 London (GMT since 25 Oct).
const NOW = new Date('2026-10-28T09:00:00.000Z');

let rowCount = 0;
const row = (
  payoutType: string,
  amountCents: number,
  bankOn: string | null,
  id = `row-${++rowCount}`
) => ({
  id,
  payoutType,
  amountCents,
  bankOn,
});

/** The server's per-sale share, as `MyStripeBalance.towards` carries it. */
const towards = (rows: Array<[string, number]>) => ({
  cents: rows.reduce((sum, [, cents]) => sum + cents, 0),
  rows: rows.map(([payoutId, towardsCents]) => ({ payoutId, towardsCents })),
});

describe('Held for 14 days', () => {
  test("the owner's share whose bank day has not run, and the next day's part of it", () => {
    const held = heldForBank(
      [
        row('organization_fee', 300, '2026-10-28'), // went at 08:00 today
        row('organization_fee', 216, '2026-10-30'),
        row('creator_payout_to_owner', 500, '2026-10-30'),
        row('organization_fee', 100, '2026-11-02'),
        row('creator_payout', 999, '2026-10-30'), // the creator's own money
        row('organization_fee', 400, null), // no bank date on record
      ],
      NOW
    );
    expect(held).toEqual({
      cents: 816,
      next: { on: '2026-10-30', cents: 716 },
    });
  });

  test("before 08:00 London, today's share is still held", () => {
    const beforeEight = new Date('2026-10-28T07:59:00.000Z');
    expect(
      heldForBank([row('organization_fee', 300, '2026-10-28')], beforeEight)
    ).toEqual({
      cents: 300,
      next: { on: '2026-10-28', cents: 300 },
    });
  });

  test('nothing held: no next day', () => {
    expect(
      heldForBank([row('creator_payout', 999, '2026-10-30')], NOW)
    ).toEqual({
      cents: 0,
      next: null,
    });
  });

  test('above zero: what went towards a take-back is not held; the rest goes on its day (AMENDMENT 3)', () => {
    const held = heldForBank(
      [
        row('organization_fee', 1100, '2026-10-30', 'eleven'),
        row('organization_fee', 216, '2026-11-02', 'whole'),
        row('organization_fee', 600, '2026-10-26', 'six'), // all towards, day past
      ],
      NOW,
      {
        negative: null,
        towards: {
          live: null,
          lastEpisode: towards([
            ['six', 600],
            ['eleven', 240],
          ]),
        },
      }
    );
    expect(held).toEqual({
      cents: 860 + 216,
      next: { on: '2026-10-30', cents: 860 },
    });
  });

  test("below zero: Held is what of the share is going towards it now, and there's no next day", () => {
    const held = heldForBank(
      [
        row('organization_fee', 300, '2026-10-26', 'ran'), // day ran inside it
        row('organization_fee', 216, '2026-10-30', 'young'),
        row('organization_fee', 150, '2026-10-20', 'sent'), // before: not in it
        row('creator_payout', 999, '2026-10-30', 'creator'),
      ],
      NOW,
      {
        negative: { owedCents: 2310, since: '2026-10-21' },
        towards: {
          live: towards([
            ['ran', 300],
            ['young', 216],
            ['creator', 999],
          ]),
          lastEpisode: towards([['sent', 150]]),
        },
      }
    );
    expect(held).toEqual({ cents: 516, next: null });
  });
});

describe('the Held card', () => {
  const balance = {
    negative: null,
    manualPayouts: true,
  };
  const rows = {
    items: [row('organization_fee', 216, '2026-10-30')],
    totalPages: 1,
  };

  test('shows a figure only when both reads are in', () => {
    expect(heldCard({ balance: undefined, rows, now: NOW })).toEqual({
      kind: 'loading',
    });
    expect(heldCard({ balance, rows: undefined, now: NOW })).toEqual({
      kind: 'loading',
    });
    expect(heldCard({ balance, rows, now: NOW })).toEqual({
      kind: 'shown',
      cents: 216,
      detail: { on: '2026-10-30', cents: 216 },
    });
  });

  test('either read failed: "couldn\'t check", never a figure or a next day', () => {
    expect(heldCard({ balance: 'failed', rows, now: NOW })).toEqual({
      kind: 'failed',
    });
    expect(heldCard({ balance, rows: 'failed', now: NOW })).toEqual({
      kind: 'failed',
    });
  });

  test('more rows than one page: no partial sum shown as the whole', () => {
    expect(
      heldCard({ balance, rows: { ...rows, totalPages: 2 }, now: NOW })
    ).toEqual({ kind: 'too_many' });
  });

  test('below zero: all of it covers the chargeback first, as the rows say', () => {
    const ran = row('organization_fee', 300, '2026-10-26');
    expect(
      heldCard({
        balance: {
          ...balance,
          negative: { owedCents: 2310, since: '2026-10-21' },
          towards: {
            live: towards([
              [rows.items[0]?.id ?? '', 216],
              [ran.id, 300],
            ]),
            lastEpisode: null,
          },
        },
        rows: { items: [...rows.items, ran], totalPages: 1 },
        now: NOW,
      })
    ).toEqual({ kind: 'shown', cents: 516, detail: 'covering' });
  });

  test('no account, or Stripe still pays out by itself with nothing held: no card', () => {
    expect(heldCard({ balance: null, rows, now: NOW })).toEqual({
      kind: 'hidden',
    });
    expect(
      heldCard({
        balance: { ...balance, manualPayouts: false },
        rows: { items: [], totalPages: 1 },
        now: NOW,
      })
    ).toEqual({ kind: 'hidden' });
  });
});

describe('the below-zero cause line (P2)', () => {
  const ORG = 'org-hollow-oak';
  const hollowOak = {
    causeType: 'dispute' as const,
    cents: 3443,
    on: '2026-10-19',
    title: 'The Making of Hollow Oak',
    organizationId: ORG,
    organisationName: 'Hollow Oak Films',
    payoutTypes: ['organization_fee'],
  };

  test("this organisation's sale is named, as the organisation's share, as the mockup words it", () => {
    expect(orgCauseLine([hollowOak], ORG)).toBe(
      "A chargeback on ‘The Making of Hollow Oak’ took back £34.43 of the organisation's share on 19 Oct, after that money had gone to your bank. If the bank decides for us, it is paid back to you."
    );
  });

  test("another organisation's sale, or the owner's own, names no title", () => {
    expect(
      orgCauseLine(
        [
          {
            ...hollowOak,
            organizationId: 'org-other',
            organisationName: 'Other',
          },
        ],
        ORG
      )
    ).toBe(
      'A chargeback on a sale in another organisation took back £34.43 on 19 Oct, after that money had gone to your bank. If the bank decides for us, it is paid back to you.'
    );
    expect(
      orgCauseLine(
        [
          {
            ...hollowOak,
            causeType: 'refund',
            organizationId: null,
            organisationName: null,
          },
        ],
        ORG
      )
    ).toBe(
      'A refund on one of your own sales took back £34.43 on 19 Oct, after that money had gone to your bank.'
    );
  });

  test("a solo owner-creator's one chargeback, from both shares: named once, never as the organisation's share alone (R2-L2)", () => {
    const both = {
      ...hollowOak,
      cents: 864,
      payoutTypes: ['creator_payout', 'organization_fee'],
    };
    expect(orgCauseLine([both], ORG)).toBe(
      'A chargeback on ‘The Making of Hollow Oak’ took back £8.64 on 19 Oct, after that money had gone to your bank. If the bank decides for us, it is paid back to you.'
    );
    // The owner's own creator share in this organisation is not the organisation's.
    expect(
      orgCauseLine([{ ...hollowOak, payoutTypes: ['creator_payout'] }], ORG)
    ).not.toContain("of the organisation's share");
    // Not known which share it came from: no claim about it.
    expect(
      orgCauseLine([{ ...hollowOak, payoutTypes: undefined }], ORG)
    ).not.toContain("of the organisation's share");
  });

  test('no cause known: the generic line', () => {
    expect(orgCauseLine([], ORG)).toBe(m.payouts_negative_cause());
    expect(orgCauseLine(undefined, ORG)).toBe(m.payouts_negative_cause());
  });
});

describe("the owner's reads", () => {
  const connected = { current: { isConnected: true }, loading: false };
  const answer = { current: { availableCents: 486 }, loading: false };
  const failed = { current: undefined, loading: false, error: { status: 503 } };
  const inFlight = { current: undefined, loading: true };

  test('the balance is asked only of an account that exists; no account is null, not a failure (L3)', () => {
    expect(
      ownerBalanceOf({ current: { isConnected: false }, loading: false }, null)
    ).toBeNull();
    expect(ownerBalanceOf(connected, answer)).toEqual({ availableCents: 486 });
  });

  test('in flight, a retry included, is loading; a failed read of either is failed', () => {
    expect(ownerBalanceOf(inFlight, null)).toBeUndefined();
    expect(ownerBalanceOf(connected, inFlight)).toBeUndefined();
    expect(
      ownerBalanceOf(connected, { ...failed, loading: true })
    ).toBeUndefined();
    expect(ownerBalanceOf(failed, null)).toBe('failed');
    expect(ownerBalanceOf(connected, failed)).toBe('failed');
  });

  test("the held rows' page count comes with them", () => {
    expect(
      heldRowsOf({
        current: { items: [], pagination: { totalPages: 3 } },
        loading: false,
      })
    ).toEqual({ items: [], totalPages: 3 });
    expect(heldRowsOf(failed)).toBe('failed');
    expect(heldRowsOf(inFlight)).toBeUndefined();
  });
});

describe('the bank line', () => {
  const payout = (payoutType: string) => ({
    id: 'payout-1',
    payoutType,
    status: 'resolved',
    reason: null,
    amountCents: 216,
    bankOn: '2026-10-30',
  });
  const ctx = {
    connectState: 'enabled' as const,
    balance: { negative: null },
    now: NOW,
  };

  test("only the owner's share gets one: a creator's is in their own account", () => {
    expect(isOwnerShare('organization_fee')).toBe(true);
    expect(isOwnerShare('creator_payout_to_owner')).toBe(true);
    expect(isOwnerShare('creator_payout')).toBe(false);
    expect(ownerBankLine(payout('creator_payout'), ctx)).toBeNull();
    expect(ownerBankLine(payout('organization_fee'), ctx)).not.toBeNull();
  });

  test("the owner's balance's share for this row: all of it went towards the take-back, never sent", () => {
    const below = {
      ...ctx,
      balance: {
        negative: { owedCents: 840, since: '2026-10-21' },
        towards: { live: towards([['payout-1', 216]]), lastEpisode: null },
      },
    };
    const allOfIt = 'Went towards a refund or chargeback';
    expect(ownerBankLine(payout('organization_fee'), below)).toBe(allOfIt);
    // Its day ran while below zero: still not sent.
    expect(
      ownerBankLine(
        { ...payout('organization_fee'), bankOn: '2026-10-26' },
        below
      )
    ).toBe(allOfIt);
  });

  test("the owner's own Connect state: paused by Stripe, the share stays in the balance", () => {
    expect(
      ownerBankLine(payout('organization_fee'), {
        ...ctx,
        connectState: 'pending_verification',
      })
    ).toBe(m.earnings_bank_paused());
  });
});
