# Disputes: the record, the hold and the re-pay

**Status: AGREED by the owner, 2026-10-19 (§8 Q1–Q3 decided, all as recommended).** It is the data design behind Codex-2hxff.9. The *behaviour* is already decided: [purchases.md](purchases.md#disputes) and [subscriptions.md](subscriptions.md#disputes) (owner decision P-2, "Creators share it"). It builds on the refund record ([refund-reversal-record.md](refund-reversal-record.md)), which reserved `cause_type = 'dispute'` for this.

---

## 1. The problem

Today only `charge.dispute.created` is handled, and only for a purchase. It marks the purchase disputed and revokes access, and that is all:

| Spec | Today |
|---|---|
| Paid creator and organisation slices are reversed in proportion | Nothing is reversed: the platform pays the whole chargeback |
| Pending slices are held, not drained | They drain and pay out |
| Won: access restored, reversed slices paid again, held ones released | `closed` is ignored, so the buyer is locked out for good |
| Lost: the reversals stand, held slices cancelled, a subscription cancelled | Ignored |
| A disputed subscription invoice follows the same rules | Ignored: no purchase row, so nothing happens |

## 2. What Stripe does (verified in Stripe's documentation, 2026-10-19)

- **An inquiry takes no money.** Some networks, mostly American Express, start with an *inquiry*: status `warning_needs_response`, `warning_under_review` or `warning_closed`. It debits nothing. It can escalate into a chargeback, or close after 120 days.
- **A chargeback** (`needs_response`, then `under_review`) debits the disputed amount and a fee from the platform balance at once. Under separate charges and transfers, the platform recovers it by reversing its transfers.
- **Won:** the disputed amount comes back to the platform. A transfer reversal cannot be undone, so the creators are paid again with a **new transfer**.
- **Lost:** the money stays with the buyer. A dispute on a partly refunded charge can end `lost` and still return the part already refunded.
- **A disputed charge cannot be refunded** until the bank decides for the platform.
- **An appeal** (API `2026-10-28.endive`; changelog `evidence-submission-appeal-dispute-decisions`): a lost chargeback can be appealed. Its status becomes `appeal_needs_response`, then `appeal_under_review`, until the bank decides again, `won` or `lost`.

## 3. The records

### `disputes`: one row per Stripe dispute, any source

It is shaped like `refunds`.

| Column | Notes |
|---|---|
| `stripe_dispute_id` | unique; `dp_…` |
| `stripe_charge_id`, `purchase_id` (nullable) | as `refunds`; null for a subscription invoice |
| `amount_cents`, `currency`, `reason` | the disputed amount |
| `status` | Stripe's, forward only (`warning_*`, `needs_response`, `under_review`, `won`, `lost`, `prevented`), with one way back: a late win, `lost` → `won`, written once (§10). It also says whether money moved: a chargeback status means Stripe took it, an inquiry's means it did not |
| `outcome_applied_at` | when won or lost handling finished. A redelivery finds it and stops |
| `late_won_at` | when the row moved `lost` → `won`: a late win (§10). Null for every other dispute |
| `lost_applied_at` | the loss's `outcome_applied_at`, kept when the late win clears that column; null when the loss never finished. Support's "lost on …" |
| `late_win_refund_id` | the `re_…` refund the late win made of a first payment, for a buyer who had bought the item again (§10) |
| `buyer_told_at` | the buyer's "access is back" email was claimed, before it was sent, so it goes once |
| `appeal_status` | (0130) a lost chargeback's appeal while it runs: `appeal_needs_response`, then `appeal_under_review`, as Stripe has it now (back too, when Stripe asks for more evidence). Set only on a `lost` row, in code; the bank's decision (a late win, or a live `lost`) clears it, and the hourly reconcile's first step clears one left stale on a row that isn't lost (§4, "An appeal"; owner D34). Null for every other dispute |
| `refunded_outside_stripe_at` | (0127) when the buyer was refunded outside Stripe. From then on, support's refund route refuses the charge (`REFUNDED_OUTSIDE_STRIPE`; owner decision 2026-11-08, "Block it in code"). Three writers: the runbook step that settles the charge by hand ([operations](operations.md#settling-a-late-win-refund-stripe-wont-make)); support settling the late win's own failed refund as refunded elsewhere while the charge's succeeded Stripe refunds don't cover it (a pending one doesn't count) ([purchases](purchases.md#refunds)); and a manual UPDATE, with the owner's OK, for a buyer refunded another way that the settle never saw ([R19 (b)](release-checklist.md#r19--before-any-workers-rollback-late-wins-still-being-undone)). No date is overwritten: the runbook step runs only on a charge with no refund recorded, so it never meets a set date, and the other two guard with `IS NULL` |

Checks (0126), none of which can be NULL: `late_won_at` is set only on a `won` row, and `late_win_refund_id` and `lost_applied_at` only on a late win. Check (0130): `appeal_status` is NULL or one of `DISPUTE_APPEAL_STATUSES` (`check_disputes_appeal_status`). That a mark lives only on a `lost` row is held in code, not by a CHECK: a CHECK stays on a workers rollback and binds the older worker too, whose late win (0126–0129) moves `lost` → `won` without clearing the mark, so a CHECK would refuse it (23514, classed permanent: acknowledged, the late win never recorded). In code, the late win is the one move off `lost`, and it clears the mark in the same SET. An older worker's late win, or release step R18 (a)'s hand UPDATE, can leave a stale mark on a `won` row: support shows the appeal line only on a lost row, and the hourly reconcile's first step clears it on its next run, whatever its age (`clearStaleDisputeAppealMarks`). So does the next record of the dispute, unless that is a `lost` or an appeal, which a won row refuses (`refusedLost`) before the mark is looked at, or a status the table doesn't know.

### The reversal: `payout_reversals` with `cause_type = 'dispute'`

The clawback engine is used unchanged, with the dispute as one more cause on the charge.

- **A dispute's share of a slice** is `floor(gross × (refunded + disputed) / charge) − floor(gross × refunded / charge)`. The charge's settled refunds come first, so a dispute on a partly refunded charge takes only what the refunds left.
- **Paid slices** are reversed (`transfer_reversal`), with the key `${transferId}_reversal_${disputeId}_${attempt}`. Debts go to `refund_reviews` as for refunds. Retries, the lease and the hourly cron all apply.
- **The platform fee** is `retained_fee`.
- **Pending slices are not reduced while the dispute is open.** They are **held** (below). A **lost** dispute reduces them by its share, as a refund would. A slice that the refunds and the dispute take whole becomes `cancelled_by_dispute`. What a partial loss leaves of a slice is released to the drain. An unpaid slice whose recorded steps and a new share take all of it is cancelled, not reduced to nothing (Codex-2hxff.59).

### The hold

The drain skips a pending or failed slice whose charge has a dispute that is either of these:

- **open:** any status but `won`, `lost`, `warning_closed` and `prevented`;
- **`lost` with no `outcome_applied_at` yet:** a loss keeps holding until its whole handling has run (the held slices cut, the purchase refunded or the subscription cancelled), so a drain run between the two cannot pay out money the bank took back. If any step fails, nothing marks it: the webhook's redelivery or the hourly reconcile re-runs the whole lost path, which is safe to repeat, and marks it only once that succeeds (Codex-2hxff.58). The clawback retry no longer marks a loss on its own steps alone: the chargeback's opening steps would have passed that test.

The match is on the charge id, or on the purchase id, which also catches a purchase's re-pay rows (they have no charge id). A re-pay row is also held through the charge of the slice it re-pays, so a second dispute holds a subscription's re-pay row too until its loss is applied (Codex-2hxff.59). There is no new column on `payouts`.

The hold applies when a slice is first recorded as well: a payable slice whose sale a dispute or inquiry holds is reserved `pending` and not sent, and the drains pay it after a win or a close (Codex-2hxff.59). Before, an inquiry's slice was paid at once and a chargeback's was sent and then reversed.

### The re-pay: a new pending payout row per reversed slice

This is the mechanism a won dispute needs. It is also what support's "re-pay the creators" action will reuse for a failed refund (Codex-2hxff.28).

- For each `done` dispute reversal with a payee, one new `payouts` row is written:
  - `status = 'pending'`, the same payee, type, source and transfer group;
  - `amount_cents` is the reversal's amount;
  - **`stripe_charge_id` is NULL**, so the transfer comes from the platform balance (no `source_transaction`), and none of the one-slice-per-charge unique indexes apply.
- `payout_reversals.repaid_by_payout_id` (new, unique, nullable) links the reversal to its re-pay row. That makes the re-pay idempotent: a redelivery finds the link.
- The drain pays it like any other row, with the floor, Connect readiness and retries.
- **The won path settles every step the dispute wrote:**

  | Step | On a win |
  |---|---|
  | `done` reversal | Re-paid |
  | `pending` or `failed` reversal | First checked with Stripe: its outcome may never have been recorded (a timeout, or a crash after Stripe answered). A reversal whose metadata names the step is recorded `done` and re-paid; otherwise the step is `cancelled`. A step another delivery still holds under its lease makes the webhook retry. A delivery whose lease ran out before the cancel cannot change the step afterwards; a reversal of it that lands is held for support ([refund-reversal-record.md](refund-reversal-record.md) §4 step 7) |
  | `pending` or `failed` cancellation on a slice the dispute already cancelled | **Decided by the system, by the same rule as a failed refund's** (Codex-2hxff.71, owner decision Q6; [refund-reversal-record.md](refund-reversal-record.md) §8 rule 2). `cancelled_by_dispute` has one writer, a dispute's own cancellation step, so the step took the slice when its lease is still on the slice's `resolved_at`, or no other dispute's cancellation is on it (`tookTheSlice`). Then Stripe says: no transfer went out, or one did and is back, so it is `done` (`system_took_share`) and re-paid; a transfer went out and was never reversed, so it is `cancelled` (`system_payee_kept`) with a born-resolved `transfer_kept` credit and an alert to reconcile the slice; Stripe can't be asked, so the webhook retries. When the rule cannot decide (two such cancellations, neither lease matching: two concurrent final causes plus a crash), the step is cancelled as before, but never silently: an error alert, and an `unverified` credit that Owed to creators shows as `needs_person`: support checks in Stripe, then re-pays or marks it not owed, with a note (owner decisions 2026-10-28). A slice the drain marked `reversed` since the cancel is decided by the same rule, from the transfer it records (Codex-2hxff.88; [refund-reversal-record.md](refund-reversal-record.md) §8 rule 2). A debt the payee paid is re-paid even when a payee credit's re-pay is already linked on its step (review MED-4) |
  | `debt` the payee settled (`manually_reversed`, `creator_absorbed`) | Re-paid: the payee paid it |
  | Any other `debt` | `cancelled`, with its review closed as `dispute_won`, in one transaction |
  | Platform fee's `retained_fee` | `cancelled`; a fee slice it marked `reversed` goes back to `paid` |

- **A step re-checks its dispute when it is claimed.** If the dispute was won after the run began, the claim fails. A step never claimed before is cancelled and never sent. One claimed before (a `failed` attempt) may have landed, so it is left for the re-pay, which asks Stripe.
- **The clawback never treats a re-pay row as a slice of the charge.** It is excluded from the engine's row scope. A later refund, or a second dispute once lost, takes its share of a re-paid slice off the slice's re-pay row while that row is unpaid: a `pending_reduction` step on the re-pay row, or a `cancellation` when the share takes the rest of it. A second dispute still open only holds the row. What an unpaid re-pay row cannot carry (one already paid, or a larger share) is a `slice_repaid` debt on the slice for a person (Codex-2hxff.59).
- **A refund that settled while a full chargeback held the whole slice** wrote no step: nothing was left of the slice. On a win, the re-pay runs the charge's clawback again, so that refund takes its share off the new re-pay row, and the payee nets what the refund alone would have left (Codex-2hxff.59).

## 4. How each event runs

The dispute endpoint already takes `charge.dispute.created`, `.updated` and `.closed`. It also needs `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated`, an owner Stripe change. Every event first records the dispute row, forward only, then:

| Event or status | Access | Money |
|---|---|---|
| Inquiry (`warning_*`) | Kept (Q1) | Nothing reversed; the sale's pending slices held until it closes or escalates (Q1) |
| Chargeback opened (`needs_response`, or funds withdrawn) | Paused: `disputedAt`, and the streaming block with reason `'purchase_dispute'` or `'subscription_dispute'`. A disputed purchase stays in the library, labelled paused (`purchase.disputedAt`) only while the dispute is why the item is refused: one predicate, `resolveDisputePause`, decides the label and the content page's notice. An item that a subscription, a support grant, a staff role or an owned course still opens is not labelled, nor is one refused for another reason (say it became course-only). A subscription's items leave the library. A refused stream says why from the database too, after the block expires, course lessons included (a disputed course purchase or course subscription; owner decision 2026-10-24), and the course shelf marks the course paused (`disputeHold`) exactly while its lessons say so (Codex-2hxff.60) | Paid slices reversed by the dispute's share; pending slices held |
| Won (`won`, funds reinstated) | Restored: `disputedAt` cleared, content access and the entitlement restored | One re-pay row per reversed slice; held slices released; any dispute debt in `refund_reviews` closed |
| Lost (`lost`) | Ends for good: the purchase becomes `refunded` (Q3) and leaves the library, and the streaming block is written with reason `'refund'`, for a dispute that opened already lost and was never paused. A subscription is cancelled | Reversals stand; held slices are cut by the dispute's share, and become `cancelled_by_dispute` when nothing is left (Q3) |
| Lost after a partial refund | As lost | As lost; Stripe reinstates the refunded part, and the refunds already clawed it back |

**An appeal** of a lost chargeback (Codex-wzaoh; owner D34, 2026-11-12) is a mark on the lost row, never a status. Appeals exist only on an account that has turned on Appeal responses, which only an eligible business can (Settings → Payments → Disputes; [Stripe: dispute appeals](https://docs.stripe.com/disputes/arbitration.md)). A dispute closed while its appeal needs a response is `lost`. Stripe's `appeal_*` statuses are reachable only from `lost`, and the platform has lost the money either way, so an appeal is recorded, and acted on, as `lost`, with the appeal marked (`appeal_status`): the sale is held and the loss applied exactly as any loss (§3, the hold), and a late win undoes it as today (§10). The record makes the translation itself: the webhook passes Stripe's raw status, and `recordDispute` reads an appeal as `lost` (`disputeAppealOf`). One predicate, `settlesAsLost` (`@codex/constants`), says "lost, or an appeal of it" for the record, the hourly reconcile (`stageOf`: an appeal is closed, as `lost` is) and the won-reported-lost alert.

Stripe does not deliver events in order, so an appeal is recorded at the dispute's live status, read from Stripe (`liveDispute`, `payment-webhook.ts`), never the event's. The record holds the rule itself too: an appeal not read live marks nothing and comes back `appealCheck`, as a stale `lost` does. A transient read failure is a 503, and Stripe redelivers. A permanent one (a 404, say) is left to the classifier: acknowledged, and the hourly reconcile re-reads the dispute.

- **An appeal:** the row is recorded `lost` (created, or moved forward from an open chargeback whose `lost` was missed), and the mark follows Stripe's appeal (`markDisputeAppeal`), back as well as forward: Stripe can ask for more evidence, moving `appeal_under_review` back to `appeal_needs_response`. The same stage again writes nothing. A loss never applied is then applied, and the hourly reconcile retries it as any unapplied loss, so it never sits through an appeal unapplied. A won row, or a closed inquiry, is never marked: a won one comes back `refusedLost`, alerted if Stripe has it lost or under appeal now; a closed inquiry is logged at warn.
- **A `lost` for a marked row** may be the bank's decision or an event older than the appeal. The record changes nothing and comes back `appealCheck`; the webhook reads the live dispute, one extra read in that case only, and records that: still an appeal keeps or moves the mark; `lost` clears it; `won` is a late win, whose one statement clears it.
- **An appeal on a row that isn't lost** (an open chargeback whose `lost` was missed, or no row at all) is recorded `lost` and applied, as above, so it never sits at its open stage through the appeal. Only a won row refuses it, and a closed inquiry is left as it is.
- **A mark on a row that isn't lost** is stale: an older worker's late win (after a rollback) or R18 (a)'s hand UPDATE left it. Support never shows it. The hourly reconcile's first step clears every such mark on an applied row in the database, with no Stripe read, whatever the dispute's age, on every run, the 08:00 one included (`clearStaleDisputeAppealMarks`; it moves no money). A row still being settled (an older worker's late win whose undo hasn't finished) is left to the reconcile's retry of unsettled rows, whose live record clears the mark, so the first step never delays that retry. If that record is refused (Stripe has the dispute lost now) or never runs, the mark waits until the row is applied, and the first step clears it then. The next record of the dispute clears it too, unless that record is a `lost` or an appeal, which a won row refuses (`refusedLost`) before the mark is looked at, or a status the table doesn't know.
- **The reconcile repairs a mark Stripe disagrees with** on an applied lost row (`needsSettling`), from Stripe's events of the last 4 days: a mark whose event was missed is set, and a decision that was missed clears one. A stale mark on a won row is the first step's (above), but is compared the same way (`appealMarkOn`), in case that step failed this run. A race can also set a mark again just after a decision cleared it (an appeal's live read just before the decision, written just after); the decision's own events then show it, and the next hourly run clears it. A row whose mark agrees with Stripe is not read. Each dispute the reconcile settles is read from Stripe once: it tells `processDispute` the dispute is live (`receivedLive`), so there is no second read and no `appealCheck`. The 08:00 London run leaves applied rows alone, marks included; the next hour's run repairs them. On a lost row, a disagreement older than the 4-day window, with no later event, stays until the dispute's next event; a row that isn't lost has no such limit.
- **The events are as Stripe stored them** (owner D35). A listed event keeps the rendering it was created with, at the account's default API version then, never our request pin. Stripe doesn't document which versions show the appeal statuses, so below endive an appeal may read as `lost`. That costs little: an appeal a snapshot does show is used; a `lost` on a marked row disagrees with the mark, so the row is re-read live and the bank's decision recorded or the mark kept; only an appeal on an unmarked lost row can hide, until an event shows it. Each run logs how many of its snapshots rendered below the pin (`snapshotsBelowPin` on "dispute reconcile completed"). Release step R23 moves the account default to endive; four days later the count is 0.

Support's chargeback row carries `appealStatus`, on a lost row only, and the card shows "Appeal: needs a response in Stripe" or "Appeal under review" under the Lost badge while the appeal runs, then "Won late" or "Lost" as before. While a response is due, the row also has Stripe's deadline for it (`evidence_details.due_by`, as an open chargeback's), shown as "Respond by …" after the appeal line; none when Stripe gives none. At the appeal stage, Stripe moves `due_by` to the appeal response deadline ([Stripe: dispute appeals](https://docs.stripe.com/disputes/arbitration.md)), so it is the appeal's own deadline.

**A late win** (Stripe turns `lost` into `won`) is recorded and the loss undone (Codex-2hxff.70, §10). It replaces "alert only" (owner decision 2026-10-25), under which the row stayed `lost` and a person undid the loss by hand.

**Missed events are settled by the hourly reconcile** (Codex-2hxff.58). Before the payouts drain, the cron reads Stripe's `charge.dispute.*` events from the last 4 days, leaving the last 15 minutes to the webhook. It runs the webhook's own handling (`processDispute`) for any dispute that has no row, or whose unapplied row is final or would move to a later stage (inquiry, then chargeback, then closed). It then re-reads from Stripe every final row of ours whose outcome was never applied, whatever its age, skipping rows touched in the last 15 minutes (the webhook may still be handling them). Each dispute is read live from Stripe before it is acted on. An open chargeback is re-run while its events are in the window, since nothing records that opening it finished; every step is idempotent and the re-run writes no second streaming block. A failure opening a chargeback is alerted at error with an errorId and returned to Stripe for redelivery; after the 4-day window it waits for the dispute's close. A step that keeps failing is retried every hour and alerted at error with an errorId each time (owner decision 2026-10-23, "Retry hourly, alert"; no new state).

## 5. Subscriptions

- A disputed invoice has no purchase row. The `disputes` row is keyed by its charge, and the subscription is found from the invoice's payout rows (`subscription_id`).
- **Paused** means the subscription's access is paused for the dispute's life, and its billing too (owner decision Q-A, [subscription-disputes.md](subscription-disputes.md)).
- **Lost** cancels the subscription at Stripe (subscriptions.md).
- The money (reversal, hold, re-pay, cancel) is the same for both sources. Pausing, restoring and cancelling the subscription is designed in [subscription-disputes.md](subscription-disputes.md).

## 6. Migration

- A new table `disputes`.
- `payout_reversals.repaid_by_payout_id` (FK `payouts`, restrict, unique where not null), and a `cancelled` status: a step whose dispute was won before it ran.
- `refund_reviews.resolution` gains `dispute_won`: a debt the dispute caused, closed when it is won.
- `payouts.status` gains `cancelled_by_dispute` (Q3).
- No backfill: no dispute has ever moved money in this codebase.

## 7. Out of scope

- The **early fraud warning** auto-refund (owner decision 2026-10-13). It is a full refund issued through `issueRefund` (WP6), and the refund path above handles the rest.
- The dispute **evidence** workflow; disputes are answered in the Stripe Dashboard.

## 8. Owner decisions (2026-10-19, all as recommended)

- **Q1: an inquiry holds payouts and keeps access.** While an inquiry is open, the sale's pending slices wait and nothing is reversed. The buyer keeps access. If it escalates it is a chargeback (paused, reversed); if it closes (`warning_closed`), the slices are released.
- **Q2: a won dispute is re-paid by the next sweep.** One pending payout row per reversed slice, paid by the drain like any other, so the floor, Connect readiness and retries all apply. Support's "re-pay the creators" action for a failed refund reuses it (Codex-2hxff.28).
- **Q3: a lost dispute makes the purchase `refunded`, and held slices `cancelled_by_dispute`.** Sales reports count the money as gone, access stays ended, and a chargeback can be told apart from a refund. A dispute lost for part of the charge cuts the held slices by its share instead (§3).

## 9. Known limits (from review, 2026-10-19)

These are accepted for now; each is rare.

- **A debt the payee paid is re-paid in full.** Under Q2 (Codex-2hxff.30) a take-back Stripe cannot cover no longer becomes a debt at all: Stripe takes the balance below zero and recovers it itself, so only a refused take-back is a `refund_reviews` debt, and that one the payee settles whole.
- **A win clears the user's streaming block for the organisation.** That can lift a block a subscription event set in the same 20-minute window.
- **For up to 20 minutes the stream refuses a disputed item that something else still covers** (Codex-2hxff.60). The block is written for the buyer's whole organisation (the dispute notice's Q2, owner decision 2026-10-24), and for every disputed content purchase: `accessEnded` only asks whether another completed purchase keeps the item. So a disputed item that a subscription, a support grant or a staff role covers says "Access paused" while the library shows it playable. When the block expires, it plays.
- **The library's undim is cached** (Codex-2hxff.60). The label is decided when the library is fetched, and the client keeps the row until the next library version bump. A covering grant that lapses by its expiry bumps nothing, so the card stays undimmed while the stream refuses.
- **A share larger than a re-paid slice's unpaid re-pay rows** is left to a person (`slice_repaid`), for the part they cannot carry, rather than reversed from the slice's own transfer.
- **`prevented` is a closed inquiry.** Stripe defines it as a dispute "prevented from becoming a formal chargeback" (Dispute Preventions, 2025-08-27), so nothing is restored or re-paid, and the held slices are released. A `prevented` dispute that has a dispute reversal step anyway is alerted at error with an errorId (Codex-2hxff.59).
- **A late win finds its purchase by the dispute's `purchase_id`.** A dispute first recorded before its purchase existed has none, and nothing fills it in later, so its late win restores no purchase (§10). A dispute comes days after the sale, so this needs the dispute to beat the purchase's own events.

## 10. A late win (Codex-2hxff.70)

Stripe can turn a lost dispute into a won one, weeks or months later: the issuer reverses itself, or the cardholder withdraws the dispute. The money comes back to the platform. The late win undoes the loss as a win, then marks it applied. Owner decisions Q1–Q6 (2026-10-31) are all as the late-win design recommends; Q7 (support may refund a late-won payment past the 14-day window) is support's.

### States

| State | `status` | `outcome_applied_at` | `late_won_at` | Holds the drain? |
|---|---|---|---|---|
| Lost, being applied | `lost` | null | null | Yes |
| Lost, applied | `lost` | set | null | No |
| Won late, being undone | `won` | null | set | Its re-pay rows only (`isDrainablePayout`) |
| Won late, undone | `won` | set | set | No |

### The record

- **lost → won** is one statement, after the forward-only upsert refuses it (`recordDispute`, `recordLateWin`): `status = 'won'`, `late_won_at = $now`, `lost_applied_at = outcome_applied_at`, `outcome_applied_at = NULL`, `updated_at = $now`, `WHERE status = 'lost'`. Every SET reads the row as it was, and `$now` is a bound instant. A second delivery matches no row and reads the row as it stands. Writing `updated_at` gives the webhook the reconcile's 15-minute grace; after it the hourly retry of unapplied final rows takes the undo, so a failed step is retried every hour.
- **won → lost** is refused: Stripe documents no such move. The row comes back with `refusedLost: true`, and the caller alerts only if the live dispute says lost (an older `lost` event arriving after the late win's `won` is the harmless case).
- Every other move out of a final status is still refused silently.

### The undo, in order

Each step keys on the row being a late win being undone (won, `late_won_at` set, `outcome_applied_at` null), and each Stripe call that can fail comes before the outcome is marked, so a failure is retried with nothing marked.

1. **The buyer** (`restoreAfterLateWin`). One transaction: the dispute under a share lock, then the purchase under its row lock. The won dispute no longer holds, so its disputed mark is cleared, and support's failed-refund rule decides (`accessKeptReason`), so the two cannot disagree. The refund fields always come from the refunds that still stand (`standingRefundFields`), never the disputed amount the loss added.

   | The purchase | Outcome | Written |
   |---|---|---|
   | Refunded by the loss, nothing else in the way | `restored` | `completed`, `refunded_at` cleared, the refund fields restated (a refund made before the dispute still counts), the content access row and the entitlement (by `source_ref`) restored |
   | Still completed: the loss never finished | `restored` | Its access back, as a normal win |
   | The buyer bought it again since | `rebought` | Stays refunded, refund fields restated, its entitlement still revoked; the shared content access row is the new purchase's and is left alone |
   | A duplicate payment | `duplicate` | Its disputed mark cleared. One the loss refunded is refunded by step 4; one the loss never got to is still pending, and the hourly duplicate sweep refunds it |
   | Refunds that still stand cover what was paid | `still_refunded` | Stays refunded, refund fields restated |
   | Another chargeback on it is open or lost | `dispute_holds` | Nothing: that dispute decides |

2. **A subscription invoice**: the normal win's restore, unchanged ([subscription-disputes.md](subscription-disputes.md#a-late-win)).
3. **The money** (`repayWonDispute`): the normal win's re-pay, without the mark. Every done step the loss left is paid back by a new pending row: a reversal, a cancellation (the slice stays `cancelled_by_dispute`, the one writer `tookTheSlice` relies on) and a reduction. The re-pay rows stay held until the outcome is applied.
4. **A buyer who bought it again, or a duplicate payment** (`refundFirstPaymentAfterLateWin`; owner decision Q1). After the re-pay, whatever is left of the first charge is refunded: reason `duplicate`, key `late_win_refund_${disputeId}`, metadata `codex_late_win_dispute`. Its id is written once (`late_win_refund_id IS NULL`), so a re-run reads it and never makes another. The undo then records the charge's refunds, restates the purchase's refund fields, and claws the refund back as the win's own (`settlingDisputeId`). Each share comes off its slice's held, unpaid re-pay row, so the creators net nothing for the first payment and keep the second sale. A refund Stripe reports pending is waited for: nothing is marked, and only the next hourly run finishes it. A `refund.updated` for it can't: its clawback waits while the win is unapplied (below), so it is answered 500 and redelivered until the run has marked the outcome. A refusal, or any other failure to make the refund, is a `LateWinRefundRefusedError` (a retry). Its alert carries Stripe's code, error type and HTTP status, ids only, and says "refused" only when Stripe refused the request itself (an invalid request); an outage, a rate limit or a key without refund rights reads "could not be refunded". Stripe replays a refusal for 24 hours under the same key, so a cause that clears is only tried again a day later. One Stripe will never make is settled by a person ([operations](operations.md#settling-a-late-win-refund-stripe-wont-make)), and the charge is then never refunded through Stripe (`refunded_outside_stripe_at`). A refund that has already failed when the undo reads it counts as settled, as a failed refund does: its clawback stands (the clawback counts failed refunds, `listClawableRefunds`), so the creators give the first payment back off their held re-pay rows. It is alerted at error, since the buyer was not refunded, and it is in the Failed refunds queue. A refund that fails after that is a failed refund like any other. A refund Stripe cancels counts as settled too, but the buyer got nothing, and the Failed refunds queue reads `failed` only: it is alerted at error, with ids only, for support to settle by hand (owner decision 2026-11-05). It takes nothing from the creators: the clawback counts only succeeded and failed refunds (`listClawableRefunds`), so the held re-pay rows are untouched.
   - **A duplicate payment** the loss refunded is refunded the same way (owner decision 2026-11-05, "Refund it"), on the disputed charge. That holds whether or not the purchase it repeats still stands: one refunded since leaves the buyer holding nothing for either payment (owner decision 2026-11-08, "Refund it"). A duplicate pays no one, so nothing is clawed back. Its refund email is the duplicate one (`lateWinKeptThrough` is null, `duplicatePayment` true): it refunds the second payment, not a first.
   - **Only a payment the loss refunded is refunded** (`refundedByTheLoss`): it is `refunded`, the refunds standing on the charge do not cover what was paid, and, for a buyer who bought it again, they hold the item through another completed purchase. It doesn't ask whether the loss's mark ran (`lost_applied_at`): a loss whose steps ran but whose mark didn't leaves that empty, and the buyer would pay twice. A duplicate the loss never got to is still `pending`, and the hourly duplicate sweep refunds it. If the sweep refunded it before the late win reads it, the late win's refund meets `charge_already_refunded`, which `issueRefund` takes as done: one refund either way. A payment refunded in full before the chargeback was lost (the loss found it refunded and wrote nothing) is not refunded again. The sweep never reaches one the late win refunded: it takes `pending` duplicates only, and nothing moves a refunded purchase back. Either refund asks for what is left of the charge, so Stripe never refunds more than was paid.
5. **The outcome is marked** (`markDisputeOutcomeApplied(id, { status: 'won' })`), only while the row is still won ([the mark](#the-loss-racing-the-late-win)).
6. **The buyer's email** (`claimLateWinBuyerEmail`): `restored` only, claimed once on `buyer_told_at`, after the mark. Its button opens the item's own page, built by the purchase receipt's builders (`purchaseItemUrl`, Codex-0u7kb): org content on its organisation's site (`/content/{slug}`), a creator's own content on the creators host (`/@{username}/content/{slug}`), or a course's journey dashboard. The buyer's library (`/library`) is the fallback when the item has no page, or its page can't be looked up. The link is read before the outcome is marked.

Re-pay first, then the refund: the engine shares refunds before chargebacks (`inClawbackOrder`), so a refund clawed back while the loss's steps still stood, with nothing re-paid, would take each share a second time from a slice a partial loss had only cut. In that order, what an unpaid re-pay row cannot carry is the documented `slice_repaid` limit (§9), never a second take from the slice.

### A refund made while the undo runs

`reverseCharge` waits, with a `ServiceUnavailableError`, before clawing back a refund while a chargeback on the charge is won and not yet applied, so Stripe redelivers and the hourly retry tries again. The win's own settlement names its dispute and is let through: the re-pay's clawback of a refund recorded first (`clawBackRefundsUnderDispute`), and the late win's own refund. A normal win has the same short window, and the same wait covers it.

### The loss racing the late win

Lock order, always: the dispute (the transition's write; a share lock in every guard), then the purchase, then content access and entitlements, then each step, then payouts.

- **The purchase.** `processLostDispute` reads the dispute under a share lock before it writes the purchase, and does nothing unless it is still lost. A late win landing during a re-run of an unfinished loss then waits for the loss to commit, and its restore runs after.
- **The subscription.** `cancelLostDisputeSubscription` ends access under a share lock on the dispute, and reads it again just before the Stripe cancel, which cannot be undone. Once the dispute is no longer lost it writes and cancels nothing.
- **The loss's unfinished steps** cannot run after the win: a won dispute no longer takes money (`disputeStillClawed`), so a step not yet claimed is cancelled, and a claimed one is settled by the re-pay.
- **The mark.** An outcome is marked only while the row still has the status its step settled (`markDisputeOutcomeApplied(id, { status })`): the loss passes `lost`, a win or a late win `won`, an inquiry its own. A loss run that finds the dispute won by the time it marks leaves the late win unmarked, and logs at warn with its ids, so the undo still restores, re-pays and refunds.

### An applied late win

A row settled by hand under release step R18 (`status = 'won'`, `late_won_at` and `outcome_applied_at` set, `buyer_told_at` null) is an applied late win. R18 writes it in two steps, and the outcome is applied at each: (a) before the deploy, `status = 'won'`, keeping the loss's applied time, or, for a loss that never finished, setting one a second before the write; (b) after the deploy, `late_won_at` and `lost_applied_at`, only on a row still applied. Between the two it is a normal applied win, which nothing acts on either. Nothing re-pays, restores, refunds or emails it again: every step needs `outcome_applied_at` null, and the email claim needs the outcome to have been applied by the undo itself, after `late_won_at`. A hand settlement's applied time is always the earlier one. The mark never writes a time before `late_won_at` (`GREATEST`), so a mark run by a worker whose clock is behind the one that recorded the late win cannot pass for a hand settlement.

### How the reconcile finds a late win

The webhook undoes a late win when Stripe's event arrives. One whose event was missed is found by the hourly reconcile (§4, `dispute-reconcile.ts`), which reads each dispute live from Stripe and runs it through the webhook's own `processDispute`:

| Source | Finds |
|---|---|
| 1. Stripe's events of the last 4 days | An applied loss whose furthest snapshot says won (`needsSettling`). A late win already undone, or settled by hand under R18, is won and applied, and is left alone |
| 2. Our final rows whose outcome was never applied | A late win being undone whose step failed: retried every run, and alerted at error with an errorId each time |
| 3. Our lost rows (owner Q3) | A late win whose events are older than source 1's 4 days |

Source 3, in order:

1. `findLostDisputesToRecheck` reads our lost rows opened (`stripe_created_at`) in the last 12 months and not written in the last 15 minutes (the webhook's), newest first, at most 300: what the pages below can list. None, and Stripe isn't called.
2. Stripe's disputes created since the oldest of them are listed newest first, 100 a page, at most 3 pages. Production and development share one Stripe sandbox, so the list holds the other's disputes too; only our rows are acted on.
3. Each of ours that Stripe has as `won` is settled, at most 10 a run (`LATE_WIN_LIMIT`), skipping any the first two sources settled this run. The rest wait for the next run.

Reaching the page limit, failing to read a page, and failing to read our rows are each alerted at error with an errorId ([operations](operations.md#late-wins)). A page that cannot be read still leaves the late wins found on the pages before it to be settled.

**The 08:00 London run** pays the banks and has no subrequests to spare, so it finds no new late wins (`lateWins: !isBankPayoutRun(scheduledTime)`, `payouts-sweep.ts`): no source 3, and source 1 leaves applied losses alone. Source 2 still runs, so a late win already being undone is retried. The next hour's run picks up the rest. Source 3 costs at most about 125 subrequests a run: 3 list pages, and at most 10 undos of about 12 each ([the budget](connect-and-payouts.md#payout-timing)).

**Limits.**

- A lost row opened more than 12 months ago is never re-checked (owner Q3): a late win that old, whose events were missed, is left to a person.
- With more than 300 lost rows in 12 months, the oldest past 300 are not read. The page-limit alert fires whenever Stripe's list since the oldest of the 300 holds more than 300 disputes, which it does unless every dispute in that span is one of those lost rows.
