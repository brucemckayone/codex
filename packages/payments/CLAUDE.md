# @codex/payments

The payment domain modules every payment path calls. It sits **below** `@codex/purchase` and `@codex/subscription`, so a rule both need has one implementation, here (decision D1, 2026-10-19).

**Design:** [docs/payments/architecture.md](../../docs/payments/architecture.md) §4 says which modules belong here and in what order they move. **Behaviour:** [docs/payments/connect-and-payouts.md](../../docs/payments/connect-and-payouts.md#the-payouts-ledger).

## Key Exports

- **The payouts ledger** (`payout-ledger.ts`, Codex-2hxff.11/.12/.37): `recordSlice`, `recordPlatformFee`, `settleTransfer`, `claimPayoutAttempt(s)`, `renewPayoutAttempt`, `settlePayoutPaid`, `markPayoutFailed`, `findTransfersForPayouts`, `isDrainablePayout`, `cancelUnpaidPayoutForRefund`, `type LedgerDeps`. One row per slice per charge, reserved **before** any transfer. The unique indexes `uq_payouts_*_per_charge` make a replay a no-op.
- **`resolveOrganisationPayee`** (`resolve-organisation-payee.ts`, Codex-2hxff.2): who is paid the organisation's part of a sale, at the sale's own time.

## Rules

- **Money moves only through the ledger** (architecture rule A1). Do not call `stripe.transfers.create` or `createReversal` outside this package.
- **Pure functions over a `DatabaseClient` + Stripe client.** No service classes, no registry. Callers pass their `db` and `stripe`.
- **A module moves here as an extraction:** no behaviour change, its tests move with it, and the old export is removed rather than re-exported.
- Depends only on Foundation packages (`constants`, `database`, `service-errors`). It must never import `@codex/purchase` or `@codex/subscription`, which would create a cycle.

## Tests

Integration tests against the real schema, because the guarantees are unique indexes and CHECKs a mocked db would not enforce. They run sequentially (`vitest.config.payments.ts`) because payout rows are shared across files.
