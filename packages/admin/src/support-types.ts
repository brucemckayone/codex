/**
 * Support refunds: what the platform-owner support routes return
 * (Codex-2hxff.28; data design §1). Amounts are pence, dates ISO 8601
 * strings, and the currency is always GBP.
 *
 * These routes are platform-owner only and still never send: a connected
 * account id (`acct_`; the Creator debts tab's live balance included), a
 * secret, card data beyond brand and last four, a
 * debt's Stripe message (`refund_reviews.error_message`; the code and a label
 * made here go out instead), or a raw Stripe error. Stripe object ids (`ch_`,
 * `py_`, `pi_`, `re_`, `tr_`, `du_`, `in_`, `sub_`) and buyer and payee names
 * and emails are fine: support needs them.
 *
 * Money records are never hidden, so soft-deleted content, organisations and
 * users are returned with `deleted: true`, for the page to label.
 */

/** What was paid for: a one-off purchase, or an invoice of a subscription. */
export type SupportChargeKind =
  | 'purchase'
  | 'subscription_invoice'
  | 'course_plan_invoice';

/**
 * A charge's chargeback as support sees it. An inquiry takes no money; an
 * open or lost chargeback blocks a refund; a won one does not.
 */
export type ChargebackState = 'inquiry' | 'open' | 'won' | 'lost';

/** Support's 14-day refund window for one payment (`refundWindow`). */
export interface SupportRefundWindow {
  closesAt: string;
  isOpen: boolean;
}

/** A person named on a record: a payee, or whoever issued a refund. */
export interface SupportPerson {
  userId: string;
  name: string;
  deleted: boolean;
}

/** The buyer, with the email support matches against the customer's message. */
export interface SupportBuyer extends SupportPerson {
  email: string;
}

/** One row of the search results. */
export interface ChargeSummary {
  /**
   * The Stripe charge (`ch_`/`py_`). Null only for an old purchase whose
   * payment Stripe names no charge for: the row is shown, but cannot be opened.
   */
  chargeId: string | null;
  kind: SupportChargeKind;
  /** The content or course title, or the tier (a course plan: its course). */
  title: string;
  /** The item or tier was deleted since. */
  titleDeleted: boolean;
  /** A subscription invoice's billing interval; null for a purchase. */
  interval: 'month' | 'year' | null;
  organizationName: string | null;
  buyer: SupportBuyer;
  amountCents: number;
  /** Refunds pending, waiting on the customer, or succeeded. */
  refundedCents: number;
  paidAt: string;
  /** The charge's latest dispute; null for none, or an inquiry that closed. */
  chargeback: ChargebackState | null;
  /**
   * From the recorded payment time, for the list only. The detail and the
   * refund route measure from Stripe's `charge.created`, and only the route's
   * check counts.
   */
  window: SupportRefundWindow;
}

/** Why the form cannot refund this charge now. */
export type RefundBlock = 'window_closed' | 'chargeback' | 'nothing_left';

/** What the charge paid for. */
export type ChargeDetailSource =
  | {
      type: 'purchase';
      purchaseId: string;
      /** `completed`, `refunded`, … (`PURCHASE_STATUS`). */
      status: string;
      /** Null only if the purchase names neither content nor a course. */
      item: {
        kind: 'content' | 'course';
        id: string;
        title: string;
        deleted: boolean;
      } | null;
    }
  | {
      type: 'subscription' | 'course_subscription';
      subscriptionId: string;
      /** Stripe's `sub_` id for the subscription. */
      stripeSubscriptionId: string;
      /** The tier's name; a course plan's course title. */
      planName: string;
      planDeleted: boolean;
      interval: 'month' | 'year';
      /** The subscription's current billing period, from our record. */
      periodStart: string;
      periodEnd: string;
      status: string;
      /**
       * This charge paid for the current billing period, so its full refund
       * cancels the subscription (owner decision P-4).
       */
      isCurrentPeriodPayment: boolean;
    };

/** The charge, its split, and everything done to it so far. */
export interface ChargeDetail {
  charge: {
    id: string;
    paymentIntentId: string | null;
    amountCents: number;
    /** Refunds pending, waiting on the customer, or succeeded. */
    refundedCents: number;
    /** Stripe's `charge.created`. */
    paidAt: string;
    card: { brand: string; last4: string } | null;
    /** Stripe's fee on the payment, which Stripe keeps on a refund. */
    stripeFeeCents: number | null;
  };
  source: ChargeDetailSource;
  buyer: SupportBuyer;
  organization: {
    id: string;
    name: string;
    slug: string;
    deleted: boolean;
  } | null;
  window: SupportRefundWindow;
  refundable: {
    /** The charge less its pending, waiting and succeeded refunds. */
    maxCents: number;
    blocked: RefundBlock | null;
  };
  /**
   * How many refunds Stripe lists on the charge, in any status. The form
   * sends it back as `expectedRefundCount`: it is the page's concurrency
   * token, and part of the refund's idempotency key.
   */
  refundCount: number;
  slices: Slice[];
  /** The split card's totals, so the page does no money arithmetic. */
  split: {
    /**
     * Taken back so far: every slice's `takenCents` together, the platform
     * fee's own share included (the card's footer).
     */
    takenTotalCents: number;
    /**
     * The platform fee slice's share of the charge, in basis points
     * (1050 = 10.5%), as charged; null with no fee slice.
     */
    platformFeeShareBps: number | null;
  };
  refunds: RefundRow[];
  chargebacks: ChargebackRow[];
}

/** One payee's (or the platform fee's) slice of the charge. */
export interface Slice {
  payoutId: string;
  /** `platform_fee`, `organization_fee`, `creator_payout`, `creator_payout_to_owner`. */
  payoutType: string;
  /** Null on the platform fee, and on an organisation's slice with no owner. */
  payee: SupportPerson | null;
  organizationName: string | null;
  amountCents: number;
  /**
   * A creator slice's share of the pool after the platform fee, in basis
   * points (6000 = 60%), from the agreement that split it: an invoice slice's
   * own agreement, a purchase's creator slice's purchase's. An accepted
   * agreement's share never changes. Null on every other slice, one split
   * without an agreement, and rows written before the agreement was recorded.
   */
  agreementShareBps: number | null;
  /** `paid`, `pending`, `failed`, `reversed`, `cancelled_by_refund`, `cancelled_by_dispute`. */
  status: string;
  /** Why an unpaid slice waits (`connect_not_ready`, …). */
  reason: string | null;
  paidAt: string | null;
  /** The `tr_` transfer that paid it. */
  transferId: string | null;
  /**
   * Taken back so far: `taken`, `taken_from_repay` and `taken_after_settled`,
   * not counting a won chargeback.
   */
  takenCents: number;
  /** What the payee still owes: open debts only. */
  owedCents: number;
  /**
   * What is owed back TO the payee: late take-backs on settled steps, open
   * and confirmed (`taken_after_settled`). Never netted with `owedCents`.
   */
  owedToPayeeCents: number;
  history: HistoryLine[];
}

/**
 * What one refund or chargeback did to a slice. Never read
 * `payout_reversals.status` on its own: a `cancelled` step marked
 * `moved_to_repay` was taken, from the slice's re-pay payout.
 */
export type HistoryOutcome =
  // Taken back from the slice.
  | 'taken'
  // Taken from a re-pay payout of the slice (it had been paid back).
  | 'taken_from_repay'
  // The payee's balance could not cover it: a debt.
  | 'owed'
  // Taken, then paid back by a new payout (a won chargeback, or a failed
  // refund support settled as creators_repaid).
  | 'paid_back'
  // Never taken: its chargeback was won before the step ran.
  | 'not_taken'
  // Recorded and not yet acted on.
  | 'in_progress'
  // Stripe failed or refused it; it is retried.
  | 'retrying'
  // Stripe refused it on every try: nothing retries it. A person decides.
  | 'refused'
  // Settled as not taken (or as a debt), but a late take-back reached Stripe
  // anyway: owed back to the payee (Codex-2hxff.73, Q8).
  | 'taken_after_settled';

/**
 * A payee credit's state (data design §7.2). `needs_person`: open, on a
 * cancellation the ledger cannot attribute to its step (another cancellation
 * or take-back is on the slice), so a check can never confirm it: support
 * checks in Stripe, then decides (owner decision 2026-10-28, MED-3).
 */
export type CreditState =
  | 'needs_check'
  | 'needs_person'
  | 'owed'
  | 'repaid'
  | 'debt_collected'
  | 'not_owed';

/**
 * The one thing support can do with an open credit now (§7.4; owner
 * decisions Q11, OQ4, and MED-3 of 2026-10-28):
 *
 * - `repay`: pay back what Stripe took;
 * - `count_against_debt`: the step's own debt is still open and Stripe took
 *   exactly its amount, so the take-back paid it;
 * - `check`: Stripe never answered: "Check Stripe again";
 * - `decide`: a `needs_person` row: "Check in Stripe, then decide". Re-pay
 *   (it pays `repayCents`, the cancelled share) or Not owed, and BOTH need a
 *   note saying what support saw in Stripe;
 * - `settle_by_hand`: found on a step another path had already paid back
 *   (a `done` step, or one already re-paid). Re-pay refuses it.
 *
 * "Not owed" is on every open row, so it is not listed here.
 */
export type CreditAction =
  | 'repay'
  | 'count_against_debt'
  | 'check'
  | 'decide'
  | 'settle_by_hand';

/** A late take-back's credit on a history line (§7.6). */
export interface HistoryCredit {
  creditId: string;
  state: CreditState;
  /** What Stripe took, or the cancelled share; null while it needs a check. */
  amountCents: number | null;
  /** Null once settled. */
  action: CreditAction | null;
  /** The re-pay payout support wrote for it, and its status (`pending` until the next run). */
  repayPayout: { id: string; status: string } | null;
}

/** What the system decided for a stranded cancellation (Codex-2hxff.71, §6.3). */
export type SystemDecision = 'took_share' | 'payee_kept';

export interface HistoryLine {
  causeType: 'refund' | 'dispute';
  /** The `re_` refund or `du_` dispute. */
  causeId: string;
  /** The refund's or dispute's own amount; null if we hold no record of it. */
  causeAmountCents: number | null;
  /** This slice's share of it. */
  amountCents: number;
  outcome: HistoryOutcome;
  /** The re-pay payout the line is on, for `taken_from_repay` and its kin. */
  repayPayoutId: string | null;
  /**
   * On an `owed` line, how support settled the debt (`creator_absorbed`,
   * `platform_absorbed`, `manually_reversed`, `dispute_won`, `refund_failed`);
   * null while it is open.
   */
  debtResolution: string | null;
  /** A dispute line's dispute: Stripe's `created`. Null on a refund line. */
  disputeOpenedAt: string | null;
  /**
   * A dispute line's dispute, once won: when we applied the win (its re-pay),
   * which Stripe's close precedes by moments. Null otherwise.
   */
  disputeWonAt: string | null;
  /**
   * The system settled this stranded step itself (§6.3): it took the share
   * (and it is paid back), or the payee kept a transfer made for the slice.
   * Null otherwise.
   */
  systemDecision: SystemDecision | null;
  /** A late take-back's credit on this step, in any state; null for none. */
  credit: HistoryCredit | null;
}

/** Whoever issued a refund: support, the Stripe Dashboard, or the platform (null). */
export type RefundRequester = SupportPerson | 'dashboard' | null;

/** One refund of the charge, as Stripe lists it. */
export interface RefundRow {
  /** The `re_` refund. */
  id: string;
  amountCents: number;
  reason: string | null;
  /** Stripe's: `pending`, `requires_action`, `succeeded`, `failed`, `canceled`. */
  status: string;
  failureReason: string | null;
  /** A plain label for `failureReason`, made here. */
  failureLabel: string | null;
  createdAt: string;
  /** When the buyer was emailed about it; null until the webhook records it. */
  notifiedAt: string | null;
  requestedBy: RefundRequester;
}

/** One dispute of the charge, from `disputes`. */
export interface ChargebackRow {
  /** The `du_` dispute. */
  id: string;
  amountCents: number;
  /** Stripe's dispute status, current as the webhook and the reconcile keep it. */
  status: string;
  reason: string | null;
  createdAt: string;
  /** Stripe's evidence deadline, while a response is due. */
  respondBy: string | null;
}

/** How the preview says a line of the clawback is taken (`planClawback`). */
export type RefundPreviewMethod =
  | 'transfer_reversal'
  | 'reduce_unpaid'
  | 'cancel_unpaid'
  | 'platform_bears'
  | 'from_repay_payout'
  | 'needs_person'
  | 'rounding';

export interface RefundPreviewLine {
  /** The slice; null on the rounding line. */
  payoutId: string | null;
  /** On a `from_repay_payout` line, the re-pay payout the share comes off. */
  repayPayoutId: string | null;
  /** How it is taken, in words. Names come from the detail's slices. */
  label: string;
  amountCents: number;
  method: RefundPreviewMethod;
}

/** What a refund of `amountCents` would do, worked out by the clawback engine's own rules. */
export interface RefundPreview {
  amountCents: number;
  /** It completes the charge's refund: unpaid slices are cancelled, not reduced. */
  isFinal: boolean;
  lines: RefundPreviewLine[];
  /** Taken back from payees: every line but the platform's and `needs_person`. */
  payeesGiveBackCents: number;
  /** The platform fee's share plus the rounding. */
  platformBearsCents: number;
  stripeFeeCents: number | null;
  access: {
    kind: 'keeps' | 'loses' | 'subscription_cancelled' | 'subscription_runs';
    /** What the buyer keeps or loses: the item, or the plan. */
    title: string;
  };
}

/** The refund support just made, or the one a repeat of the same submit found. */
export interface SupportRefundResult {
  refund: {
    /** The `re_` refund. */
    id: string;
    amountCents: number;
    /** Stripe's status at once: usually `succeeded` or `pending`. */
    status: string;
    createdAt: string;
  };
  /** The same submit was already made: no new refund was created. */
  replayed: boolean;
}

export interface SupportQueueCounts {
  failedRefunds: number;
  /**
   * People who need a person (owner decision OQ2): an open debt Stripe
   * refused, or a Stripe-held balance at "To invoice". A balance Stripe is
   * recovering by itself is listed, not counted.
   */
  creatorDebts: number;
  /** Open payee credits: owed back, or waiting for a check (Codex-2hxff.73). */
  owedToCreators: number;
}

/** A failed refund waiting for support (`refunds`, status failed, unresolved). */
export interface FailedRefundItem {
  /** Our `refunds` row: the id the settle route takes. */
  refundId: string;
  stripeRefundId: string;
  chargeId: string;
  /** Null when we hold no record of what the charge paid for. */
  kind: SupportChargeKind | null;
  title: string | null;
  buyer: SupportBuyer | null;
  chargeAmountCents: number | null;
  /**
   * When the charge was paid, from our record (as search's `paidAt`): a
   * purchase's payment time, an invoice's first slice. Null when we hold no
   * record of the charge.
   */
  chargePaidAt: string | null;
  amountCents: number;
  /** The refund was for the whole charge; null when we hold no record of the charge. */
  isFull: boolean | null;
  /** Who in support made it; null for the Stripe Dashboard or the platform. */
  requestedBy: SupportPerson | null;
  /** When Stripe made the refund. */
  createdAt: string;
  /** When it was recorded as failed. */
  failedAt: string;
  failureReason: string | null;
  failureLabel: string;
  /** What its clawback took from payees (done steps, not the fee's share). */
  takenFromPayeesCents: number;
  /**
   * What settling it `creators_repaid` would do to the buyer's access,
   * worked out read only by the restore's own rule: null means access would
   * come back; otherwise why it would not, or `unknown`. A prediction:
   * nothing is locked, so the settle's `accessNotRestoredReason` is the
   * final word.
   */
  accessRestoreBlockedReason: AccessRestorePrediction | null;
}

/** A payee's role on a slice, as the queue labels it. */
export type PayeeRole = 'creator' | 'organisation_owner';

/** The refund or chargeback a queue row is about. */
export interface QueueCause {
  type: 'refund' | 'dispute';
  id: string;
  amountCents: number | null;
  /** A chargeback's current status. */
  disputeStatus: string | null;
}

/** A creator debt waiting for support (`refund_reviews`, unresolved). */
export interface CreatorDebtItem {
  reviewId: string;
  /** The slice the debt is on. */
  payoutId: string;
  payee: SupportPerson & { role: PayeeRole };
  owedCents: number;
  chargeId: string | null;
  title: string | null;
  /** The slice's organisation; null for none. */
  organizationName: string | null;
  buyerName: string | null;
  /** Null only on a debt recorded before steps were (no cause is named). */
  cause: QueueCause | null;
  /** `insufficient_funds`, `balance_insufficient`, `slice_repaid`, or Stripe's code. */
  errorCode: string;
  /** A plain label for `errorCode`, made here. Never Stripe's message. */
  errorLabel: string;
  createdAt: string;
  /**
   * An open credit on this debt's step whose take-back paid it ("Count it
   * against this debt" on Owed to creators, Q11); null for none.
   */
  owedCreditId: string | null;
  /** The slice's history, as on the charge detail. */
  history: HistoryLine[];
}

/**
 * A take-back that came out of a payee's Stripe balance during their current
 * negative balance (owner decision Q2): Stripe holds what it left owed, and
 * takes it from their next earnings. A Creator debts row's lines, beside its
 * recorded debts.
 */
export interface StripeHeldTakeBack {
  /** The step that took it. */
  payoutReversalId: string;
  payoutId: string;
  /** What it took; a cancelled share's late full reversal reads its share. */
  amountCents: number;
  takenAt: string;
  /** The `trr_` reversal. */
  stripeReversalId: string | null;
  chargeId: string | null;
  title: string | null;
  organizationName: string | null;
  buyerName: string | null;
  cause: QueueCause;
  /** The slice's history, as on the charge detail. */
  history: HistoryLine[];
}

/**
 * One person on the Creator debts tab (data design §4.3; owner decisions Q2,
 * Q4, Q7): what they owe across every organisation. Stripe holds most of it
 * as their negative balance; a debt Stripe refused is a recorded debt. The
 * two never overlap: a refused take-back never moved the balance.
 */
export interface CreatorDebtPerson {
  payee: SupportPerson & { roles: PayeeRole[] };
  stripe: {
    /** Pence; can be negative. Null when Stripe was never read for them. */
    availableCents: number | null;
    pendingCents: number | null;
    /** When the shown balance was read. */
    checkedAt: string | null;
    /**
     * True: read from Stripe for this page. False: Stripe could not be read
     * just now, so the last morning snapshot is shown (or nothing).
     */
    live: boolean;
  };
  /** What Stripe holds as owed: the balance below zero, else 0. */
  stripeOwedCents: number;
  /** The first morning the balance was seen below zero; null when it is not. */
  negativeSince: string | null;
  /**
   * Back so far in this negative balance (§4.2): what the take-backs since
   * the last morning it was at or above zero took, less what is owed now.
   * Null when that morning is unknown, or Stripe was not read.
   */
  backCents: number | null;
  /** The take-backs in this negative balance, oldest first. */
  stripeHeld: StripeHeldTakeBack[];
  /** Debts Stripe refused (open `refund_reviews`). */
  recordedDebts: CreatorDebtItem[];
  /**
   * A debt over £50 Stripe collected from the platform at 180 days, still
   * the person's to pay, awaiting the P6 invoice (design §14; AMENDMENT 2):
   * their accounts' `collected_owed_cents`, summed. Null when none.
   */
  collectedCents: number | null;
  /** When Stripe first collected it (the earliest account's); null when none. */
  collectedAt: string | null;
  /** `stripeOwedCents`, every recorded debt and `collectedCents`. */
  totalOwedCents: number;
  /**
   * `recovering`: Stripe is taking it back from their earnings by itself;
   * `to_invoice`: over £50 and 90 days below zero, or collected by Stripe
   * over £50 (`collectedCents`), even with no balance below zero now (the
   * invoice itself is a follow-up, OQ1); `needs_settling`: only debts Stripe
   * refused.
   */
  state: 'recovering' | 'to_invoice' | 'needs_settling';
  /**
   * The Q4 rule on Stripe's figure, for the balance below zero now: £50 or
   * less is written off by Stripe at 180 days below zero; over £50 is
   * invoiced at 90. Null with only recorded or collected debts. `daysLeft` is
   * 0 once the day has come.
   */
  clock: {
    kind: 'invoice' | 'stripe_writes_off';
    on: string;
    daysLeft: number;
  } | null;
  /** The oldest open date: `negativeSince`, the oldest recorded debt's, or `collectedAt`. */
  oldestAt: string;
}

/** One row of "Owed to creators": an open `payee_credits` row (Q8-Q11). */
export interface OwedToCreatorItem {
  creditId: string;
  /** The step's own payout: the slice, or the re-pay payout it took from. */
  payoutId: string;
  /** Null for an organisation's slice with no owner yet. */
  payee: (SupportPerson & { role: PayeeRole }) | null;
  state: 'needs_check' | 'needs_person' | 'owed';
  /**
   * `reversal_landed`: a take-back reached Stripe; `slice_cancelled`: the
   * unpaid share was cancelled; `unverified`: Stripe could not say (a
   * `needs_check` or `needs_person` row).
   */
  effect: 'reversal_landed' | 'slice_cancelled' | 'unverified';
  /** What Stripe took, or the cancelled share; null while it needs a check or a person. */
  amountCents: number | null;
  /**
   * What Re-pay pays now: `amountCents` on an `owed` row; on a
   * `needs_person` row, the cancelled share (the slice less its done
   * reductions); null on a `needs_check` row, which Re-pay refuses.
   */
  repayCents: number | null;
  /** The step's own share: what a needs-check row would be, if taken. */
  stepAmountCents: number;
  /** The step's status when the late effect was found. */
  settledAs: 'cancelled' | 'debt' | 'done';
  /** The `trr_` take-back; null for a cancelled share, or before a check. */
  stripeReversalId: string | null;
  chargeId: string | null;
  title: string | null;
  organizationName: string | null;
  buyerName: string | null;
  cause: QueueCause;
  /** On a step that had become a debt: its review, open (null resolution) or settled. */
  debt: {
    reviewId: string;
    owedCents: number;
    resolution: string | null;
  } | null;
  action: CreditAction;
  foundAt: string;
  /** The last "Check Stripe again"; null if never. */
  checkedAt: string | null;
}

/** What support chose for an open credit. */
export type OwedToCreatorAction = 'repay' | 'count_against_debt' | 'not_owed';

/** A credit support settled (or a repeat of the same settle found). */
export interface ResolvedOwedToCreator {
  creditId: string;
  resolution: 'repaid' | 'debt_collected' | 'not_owed';
  resolvedAt: string;
  /** `repaid`: the new pending re-pay payout. */
  repayPayoutId: string | null;
  amountCents: number | null;
  /** Null for an organisation's slice with no owner yet. */
  payeeName: string | null;
}

/** What "Check Stripe again" found (§7.4). */
export interface CheckedOwedToCreator {
  creditId: string;
  /**
   * `owed`: Stripe confirms the take-back; `not_owed`: closed by the system,
   * nothing was taken or the payee kept the transfer; `still_unknown`: Stripe
   * still could not say, and nothing changed; `needs_person`: the ledger
   * cannot attribute the cancellation to this step, so Stripe was not asked
   * and nothing changed but `checkedAt`: support checks in Stripe, then
   * decides (state `needs_person`, action `decide`).
   */
  outcome: 'owed' | 'not_owed' | 'still_unknown' | 'needs_person';
  state: CreditState;
  amountCents: number | null;
  stripeReversalId: string | null;
  /** The system's note on a `not_owed` close. */
  note: string | null;
  checkedAt: string;
  /** The row's one action now; null once it is closed. */
  action: CreditAction | null;
}

export type FailedRefundResolution = 'refunded_elsewhere' | 'creators_repaid';

/** A failed refund support settled. */
export interface ResolvedFailedRefund {
  refundId: string;
  resolution: FailedRefundResolution;
  resolvedAt: string;
  /** `creators_repaid`: the pending re-pay payouts it wrote (or a repeat found). */
  repaid: Array<{
    payoutId: string;
    /** Null for an organisation's slice with no owner yet. */
    payeeName: string | null;
    amountCents: number;
  }>;
  /** A failed full purchase refund gave the buyer access back (Q5d). */
  accessRestored: boolean;
  /**
   * `creators_repaid` only: why access was NOT given back (silent F5); null
   * when it was, for `refunded_elsewhere`, and for a repeat of a settlement.
   */
  accessNotRestoredReason: AccessNotRestoredReason | null;
  /**
   * `creators_repaid` only: the slices whose take-back had stopped part-way,
   * which the system settled first (Codex-2hxff.71, Q6), in payout id order.
   * `decision` says how (review LOW-8): `took_share` means the take-back
   * did take the share (no transfer went out, or it was reversed), so it is
   * paid back with this settlement; `payee_kept` means a transfer for the
   * slice went out and was never reversed, so nothing is paid back and
   * support reconciles the slice. Empty otherwise.
   */
  systemSettled: Array<{
    payoutId: string;
    payeeName: string | null;
    decision: SystemDecision;
  }>;
}

/**
 * Why settling a failed refund `creators_repaid` left the buyer's access as
 * it was:
 *
 * - `partial`: a part refund, which never ended the access (P-1);
 * - `not_refunded`: the purchase is in another status;
 * - `dispute_holds`: a chargeback is open or was lost on it;
 * - `duplicate`: a duplicate payment, which never granted anything;
 * - `rebought`: the buyer bought the item again, and that purchase grants it;
 * - `still_refunded`: the refunds that still stand cover the payment;
 * - `no_purchase`: an invoice's charge, or one we hold no purchase for.
 */
export type AccessNotRestoredReason =
  | 'partial'
  | 'not_refunded'
  | 'dispute_holds'
  | 'duplicate'
  | 'rebought'
  | 'still_refunded'
  | 'no_purchase';

/**
 * The queue's prediction of why access would not come back
 * (`FailedRefundItem.accessRestoreBlockedReason`): a reason, or `unknown`
 * when it couldn't be worked out, because Stripe couldn't be read for a
 * charge none of our records name. `unknown` promises nothing either way:
 * the settle reads Stripe again and decides. The settle itself never answers
 * `unknown`.
 */
export type AccessRestorePrediction = AccessNotRestoredReason | 'unknown';

/** The resolutions support may choose. `dispute_won` is only ever automatic. */
export type CreatorDebtResolution =
  | 'creator_absorbed'
  | 'platform_absorbed'
  | 'manually_reversed';

export interface ResolvedCreatorDebt {
  reviewId: string;
  resolution: CreatorDebtResolution;
  resolvedAt: string;
}
