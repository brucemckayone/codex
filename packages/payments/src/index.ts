/**
 * @codex/payments: the payment domain modules every payment path calls
 * (docs/payments/architecture.md §4.3; package decision D1, 2026-10-19).
 *
 * It sits below @codex/purchase and @codex/subscription, so a rule both need
 * has one implementation, here. Domain modules move in one at a time, each as
 * an extraction that changes no behaviour.
 */

// Claw back each refund's share of a charge's payout slices, for every
// source, recorded per slice per refund (Codex-2hxff.56, .8)
export {
  type ClawbackCharge,
  type ClawbackDeps,
  type ClawbackDispute,
  type ClawbackRefund,
  type ClawbackSource,
  listChargeRefunds,
  listClawableRefunds,
  MAX_CLAWBACK_ATTEMPTS,
  pendingReductionsFor,
  refundShare,
  retryFailedClawbacks,
  reverseCharge,
  reverseEarlierRefunds,
} from './clawback';
// The charge an invoice payment settled on: the key every invoice payout
// uses (Codex-2hxff.50)
export { resolveInvoiceCharge } from './invoice-charge';
// The payouts ledger's write path: one row per slice per charge, reserved
// before any transfer (Codex-2hxff.11, .12, .37)
export {
  cancelUnpaidPayout,
  claimPayoutAttempt,
  claimPayoutAttempts,
  findTransfersForPayouts,
  isDrainablePayout,
  type LedgerDeps,
  markPayoutFailed,
  type RecordSliceInput,
  type RecordSliceOutcome,
  recordPlatformFee,
  recordSlice,
  recordSplitOnce,
  renewPayoutAttempt,
  settlePayoutPaid,
  settleTransfer,
  type UnpaidCancelOutcome,
} from './payout-ledger';
// Refund a payment the platform decides to give back; the charge.refunded
// webhook then does the rest (architecture C5, Codex-2hxff.14)
export {
  type IssueRefundInput,
  type IssueRefundResult,
  issueRefund,
} from './refund';
// A won dispute's clawback paid back by new pending payout rows the sweep
// pays (Codex-2hxff.9)
export { type DisputeRepayResult, repayDispute } from './repay';
// Who is paid the organisation's part of a sale (Codex-2hxff.2)
export {
  type OrganisationPayee,
  resolveOrganisationPayee,
} from './resolve-organisation-payee';
