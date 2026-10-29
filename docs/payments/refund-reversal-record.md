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
| `status` | `'pending'` \| `'done'` \| `'failed'` \| `'debt'` \| `'cancelled'` | `failed` = retry; `debt` = balance too low; `cancelled` = settled without taking anything (§8) |
| `stripe_reversal_id` | varchar, unique, nullable | `trr_…` once reversed. On a step settled another way (not `done`), the reversal that landed after it was settled (§4, step 7) |
| `attempt` | int, default 0 | part of the Stripe idempotency key (§4) |
| `attempted_at` | timestamptz, nullable | the lease a claim takes, and the claim's version (§4, step 7) |
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
   - **A retried cancellation whose cancel committed before it failed** (its late transfer's reversal timed out, or its done failed) finds the slice already cancelled. When `tookTheSlice` (step 7, §8) says it is this step's, the retry asks Stripe for a transfer made for the slice anyway (`lateTransferOf`) and reverses it, as the first attempt was doing (`finishCancelledSlice`; Codex-2hxff.71, batch B data design §6.4). Before, it was marked done without asking, and a drain's transfer stayed with the payee.
7. **A delivery that outlives its lease never changes a step another path has settled** (Codex-2hxff.72; owner decision 2026-10-27, "Never overwrite; hold for support").
   - **The claim's version.** The claim writes its lease to `attempted_at`, and that lease is the claim's version. Every write the delivery then makes to its step is a compare-and-set on it: done, failed, debt (with its review, in one transaction), a change of kind, a reduction, and a move to the re-pay rows. Every other writer clears or replaces the lease: a settlement (support's re-pay, a won dispute's re-pay), a release, or another delivery's claim once the lease ran out. The delivery's own change of kind keeps it, which `updated_at` would not.
   - **The cancel of an unpaid slice first renews the lease,** a compare-and-set on the claim, and cancels the slice only once that has committed. Every settlement's write to a step needs it unleased, so from the renewal on, none can cancel the step before its done. One that comes first makes the renewal miss, and nothing is cancelled. One waiting on the step's row when the renewal commits finds it moved since its read, and refuses too. The only gap is a delivery that outlives the renewed lease as well, and `claimLost` alerts that. The Stripe lookup for a transfer that went out anyway runs after the cancel.
     - The two are separate statements, not a transaction. A transaction adds nothing a settlement could see. It also hid the cancel from the `.51` wiring suite's fault injection, which wraps the top-level client: a failed cancel is a step failure like any other write's, so the call rejects with it once every other slice has run (Codex-2hxff.51, §4 step 5).
   - **When a write finds the claim gone, the step is left as it is.** A step another delivery has claimed since is finished by that delivery, with the same key.
   - **A reversal that LANDED on a step already settled.** For example, the step was cancelled, so the payee keeps the money. ONE error alert, with an `errorId`, names the payee, the amount, and the refund or dispute, and holds it for support, who re-pay the payee from the admin Refunds screen. Nothing is re-paid automatically.
     - **When Stripe's answer was lost,** Stripe is asked first (`transfers.listReversals`, by `payout_reversal_id`). One Stripe cannot be asked about is an error alert too. One Stripe lists no reversal for is a warning that the outcome is unconfirmed.
     - **The same alert covers an unpaid slice the delivery cancelled under a settled step.** That applies when no transfer had gone out for the slice, or when the one that had was reversed in full.
     - **It is raised once per run.** If the step cannot even be read, a single "check by hand" alert names the reversal instead. A failure to record the reversal (below) is logged under the alert's own `errorId`.
   - **A cancelled slice whose transfer was NOT reversed: do not re-pay.** The delivery cancelled an unpaid slice, found that a transfer had gone out for it anyway, and Stripe refused to reverse it (the balance was too low, or the refusal was definitive). So the payee still holds that transfer. A different error alert, carrying `stripeTransferId`, says not to re-pay, and to reconcile the slice instead. Re-paying would pay the payee twice.
     - **When it is unconfirmed, the alert never says so outright.** There are two such cases: the reversal's answer was lost and Stripe lists none, or Stripe could not be asked whether a transfer went out at all (`lateTransferOf` is `unknown`, never read as "none"). The alert is marked `unconfirmed` and says to check Stripe first. For a known transfer: "If a reversal of this transfer exists, the payee is owed it back; if not, reconcile the slice and do not re-pay". For an unknown one: "If none went out, or one went out and was reversed, the payee is owed the slice back; if one went out and was not reversed, reconcile the slice and do not re-pay". So a reversal that lands late never leaves the payee short on our instruction.
   - **The record that it landed.** The reversal's id is written to the step's `stripe_reversal_id`, only when that is null and the step is not `done`. Nothing else on the row changes: status, amount and the re-pay link stay as the other path left them. Two cases are named by the alert alone:
     - a step that already names a reversal, which is never written over;
     - a `done` step, whose reversal would then read as its own. At most one attempt lands, so this only happens when another path marked the step done without a reversal.
     An unpaid slice the delivery cancelled has no reversal to record. The cancelled-slice query below finds it.
   - **Every late case is queued for support: a `payee_credits` row** (Codex-2hxff.73, owner decisions Q8-Q11 and OQ3; batch B data design §7). Each alert above also writes one row for its step (`recordPayeeCredit`, `clawback.ts`), after the alert, in its own `try`. A failed insert never throws: it is logged under the alert's own `errorId` ("could not be queued for support; it is in this alert only"), since a redelivery never reaches `claimLost` again for a settled step. The row carries that `errorId` in `alert_error_id`.

     | Where `claimLost` finds it | `effect` | Amount owed |
     |---|---|---|
     | A reversal landed (Stripe's answer, or found by `listReversals`) | `reversal_landed` | what Stripe took: the reversal's own amount, never the step's |
     | The unpaid slice it cancelled, with no transfer or one reversed in full | `slice_cancelled` | what the drain would have paid: the slice less its done reductions |
     | Stripe refused to reverse a cancelled slice's transfer | `transfer_kept`, born resolved `not_owed` by the system | none: the payee kept it |
     | Unconfirmed: the reversal's answer was lost and Stripe lists none (the warning, OQ3), Stripe could not be asked, a transfer's existence is unknown, or the step could not be read | `unverified` | none until "Check Stripe again" says |

     A later, confirmed finding upgrades an open `unverified` row (`ON CONFLICT … WHERE effect = 'unverified' AND resolved_at IS NULL`). One that meets a row the system closed as not owed (a born `transfer_kept`, or a check's not owed; `resolved_by_user_id` null) reopens it as owed for what Stripe took, compare-and-set on that closed state; one that meets a row a person settled leaves their decision, with an error under the alert's errorId naming the credit to reopen by hand (owner decision 2026-10-28 on review MED-1, "Reopen if the system closed it"). A write that changes nothing is logged, never silent (`reportPayeeCreditWrite`). Not recorded: a step another delivery holds now (it finishes it), and a `done` step this delivery took nothing from.

   - **Support acts in Admin → Queue → "Owed to creators"** (`payee-credits.ts`; admin-api `/api/admin/support/queue/owed-to-creators` and `/owed-to-creators/:creditId/{resolve,check}`), and on the charge page, whose line reads "Taken after it was settled. £X owed back to {name}" instead of "Not taken". One action per row:
     - **Re-pay** writes one pending re-pay payout for the amount owed, linked on the step (`repaid_by_payout_id`), so the engine treats it as the slice's re-pay: a later cause takes its share off it, and the drain holds it while the sale is disputed. The next drain pays it. A `done` step, or one another path already re-paid, is refused (`CREDIT_SETTLE_BY_HAND`) with an alert.
     - **Count it against this debt**, only when the step had become a debt, that debt is still open, and Stripe took exactly its amount (Q11, OQ4): the review closes `creator_absorbed`, the credit `debt_collected`, and nothing is re-paid. Of another amount, Re-pay pays what Stripe took and the debt stays open.
     - **Not owed**, with a required note.
     - **Check Stripe again**, on an `unverified` row: a reversal naming the step is owed; a cancelled slice with no transfer, or one reversed in full, is owed the share (a slice the drain marked `reversed` is read from the transfer it records, Codex-2hxff.88); a transfer never reversed, or a transfer step with nothing taken, is closed not owed by the system; Stripe still failing changes nothing but `checked_at`.
     - **Check in Stripe, then decide** (owner decision 2026-10-28, review MED-3): a row whose cancellation's slice IS cancelled by that cause type, or `reversed`, but which a sibling step makes unclear (`cancellationAttribution` is `ambiguous`) is `needs_person`. A cancellation whose slice is in any other state (pending, paid, cancelled by the other cause) never took it, so its row is checked as a transfer step's would be. A needs-person row whose sibling is `done` or already re-paid is settled by hand, never re-paid (`CREDIT_SETTLE_BY_HAND`), so a share is never paid twice (re-review round 2 MED-1). A check never confirms it, so it says `needs_person` with an error alert and asks Stripe nothing. Support looks in Stripe, then Re-pays (the cancelled share, one pending re-pay row) or marks it Not owed, both with a note saying what Stripe showed (`CREDIT_NOTE_REQUIRED`). Every other `unverified` row is still refused Re-pay until a check confirms it (`CREDIT_NEEDS_CHECK`).
     - **A debt the payee paid after a credit's Re-pay on its step** (owner decision 2026-10-28, review MED-4, "Still re-pay the £10"): the credit's re-pay is of what Stripe took late, not the debt's, so a won dispute or a failed refund's settlement still re-pays the debt. Its row takes the step's link (`repayDebtStep`, decided on the link as read FOR UPDATE), and the credit's row stays a re-pay row through `payee_credits.repay_payout_id`: the clawback never reads it as a slice (`sourceScope`), and the drain holds it while its charge is disputed (`isDrainablePayout`). In the other order, the credit's Re-pay goes ahead unlinked, carried by `repay_payout_id` alone.

     The SQL queries this section used to give are no longer needed: the queue lists every open row.

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

## 8. Support's settlement and the preview (Codex-2hxff.28, owner decisions 2026-10-24 and 2026-10-25)

- **`creators_repaid` re-pays the refund's clawback** (`repayFailedRefund`, `packages/payments/src/repay.ts`, Q5a and Q5b). It is a won dispute's re-pay, applied to a refund, and uses the same row writer.
  - Each `done` step of the refund that took money from a payee gets one pending re-pay row for its amount: a `transfer_reversal`, a `pending_reduction` or a `cancellation`, on a slice or on a re-pay row. The re-pay row has the same payee, organisation and source, and no charge id. It is linked by `repaid_by_payout_id`, which is unique, so a second run writes nothing.
  - **The settlement runs in three steps.**
    1. `failedRefundRepayBlock`, on the engine's own causes (`loadClawbackCauses`).
    2. `settleUnfinishedRefundSteps`, which asks Stripe, so it runs before the transaction. It writes only what is true whatever the settlement decides: a reversal Stripe made, recorded `done`.
    3. `repayFailedRefund`, inside the support route's transaction, which locks the `refunds` row and records the resolution. It is given the charge's amount and the pre-step's `unlanded` steps. The refusal codes are `REFUND_REPAY_CODES` (repay.ts only, not exported: consumers match the strings).
- **Four rules (owner decisions 2026-10-24 and 2026-10-25, all as recommended):**
  1. **A later cause shared against the failed refund refuses the re-pay** (`REPAY_BLOCKED_BY_LATER_CAUSE`, 422, built by `repayBlockedError`).
     - **The two cases.** A chargeback open or lost on the charge: every chargeback is shared after the refunds. Or a refund after it in the engine's order whose running total exceeds the charge: its share was capped.
     - **Why.** The skip below is not retroactive, so such a cause took less because the failed refund counted, and re-paying would overpay. A later refund that exactly fills the charge was not capped, and refunds before the failed one were not shared against it, so neither blocks. Support settles a blocked one by hand, or marks it `refunded_elsewhere`.
     - **Re-checked inside the transaction.** `repayFailedRefund` runs the whole rule again, from the recorded `refunds` (`recordedClawableRefunds`, no Stripe call) and `disputes`. A refund or chargeback can be recorded between the caller's check and the lock, and every refund is recorded before its clawback runs.
     - **Known limit.** What remains is a refund or chargeback recorded after that read, whose clawback runs before the settlement commits. That clawback reads the failed refund's resolution without a lock, so for the length of the transaction (under a second) it still counts the failed refund. It means two people acting on one charge within the same second: the race the refund route already accepts (two refunds of one charge in the same second both pass its refund-count check).
  2. **A step that can never move money is cancelled, by the settlement.**
     - **Never claimed.** A step that is `pending` with no `attempted_at` never reached Stripe. It is cancelled inside the transaction.
     - **No retry will run it.** That is a `pending` step whose lease ran out, its delivery dead, or a `failed` step at `MAX_CLAWBACK_ATTEMPTS`, which only a definitive refusal advances. Its last try may still have landed, so `settleUnfinishedRefundSteps` asks Stripe first (`transfers.listReversals`), as a won dispute's re-pay does. A reversal Stripe made is recorded `done` there, and is then re-paid. The record is a compare-and-set on the version that was read, as the cancel below is, so a step a delivery claimed since the read is left to that delivery, and the settlement refuses it as still running (Codex-2hxff.72).
     - **Without a reversal (money LOW-B).** The step is NOT cancelled by the pre-step. It is listed (`unlanded`) with its version, its `updated_at` in microseconds, and `repayFailedRefund` cancels it inside the transaction. So a refused settlement leaves it as it was: if support then marks the refund refunded elsewhere, a redelivery can still finish its clawback. The cancel is a compare-and-set on that version, so a step a redelivery claimed and tried again since the check is left, and refuses. `attempt` and `attempted_at` cannot show that: a claim followed by an unconfirmed failure puts both back as they were. A won dispute's cancel (`cancelUnfinished`) uses the same compare-and-set.
     - **An unfinished cancellation on a slice already `cancelled_by_refund` is decided by the system** (Codex-2hxff.71, owner decision Q6, "The system decides"; was money LOW-C). Only a cancellation step's cancel writes `cancelled_by_<cause type>`, a cancelled slice gets no new step, and the cancel writes the step's renewed lease as the slice's `resolved_at`. So the step took the slice when that lease is still on it, or no other cancellation of the same cause type is on the slice (`tookTheSlice`, `clawback.ts`). Stripe then says whether money went out (`decideStrandedCancellation`, `repay.ts`):
       - no transfer went out, or one did and is back (a reversal naming the step, or the transfer reversed in full): the step is recorded `done` by the pre-step, marked `system_took_share` in `last_error_code`, the slice `reversed` when a transfer went out, and the settlement re-pays it;
       - a transfer went out and was never reversed: the payee kept it. It is listed `unlanded` marked `payeeKept`, and the settlement cancels it, marked `system_payee_kept`, with a born-resolved `transfer_kept` credit and an alert to reconcile the slice. Nothing is re-paid;
       - Stripe cannot be asked: left, so the settlement refuses it as still running (`REFUND_CLAWBACK_UNFINISHED`);
       - the rule cannot decide (two cancellations of a refund on one slice, neither lease matching): it is logged for a person and refused with `REFUND_CLAWBACK_NEEDS_PERSON`, because retrying will not help.

       A slice the drain marked `reversed` after the cancel (it sent the transfer anyway, reversed it in full and recorded it) is decided by the same rule (owner decision 2026-10-28 on Codex-2hxff.88, "Re-pay them, same rule"; `sliceTakenBy`). That state no longer says which cause cancelled it, so the step took it only when it is the slice's only cancellation or transfer reversal, of any cause. Stripe is asked about the transfer the slice records: reversed in full, `done` and re-paid; not reversed in full, the ledger and Stripe disagree, so it is logged for a person; Stripe cannot be asked, left. Before, such a step was cancelled and never re-paid.
       The settle's answer names the slices the system settled (`systemSettled`), and the charge page's history says what it decided (`systemDecision`).
     - **Still running.** Any other step still `pending` or `failed` refuses the settlement with `REFUND_CLAWBACK_UNFINISHED`, and the caller's transaction rolls back. That is a step a retry is due for, one a delivery holds, or one that moved since the check. Support is told the clawback is still running and to try again later.
  3. **A debt the payee already paid gets a re-pay row:** `creator_absorbed` or `manually_reversed`. One the platform wrote off (`platform_absorbed`) gets nothing. The refund's open debts close as `refund_failed`, a new `refund_reviews` resolution, with who settled them and `resolution_note`. Their steps stay `debt`, because the review is the record, and nothing is re-paid for them: the payee paid nothing. A debt with no review (a slice with no payee) is cancelled, as a won dispute's re-pay does, so it never reads "owed".
  4. **The platform fee's share is cancelled.** The `retained_fee` step is cancelled, and a fee slice it had marked `reversed` is `paid` again. There is no re-pay row, since the money is back in the platform's balance.
- **The running total skips it** (Q5c).
  - `reverseCharge` drops every refund whose `refunds` row is resolved `creators_repaid`, however its caller listed the refunds (`withoutRepaidRefunds`). Left in, it would still count as refunded: a later refund's share would floor to zero and take nothing from the re-paid payees.
  - Dropped, a refund or chargeback clawed back AFTER the settlement takes its share as if it had never been made. On a slice it reversed, that share comes off the new re-pay row (the re-paid path, `clawBackRepaidShare`).
  - The skip is not retroactive. A cause recorded before the settlement keeps the share it got, which is why rule 1 refuses the re-pay then.
  - The refund's own steps are never run again, which is why an unfinished one must be settled first.
  - A step cannot start after the settlement either. A refund step is claimed only under a `FOR SHARE` read of its `refunds` row, and the claim refuses once that row is `creators_repaid` (`claimRefundStep`). The settlement holds the row `FOR UPDATE`, so a claim either waits and then refuses, or comes first and leaves the step leased, which the settlement then refuses.
  - A delivery still running when the settlement cancels its step (its lease ran out first) cannot change the step afterwards, and a reversal of it that lands is held for support (§4, step 7).
- **The preview is the engine's own arithmetic** (`planClawback`, `clawback.ts`, design §3). It walks the same causes in the same order: the refunds less those support re-paid, the new refund last among them, then the chargebacks open or lost. It uses the same share (`refundShare`), the same re-paid split (`splitRepaid`, which `splitRepaidShare` also calls) and the same step (`newStepKind`, which `ensureRecord` also calls). It returns one line per step the engine would record, and a rounding line. `loadClawbackPlanInput` reads its inputs through `sourceScope`, so it sees the same slices. Its spec, `plan-clawback.integration.test.ts`, checks each fixture against what `reverseCharge` then records.
- **Known limit:** a re-pay row for a refund's step that was on a re-pay row is a re-pay of a re-pay. The re-paid path reads only a slice's first-level re-pay rows (`repayRowsOf`), so a later cause cannot take its share off that row. It goes to a person (`slice_repaid`) instead, so nothing is clawed back twice.
