# PR #203 + #204 Review — Design Questions

Format: each entry has **Context**, **Options**, **Recommendation**, **Status** (open / resolved / deferred).

---

## DQ-1 — Option A vs Option B money flow on purchases

**Resolved.** Code is Option B (platform charge with two secondary transfers using `source_transaction`). `reversePayoutsForPurchase` (L1270-1331) correctly reverses BOTH the creator AND org transfers via `transfers.createReversal` keyed on `${stripeTransferId}_reversal`. The PR #203 body is stale and should be updated to match.

**Action.** Update PR #203 body to describe Option B. The reversal logic IS correct under Option B (but see DQ-7 / Finding F-1 for the partial-refund flaw and F-2 for the pending-row mis-marking — neither was caught by current tests).

**Status.** Resolved (model identified). Body update needed; refund-amount bug filed as DQ-7.

---

## DQ-2 — `isOrgOwner` badge: only `role='owner'`, or also `'admin'`?

**Context.** PR #204's `getPayoutsByCreatorBreakdown` flags users in the rail with `isOrgOwner: true` only if `organizationMemberships.role = 'owner'`. The UI shows "Org owner" badge for those rows.

Multi-creator orgs can have:
- 1 owner + N creator-members
- 1 owner + 1 admin + N creators
- Co-owners (rare, but the schema allows multiple memberships)
- A creator who is also an admin (RBAC overlap)

**Options.**
- (a) Only owner gets badge — current behaviour. Admins look like plain creators.
- (b) Owner gets "Owner" badge, admin gets "Admin" badge — finer-grained.
- (c) Add a generic "Team" tag that distinguishes any non-creator-only role.
- (d) Hide the badge entirely; the org-page header already shows ownership.

**Recommendation.** (b) for studio surface — admins have payout-relevant powers and should be visually distinguishable. Defer (b) if `organizationMemberships.role` doesn't currently model admin.

**Status.** Open.

---

## DQ-3 — `transactionCount` dedupe grain: per-creator or per-org?

**Context.** PR #204 dedupes `transactionCount` by `transferGroup` inside the per-creator aggregation. But one `transferGroup` = one charge = potentially N creator_payout rows for an org with multi-creator content.

If the dedupe is global (across all creators), per-creator counts undercount.
If the dedupe is per-creator (within one breakdown row), counts are correct but two creators receiving from the same charge each see "1 transaction" — which is correct from each creator's view.

The PR test says "4 rows / 2 groups → 2" — that's the single-creator case. The multi-creator case isn't covered.

**Options.**
- (a) Dedupe per-creator (within the map entry). Each creator's count reflects how many distinct charges contributed to their payout.
- (b) Dedupe globally. Org-wide view; per-creator counts may exceed the actual charge count if you sum them.

**Recommendation.** (a) — per-creator dedupe matches the "per-creator stats" framing of the rail. Add a test with one transferGroup spanning two creators.

**Status.** Open — needs code read to confirm which form is implemented.

---

## DQ-4 — Should the rail be visible to non-owner creators?

**Context.** `/studio/payouts` is currently studio-scoped (org owners/admins). The breakdown rail surfaces *every* creator's totals — that's privileged data.

If a non-owner creator can reach this page, they would see their peers' payout totals.

**Options.**
- (a) Hide rail for non-owners. Show only "your" stats.
- (b) Page requires owner/admin role → rail always shows all creators.
- (c) Rail shows all creators but only owner sees totals; non-owners see anonymized counts.

**Recommendation.** (b) — match the existing studio-page guard. Add an explicit role check (`requireOrgRole('owner','admin')`) on the new `/subscriptions/payouts/by-creator` route.

**Status.** Open — needs API route audit.

---

## DQ-5 — `sourceType` default 'subscription' on backfill

**Context.** PR #203 migration adds `sourceType` with `default 'subscription'`, justified because "all pre-h69cg rows came from the subscription pipeline." For multi-creator orgs with historical purchase-side rows from before subscription support existed, this default is wrong.

**Options.**
- (a) Backfill manually: SET sourceType='purchase' WHERE purchaseId IS NOT NULL.
- (b) Trust the default — there are no pre-h69cg purchase rows because purchases didn't write to payouts before.
- (c) Drop the default; require an explicit value at insert.

**Recommendation.** (b) IF an audit query confirms zero pre-h69cg rows have a non-null `purchaseId`. Otherwise (a). Add a one-line note in `payouts.ts` schema explaining the default.

**Status.** Open.

---

## DQ-6 — Per-creator subscription split semantics (not yet covered)

**Context.** When a subscriber pays £20/mo for a tier that grants access to content from Creator X, Y, Z within the same org, the current code path appears to write a single `creator_payout` row to the **org owner** (not split per creator). The membership-redesign epic hasn't landed yet, so this is correct today, but the rail's "per-creator" framing implies otherwise.

**Options.**
- (a) Rail shows org owner with full subscription total. Per-creator-of-tier breakdown is a follow-up.
- (b) Split subscriptions by content access (complex; out of PR scope).
- (c) Surface subscription totals at the org level (separate panel from the creator breakdown).

**Recommendation.** (a) for this stack. File a follow-up bead to revisit when membership-redesign Phase 2 lands.

**Status.** Open.

---

---

## DQ-7 — Partial refunds and proportional ledger reversal

**Context.** `processRefund` accepts `refundAmountCents` from the webhook (`charge.amount_refunded`) and stores it on the purchase row, but `reversePayoutsForPurchase` calls `transfers.createReversal` with `amount: row.amountCents` — the **full** stored slice. For a £20 charge refunded at £5:

- Creator slice (£18) — fully reversed by code → creator loses £18.
- Org slice (£0.30) — fully reversed by code → org loses £0.30.
- Customer receives £5 from platform balance.
- Platform absorbs £13.30 of unaccounted loss; creator's books drift £13 vs Stripe.

**Options.**
- (a) Refuse partial refunds at the webhook layer (only support full refunds for purchases). Simplest; user-hostile if Stripe Dashboard supports them.
- (b) Pass `refundAmountCents` into `reversePayoutsForPurchase`, compute `ratio = refundAmountCents / purchase.amountPaidCents`, reverse `floor(row.amountCents * ratio)` per slice. Round residual into platform fee.
- (c) Mark partial refunds as "review needed" — write a sentinel row and surface in studio.

**Recommendation.** (b). Use integer math (pence) with a deterministic rounding rule (residual → platform). Add idempotency key suffix `_${refundedAt}` or `_${refundAmountCents}` so multiple partial refunds against the same purchase don't replay the first reversal.

**Status.** Open — file as P0 bead. Real-money path, no current test coverage.

---

## DQ-8 — `organization_fee` row attribution + breakdown semantics

**Context.** `writePurchasePayouts` writes `organization_fee` rows with `userId = orgConnect.userId`. The per-creator breakdown then aggregates that row under the org-owner's totalPaidCents, conflating personal earnings with the org's administrative slice.

**Options.**
- (a) Exclude `organization_fee` from per-creator totals; surface org slice as a separate panel in the rail.
- (b) Split breakdown into `personalEarningsCents` + `orgSliceCents`; only personal earnings sort the rail.
- (c) Leave behaviour as-is (org owner earns more headline number), document the ambiguity.

**Recommendation.** (a) for now. The rail is "Per-creator earnings"; org slice is an org-level concept. A separate org-owner card or top-of-rail line item solves the surface need without aggregation drift.

**Status.** Open. Implementation-blocker for PR #204 if accepted.

---

## DQ-9 — Pending payouts behaviour on refund

**Context.** A creator with Connect-not-ready receives a `pending` payouts row when a purchase completes. If the buyer refunds before Connect is ready:

1. `reversePayoutsForPurchase` currently marks the pending row `status='reversed'`.
2. Sweep cron no longer sees it as pending → no retry attempt.
3. If Connect onboarding completes after the refund, the creator's pending payout is silently lost.

But the refund DID reduce the platform's owed liability — the customer got their money back. So is the pending row's reversal correct in effect (money flow), even if wrong in semantics?

**Options.**
- (a) Pending/failed rows on refund get a new `status='cancelled_by_refund'` (or are hard-deleted). Sweep skips them; semantic clarity preserved.
- (b) Pending rows on refund are left untouched. Sweep eventually picks them up, fails the transfer (insufficient platform balance because the refund already reduced it), and they become `status='failed'` naturally.
- (c) Current behaviour ('reversed') — accept the semantic mismatch.

**Recommendation.** (a). Reverses the obligation explicitly, doesn't pretend a transfer happened. Failing-into-failed (option b) creates noisy alerts. Current behaviour (c) is misleading on the ledger.

**Status.** Open.

---

---

## DQ-10 — Display "effective share" vs raw share in the per-creator rail

**Context.** `executeTransfers` normalises the creator pool by `totalShareBps = Σ activeAgreements.sharePercent`, not by 10000bps. A creator told "you have 25% share" who is the sole active creator receives 100% of the pool (25/25). With three other co-creators each at 25%, they receive 25% of the pool (25/100).

This is documented + tested behaviour, but the per-creator rail today renders `sharePercent` verbatim. Creators will reconcile their payouts against the wrong number.

**Options.**
- (a) Render "effective share = sharePercent / totalShareBps × 100%" alongside the raw value.
- (b) Render only effective share; hide raw.
- (c) Don't display share at all; only render actual amount + count.

**Recommendation.** (a) — both numbers tell different stories. The org owner can verify the agreement; the creator can predict next month's earnings.

**Status.** Open — UI-only change, no backend impact. File when the rail UI work starts.

---

_Add new questions below; renumber if any are removed._
