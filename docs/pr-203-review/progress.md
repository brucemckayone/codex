# PR #203 + #204 Deep Review — Progress

**Stack:** PR #204 (`feat/Codex-6nt4l-payouts-grouping-rail`) → PR #203 (`fix/Codex-h69cg-purchase-payouts-parity`) → `main`

**Focus:** Multi-creator orgs. Bugs, missing tests, design questions.

**Worktree:** `.claude/worktrees/pr-203-review` (at tip of stacked branch, `f9104cb6`).

**Self-paced loop:** cron `7,37 * * * *`, job `80de02cc`. Cancel with `CronDelete 80de02cc`.

## Status legend

- 🟢 reviewed, no findings
- 🟡 reviewed, finding filed (see Findings + design-questions.md)
- 🔴 bug confirmed + failing test pending or written
- ⚪ outstanding

## Code-path coverage matrix

### PR #203 — tri-party ledger

| Surface | File | Status | Notes |
|---|---|---|---|
| Purchase: write 3 rows on checkout | `purchase-service.ts` (`writePurchasePayouts`, L693-798) | 🟡 | Option B (platform charge) confirmed. **Finding F-2, F-8.** |
| Purchase: refund reversal | `purchase-service.ts` (`reversePayoutsForPurchase`, L1270-1331) | 🔴 | **Finding F-1, F-2.** Partial-refund money loss + wrong status for pending rows. |
| Purchase: createCheckoutSession (Option A→B switch) | `purchase-service.ts` L290-309, L382-386 | 🟢 | Switch correct + commented. PR body stale (DQ-1). |
| Subscription: write 3 rows on invoice.paid | `subscription-service.ts` (L3742+, L4041) | ⚪ | Not yet read — next cycle. |
| Sweep cron grouping | `sweepUnresolvedPayouts` L4255-4372 | 🟢 + 🔴 | Correctly groups by (orgId, userId). **Finding F-7**: applies subscription fee policy to purchase-sourced rows. |
| `resolvePendingPayouts` per-creator scope | L3125-3256 | 🟢 | Correctly scopes by (userId, orgId). No cross-creator credit. |
| Revenue calculator | `revenue-calculator.ts` | ⚪ | Not yet read. |
| Schema CHECK constraints | `0065_acoustic_spirit.sql` | ⚪ | Not yet read. |
| `/studio/payouts` source filter | `+page.svelte` | ⚪ | Not yet read. |
| Stale CLAUDE.md | `packages/purchase/CLAUDE.md` | 🟡 | **Finding F-9**. Wrong signature + outdated charge model. |

### PR #204 — grouping + per-creator rail

| Surface | File | Status | Notes |
|---|---|---|---|
| `getPayoutsByCreatorBreakdown` aggregation | `subscription-service.ts` L3009-3110 | 🔴 | **Finding F-3**: `organization_fee` userId conflates org-owner personal vs org-admin slice. |
| `transactionCount` dedupe by transferGroup | L3101 | 🟢 | Per-accumulator dedupe is correct for multi-creator. |
| `isOrgOwner` LEFT JOIN | L3032-3038 | 🔴 | **Finding F-4, F-5**: only `'owner'` flagged; no `deletedAt` filter on membership join. |
| `buildPayoutConditions` shared helper | L2802-2825 | 🟢 | Looks correct; parity test still needed (Task #11). |
| `CreatorBreakdownRail.svelte` | `apps/web/src/lib/components/studio/payouts/` | ⚪ | Not yet read. |
| `CreatorBreakdownCard.svelte` | same | ⚪ | Not yet read. |
| Page restructure (grid + sticky rail) | `+page.svelte` | ⚪ | Not yet read. |
| Remote function | `subscription.remote.ts` | ⚪ | Auth scoping + zod check pending. |
| API route | `workers/ecom-api/src/routes/subscriptions.ts` | ⚪ | procedure() policy + zod validation pending. |

## Findings

### F-1 🔴 Partial-refund money loss (purchase-service.ts:1289-1297)

`reversePayoutsForPurchase` calls `transfers.createReversal` with `amount: row.amountCents` — the **full** stored slice — regardless of whether the originating Stripe refund was partial. `payment-webhook.ts:155` already passes `charge.amount_refunded` to `processRefund`, but it's stored on the purchase row only; the reversal path ignores it.

**Impact.** For a £20 charge refunded at £5 (partial refund), the creator's £18 slice is fully reversed (creator loses ~£18 even though the customer only got £5 back). Net: platform absorbs £13 unaccounted, creator loses £18 of legitimate earnings.

**Fix.** Pass `refundAmountCents` into `reversePayoutsForPurchase`; for partial refunds, compute proportional reversal (`amountCents * refundedRatio`). For full refunds, current behaviour is correct.

**Test.** `partial refund proportionally reverses creator + org transfers, platform_fee marks status='partial_reversal'`. To be written.

---

### F-2 🔴 Pending/failed rows mis-marked as 'reversed' on refund

`reversePayoutsForPurchase` L1278 loops over **all** rows for the purchase and marks any non-already-reversed row as `status='reversed'`. But `pending` rows (Connect-not-ready) and `failed` rows **never had a Stripe transfer** — they have no `stripeTransferId`. Marking them 'reversed' is semantically wrong:

- These rows represent money the platform still owes the creator (or that failed to send).
- After this code marks them 'reversed', the sweep cron no longer sees them as `status='pending'`, so they will never be retried.
- The creator silently loses the legitimate payout that was queued.

**Impact.** If a creator's Connect account isn't ready when a purchase completes (perfectly normal during onboarding), and the buyer later refunds, the creator never gets paid even if onboarding completes after the refund. Money disappears.

**Fix.** Only mark `status='reversed'` on rows that were actually paid out (`status='paid'` AND `stripeTransferId IS NOT NULL`). Pending/failed rows should either be deleted, marked with a separate 'cancelled' status, or left alone (sweep will see they're orphan).

**Test.** `processRefund leaves pending payouts on (connect_not_ready) untouched so the sweep can still resolve them when Connect onboarding completes`. To be written.

---

### F-3 🔴 Per-creator breakdown conflates org-owner personal vs org-fee slice

`writePurchasePayouts` writes `organization_fee` rows with `userId = orgConnect.userId` — the user who owns the org's Connect account (typically the org owner). `getPayoutsByCreatorBreakdown` then accumulates **all** rows under that userId, including the org_fee slice that's the org's administrative cut, not personal earnings.

**Multi-creator example.** Org A: Owner=X (Connect account holder), Creator=Y. Buyer purchases Y's content £20 → splits 10% platform / 13.5% org / 76.5% creator. Result:
- Y's row: £15.30 personal `creator_payout` ✓
- X's row: £2.70 `organization_fee` — **but the breakdown shows X with £2.70 totalPaid, looks like personal earnings.**

In the UI rail, X gets "Org owner" badge + £2.70. An operator can't tell if X is also a creator earning their own slice or just receiving the org's cut.

**Impact.** Misleading payouts surface for any org with co-creators. Reconciliation against personal Stripe Connect dashboards will drift.

**Fix.** Either (a) exclude `organization_fee` from per-creator totals (it's org money, surface separately in rail), or (b) split the breakdown into personal-earnings + org-slice columns. Option (a) is the conservative call.

**Test.** `getPayoutsByCreatorBreakdown excludes organization_fee from owner's totalPaidCents in multi-creator org`. To be written.

---

### F-4 🟡 `isOrgOwner` only flags `role='owner'`

L3062: `isOrgOwner: row.membershipRole === 'owner'`. Admins, members, and creator-only roles all render identically. See DQ-2.

---

### F-5 🟡 Membership LEFT JOIN lacks `deletedAt` filter

L3032-3038. Soft-deleted memberships still match. Also: if `organizationMemberships` ever permits multiple rows per (userId, orgId) without `deletedAt` filtering, this LEFT JOIN would **duplicate payouts in the aggregation**, inflating `totalPaidCents`. Schema currently enforces a unique constraint per `packages/database/schema/organizations.ts` (need to verify), but defence-in-depth says add the filter.

**Fix.** Add `isNull(organizationMemberships.deletedAt)` to the join predicate.

**Test.** `breakdown does not double-count when a stale soft-deleted membership row exists`. To be written if schema permits the scenario.

---

### F-6 🟢 `transactionCount` dedupe is correct per-creator

L3101 accumulates `_transferGroups` *into the per-user accumulator*. Multi-creator one-charge fan-out (if ever supported) would correctly show transactionCount=1 for each creator.

---

### F-7 🔴 Sweep uses subscription fee policy for purchase-sourced pending rows

`sweepUnresolvedPayouts` calls `resolvePendingPayouts` (L4347) which calls `resolveSubscriptionFees(orgId, userId)` (L3193) hardcoded to `'subscription'` policy (L553). Purchase-sourced pending rows (`sourceType='purchase'`) thus get gated by the **subscription** `minTransferCents`, not the `one_off` floor.

**Impact.** If an org configures different floors per policy (subscription £5, one_off £1), a £2 pending purchase payout would skip on the subscription floor even though the one_off floor allows it. Stuck pending indefinitely.

**Fix.** Branch on `payout.sourceType` and call `getFeesForCreator(orgId, userId, 'one_off')` for purchase rows.

**Test.** `resolvePendingPayouts uses one_off fee policy for purchase-sourced pending rows`. To be written.

---

### F-8 🟡 Idempotency key `${stripeChargeId}_creator` omits creatorId

`purchase-service.ts:778` — `idempotencyKey: \`${stripeChargeId}_creator\``. Single-creator-per-charge baked in. If future bundle-purchase work fans out one charge to multiple creators, two creator transfers on the same charge collide on the idempotency key (one wins, other returns the first's transfer object).

Subscription side already uses `${chargeId}_creator_${creatorId}` per CLAUDE.md — purchase side should mirror this defensive pattern even though single-creator-per-charge is the only current case.

**Fix.** Change to `\`${stripeChargeId}_creator_${creatorId}\``. Mirror subscription invariant.

**Test.** Static check / lint or a test that runs two parallel `executePurchaseTransfer` calls with same chargeId different creatorIds and verifies both get distinct transfer ids.

---

### F-9 🟡 `packages/purchase/CLAUDE.md` is stale

- Documents `processRefund(purchaseId, customerId, reason?)` — actual signature is `(paymentIntentId, refundDetails?)`.
- Says "Routed via destination charge at the moment of purchase" — code is platform charge (Option B).
- Missing `processDispute` method.

**Fix.** Update docs to match HEAD.

---

### F-10 🟢 Sweep cron correctly groups by (orgId, userId)

No cross-creator money flow. Defence-in-depth invariant holds.

---

### F-11 🟢 Refund reversal correctly handles both creator + org transfers under Option B

`reversePayoutsForPurchase` reverses ALL rows with `stripeTransferId`, so both creator and org transfers get explicitly reversed (Stripe does NOT auto-reverse under platform charge model).

Caveat: see F-1 (amount) and F-2 (status for pending rows).

---

## Outstanding

- Subscription write path on invoice.paid (`handleInvoicePaymentSucceeded` and `executeTransfers`)
- Schema CHECK constraints exercised by unit tests
- Frontend rail components (CreatorBreakdownRail/Card)
- /studio/payouts page restructure (grid, sticky rail, mobile stacking)
- Remote function + API route auth scoping
- /review and /simplify formal passes

## Design questions

See `design-questions.md`.
