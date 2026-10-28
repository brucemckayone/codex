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

## 3. The records

### `disputes`: one row per Stripe dispute, any source

It is shaped like `refunds`.

| Column | Notes |
|---|---|
| `stripe_dispute_id` | unique; `dp_…` |
| `stripe_charge_id`, `purchase_id` (nullable) | as `refunds`; null for a subscription invoice |
| `amount_cents`, `currency`, `reason` | the disputed amount |
| `status` | Stripe's, forward only (`warning_*`, `needs_response`, `under_review`, `won`, `lost`, `prevented`); a late win, `lost` → `won`, is alerted and not written (§4). It also says whether money moved: a chargeback status means Stripe took it, an inquiry's means it did not |
| `outcome_applied_at` | when won or lost handling finished. A redelivery finds it and stops |

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

**A late win** (Stripe turns `lost` into `won`; owner decision 2026-10-25, "alert only") is only alerted: each such event logs at error with an `errorId` and ids only ("late win on a lost dispute: re-pay creators and restore the buyer by hand"). The record stays `lost`, its `outcome_applied_at` untouched, so nothing reads a win: the loss's refund, reversals, ended access and support's refund block all stand until a person acts. `Codex-2hxff.70` will later record `won` together with the undo.

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

- **A debt the payee paid is re-paid in full.** Once partial recoveries are recorded (Codex-2hxff.30), the re-pay must be limited to what was recovered.
- **A win clears the user's streaming block for the organisation.** That can lift a block a subscription event set in the same 20-minute window.
- **For up to 20 minutes the stream refuses a disputed item that something else still covers** (Codex-2hxff.60). The block is written for the buyer's whole organisation (the dispute notice's Q2, owner decision 2026-10-24), and for every disputed content purchase: `accessEnded` only asks whether another completed purchase keeps the item. So a disputed item that a subscription, a support grant or a staff role covers says "Access paused" while the library shows it playable. When the block expires, it plays.
- **The library's undim is cached** (Codex-2hxff.60). The label is decided when the library is fetched, and the client keeps the row until the next library version bump. A covering grant that lapses by its expiry bumps nothing, so the card stays undimmed while the stream refuses.
- **A share larger than a re-paid slice's unpaid re-pay rows** is left to a person (`slice_repaid`), for the part they cannot carry, rather than reversed from the slice's own transfer.
- **`prevented` is a closed inquiry.** Stripe defines it as a dispute "prevented from becoming a formal chargeback" (Dispute Preventions, 2025-08-27), so nothing is restored or re-paid, and the held slices are released. A `prevented` dispute that has a dispute reversal step anyway is alerted at error with an errorId (Codex-2hxff.59).
