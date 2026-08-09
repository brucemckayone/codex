/**
 * The fixtures here are the six real `payouts` rows of the seeded
 * `of-blood-and-bones` org, read straight out of Postgres — including the
 * detail that made the old grouping wrong: `transfer_group` and
 * `stripe_charge_id` are populated ONLY on the two `paid` platform_fee rows,
 * because every non-paid insert in subscription-service.ts /
 * purchase-service.ts omits both.
 */

import type { PayoutWithCreator } from '@codex/subscription';
import { describe, expect, it } from 'vitest';
import { groupKeyOf, groupTransactions } from './group-transactions';

const PURCHASE_A = 'a1d583cb-0397-4958-b728-bed3d9054b24';
const PURCHASE_B = 'c67b64a1-e91a-44db-bbc9-5468faebcc8e';

function row(overrides: Partial<PayoutWithCreator>): PayoutWithCreator {
  return {
    id: crypto.randomUUID(),
    creatorId: null,
    creatorName: null,
    creatorEmail: null,
    creatorAvatarUrl: null,
    amountCents: 100,
    currency: 'gbp',
    reason: '',
    status: 'resolved',
    resolvedAt: null,
    stripeTransferId: null,
    createdAt: '2026-07-30T20:00:00.000Z',
    payoutType: 'creator_payout',
    subscriberName: null,
    subscriberEmail: null,
    sourceType: 'purchase',
    transferGroup: null,
    purchaseId: null,
    subscriptionId: null,
    stripeChargeId: null,
    ...overrides,
  } as PayoutWithCreator;
}

/** The six live of-blood-and-bones rows, newest ledger write first. */
const BONES_ROWS: PayoutWithCreator[] = [
  row({
    id: '5a150054-77d3-4820-b838-1c0f5941e0f7',
    payoutType: 'organization_fee',
    status: 'failed',
    reason: 'transfer_failed',
    amountCents: 117,
    purchaseId: PURCHASE_A,
    createdAt: '2026-07-30T20:01:59.775Z',
  }),
  row({
    id: 'db0680d9-3a06-4770-8fbe-3e1260a4526c',
    payoutType: 'creator_payout',
    status: 'failed',
    reason: 'transfer_failed',
    amountCents: 1052,
    purchaseId: PURCHASE_A,
    createdAt: '2026-07-30T20:01:59.558Z',
  }),
  row({
    id: 'a9b4db99-58ce-47e2-9f73-20105fb99dc3',
    payoutType: 'platform_fee',
    status: 'resolved',
    amountCents: 130,
    purchaseId: PURCHASE_A,
    transferGroup: `purchase_${PURCHASE_A}`,
    stripeChargeId: 'ch_3Tz09Q7wyGmo4sh60ZnDoyWS',
    createdAt: '2026-07-30T20:01:59.350Z',
  }),
  row({
    id: '7378634c-792b-4b89-bdec-c46484f94d52',
    payoutType: 'organization_fee',
    status: 'failed',
    reason: 'transfer_failed',
    amountCents: 225,
    purchaseId: PURCHASE_B,
    createdAt: '2026-07-30T19:59:18.595Z',
  }),
  row({
    id: '1e1f084a-5620-4d9e-a866-acedf6043174',
    payoutType: 'creator_payout',
    status: 'failed',
    reason: 'transfer_failed',
    amountCents: 2024,
    purchaseId: PURCHASE_B,
    createdAt: '2026-07-30T19:59:18.358Z',
  }),
  row({
    id: '59bfd98a-74db-4376-8c8f-679f93edbaa4',
    payoutType: 'platform_fee',
    status: 'resolved',
    amountCents: 250,
    purchaseId: PURCHASE_B,
    transferGroup: `purchase_${PURCHASE_B}`,
    stripeChargeId: 'ch_3Tz06p7wyGmo4sh60ayUjxTx',
    createdAt: '2026-07-30T19:59:18.115Z',
  }),
];

describe('groupKeyOf', () => {
  it('agrees across siblings even when only one of them carries transferGroup', () => {
    // This is the whole bug: `transferGroup` is namespaced `purchase_<id>`, so
    // a `transferGroup ?? purchaseId` chain would key the platform_fee row
    // "purchase_a1d5…" and its two siblings "a1d5…" — three rows, two buckets.
    const keys = new Set(
      BONES_ROWS.filter((r) => r.purchaseId === PURCHASE_A).map(groupKeyOf)
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(`purchase:${PURCHASE_A}`);
  });

  it('never keys on subscriptionId — a subscription spans many invoices', () => {
    const subId = '11111111-1111-4111-8111-111111111111';
    const janFailure = row({
      sourceType: 'subscription',
      subscriptionId: subId,
      status: 'failed',
      createdAt: '2026-01-31T00:00:00.000Z',
    });
    const febFailure = row({
      sourceType: 'subscription',
      subscriptionId: subId,
      status: 'failed',
      createdAt: '2026-02-28T00:00:00.000Z',
    });
    expect(groupKeyOf(janFailure)).not.toBe(groupKeyOf(febFailure));
  });

  it('keys subscription rows per charge when the writer set stripeChargeId', () => {
    const a = row({ sourceType: 'subscription', stripeChargeId: 'ch_jan' });
    const b = row({ sourceType: 'subscription', stripeChargeId: 'ch_jan' });
    const c = row({ sourceType: 'subscription', stripeChargeId: 'ch_feb' });
    expect(groupKeyOf(a)).toBe(groupKeyOf(b));
    expect(groupKeyOf(a)).not.toBe(groupKeyOf(c));
  });

  it('falls back to transferGroup, then the row id, for legacy rows', () => {
    expect(groupKeyOf(row({ transferGroup: 'course_sub_x' }))).toBe(
      'course_sub_x'
    );
    expect(groupKeyOf(row({ id: 'bare-row' }))).toBe('bare-row');
  });
});

describe('groupTransactions', () => {
  it('collapses the six live bones rows into two charges whose totals are the real gross', () => {
    const groups = groupTransactions(BONES_ROWS);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.rows.length)).toEqual([3, 3]);
    // 130+117+1052 and 250+225+2024 — the £12.99 and £24.99 /studio/sales
    // reports for the same two purchases. Before the fix this page showed six
    // "transaction" totals (£1.17 / £10.52 / £1.30 / £2.25 / £20.24 / £2.50),
    // none of which was a transaction that ever happened.
    expect(groups.map((g) => g.totalCents)).toEqual([1299, 2499]);
  });

  it('orders groups newest-first on the latest ledger write, and dates them from the earliest', () => {
    const groups = groupTransactions(BONES_ROWS);

    expect(groups[0].key).toBe(`purchase:${PURCHASE_A}`);
    expect(groups[0].latestAt).toBe('2026-07-30T20:01:59.775Z');
    // Shown date is the charge, not the last retry.
    expect(groups[0].createdAt).toBe('2026-07-30T20:01:59.350Z');
    expect(groups[1].key).toBe(`purchase:${PURCHASE_B}`);
  });

  it('orders rows within a group platform → org → creator', () => {
    const [first] = groupTransactions(BONES_ROWS);
    expect(first.rows.map((r) => r.payoutType)).toEqual([
      'platform_fee',
      'organization_fee',
      'creator_payout',
    ]);
  });

  it('takes the subscriber from whichever sibling carries it', () => {
    // The join is payouts → subscriptions → users, so a purchase-sourced row
    // resolves null and only some siblings of a subscription charge have it.
    const [group] = groupTransactions([
      row({ stripeChargeId: 'ch_1', subscriberName: null }),
      row({ stripeChargeId: 'ch_1', subscriberName: 'Ada Fan' }),
    ]);
    expect(group.subscriberName).toBe('Ada Fan');
  });

  it('leaves an unattributable row as its own single-row group', () => {
    const groups = groupTransactions([
      row({ id: 'orphan-1', sourceType: 'subscription' }),
      row({ id: 'orphan-2', sourceType: 'subscription' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.rows.length === 1)).toBe(true);
  });

  it('returns nothing for an empty page', () => {
    expect(groupTransactions([])).toEqual([]);
  });
});
