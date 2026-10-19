# Refund reversals: one record per slice per refund

**Status: AGREED by the owner, 2026-10-19 (§7 Q1–Q3 decided).** It is the data design behind WP3's behaviour PRs ([architecture.md](architecture.md) §6, engineering calls D1–D5, D7 and D8 on Codex-2hxff.56). It closes the money half of Codex-2hxff.8, and Codex-in0g4.

The *behaviour* is already decided in [purchases.md](purchases.md#refunds) and [subscriptions.md](subscriptions.md#refunds). This document only decides **how it is recorded**, plus the three questions at the end.

---

## 1. The problem

The clawback engine (`@codex/payments` `reverseCharge`) has no record of which refund it has already handled. It infers that from `payouts.status`, and that one fact cannot represent most of what the spec asks for. The characterisation tests pin each consequence:

| Defect (pinned by) | Why `payouts.status` cannot get it right |
|---|---|
| A second partial refund claws back nothing (test 3, both sources) | The first partial marks the row `reversed`, and the second is skipped |
| A failed purchase reversal is never retried (purchase test 2) | The purchase is marked `refunded` first, so a redelivery stops before the row |
| A non-funds reversal failure is marked `reversed` (test 5, both) | There is nowhere to record "failed, retry me" |
| A subscription debt is only in the logs (subscription test 6) | `refund_reviews.purchase_id` is NOT NULL |
| A partial refund overwrites the slice's state | Rows are meant to be permanent; the reversed amount has nowhere to go |
| `refundAmountCents = 0` is a full reversal (test 8) | No refund id means no way to tell "nothing" from "everything" |

## 2. The rule (from the spec, unchanged)

For each refund of a charge, and each payout slice of that charge:

- the refund's share of the slice is `floor(slice.amountCents × refund.amount / charge.amount)`. The denominator is the **Stripe charge amount** for every source (D1); the rounding stays with the platform;
- a **paid** slice: that share is reversed with `transfers.createReversal`;
- a **pending or failed** slice: a full refund cancels it (`cancelled_by_refund`, as today); a partial refund **reduces** it by that share before it is paid;
- the **platform fee**: no transfer, so the share is recorded and absorbed;
- the payee's balance is too low: a **debt** is recorded (`refund_reviews`), to be recovered from future earnings (Codex-2hxff.30);
- **any other failure is retried**, and nothing is marked done until it succeeds.

## 3. The record: `payout_reversals`

One row per (payout slice, cause). A cause is a refund now, and a dispute later (Codex-2hxff.9, rule A3: a refund and a dispute differ only in cause and amount).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `payout_id` | uuid FK → `payouts`, restrict | the slice |
| `cause_type` | `'refund'` \| `'dispute'` | CHECK |
| `cause_id` | varchar | `re_…` or `dp_…` |
| `amount_cents` | int > 0 | this cause's share of the slice |
| `kind` | `'transfer_reversal'` \| `'pending_reduction'` \| `'retained_fee'` \| `'cancellation'` | what was done |
| `status` | `'pending'` \| `'done'` \| `'failed'` \| `'debt'` | `failed` = retry; `debt` = balance too low |
| `stripe_reversal_id` | varchar, unique, nullable | `trr_…` once reversed |
| `attempt` | int, default 0 | part of the Stripe idempotency key (§4) |
| `last_error_code` | varchar, nullable | the last Stripe error code |
| `created_at`, `updated_at`, `resolved_at` | timestamptz | |

**`UNIQUE (payout_id, cause_type, cause_id)`** is the new "already processed" check (D2). A redelivery finds the row; a second refund on the same charge gets its own row.

What stays the same:

- `payouts` rows are never rewritten. `amount_cents` stays the slice's gross (D4).
- `payouts.status` keeps its meaning for the drain and for reporting. A row becomes `reversed` only once its reversals add up to its whole amount, and `cancelled_by_refund` as today.
- **The drain pays `amount_cents − Σ pending_reduction`** for a pending row. That is one change to the drain's amount, and it is covered by a test.

### Debts: `refund_reviews` for every source (D5, replaces Codex-in0g4's plan)

- Add `payout_reversal_id` uuid FK → `payout_reversals`, **unique**, nullable for existing rows.
- `purchase_id` becomes nullable: the source is read from the payout row, so the table needs no `subscription_id` column (Codex-in0g4's plan).
- The open-per-payout unique index is replaced by the per-reversal one. Two refunds that each hit insufficient funds are two debts, not one.

## 4. How a delivery runs

1. **Read the charge's refunds from Stripe** (`refunds.list({ charge })`, every page). Today's code uses the event's cumulative `amount_refunded`, and that is the cause of the second-partial defect.
2. For each refund that should be clawed back (Q1), and each slice row of the charge (by `stripe_charge_id`, falling back to the source ref where it is null, D8), **insert** the `payout_reversals` row on conflict do nothing, then act on any row not yet `done` or `debt`.
3. **The Stripe idempotency key is `${transferId}_reversal_${refundId}_${attempt}`.**
   - The attempt number advances **only on a definitive Stripe error**: Stripe replays a stored error for that key for 24h, verified 2026-10-19.
   - It **stays the same on an indeterminate one** (network error, a 5xx with no response), where retrying the same key is what prevents a double reversal.
4. `insufficient_funds` / `balance_insufficient` (D7) → `debt` + one `refund_reviews` row. Any other error → `failed`.
5. After every row: **if any row is `failed`, the call rejects** with the failure as `cause` (the .51 mechanism), for **every** source. The purchase's "already refunded" gate is gone, because the record is the gate, so a redelivery reaches the failed row.
6. **Beyond Stripe's redeliveries** (up to 3 days in live mode, a few hours in a sandbox), the hourly payouts cron retries `failed` rows. It already runs. Each retry claims its row first, so a cron run and a redelivery cannot both reverse it, using the same lease pattern as `claimPayoutAttempts`.

## 5. Migration

- New table and the `refund_reviews` changes, via `pnpm db:generate`.
- No backfill:
  - Existing `reversed` rows have no record, and none is needed. A refund already handled will not be redelivered, and step 2 only creates records for refunds a delivery sees.
  - **The one gap:** a refund older than this change, on a charge that is refunded again later. Its share would be reversed a second time. To close it, step 2 skips any slice already `reversed` with no record (that is today's semantics), with a test.
- Existing `refund_reviews` rows stay readable: `payout_reversal_id` is null on them.

## 6. What the behaviour PR deletes and flips

- **Deleted from `profileFor`:** `denominator` (D1), `where` (D8), `retriesIncompleteCancels` (D2), `reversalFailedHasErrorId` and `messages` (one log vocabulary), `reversalMetadata` (source fields read from the row), `onInsufficientFunds` (one debt path). The profile is gone.
- **Characterisation tests flipped:** 2, 3, 5, 6, 8 (the key and zero-amount cases), and 11 (selection) in both files, each renamed from "(defect)" to the spec behaviour.

## 7. Owner decisions (2026-10-19, all as recommended)

- **Q1: a refund still `pending` at Stripe is clawed back only once it has succeeded.**
  - The payment webhook also handles `refund.updated`, a new event on the payment endpoint, which is a Stripe dashboard change.
  - A refund that is already `succeeded` when `charge.refunded` arrives, which is most card refunds, is clawed back at once.
- **Q2: a refund that fails after its clawback is re-paid automatically.** A new pending payout row for the clawed-back amount, which the drain pays like any other. The reversal record is marked so it is never re-reversed.
- **Q3: access on a partial refund (P-1) ships in a separate PR, after this one.**
