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

**Status.** **RESOLVED 2026-05-16** — choice (b). Implementation:
1. Verify `organizationMemberships.role` enum currently includes a distinct `'admin'` value (audit `packages/database/schema/organizations.ts`). If yes, proceed; if no, file a schema migration first.
2. Update `getPayoutsByCreatorBreakdown` to return `membershipRole: 'owner' | 'admin' | 'member' | null` (currently returns `isOrgOwner` boolean — replace with the richer field).
3. UI: render `Owner` badge for role='owner', `Admin` badge for role='admin' (lighter variant), no badge for member/null. Closes DQ-13 by making `data-org-owner` truly redundant — delete it.

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

**Status.** **RESOLVED 2026-05-16** — choice (a). Per-creator dedupe of `transactionCount` by `transferGroup` (within each map entry, NOT globally). Follow-up test required: 1 transferGroup spanning 2 creators → each sees `transactionCount=1`. Confirm current code matches; file a defect bead if it doesn't.

---

## DQ-4 — Should the rail be visible to non-owner creators?

**Context.** `/studio/payouts` is currently studio-scoped (org owners/admins). The breakdown rail surfaces *every* creator's totals — that's privileged data.

If a non-owner creator can reach this page, they would see their peers' payout totals.

**Options.**
- (a) Hide rail for non-owners. Show only "your" stats.
- (b) Page requires owner/admin role → rail always shows all creators.
- (c) Rail shows all creators but only owner sees totals; non-owners see anonymized counts.

**Recommendation.** (b) — match the existing studio-page guard. Add an explicit role check (`requireOrgRole('owner','admin')`) on the new `/subscriptions/payouts/by-creator` route.

**Status.** **RESOLVED 2026-05-16** — choice (b). Rail is owner + admin only. Cycle 6 F-37 confirmed `requireOrgManagement` (which admits owner + admin uniformly) IS already wired on all three payouts routes. No new code needed — the audit gate holds. Action: add a route-level integration test (Codex-ajbja covers this) verifying that a member-role user receives 403 on `/payouts/by-creator`.

---

## DQ-5 — `sourceType` default 'subscription' on backfill

**Context.** PR #203 migration adds `sourceType` with `default 'subscription'`, justified because "all pre-h69cg rows came from the subscription pipeline." For multi-creator orgs with historical purchase-side rows from before subscription support existed, this default is wrong.

**Options.**
- (a) Backfill manually: SET sourceType='purchase' WHERE purchaseId IS NOT NULL.
- (b) Trust the default — there are no pre-h69cg purchase rows because purchases didn't write to payouts before.
- (c) Drop the default; require an explicit value at insert.

**Recommendation.** (b) IF an audit query confirms zero pre-h69cg rows have a non-null `purchaseId`. Otherwise (a). Add a one-line note in `payouts.ts` schema explaining the default.

**Status.** **RESOLVED 2026-05-16** — choice "(b) with audit gate". Action: run the one-time audit query `SELECT COUNT(*) FROM payouts WHERE source_type='subscription' AND purchase_id IS NOT NULL` against production. If COUNT=0, trust the default; add a schema-level comment in `packages/database/src/schema/payouts.ts` documenting the rationale. If COUNT>0, run a corrective `UPDATE payouts SET source_type='purchase' WHERE purchase_id IS NOT NULL`. File a small task bead to execute this audit pre-merge of any DQ-8 / DQ-18 work that depends on sourceType correctness.

---

## DQ-6 — Per-creator subscription split semantics (not yet covered)

**Context.** When a subscriber pays £20/mo for a tier that grants access to content from Creator X, Y, Z within the same org, the current code path appears to write a single `creator_payout` row to the **org owner** (not split per creator). The membership-redesign epic hasn't landed yet, so this is correct today, but the rail's "per-creator" framing implies otherwise.

**Options.**
- (a) Rail shows org owner with full subscription total. Per-creator-of-tier breakdown is a follow-up.
- (b) Split subscriptions by content access (complex; out of PR scope).
- (c) Surface subscription totals at the org level (separate panel from the creator breakdown).

**Recommendation.** (a) for this stack. File a follow-up bead to revisit when membership-redesign Phase 2 lands.

**Status.** **RESOLVED 2026-05-16** — choice (a). Rail correctly shows org owner as a "creator" row for subscription revenue today. When membership-redesign Phase 2 ships per-content-creator subscription splits, revisit this DQ + the rail logic. File a follow-up bead pointing at Phase 2 dependency (Codex-8k2k epic).

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

**Status.** **RESOLVED 2026-05-16** — **HYBRID: (b) + (c)**. Ship proportional reversal as the math layer, AND add a "review-needed" sentinel that fires reactively when Stripe Connect returns `insufficient_funds` on the reversal call (creator already withdrew their slice → balance below reversal amount → platform absorbs the loss until creator earns again).

**Implementation plan for Codex-d9t5r:**
1. **Math layer**: pass `refundAmountCents` into `reversePayoutsForPurchase`. Compute `ratio = refundAmountCents / amountPaidCents`. Reverse `floor(row.amountCents * ratio)` per slice. Idempotency suffix `_${refundAmountCents}` so multiple partial refunds against same charge don't collide.
2. **Sentinel layer**: wrap each `transfers.createReversal` call in a try/catch. On Stripe error code `'insufficient_funds'`, write a `refund_review` audit row (new table OR a `status='review_needed'` extension on the payouts row — TBD migration shape) capturing `{ purchaseId, creatorUserId, attemptedReversalCents, currentBalanceCents, refundedAt }`. Keep the original payout row as `status='paid'` (since the original transfer succeeded) but flag the reversal failure separately. The customer's refund still completes (Stripe issued it from platform balance); the platform now has an unresolved clawback obligation.
3. **Surface (follow-up bead)**: studio admin page listing review-needed rows for ops to resolve. Decision per row: "pursue creator" (creator stays negative until earnings catch up — current default), "platform absorbs" (write off, log obs.warn), or "manual reverse" (cancel a future creator payment by hand).

**Product-policy conversation**: tracked in **bead Codex-aqk92 (P2)** — "Refund policy: liquidity + clawback recovery + customer-facing policy". Covers: who absorbs cost (creator vs platform vs hybrid), liquidity strategy (platform float vs delayed payouts vs reactive clawback), refund window, initiation channels, negative-balance recovery, customer-facing copy, Connect agreement clauses. Does NOT block Codex-d9t5r (math ships regardless).

**Why this still ships proportional today**: regardless of policy, Stripe Dashboard CAN issue partial refunds at any time. The math must be correct first; the sentinel makes the operational risk visible; the product conversation determines what ops does with the review queue.

---

## DQ-8 — `organization_fee` row attribution + breakdown semantics

**Context.** `writePurchasePayouts` writes `organization_fee` rows with `userId = orgConnect.userId`. The per-creator breakdown then aggregates that row under the org-owner's totalPaidCents, conflating personal earnings with the org's administrative slice.

**Options.**
- (a) Exclude `organization_fee` from per-creator totals; surface org slice as a separate panel in the rail.
- (b) Split breakdown into `personalEarningsCents` + `orgSliceCents`; only personal earnings sort the rail.
- (c) Leave behaviour as-is (org owner earns more headline number), document the ambiguity.

**Recommendation.** (a) for now. The rail is "Per-creator earnings"; org slice is an org-level concept. A separate org-owner card or top-of-rail line item solves the surface need without aggregation drift.

**Status.** **RESOLVED 2026-05-16** — choice (a) **partially shipped by `ea08ca29` (merged cycle 15)**.

**Already landed**: new `orgFeePaidCents` field on `CreatorPayoutBreakdown` projects the organization_fee subset; UI shows "of which £X org fee" subline on the owner card.

**Still pending (Codex-h3864 fix scope)**:
1. SQL exclusion: `WHERE payoutType != 'organization_fee'` in `getPayoutsByCreatorBreakdown`'s aggregation for `totalPaidCents`. Currently `totalPaidCents` still INCLUDES org_fee.
2. Surface the org slice as a separate panel at the top of the rail (DQ-12's two-tier layout — owner's `orgFeePaidCents` becomes the source of truth for that panel).
3. Update the upstream `'orgFeePaidCents tracks ...'` test in subscription-service.test.ts: when the SQL exclusion lands, the assertion `expect(owner?.totalPaidCents).toBe(1000)` must change to `expect(owner?.totalPaidCents).toBe(850)` (excluding the £1.50 organization_fee row).
4. Our `it.fails('F-3/DQ-8: excludes organization_fee ...')` regression test goes green; remove the `.fails` marker.

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

**Status.** **RESOLVED 2026-05-16** — choice (a). Add `cancelled_by_refund` to the `payouts.status` enum. Migration must:
1. Drop and recreate the `check_payouts_status` CHECK constraint to include the new value.
2. Update `reversePayoutsForPurchase` to set `status='cancelled_by_refund'` ONLY on rows where `stripeTransferId IS NULL` (i.e. the row never actually paid out). Rows with a transfer keep `status='reversed'`.
3. Update `derivePayoutStatus` UI mapping + `statusLabel` / `statusVariant` to render the new status (label: "Cancelled (refund)", variant: 'info' or muted-warning).
4. Add a CHECK constraint tripwire test mirroring cycle 8 pattern. Fixes F-2 / Codex-92ej7 P0.

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

**Status.** **RESOLVED 2026-05-16** — choice (a). Card displays effective % + raw % side-by-side, e.g. "Receiving 33% of pool (25% raw share — 1 of 3 creators active)". Tooltip explains the normalisation rule (`totalShareBps = Σ active agreements`, effective = sharePercent / totalShareBps × 100). Backend returns both `sharePercent` and `effectiveSharePercent` from `getPayoutsByCreatorBreakdown`. UI-only fix once backend exposes the field; bundle into the Codex-h3864 (DQ-8) rail refactor.

---

---

## DQ-11 — Identifying fragment for soft-deleted creators in the rail

**Context.** `getPayoutsByCreatorBreakdown` LEFT JOINs `users`. A soft-deleted user's `name`/`email`/`image` columns are null in the join result. `CreatorBreakdownCard.svelte:37-39` falls back to "Unknown creator". Multiple deleted creators with outstanding payouts render identically; auditors and operators can't trace any individual row.

**Options.**
- (a) Render last 6 chars of userId: `Deleted creator (usr_…abc123)`.
- (b) Filter `users.deletedAt` at the SQL boundary; project a `userDeleted` flag; render tombstone card with userId + a "View row" link to a triage page.
- (c) Show userId in full as a `<code>` tag in the fallback.

**Recommendation.** (b) — filter at SQL, return a `userDeleted: true` flag, design a tombstone state. Anything less is a lossy audit trail.

**Status.** **RESOLVED 2026-05-16** — choice (b). Implementation in **bead Codex-biiqd**:
1. Add `isNull(users.deletedAt)` filter on the JOIN, OR project `users.deletedAt` and compute `userDeleted = u.deletedAt !== null` in the projection (preferred — keeps the row visible for audit).
2. Service returns `breakdown.userDeleted: boolean` + `breakdown.userIdLastChars: string` (last 6 chars).
3. `CreatorBreakdownCard.svelte` renders tombstone state when `userDeleted`: muted background, "Deleted creator (usr_…abc123)" title, no avatar, a "View source rows" link to a triage page (separate route — file follow-up bead for the triage page itself).
4. Component test (already landed for the fallback case in cycle 4) needs an it.fails marker flipped once the fix lands.

---

## DQ-12 — Source pills surface `sourceType` but not `payoutType`

**Context.** `CreatorBreakdownCard` shows pills labelled "purchases" / "subscriptions" (the `sourceType` axis). But the F-3 conflation bug means a creator who only ever received `organization_fee` rows shows £N "purchases" — which sounds like personal earnings.

Even after F-3 is fixed (excluding org_fee from totals), the rail still has no UI distinguishing "personal creator_payout" from "org admin slice routed via my Connect."

**Options.**
- (a) Add a third pill: "platform" / "org admin". Hide when the user is just a creator.
- (b) Two-tier rail: top section "Per-creator earnings", bottom section "Org admin slices".
- (c) Tooltip / drawer on a "?" icon explaining "These totals include £X of org admin slice routed via your Connect."

**Recommendation.** (b) for clarity, fall back to (a) if space-constrained. (c) is a UX bandaid.

**Status.** **RESOLVED 2026-05-16** — choice (b). Two-tier rail. Implementation order:
1. Backend (`getPayoutsByCreatorBreakdown`): project `creatorEarningsCents` (sum of `creator_payout` rows) AND `orgAdminSliceCents` (sum of `organization_fee` rows attributed to this userId). Note: DQ-8 excludes org_fee from `totalPaidCents` — this DQ adds the org slice back as a SEPARATE projected field.
2. UI top section "Per-creator earnings": iterate breakdown rows where `creatorEarningsCents > 0`.
3. UI bottom section "Org admin slices": iterate breakdown rows where `orgAdminSliceCents > 0` (often just the org owner). Render with a distinct heading + `Admin` badge from DQ-2.
4. Source pills inside per-creator cards stay as today (purchases / subscriptions = sourceType axis); the section split carries the payoutType axis.

---

## DQ-13 — `data-org-owner` attribute set but unused

**Context.** `CreatorBreakdownCard.svelte:57` sets `data-org-owner={breakdown.isOrgOwner ? 'true' : 'false'}` but no CSS selector references it. The `Badge` component handles the visible "Org owner" indicator. The attribute may be intended for E2E test selectors or future styling.

**Options.**
- (a) Remove the attribute (dead code).
- (b) Add a CSS rule: tint card background slightly when `data-org-owner='true'`.
- (c) Keep it for E2E selectors; add a `// kept for E2E tests` comment.

**Recommendation.** (a) unless an E2E test grep finds usage — keep the component lean. If the visual differentiation is wanted, do (b) explicitly.

**Status.** **RESOLVED 2026-05-16** — choice (a). Delete the `data-org-owner` attribute from `CreatorBreakdownCard.svelte:57`. DQ-2's resolution (Owner + Admin badges) replaces any visual need; cycle 4 F-18 audit confirmed no CSS selector references the attribute. Pre-deletion check: grep `apps/web/tests/` and `apps/web/e2e/` for `data-org-owner` — if a Playwright selector exists, switch the test to query by badge text/role first, then delete. Folds into the same PR as the Codex-h3864 (DQ-8) rail rendering changes.

---

## DQ-14 — £0.00 headline + needs-attention subline visual hierarchy

**Context.** A creator with ONLY pending/failed rows appears in the breakdown with `totalPaidCents=0` + `needsAttentionCount=N>0`. Card today leads with giant "£0.00" headline and de-emphasised "needs attention" pill. The £0.00 dominates but is the LEAST interesting number on the card.

**Options.**
- (a) When `totalPaidCents=0 && needsAttentionCount > 0`, swap hierarchy: lead with a prominent "Needs attention" callout (red surface), demote total to subline.
- (b) Suppress the £0.00 when zero AND there are pending rows; replace with the needs-attention count as headline.
- (c) Keep current; assume operators understand zero-totals.

**Recommendation.** (a) — pending money is the actionable signal; £0.00 is not. Operators triage by attention count, not by zero balance.

**Status.** **RESOLVED 2026-05-16** — choice (a). When `totalPaidCents === 0 && needsAttentionCount > 0`, swap card hierarchy: prominent "Needs attention" callout (red `--color-status-error` surface with the count, e.g. "3 pending — needs attention"), demote £0.00 total to a small subline. When `totalPaidCents > 0`, keep current layout. Add a Svelte 5 `$derived` for the swap predicate. No backend change.

---

## DQ-15 — Skeleton card count heuristic

**Context.** `CreatorBreakdownRail.svelte:59` hardcodes `Array(3)` skeletons. Orgs with 1 or 12 creators get a CLS layout shift.

**Options.**
- (a) Cache the prior creator count per orgId in localStorage; render that many skeletons. Cap at 10.
- (b) Render 1 skeleton + "loading more" indicator below.
- (c) Render an explicit "Loading breakdown for {creatorCountHint} creators" line.

**Recommendation.** (a) — same pattern as the rest of the studio's localStorage cache, simplest fix.

**Status.** **RESOLVED 2026-05-16** — choice (a). Implementation in **bead Codex-0sz4j**:
1. Per-orgId localStorage key (`payouts:rail:creator-count:${orgId}`) cached count from last server response.
2. On mount, read cached count (default 3 if missing). Render that many skeletons. Cap at 10 to bound DOM.
3. After server response arrives, update the cache with the new count.
4. Cleared on logout (use existing localStorage scope clearing hook).
5. Browser-guard the localStorage access per [[feedback_local_storage_browser_guard]] (skip if server-rendered / hydration mismatch).

---

---

## DQ-16 — Audit log for /payouts reads (defense in depth)

**Context.** The three payouts routes correctly enforce `requireOrgManagement` and scope by `ctx.organizationId`. There is no `obs.info` audit-log entry recording WHO viewed payouts WHEN. Financial-data reads — even by authorised owners — typically warrant a one-line breadcrumb for compliance + intrusion detection (post-breach forensics).

**Options.**
- (a) Add `this.obs.info('payouts.read', { orgId, userId, route, filterArgs })` at the head of each of the three service methods.
- (b) Route-level middleware: a `procedure({ audit: 'financial-read' })` option that emits a structured log entry uniformly across all financial-data routes (broader change).
- (c) Skip — accept that DB query logs at the Neon layer carry sufficient trail.

**Recommendation.** (a) as a one-line addition per service method. Cheap, immediately useful in incident triage. (b) is the right long-term shape but a bigger refactor.

**Status.** **RESOLVED 2026-05-16** — choice (a). Add `this.obs.info('payouts.read', { orgId, userId, route, filterArgs })` at the head of:
1. `SubscriptionService.listPayoutsByOrg` (the existing payouts list)
2. `SubscriptionService.getPayoutsByCreatorBreakdown` (PR-204 rail)
3. `SubscriptionService.getPayoutsSummary` (summary card)

The `route` field comes from the calling route's path (`/payouts`, `/payouts/by-creator`, `/payouts/summary`). `filterArgs` redacts any sensitive query params per `@codex/observability` PII redaction rules (none expected for payouts reads). Three-line change; folds into the next PR touching SubscriptionService.

**Future**: when worker-utils gets `procedure({ audit: 'financial-read' })` (option b), retire the per-service-method calls. Track that as a separate observability epic, not this fix.

---

---

## DQ-17 — Min-platform-fee floor: creators-first reduction order

**Context.** `applyMinPlatformFeeFloor` (revenue-calculator.ts:187-205) shifts the floor's shortfall by reducing creator pool FIRST, then org fee. Documented at L178-181: "the shortfall is taken from the creator pool first, then the org fee."

For a single-creator purchase this is one creator bearing the cost; for a multi-creator subscription invoice, ALL N creators share the burden (proportionally to their shareBps), while the org keeps its slice undamaged. The org owner benefits at every creator's expense whenever the platform's min-fee floor bites.

**Options.**
- (a) Current — creator pool first, then org. Org always defended.
- (b) Reversed — org first, then creator. Creators always defended.
- (c) Proportional — split the floor shortfall across creator pool + org by their share ratio.
- (d) Configurable per org / per fee config row.

**Recommendation.** (c) for fairness. Two creators in a multi-creator org shouldn't each lose £0.20 to a platform-floor enforcement while the org owner keeps £2.70 of org slice from the same invoice. Proportional is the policy that most product platforms (e.g. Patreon-style splits) use.

**Status.** **RESOLVED 2026-05-16** — choice (c). Rewrite `applyMinPlatformFeeFloor` (revenue-calculator.ts:187-205) to:
1. Compute the floor shortfall = `minPlatformFeeCents - platformFeeCents` (clamped to >=0).
2. Distribute the shortfall across creator pool + org slice proportionally to their pre-floor sizes: `creatorReduction = floor(shortfall * creatorPoolCents / (creatorPoolCents + orgFeeCents))`, `orgReduction = shortfall - creatorReduction`. Use integer math; residual cent goes to whichever side is larger to keep Σ exact.
3. Update existing tests pinning the "creators first" behaviour — invert/replace as proportional becomes canonical.
4. Add a multi-creator test: 4 creators each 25% share, low-value invoice triggers floor; verify each creator's payout slice is reduced AND org slice is reduced, proportionally.

---

## DQ-18 — Cumulative multi-creator rounding loss

**Context.** Two rounding events compound against creators in the multi-creator path:

1. `calculateRevenueSplit` (revenue-calculator.ts:104, 113) `Math.ceil`s both platform and org fees. Creator pool is exact remainder — already 0-2 pence smaller than the "fair" share.
2. `executeTransfers` (subscription-service.ts:4029) `Math.floor`s each per-creator share. Residual (up to N-1 pence) stays on the platform's Stripe balance with no ledger row.

For a 4-creator org on £20 invoices monthly, that's ~3p of rounding loss per invoice against creators × 1000 invoices/yr ≈ £30/yr the creator pool effectively gives away to the platform. Small per-invoice; compounds at scale.

Even the docstring of `calculateRevenueSplit` ("Round platform/org fees UP - platform/org get full cents. Creator gets exact remainder") doesn't acknowledge the multi-creator case where "creator" is the *pool*, not any individual.

**Options.**
- (a) Round-robin / largest-share-first residual distribution. The platform's `Math.floor` residual is allocated to the creator with the largest share (or rotated round-robin across creators across consecutive invoices).
- (b) Write a `platform_residual` payouts row for transparency — keep the money on the platform but record where it came from, so the ledger is complete.
- (c) Change `Math.floor` → `Math.round` per-creator. Some creators get +1 cent, others get –1 cent, evens out over time. Risks Σ > pool.
- (d) Accept the loss; update docstrings to make the multi-creator case explicit.

**Recommendation.** (b) is the minimum bar — full ledger completeness costs nothing. (a) is the right product fix if creators ever notice and push back. (d) without (b) leaves an opaque accounting gap.

**Status.** **RESOLVED 2026-05-16** — choice (b). Implementation:
1. Add `platform_residual` to the `payouts.payoutType` enum (migration + CHECK constraint update).
2. In `executeTransfers` and `writePurchasePayouts`, after the per-creator `floor()` splits, compute `residualCents = poolCents - Σ creatorSlices`. If `residualCents > 0`, write a payouts row with `payoutType='platform_residual'`, `userId=null` (permitted by `check_payouts_user_required` — platform_fee + platform_residual are the two exceptions), `amountCents=residualCents`, `sourceType` mirrors the originating invoice/purchase, `status='paid'` (money is on platform balance already, no transfer needed).
3. Add a tripwire test mirroring cycle 8's CHECK-constraint pattern: `check_payouts_user_required` accepts `payoutType='platform_residual'` with userId=null.
4. Update `getPayoutsByCreatorBreakdown` to exclude `platform_residual` rows from per-creator aggregation (similar to the DQ-8 `organization_fee` exclusion). Surface the residual in a separate org-level panel if visible at all (often not surfaced).
5. New bead: implement this in the same PR as the Codex-h3864 (DQ-8) fix since both add SQL exclusion filters on the same query.

---

---

## DQ-19 — Sales ↔ Payouts UX symmetry for multi-creator orgs

**Context.** PR-204 shipped a per-creator rail on `/studio/payouts` (money OUT). The sibling `/studio/sales` surface (money IN) remained org-aggregate-only and pre-dates PR-203. For a multi-creator org, the operator's two natural questions are:

- **Sales side**: "Which creator's content drove this month's revenue?"
- **Payouts side**: "Which creator owes me what for next transfer?"

Currently only the second has a UI answer. The first requires the operator to join `sales × content × creator` mentally because:

- `listSales` doesn't project `content.creatorId`
- `SaleListItem` has no creator field
- `getSalesStats` aggregates org-level only
- No `creatorId` filter on `listSales`

**Options.**
- (a) Mirror the PR-204 pattern verbatim on Sales: add `getSalesByCreatorBreakdown` + rail + creator filter + `creatorId` projection.
- (b) Lift the per-creator surface OUT of both pages into a new `/studio/creators/[id]` drill-down — single canonical place to view a creator's contribution across both directions.
- (c) Skip for now; Sales is owner-tier already, so worst case the owner can export and pivot in Excel.

**Recommendation.** (a) for ROI parity with Payouts — same pattern, low risk, immediate operator value. Bead Codex-y76g2 captures the implementation spec. (b) is a better long-term shape but a bigger refactor across two routes.

**Status.** Open. Implementation spec in bead Codex-y76g2 P2.

---

_Add new questions below; renumber if any are removed._
