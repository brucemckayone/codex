# @codex/payments

The payment domain modules every payment path calls. It sits **below** `@codex/purchase` and `@codex/subscription`, so a rule both need has one implementation, here (decision D1, 2026-10-19).

**Design:** [docs/payments/architecture.md](../../docs/payments/architecture.md) §4 says which modules belong here and in what order they move. **Behaviour:** [docs/payments/connect-and-payouts.md](../../docs/payments/connect-and-payouts.md#the-payouts-ledger).

## Key Exports

- **`reverseCharge`** (`clawback.ts`, Codex-2hxff.56, .8): claw back each **settled** refund's share (succeeded, or failed: the clawback stands and support settles it), and each chargeback's (read from `disputes`, Codex-2hxff.9), of a charge's payout slices, for a `purchase` or `subscription` source. What each refund did to each slice is one `payout_reversals` row, unique per (payout, cause), and that row, not `payouts.status`, is the "already processed" check. Read the design first: [refund-reversal-record.md](../../docs/payments/refund-reversal-record.md). An open chargeback holds an unpaid slice instead of reducing it; a lost one cancels it (`cancelled_by_dispute`). A slice a won dispute paid back gets a `slice_repaid` debt for any later cause. Also exported: `listChargeRefunds`, `listClawableRefunds`, `refundShare`, `pendingReductionsFor` (the drain pays gross minus these, read AFTER claiming), `retryFailedClawbacks` (the hourly cron) and `MAX_CLAWBACK_ATTEMPTS`.
- **`repayDispute`** (`repay.ts`, Codex-2hxff.9): a won dispute's clawback paid back. Each `done` transfer reversal gets ONE new pending `payouts` row for its amount (no charge id, so the transfer comes from the platform balance and no per-charge unique index applies), linked by `payout_reversals.repaid_by_payout_id`, and the drain pays it. Unrun steps are `cancelled`, debts closed as `dispute_won`, a reversed fee slice paid again. Design: [dispute-record.md](../../docs/payments/dispute-record.md). `isDrainablePayout` holds every row of a sale with an open dispute or inquiry.
- **The payouts ledger** (`payout-ledger.ts`, Codex-2hxff.11/.12/.37): `recordSlice`, `recordPlatformFee`, `settleTransfer`, `claimPayoutAttempt(s)`, `renewPayoutAttempt`, `settlePayoutPaid`, `markPayoutFailed`, `findTransfersForPayouts`, `isDrainablePayout`, `cancelUnpaidPayout`, `type LedgerDeps`. One row per slice per charge, reserved **before** any transfer. The unique indexes `uq_payouts_*_per_charge` make a replay a no-op.
- **`resolveOrganisationPayee`** (`resolve-organisation-payee.ts`, Codex-2hxff.2): who is paid the organisation's part of a sale, at the sale's own time.
- **`resolveInvoiceCharge`** (`invoice-charge.ts`, Codex-2hxff.50): the charge a paid invoice settled on, through inline → `expand: ['payments']` → `paymentIntents.retrieve().latest_charge` → `charges.list`. Every invoice payout is keyed on it. A card-paid invoice names only its PaymentIntent, so never read `payment.charge` alone.

## Rules

- **Money moves only through the ledger** (architecture rule A1). Do not call `stripe.transfers.create` or `createReversal` outside this package.
- **Pure functions over a `DatabaseClient` + Stripe client.** No service classes, no registry. Callers pass their `db` and `stripe`.
- **A module moves here as an extraction:** no behaviour change, its tests move with it, and the old export is removed rather than re-exported.
- Depends only on Foundation packages (`constants`, `database`, `service-errors`). It must never import `@codex/purchase` or `@codex/subscription`, which would create a cycle.

## Tests

Integration tests against the real schema, because the guarantees are unique indexes and CHECKs a mocked db would not enforce. They run sequentially (`vitest.config.payments.ts`) because payout rows are shared across files. `invoice-charge.test.ts` is the exception: the resolver only reads Stripe, so it runs on `createMockStripe()` with no database.
