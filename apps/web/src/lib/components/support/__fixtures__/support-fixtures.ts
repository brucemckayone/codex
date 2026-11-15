/**
 * Builders for the support pages' tests (Codex-2hxff.28): the shapes
 * `@codex/admin` exports, filled with the mockup's own example (Ellie Marsh's
 * Sleep Reset Programme, £24.00 with £4.00 already refunded, today
 * 24 Oct 2026). A plain module, not a test file, so it is never collected.
 */

import type {
  ChargebackRow,
  ChargeDetail,
  ChargeSummary,
  CreatorDebtItem,
  CreatorDebtPerson,
  FailedRefundItem,
  FeeChangeCard,
  FeeNoticeItem,
  HeldPriceMove,
  HistoryLine,
  OwedToCreatorItem,
  RefundPreview,
  RefundRow,
  Slice,
  StoppedPriceChange,
  StripeHeldTakeBack,
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
    owedToPayeeCents: 0,
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
    resolution: null,
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
    window: {
      closesAt: '2026-11-01T14:32:00.000Z',
      isOpen: true,
      liftedByLateWin: false,
    },
    refundable: {
      maxCents: 2000,
      blocked: null,
      refundedOutsideStripeOn: null,
    },
    refundCount: 1,
    slices: SLICES,
    // What the server works out for SLICES: £3.24 + £0.36 + £0.40, and 10%.
    split: { takenTotalCents: 400, platformFeeShareBps: 1000 },
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
    window: {
      closesAt: '2026-11-01T14:32:00.000Z',
      isOpen: true,
      liftedByLateWin: false,
    },
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
    // Re-paying would give Daniel access back (the server's prediction).
    accessRestoreBlockedReason: null,
    // An ordinary failed refund: not a late win's own.
    isLateWinRefund: false,
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
    systemDecision: null,
    credit: null,
    ...overrides,
  };
}

/**
 * A window a late-won chargeback lifted (owner Q7, Codex-2hxff.70): open, its
 * 14-day date (17 Sep, 20:14 London) long past, so no page may print it.
 */
export const LIFTED_WINDOW = {
  closesAt: '2026-09-17T19:14:00.000Z',
  isOpen: true,
  liftedByLateWin: true,
};

/** A chargeback on the charge, as `ChargebacksCard` lists it: open, by default. */
export function chargebackRow(
  overrides: Partial<ChargebackRow> = {}
): ChargebackRow {
  return {
    id: 'du_1QmD2rLk2vSb91tU',
    amountCents: 2400,
    status: 'needs_response',
    reason: 'unrecognized',
    createdAt: '2026-10-26T09:00:00.000Z',
    respondBy: '2026-11-05T09:00:00.000Z',
    lostOn: null,
    lateWonOn: null,
    appealStatus: null,
    settling: false,
    ...overrides,
  };
}

/**
 * The late-win mockup's chargeback (Codex-2hxff.70, support/charge-page.html
 * S1-S2): Ellen Marsh's £24.00 'Winter Light', opened 26 Oct, lost 20 Nov,
 * won late 14 Dec. `settling` while the creators are being paid back (S1).
 */
export function lateWonChargeback(
  overrides: Partial<ChargebackRow> = {}
): ChargebackRow {
  return chargebackRow({
    status: 'won',
    respondBy: null,
    lostOn: '2026-11-20T10:00:00.000Z',
    lateWonOn: '2026-12-14T16:20:00.000Z',
    settling: false,
    ...overrides,
  });
}

/** The late win's history line on Maya's share, once paid back (S2). */
export function lateWonHistoryLine(
  overrides: Partial<HistoryLine> = {}
): HistoryLine {
  return historyLine({
    causeType: 'dispute',
    causeId: 'du_1QmD2rLk2vSb91tU',
    causeAmountCents: 2400,
    amountCents: 1440,
    outcome: 'paid_back',
    repayPayoutId: 'payout-repay',
    disputeOpenedAt: '2026-10-26T09:00:00.000Z',
    disputeWonAt: '2026-12-14T16:22:00.000Z',
    lostOn: '2026-11-20T10:00:00.000Z',
    stepKind: 'transfer_reversal',
    ...overrides,
  });
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
    organizationName: 'Studio Alpha',
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
    owedCreditId: null,
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

/** A take-back that came out of a payee's Stripe balance (D1). */
export function stripeHeld(
  overrides: Partial<StripeHeldTakeBack> = {}
): StripeHeldTakeBack {
  return {
    payoutReversalId: '33333333-3333-4333-8333-333333333333',
    payoutId: 'payout-maya-winter',
    amountCents: 1440,
    takenAt: '2026-10-26T09:00:00.000Z',
    stripeReversalId: 'trr_1QlW3aLk2v',
    chargeId: 'ch_3QlW1aLk2vRb33cC',
    title: 'Winter Light',
    organizationName: 'Studio Alpha',
    buyerName: 'Nadia Hassan',
    cause: {
      type: 'dispute',
      id: 'du_1QlW2nLk2vSc18kD',
      amountCents: 1600,
      disputeStatus: 'needs_response',
    },
    history: [
      historyLine({
        causeType: 'dispute',
        causeId: 'du_1QlW2nLk2vSc18kD',
        causeAmountCents: 1600,
        amountCents: 1440,
        outcome: 'taken',
        disputeOpenedAt: '2026-10-26T09:00:00.000Z',
      }),
    ],
    ...overrides,
  };
}

/**
 * One person on Creator debts (D1): Maya's −£8.40 Stripe-held balance, £6.00
 * back so far, written off by Stripe on 24 Apr 2027 if not back by then.
 */
export function debtPerson(
  overrides: Partial<CreatorDebtPerson> = {}
): CreatorDebtPerson {
  return {
    payee: {
      userId: 'user-maya',
      name: 'Maya Chen',
      deleted: false,
      roles: ['creator'],
    },
    stripe: {
      availableCents: -840,
      pendingCents: 0,
      checkedAt: '2026-10-24T09:40:00.000Z',
      live: true,
    },
    stripeOwedCents: 840,
    negativeSince: '2026-10-26T07:00:00.000Z',
    backCents: 600,
    stripeHeld: [stripeHeld()],
    recordedDebts: [],
    collectedCents: null,
    collectedAt: null,
    totalOwedCents: 840,
    state: 'recovering',
    clock: {
      kind: 'stripe_writes_off',
      on: '2027-04-24T07:00:00.000Z',
      daysLeft: 178,
    },
    oldestAt: '2026-10-26T07:00:00.000Z',
    ...overrides,
  };
}

/** A person whose only debt is one Stripe refused (D2: Ruth's). */
export function refusedDebtPerson(
  overrides: Partial<CreatorDebtPerson> = {}
): CreatorDebtPerson {
  return debtPerson({
    payee: {
      userId: 'user-ruth',
      name: 'Ruth Calder',
      deleted: false,
      roles: ['creator'],
    },
    stripe: {
      availableCents: 0,
      pendingCents: 0,
      checkedAt: '2026-10-24T09:40:00.000Z',
      live: true,
    },
    stripeOwedCents: 0,
    negativeSince: null,
    backCents: null,
    stripeHeld: [],
    recordedDebts: [creatorDebt()],
    totalOwedCents: 810,
    state: 'needs_settling',
    clock: null,
    oldestAt: '2026-10-23T09:00:00.000Z',
    ...overrides,
  });
}

/** One row of Owed to creators (O1): Maya's £9.00, a take-back after a won chargeback. */
export function owedItem(
  overrides: Partial<OwedToCreatorItem> = {}
): OwedToCreatorItem {
  return {
    creditId: '44444444-4444-4444-8444-444444444444',
    payoutId: 'payout-maya-golden',
    payee: {
      userId: 'user-maya',
      name: 'Maya Okafor',
      deleted: false,
      role: 'creator',
    },
    state: 'owed',
    effect: 'reversal_landed',
    amountCents: 900,
    repayCents: 900,
    stepAmountCents: 900,
    settledAs: 'cancelled',
    stripeReversalId: 'trr_1QkR8sLk2vTb41cC',
    chargeId: 'ch_3QhK1zLk2vRb27pQ',
    title: 'Golden Hour Portraits',
    organizationName: 'Hollow Oak Films',
    buyerName: 'Owen Clarke',
    cause: {
      type: 'dispute',
      id: 'du_1QjM3pLk2vSb91tU',
      amountCents: 1200,
      disputeStatus: 'won',
    },
    debt: null,
    action: 'repay',
    foundAt: '2026-10-23T09:00:00.000Z',
    checkedAt: null,
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

// ── Fee notices and price moves (Codex-2hxff.33, .85, .86) ──────────────
// Batch C1 Part B's story: on Mon 2 Nov 2026 at 14:20 Jordan Reid raises
// Codex's fee from 10% to 12%; the 08:00 run on Tue 3 Nov emails the 412
// people it affects, and 2 emails don't go through.

/** Tue 3 Nov 2026, 10:00 London (winter: London is UTC). */
export const FEE_NOW = new Date('2026-11-03T10:00:00.000Z');

export const JORDAN = {
  userId: 'user-jordan',
  name: 'Jordan Reid',
  deleted: false,
};

export function feeChangeCard(
  overrides: Partial<FeeChangeCard> = {}
): FeeChangeCard {
  return {
    changeId: '33333333-3333-4333-8333-333333333333',
    scope: 'platform',
    organization: null,
    creator: null,
    lines: [
      { value: 'platformFeePercent', context: 'both', from: 1000, to: 1200 },
    ],
    removed: false,
    replacesChangeId: null,
    savedAt: '2026-11-02T14:20:00.000Z',
    savedBy: JORDAN,
    firstRunAt: '2026-11-03T08:00:00.000Z',
    firstEmailsAt: null,
    listed: 412,
    told: { byEmail: 410, anotherWay: 0 },
    toldByDay: [{ londonDate: '2026-11-03', byEmail: 410, anotherWay: 0 }],
    waitingFor: 2,
    joiners: { total: 0, told: 0, waiting: 0 },
    toldAnotherWay: [],
    lastToldAt: null,
    effectiveFrom: null,
    earliestFrom: '2026-12-04T00:00:00.000Z',
    ...overrides,
  };
}

export function feeNotice(
  overrides: Partial<FeeNoticeItem> = {}
): FeeNoticeItem {
  return {
    noticeId: '44444444-4444-4444-8444-444444444444',
    changeId: '33333333-3333-4333-8333-333333333333',
    person: {
      userId: 'user-jonah',
      name: 'Jonah Reyes',
      deleted: false,
      email: 'jonah@reyesfilms.co.uk',
    },
    roles: [
      {
        organizationId: 'org-hollow',
        organizationName: 'Hollow Oak Films',
        as: 'creator',
      },
      {
        organizationId: 'org-north',
        organizationName: 'Northlight Collective',
        as: 'creator',
      },
    ],
    onList: true,
    joinedAt: null,
    state: 'failed',
    reason: 'refused',
    error: 'HTTP 400',
    attempts: 1,
    waitingSince: '2026-11-03T08:00:00.000Z',
    lastTriedAt: '2026-11-03T08:00:05.000Z',
    nextTryAt: '2026-11-04T08:00:00.000Z',
    changeSavedAt: '2026-11-02T14:20:00.000Z',
    changeEffectiveFrom: null,
    ...overrides,
  };
}

export function heldMove(
  overrides: Partial<HeldPriceMove> = {}
): HeldPriceMove {
  return {
    moveId: '55555555-5555-4555-8555-555555555555',
    priceChangeId: '66666666-6666-4666-8666-666666666666',
    status: 'held',
    action: 'retry',
    subscriber: {
      userId: 'user-leah',
      name: 'Leah Ortiz',
      deleted: false,
      email: 'leah@ortizphoto.co.uk',
    },
    organization: {
      id: 'org-hollow',
      name: 'Hollow Oak Films',
      deleted: false,
    },
    plan: { kind: 'tier', id: 'tier-pro', name: 'Pro', interval: 'month' },
    fromAmountCents: 1200,
    newAmountCents: 1400,
    heldReason: 'notice_refused',
    lastError: 'HTTP 400',
    alertErrorId: 'e1a2b3c4',
    attempts: 3,
    lastTriedAt: '2026-10-30T17:00:04.000Z',
    noticeAt: null,
    effectiveAt: null,
    subscriptionEnded: false,
    retry: null,
    queuedFor: null,
    waitsForDispute: false,
    resolution: null,
    createdAt: '2026-10-30T14:12:00.000Z',
    ...overrides,
  };
}

export function stoppedChange(
  overrides: Partial<StoppedPriceChange> = {}
): StoppedPriceChange {
  return {
    changeId: '77777777-7777-4777-8777-777777777777',
    organization: {
      id: 'org-north',
      name: 'Northlight Collective',
      deleted: false,
    },
    plan: {
      kind: 'tier',
      id: 'tier-members',
      name: 'Members',
      interval: 'month',
    },
    fromAmountCents: 800,
    newAmountCents: 900,
    savedAt: '2026-10-30T13:20:00.000Z',
    savedBy: { userId: 'user-tom', name: 'Tom Ellison', deleted: false },
    stoppedAt: '2026-10-30T14:00:41.000Z',
    stoppedReason: 'template_missing',
    stoppedErrorId: 'e7f1c2a4',
    waiting: 6240,
    total: 6240,
    restart: null,
    ...overrides,
  };
}
