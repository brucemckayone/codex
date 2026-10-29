/**
 * @codex/payments: the payment domain modules every payment path calls
 * (docs/payments/architecture.md §4.3; package decision D1, 2026-10-19).
 *
 * It sits below @codex/purchase and @codex/subscription, so a rule both need
 * has one implementation, here. Domain modules move in one at a time, each as
 * an extraction that changes no behaviour.
 */

// The daily bank payout: manual payouts held for the 14-day refund window,
// and a balance below zero tracked for Q4's rule (Codex-2hxff.29, .30)
export * from './bank-payouts';
// Claw back each refund's share of a charge's payout slices, for every
// source, recorded per slice per refund (Codex-2hxff.56, .8)
export {
  type ClawbackCharge,
  type ClawbackDeps,
  type ClawbackDispute,
  type ClawbackPlan,
  type ClawbackPlanInput,
  type ClawbackPlanLine,
  type ClawbackPlanMethod,
  type ClawbackRefund,
  type ClawbackSource,
  failedRefundRepayBlock,
  listChargeRefunds,
  listClawableRefunds,
  loadClawbackCauses,
  loadClawbackPlanInput,
  MAX_CLAWBACK_ATTEMPTS,
  pendingReductionsFor,
  planClawback,
  type RepayBlockReason,
  refundShare,
  retryFailedClawbacks,
  reverseCharge,
  reverseEarlierRefunds,
  reverseEarlierRefundsAfterCommit,
} from './clawback';
// GBP in, GBP out: the guard every path runs before it records a split
// (Codex-2hxff.23 PAY-25)
export { assertGbpOnly, isGbpOrUnset } from './currency';
// The charge an invoice payment settled on: the key every invoice payout
// uses (Codex-2hxff.50)
export { resolveInvoiceCharge } from './invoice-charge';
// Money owed TO a payee after a late take-back: support's Re-pay, Count it
// against this debt, Not owed, and Check Stripe again (Codex-2hxff.73)
export {
  type PayeeCreditAction,
  type PayeeCreditCheck,
  payeeCreditsNeedingAPerson,
  type RecheckedPayeeCredit,
  type ResolvedPayeeCredit,
  type ResolvePayeeCreditInput,
  recheckPayeeCredit,
  resolvePayeeCredit,
} from './payee-credits';
// The payouts ledger's write path: one row per slice per charge, reserved
// before any transfer (Codex-2hxff.11, .12, .37)
export {
  cancelUnpaidPayout,
  claimPayoutAttempt,
  claimPayoutAttempts,
  classifyTransferFailure,
  findTransfersForPayouts,
  isDrainablePayout,
  type LedgerDeps,
  MAX_PAYOUT_FAILURES,
  markPayoutFailed,
  type PayeeAccounts,
  type PayoutFailureRecord,
  type PlatformFailureTally,
  payeeAccountIds,
  platformFailureTally,
  type RecordSliceInput,
  type RecordSliceOutcome,
  recordPlatformFee,
  recordSlice,
  recordSplitOnce,
  recordTransferFailure,
  renewPayoutAttempt,
  reportPlatformFailures,
  settlePayoutPaid,
  settleTransfer,
  type TransferFailure,
  type TransferFailureKind,
  type UnpaidCancelOutcome,
} from './payout-ledger';
// Refund a payment the platform decides to give back, in part or in full; the
// charge.refunded webhook then does the rest (architecture C5, Codex-2hxff.14).
// Support refunds only inside the 14-day window (Codex-2hxff.28)
export {
  type IssueRefundInput,
  type IssueRefundResult,
  issueRefund,
  type RefundWindow,
  refundWindow,
} from './refund';
// A won dispute's clawback, or a failed refund's that support settles as
// creators_repaid, paid back by new pending payout rows the sweep pays
// (Codex-2hxff.9, .28)
export {
  type DisputeRepayResult,
  type FailedRefundRepay,
  type FailedRefundRepayResult,
  PAYEE_PAID_RESOLUTIONS,
  type PayeeKeptStep,
  repayBlockedError,
  repayDispute,
  repayFailedRefund,
  reportPayeeKept,
  type StrandedStep,
  settleUnfinishedRefundSteps,
  type UnfinishedRefundSteps,
} from './repay';
// Who is paid the organisation's part of a sale (Codex-2hxff.2)
export {
  type OrganisationPayee,
  resolveOrganisationPayee,
} from './resolve-organisation-payee';
// Money waiting for a payee to finish Connect setup: the Studio banner and
// the monthly reminder share one query (Codex-2hxff.34)
export * from './waiting-money';
