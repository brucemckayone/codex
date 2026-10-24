# Refund reversals: one record per slice per refund

**Status: AGREED by the owner, 2026-10-19 (§7 Q1–Q5 decided; Q2 amended the same day).** It is the data design behind WP3's behaviour PRs ([architecture.md](architecture.md) §6, engineering calls D1–D5, D7 and D8 on Codex-2hxff.56). It closes the money half of Codex-2hxff.8, and Codex-in0g4.

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

- the refund's share of the slice is `floor(gross × refunded-so-far / charge) − floor(gross × refunded-before / charge)`, with refunds ordered by Stripe's `created`. That is the spec's "same fraction, rounded down" applied cumulatively, so refunds that add up to the whole charge reverse each slice's gross exactly. The denominator is the **Stripe charge amount** for every source (D1); a partial refund's rounding stays with the platform;
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

## 6. What the behaviour PR deletes and replaces

- **The per-source profile is gone.** One path runs for every source. Row scoping is the only difference left: a purchase's rows by its id, which covers rows recorded before charge ids were (D8), and a subscription's by charge id.
- **The characterisation suites are replaced.** They pinned the old copies, defects included, so that the extraction (WP3b-2) could be proven to change nothing. Behaviour is now specified in `packages/payments/src/__tests__/clawback.integration.test.ts` (the engine). Two wiring suites cover each source: `refund-clawback.integration.test.ts` (@codex/purchase) and `subscription-refund-clawback.integration.test.ts` (@codex/subscription). A mutation probe of the engine suite turned the matching tests red for each of: per-refund rounding, an attempt that never advances, rejecting on a Stripe refusal, and reducing a slice a drain holds.
- **A step Stripe refused does not reject the call.** A redelivery would get the same answer, and rejecting would end the webhook before the refund email. The hourly cron (`retryFailedClawbacks`) retries it with the next attempt's key, up to 5 attempts.
- **A step that could not run YET is a `ServiceUnavailableError` (503),** which the webhook treats as transient. That covers another delivery holding the step, or a drain paying the slice.

## 7. Owner decisions (2026-10-19, all as recommended)

- **Q1: a refund still `pending` at Stripe is clawed back only once it has succeeded.**
  - The payment webhook also handles `refund.updated`, a new event on the payment endpoint, which is a Stripe dashboard change.
  - A refund that is already `succeeded` when `charge.refunded` arrives, which is most card refunds, is clawed back at once.
- **Q2 (amended the same day): a refund that fails is held for support, not re-paid automatically.**
  - First answer: re-pay automatically. Amended once Stripe's documentation was checked: a refund can fail after it succeeded, up to 30 days later. Stripe returns the money to the platform balance, but the customer must still be refunded some other way, so an automatic re-pay would pay creators a share that then has to be clawed back by hand.
  - So the clawback stands. A failed refund is clawed back like a succeeded one, including one that failed straight from `pending`. It also stays in the charge's refund order, so the shares of later refunds do not move, and a step of its clawback still to be retried is retried rather than left `failed` for ever. Amended by §8: one support has settled as `creators_repaid` leaves the order.
  - Every refund is recorded in `refunds`, one row per Stripe refund for any source, with Stripe's status (decision below). Support's queue is the failed rows not yet resolved. Support either refunds the customer elsewhere (`refunded_elsewhere`) or re-pays the creators (`creators_repaid`). That action and its screen ship with the admin refunds screen, `Codex-2hxff.28`, whose mockup and data design come first.
  - The payment endpoint takes `refund.updated` and `refund.failed`, handled alike. A `canceled` refund paid nothing out and is never clawed back.
- **Q3: access on a partial refund (P-1) ships in a separate PR, after this one.**
- **Q4 (decided the same day): one `refunds` table** for every Stripe refund, any source. It holds the refund's status, amount, reason and failure reason; when its email was sent (`notified_at`); and support's resolution of a failed one. It replaces a failed-refunds-only table, so a purchase's refunds, the email gate and support's queue are one record. A stale event never moves a row backwards: `failed` and `canceled` are final, and `succeeded` does not return to pending. This PR writes it from `refund.updated` and `refund.failed`; the P-1 PR also writes it from `charge.refunded`.
- **Q5 (decided the same day): one refund email per refund,** with that refund's amount, sent once. A redelivered event sends nothing. Ships with P-1.

## 8. Support's settlement and the preview (Codex-2hxff.28, owner decisions 2026-10-24)

- **`creators_repaid` re-pays the refund's clawback** (`repayFailedRefund`, `packages/payments/src/repay.ts`, Q5a and Q5b). It is a won dispute's re-pay, applied to a refund, and uses the same row writer.
  - Each `done` step of the refund that took money from a payee gets one pending re-pay row for its amount: a `transfer_reversal`, a `pending_reduction` or a `cancellation`, on a slice or on a re-pay row. The re-pay row has the same payee, organisation and source, and no charge id. It is linked by `repaid_by_payout_id`, which is unique, so a second run writes nothing.
  - It runs inside the support route's transaction, which locks the `refunds` row and records the resolution.
- **Three rules (owner decisions 2026-10-24, all as recommended):**
  1. **A step that can never move money is cancelled.** That is one never claimed (`pending` with no `attempted_at`, so it never reached Stripe), and one Stripe refused on every try (`failed` at `MAX_CLAWBACK_ATTEMPTS`; only a definitive refusal advances `attempt`) that no delivery holds. A step still retrying, or leased by a delivery, may yet reach Stripe, so the settlement is refused with `REFUND_CLAWBACK_UNFINISHED`, and the caller's transaction rolls back. The message tells support the clawback is still running and to try again later.
  2. **A debt the payee already paid gets a re-pay row:** `creator_absorbed` or `manually_reversed`. One the platform wrote off (`platform_absorbed`) gets nothing. The refund's open debts close as `refund_failed`, a new `refund_reviews` resolution, with who settled them and `resolution_note`. Their steps stay `debt`, because the review is the record, and nothing is re-paid for them: the payee paid nothing.
  3. **The platform fee's share is cancelled.** The `retained_fee` step is cancelled, and a fee slice it had marked `reversed` is `paid` again. There is no re-pay row, since the money is back in the platform's balance.
- **The running total skips it** (Q5c). `reverseCharge` drops every refund whose `refunds` row is resolved `creators_repaid`, however its caller listed the refunds (`withoutRepaidRefunds`). Left in, it would still count as refunded: a later refund's share would floor to zero and take nothing from the re-paid payees. Dropped, a later refund on a slice it reversed takes its share off the new re-pay row (the re-paid path, `clawBackRepaidShare`). Its own steps are never run again, which is why an unfinished one must be settled first.
- **The preview is the engine's own arithmetic** (`planClawback`, `clawback.ts`, design §3). It walks the same causes in the same order: the refunds less those support re-paid, the new refund last among them, then the chargebacks open or lost. It uses the same share (`refundShare`), the same re-paid split (`splitRepaid`, which `splitRepaidShare` also calls) and the same step (`newStepKind`, which `ensureRecord` also calls). It returns one line per step the engine would record, and a rounding line. `loadClawbackPlanInput` reads its inputs through `sourceScope`, so it sees the same slices. Its spec, `plan-clawback.integration.test.ts`, checks each fixture against what `reverseCharge` then records.
- **Known limit:** a re-pay row for a refund's step that was on a re-pay row is a re-pay of a re-pay. The re-paid path reads only a slice's first-level re-pay rows (`repayRowsOf`), so a later cause cannot take its share off that row. It goes to a person (`slice_repaid`) instead, so nothing is clawed back twice.
