/**
 * Builders for the support pages' tests (Codex-2hxff.28): the shapes
 * `@codex/admin` exports, filled with the mockup's own example (Ellie Marsh's
 * Sleep Reset Programme, £24.00 with £4.00 already refunded, today
 * 24 Oct 2026). A plain module, not a test file, so it is never collected.
 */

import type {
  ChargeDetail,
  ChargeSummary,
  CreatorDebtItem,
  FailedRefundItem,
  HistoryLine,
  RefundPreview,
  RefundRow,
  Slice,
} from '@codex/admin';

/** "Today" in the mockup: 24 Oct 2026, 10:41 London (09:41 UTC). */
export const NOW = new Date('2026-10-24T09:41:00.000Z');

export const CHARGE_ID = 'ch_3QeT8xLk2vRb09aZ';

export function slice(overrides: Partial<Slice> = {}): Slice {
  return {
    payoutId: 'payout-rowan',
    payoutType: 'creator_payout',
    payee: { userId: 'user-rowan', name: 'Rowan Ellis', deleted: false },
    organizationName: 'Studio Alpha',
    amountCents: 1944,
    status: 'paid',
    reason: null,
    paidAt: '2026-10-18T13:40:00.000Z',
    transferId: 'tr_3QeT9aLk2v',
    takenCents: 324,
    owedCents: 0,
    // A purchase split without an agreement: B1 says only "Creator".
    agreementShareBps: null,
    history: [],
    ...overrides,
  };
}

export const SLICES: Slice[] = [
  slice(),
  slice({
    payoutId: 'payout-studio',
    payoutType: 'organization_fee',
    payee: { userId: 'user-sam', name: 'Sam Owner', deleted: false },
    amountCents: 216,
    status: 'pending',
    reason: 'connect_not_ready',
    paidAt: null,
    transferId: null,
    takenCents: 36,
  }),
  slice({
    payoutId: 'payout-fee',
    payoutType: 'platform_fee',
    payee: null,
    organizationName: null,
    amountCents: 240,
    status: 'paid',
    paidAt: null,
    transferId: null,
    takenCents: 40,
  }),
];

export function refundRow(overrides: Partial<RefundRow> = {}): RefundRow {
  return {
    id: 're_3QfA2bLk2v',
    amountCents: 400,
    reason: 'requested_by_customer',
    status: 'succeeded',
    failureReason: null,
    failureLabel: null,
    createdAt: '2026-10-20T08:12:00.000Z',
    notifiedAt: '2026-10-20T08:13:00.000Z',
    requestedBy: { userId: 'user-jordan', name: 'Jordan Reid', deleted: false },
    ...overrides,
  };
}

export function chargeDetail(
  overrides: Partial<ChargeDetail> = {}
): ChargeDetail {
  return {
    charge: {
      id: CHARGE_ID,
      paymentIntentId: 'pi_3QeT8xLk2vRb09aZ',
      amountCents: 2400,
      refundedCents: 400,
      paidAt: '2026-10-18T13:32:00.000Z',
      card: { brand: 'visa', last4: '4242' },
      stripeFeeCents: 56,
    },
    source: {
      type: 'purchase',
      purchaseId: 'purchase-1',
      status: 'completed',
      item: {
        kind: 'content',
        id: 'content-1',
        title: 'Sleep Reset Programme',
        deleted: false,
      },
    },
    buyer: {
      userId: 'user-ellie',
      name: 'Ellie Marsh',
      email: 'ellie.marsh@example.com',
      deleted: false,
    },
    organization: {
      id: 'org-1',
      name: 'Studio Alpha',
      slug: 'studio-alpha',
      deleted: false,
    },
    window: { closesAt: '2026-11-01T14:32:00.000Z', isOpen: true },
    refundable: { maxCents: 2000, blocked: null },
    refundCount: 1,
    slices: SLICES,
    refunds: [refundRow()],
    chargebacks: [],
    ...overrides,
  };
}

/** The mockup's £7.50 part refund (B1). */
export function preview(overrides: Partial<RefundPreview> = {}): RefundPreview {
  return {
    amountCents: 750,
    isFinal: false,
    lines: [
      {
        payoutId: 'payout-rowan',
        repayPayoutId: null,
        label:
          "Reversed from the payee's Stripe balance; a low balance makes it a debt",
        amountCents: 607,
        method: 'transfer_reversal',
      },
      {
        payoutId: 'payout-studio',
        repayPayoutId: null,
        label: 'Taken off the payout not yet made',
        amountCents: 67,
        method: 'reduce_unpaid',
      },
      {
        payoutId: 'payout-fee',
        repayPayoutId: null,
        label: 'The platform bears its share; nothing moves',
        amountCents: 75,
        method: 'platform_bears',
      },
      {
        payoutId: null,
        repayPayoutId: null,
        label: "A part refund's rounding stays with the platform",
        amountCents: 1,
        method: 'rounding',
      },
    ],
    payeesGiveBackCents: 674,
    platformBearsCents: 76,
    stripeFeeCents: 56,
    access: { kind: 'keeps', title: 'Sleep Reset Programme' },
    ...overrides,
  };
}

export function chargeSummary(
  overrides: Partial<ChargeSummary> = {}
): ChargeSummary {
  return {
    chargeId: CHARGE_ID,
    kind: 'purchase',
    title: 'Sleep Reset Programme',
    titleDeleted: false,
    interval: null,
    organizationName: 'Studio Alpha',
    buyer: {
      userId: 'user-ellie',
      name: 'Ellie Marsh',
      email: 'ellie.marsh@example.com',
      deleted: false,
    },
    amountCents: 2400,
    refundedCents: 400,
    paidAt: '2026-10-18T13:32:00.000Z',
    chargeback: null,
    window: { closesAt: '2026-11-01T14:32:00.000Z', isOpen: true },
    ...overrides,
  };
}

export function failedRefund(
  overrides: Partial<FailedRefundItem> = {}
): FailedRefundItem {
  return {
    refundId: '11111111-1111-4111-8111-111111111111',
    stripeRefundId: 're_3QgB1aLk2v',
    chargeId: 'ch_3QdP7aLk2vRb11aA',
    kind: 'purchase',
    title: 'Sleep Reset Programme',
    buyer: {
      userId: 'user-daniel',
      name: 'Daniel Price',
      email: 'daniel.price@example.com',
      deleted: false,
    },
    chargeAmountCents: 2400,
    chargePaidAt: '2026-10-12T10:00:00.000Z',
    amountCents: 2400,
    isFull: true,
    requestedBy: { userId: 'user-jordan', name: 'Jordan Reid', deleted: false },
    createdAt: '2026-10-16T09:00:00.000Z',
    failedAt: '2026-10-21T09:00:00.000Z',
    failureReason: 'expired_or_canceled_card',
    failureLabel: 'The card has expired or been cancelled',
    takenFromPayeesCents: 2160,
    ...overrides,
  };
}

export function historyLine(overrides: Partial<HistoryLine> = {}): HistoryLine {
  return {
    causeType: 'refund',
    causeId: 're_3QiC9bLk2v',
    causeAmountCents: 1000,
    amountCents: 810,
    outcome: 'owed',
    repayPayoutId: null,
    debtResolution: null,
    disputeOpenedAt: null,
    disputeWonAt: null,
    ...overrides,
  };
}

export function creatorDebt(
  overrides: Partial<CreatorDebtItem> = {}
): CreatorDebtItem {
  return {
    reviewId: '22222222-2222-4222-8222-222222222222',
    payoutId: 'payout-maya',
    payee: {
      userId: 'user-maya',
      name: 'Maya Chen',
      deleted: false,
      role: 'creator',
    },
    owedCents: 810,
    chargeId: 'ch_3QhA1aLk2vRb22bB',
    title: 'Mindful Mornings',
    buyerName: 'Grace Liu',
    cause: {
      type: 'refund',
      id: 're_3QiC9bLk2v',
      amountCents: 1000,
      disputeStatus: null,
    },
    errorCode: 'slice_repaid',
    errorLabel:
      'Already paid back after a won chargeback, and that payout had gone out',
    createdAt: '2026-10-23T09:00:00.000Z',
    history: [
      historyLine({
        causeType: 'dispute',
        causeId: 'du_1QgZ2kLk2v',
        causeAmountCents: 3000,
        amountCents: 2430,
        outcome: 'paid_back',
        disputeOpenedAt: '2026-10-13T09:00:00.000Z',
        disputeWonAt: '2026-10-20T09:00:00.000Z',
      }),
      historyLine({
        causeId: 're_3QhB1aLk2v',
        causeAmountCents: 600,
        amountCents: 486,
        outcome: 'taken_from_repay',
        repayPayoutId: 'payout-maya-repay',
      }),
      historyLine(),
    ],
    ...overrides,
  };
}

/** A paginated envelope, as the list routes answer. */
export function list<T>(items: T[]) {
  return {
    items,
    pagination: {
      page: 1,
      limit: 20,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / 20)),
    },
  };
}
