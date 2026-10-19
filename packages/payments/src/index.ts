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
  type ClawbackRefund,
  type ClawbackSource,
  listSucceededRefunds,
  MAX_CLAWBACK_ATTEMPTS,
  pendingReductionsFor,
  refundShare,
  retryFailedClawbacks,
  reverseCharge,
} from './clawback';
// The charge an invoice payment settled on: the key every invoice payout
// uses (Codex-2hxff.50)
export { resolveInvoiceCharge } from './invoice-charge';
// The payouts ledger's write path: one row per slice per charge, reserved
// before any transfer (Codex-2hxff.11, .12, .37)
export {
  cancelUnpaidPayoutForRefund,
  claimPayoutAttempt,
  claimPayoutAttempts,
  findTransfersForPayouts,
  isDrainablePayout,
  type LedgerDeps,
  markPayoutFailed,
  type RefundCancelOutcome,
  recordPlatformFee,
  recordSlice,
  renewPayoutAttempt,
  settlePayoutPaid,
  settleTransfer,
} from './payout-ledger';
// Who is paid the organisation's part of a sale (Codex-2hxff.2)
export {
  type OrganisationPayee,
  resolveOrganisationPayee,
} from './resolve-organisation-payee';
