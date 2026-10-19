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
| `status` | Stripe's, forward only (`warning_*`, `needs_response`, `under_review`, `won`, `lost`, `prevented`). It also says whether money moved: a chargeback status means Stripe took it, an inquiry's means it did not |
| `outcome_applied_at` | when won or lost handling finished. A redelivery finds it and stops |

### The reversal: `payout_reversals` with `cause_type = 'dispute'`

The clawback engine is used unchanged, with the dispute as one more cause on the charge.

- **A dispute's share of a slice** is `floor(gross × (refunded + disputed) / charge) − floor(gross × refunded / charge)`. The charge's settled refunds come first, so a dispute on a partly refunded charge takes only what the refunds left.
- **Paid slices** are reversed (`transfer_reversal`), with the key `${transferId}_reversal_${disputeId}_${attempt}`. Debts go to `refund_reviews` as for refunds. Retries, the lease and the hourly cron all apply.
- **The platform fee** is `retained_fee`.
- **Pending slices are not reduced.** They are **held** (below).

### The hold

The drain skips a pending or failed slice whose charge has an **open** dispute: a `disputes` row that is not `won`, `lost` or `warning_closed`. There is no new column on `payouts`; the drain's query gains one `NOT EXISTS`.

### The re-pay: a new pending payout row per reversed slice

This is the mechanism a won dispute needs. It is also what support's "re-pay the creators" action will reuse for a failed refund (Codex-2hxff.28).

- For each `done` dispute reversal with a payee, one new `payouts` row is written:
  - `status = 'pending'`, the same payee, type, source and transfer group;
  - `amount_cents` is the reversal's amount;
  - **`stripe_charge_id` is NULL**, so the transfer comes from the platform balance (no `source_transaction`), and none of the one-slice-per-charge unique indexes apply.
- `payout_reversals.repaid_by_payout_id` (new, unique, nullable) links the reversal to its re-pay row. That makes the re-pay idempotent: a redelivery finds the link.
- The drain pays it like any other row, with the floor, Connect readiness and retries.
- **The clawback never treats a re-pay row as a slice of the charge.** It is excluded from the engine's row scope. A later refund of a slice that was re-paid becomes a `refund_reviews` row for a person, because the cumulative-share rule cannot see the re-pay.

## 4. How each event runs

The dispute endpoint already takes `charge.dispute.created`, `.updated` and `.closed`. It also needs `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated`, an owner Stripe change. Every event first records the dispute row, forward only, then:

| Event or status | Access | Money |
|---|---|---|
| Inquiry (`warning_*`) | Kept (Q1) | Nothing reversed; the sale's pending slices held until it closes or escalates (Q1) |
| Chargeback opened (`needs_response`, or funds withdrawn) | Paused: `disputedAt`, the streaming block, and the library hides the item, as today plus the gaps | Paid slices reversed by the dispute's share; pending slices held |
| Won (`won`, funds reinstated) | Restored: `disputedAt` cleared, content access and the entitlement restored | One re-pay row per reversed slice; held slices released; any dispute debt in `refund_reviews` closed |
| Lost (`lost`) | Ends for good: the purchase becomes `refunded` (Q3). A subscription is cancelled | Reversals stand; held slices become `cancelled_by_dispute` (Q3) |
| Lost after a partial refund | As lost | As lost; Stripe reinstates the refunded part, and the refunds already clawed it back |

## 5. Subscriptions

- A disputed invoice has no purchase row. The `disputes` row is keyed by its charge, and the subscription is found from the invoice's payout rows (`subscription_id`).
- **Paused** means the subscription's access is paused for the dispute's life: the same streaming block as a failed renewal, with no Stripe change.
- **Lost** cancels the subscription at Stripe (subscriptions.md).
- The money (reversal, hold, re-pay, cancel) is the same for both sources and ships first. Pausing, restoring and cancelling the subscription ships in Codex-2hxff.9's second PR.

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
- **Q3: a lost dispute makes the purchase `refunded`, and held slices `cancelled_by_dispute`.** Sales reports count the money as gone, access stays ended, and a chargeback can be told apart from a refund.
