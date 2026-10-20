> **Snapshot, 2026-10-19.** Evidence for [../architecture.md](../architecture.md): every open bead in the payments epic, read in full, mapped to a domain and a shared change. Bead state moves: re-check with `bd show <id>` before acting. Written by a read-only survey agent; not maintained. Since this snapshot: Codex-2hxff.50, .51 and .52 were filed from the code inventory.

# Payments epic Codex-2hxff ("Payments correctness"): open-work map

Prepared 2026-10-19 for the payments architecture design doc. Read-only: no bead or git state was changed.

**Sources.** `bd show` / `bd comments` for every child of the epic (49: 36 open, 13 closed) and for 17 related beads; the bug ledger and audit README in `docs/audits/payments-2026-10-13/`; `docs/payments/*.md` in that worktree; `release-checklist.md` from `origin/dev`.

**Code baseline.** The `a worktree of dev` worktree is at `4bd9e70b`. That commit is an ancestor of `origin/dev` (`f070a62b`), and the two differ only in `docs/payments/{README,status,release-checklist}.md`, so every `file:line` below matches dev code. Paths are relative to the repo root. Line numbers drift, so treat them as anchors.

**State of the epic.**
- PR #589 (beads .1–.5), #590 (.35) and #592 (.6, .11, .12, .37) are merged to dev.
- None of them is on main yet: merging dev→main is owner-only, and the release checklist has to run first.
- Bead notes and comments win over titles. Where code shows that a bead is partly done or stale, it says so in the table and in §5.

---

## 0. Domains

The table uses the lead's domains, plus two new ones.

**Access & entitlements (new).** .21, the access half of .8, .9, .10 and .14, and Codex-3wzpl / Codex-8ntg0 all change `@codex/access` (`access-decision.ts`, `entitlements-resolver.ts`, `library.ts`, `AccessRevocation`), not the money modules. These are "what the money buys" rules. The org-tier status predicate is copied in three places in `@codex/access`, so it deserves its own owner.

**Financial-record integrity (new).** .23, part of .46 (cascade on `organization_ownership_periods.user_id`), Codex-v1io7 and Codex-904q0 are about the data model: cascade FKs, one Stripe Customer per user, the GBP-only rule, and raw provider errors reaching clients. These cut across checkout, the ledger and refunds. In each of those domains they would be a footnote, so they would get lost.

**"Payee & ownership"** is used for ownership and the membership changes that move money (.36, .38, .39, .42, .44, .46; .18 secondary).

Domain abbreviations used in the table:

| Code | Domain |
|---|---|
| CHK | checkout & purchase |
| SUBS | subscription lifecycle |
| FEE | revenue split & fees |
| AGR | agreements |
| OWN | payee & ownership |
| LEDG | payout ledger & transfers |
| CLAW | refunds, disputes & clawback |
| HOOK | webhook ingestion & retry |
| CONN | Connect onboarding & payout release |
| RPT | reporting & admin read models |
| NOTIF | notifications |
| CFG | configuration & environments |
| TEST | test infrastructure |
| LEGAL | legal / policy |
| ACC | access & entitlements (new) |
| REC | financial-record integrity (new) |

---

## 1. Open beads

### 1a. Open children of Codex-2hxff (36)

| Bead | Plain title | P | Defect IDs | Behaviour change required | Modules / functions it touches | Domain |
|---|---|---|---|---|---|---|
| Codex-2hxff.7 | Fee config and the minimum platform fee apply to every real sale | P1 | PAY-02, SUB-01, PAY-13, P-7, SUB-18 (shared with .13), CFG-06 | Webhook, cron and request paths all resolve fees through FeeConfigService (override → org → platform → constants), apply `max(percent, minPlatformFeeCents=25)`, and get the same mailer and webAppUrl wiring as the service registry. Owner comment: 25p floor, `minTransferCents=0`; worked example £1.00 = platform 25p / org 9p / creator 66p. | Hand-built services with no `feeConfig`: `workers/ecom-api/src/handlers/checkout.ts:210,:323` (`PurchaseService`), `payment-webhook.ts:268` (`PurchaseService`), `:272` (`SubscriptionService`), `subscription-webhook.ts:232` (`SubscriptionService`), `payouts-sweep.ts:68`, `connect-webhook.ts:122`. The registry is the reference: `packages/worker-utils/src/procedure/service-registry.ts:792–1106`. Fee fallbacks: `PurchaseService.completePurchase` (purchase-service.ts:559, constants at :624), `completeCoursePurchase` (:1049, :1088), `SubscriptionService.resolvePayoutFees` (subscription-service.ts:659), `computeSubscriptionSplit` (:701). Floor: `applyMinPlatformFeeFloor` (purchase/src/services/revenue-calculator.ts:187). Also `AgreementService` WEB_APP_URL (CFG-06). **Partly done:** the course-subscription webhook already gets a FeeConfigService (subscription-webhook.ts:265–275). | FEE (CFG, NOTIF) |
| Codex-2hxff.8 | Partial refunds keep access and claw back each increment; failed reversals are retried | P1 | PAY-03, PAY-04, PAY-11, PAY-12, PAY-18, PAY-19, SUB-08, X-03, P-1 | Only a FULL refund removes access. Each partial refund reverses its own increment, not cumulative `amount_refunded`. A non-insufficient-funds reversal failure stays retryable, never "reversed". Insufficient funds writes `refund_reviews`. One-off refunds write the AccessRevocation key. `charge.refunds` is expanded. A course refund before completion is kept. Refund emails are sent once with correct content. Same fixes on the subscription twin. | `PurchaseService.processRefund` (purchase-service.ts:1847), `reversePayoutsForPurchase` (:1986), `recordRefundReview` (:2172); `SubscriptionService.reverseSubscriptionPayoutsForCharge` (subscription-service.ts:4362); `cancelUnpaidPayoutForRefund` (purchase/src/utils/payout-ledger.ts:663); `handleChargeRefunded` (ecom-api payment-webhook.ts:146); `AccessRevocation` (@codex/access access-revocation.ts); `refund_reviews` schema (database/src/schema/refund-reviews.ts:34). Related: Codex-in0g4. | CLAW (ACC, NOTIF) |
| Codex-2hxff.9 | Disputes pause access, reverse slices, hold pending money, and restore on a win | P1 | PAY-05, PAY-06, PAY-17, P-2 | On `charge.dispute.created`: pause access, reverse creator/org transfers in proportion, hold pending rows. On won: restore access and re-send transfers. On lost: the reversal stands; the platform pays the dispute fee. Applies to one-off sales and subscription invoices. Owner note: on `radar.early_fraud_warning.created`, auto-refund IN FULL, idempotent per warning. | `PurchaseService.processDispute` (purchase-service.ts:2244); payment-webhook.ts `handleChargeDisputeCreated` (:200) and the event switch (:278–:282), which needs new `dispute.updated/closed` and `radar.early_fraud_warning.*` cases; drain eligibility `isDrainablePayout` (payout-ledger.ts:169) must skip disputed rows; the library query (`packages/access/src/services/content-access/library.ts`) must read `disputedAt`; the subscription-invoice path in subscription-service.ts. | CLAW (ACC, HOOK) |
| Codex-2hxff.10 | Access continues during failed-renewal retries; a full refund of the latest payment cancels the subscription | P2 | P-3, P-4 | Org tiers grant on `past_due`, as course plans already do. Stop writing the streaming revocation key on `invoice.payment_failed`; revoke only when Stripe gives up (deleted or unpaid). A full refund of the latest subscription invoice cancels the subscription immediately and ends access; a partial refund leaves it running. | Org-tier granting statuses, in three copies: `access-decision.ts:224`, `entitlements-resolver.ts:54`, `content-access/library.ts:205,:735`. Course plans: `GRANTING_STATUSES` (course-subscription-service.ts:86). `revokeAccess(c, …, 'payment_failed')` (subscription-webhook.ts:425, :688; def :100). Refund→cancel in payment-webhook `handleChargeRefunded` (:146) and `SubscriptionService` cancel. | SUBS (ACC, CLAW) |
| Codex-2hxff.13 | Parked payouts are released as soon as the payee becomes payable | P2 | SUB-05, SUB-21, SUB-15, SUB-18 | `account.updated` for per-user accounts (no org metadata) drains all of that payee's pending rows, and so does `POST /connect/me/sync`. The `payout-released` email is sent. The hourly sweep becomes a bounded, locked safety net. The connect-webhook test must run WITHOUT injected org metadata. | `connect-webhook.ts:28` requires `codex_organization_id`; `:118–128` calls `resolvePendingPayouts(orgId, …)`. Accounts are created with `codex_user_id` only (`ConnectAccountService` connect-account-service.ts:228/:242); see also `handleAccountUpdated` (:484). `/me/sync` → `syncAccountStatusForUser` (ecom-api routes/connect.ts:120), which needs to drain. `SubscriptionService.resolvePendingPayouts` (subscription-service.ts:3547), `sweepUnresolvedPayouts` (:4949), `payoutMailer` (:571/:629, never passed). **Partly superseded by #592:** drains now claim and lease rows (`claimPayoutAttempts`, `renewPayoutAttempt`) and write `retry_count`/`last_retry_at`. | CONN (LEDG, NOTIF) |
| Codex-2hxff.14 | Checkout only for content a purchase can unlock; no double purchases | P1 | PAY-09, PAY-10, PAY-20 | Offer checkout only when content is purchasable AND its access rule honours a purchase (not course-only, team or followers-only). The publish gate requires payable Connect for any priced content. Checkout sessions get an idempotency key and `expires_at`. One completed purchase per buyer per item; a duplicate payment is auto-refunded. Only `payment_status=paid` completes a purchase. | `PurchaseService.createCheckoutSession` (purchase-service.ts:295, `sessions.create` :433) and `createCourseCheckoutSession` (:895, :965); `decideContentAccess` (access/src/services/content-access/access-decision.ts:388, branches :260/:267/:280/:311); the content-service publish gate (content-service.ts ~:840, `isPurchasable && price`); the booking handler (ecom-api checkout.ts, no `payment_status` check); a unique (customer, content) constraint in `database/src/schema/ecommerce.ts`. | CHK (ACC) |
| Codex-2hxff.15 | Our subscription row always follows Stripe; duplicates are cancelled and refunded | P1 | SUB-07, SUB-09, SUB-11, SUB-12, SUB-13, SUB-19, SUB-20 | Detect, cancel and refund a second concurrent Stripe subscription; never bill it silently. Self-heal and invoice success follow Stripe's status. `subscription.deleted` leaves a tombstone that late events respect. Amounts come from the subscription price, not proration invoices. `prorationDate` is issued and checked by the server. Idempotency keys are deterministic per logical operation (resume per pause cycle; tier/course Stripe creates). Fix the SUB-20 reporting oddities, including `platform_fee` counted in org `totalEarned`. | `uq_active_subscription_per_user_org` (database/src/schema/subscriptions.ts:169); `SubscriptionService.handleSubscriptionCreated` (:1293), `handleInvoicePaymentSucceeded` (:1465), `handleSubscriptionUpdated` (:1819), `handleSubscriptionDeleted` (:1901), `previewTierChange` (:2177, server `prorationDate` :2229), `changeTier` (:2288, client `prorationDate` :2293/:2344), `resumeSubscription` (:2574); `TierService.createTier` (tier-service.ts:188); course create keys in course-subscription-service.ts. Related: Codex-sing6, Codex-cbbet. | SUBS (RPT) |
| Codex-2hxff.16 | Downgrades take effect at period end; tier reorders warn first | P2 | P-5, P-8 | A downgrade keeps the higher tier until the paid period ends; upgrades stay immediate with proration. A reorder (`sortOrder` is the access hierarchy) shows how many subscribers gain or lose access and requires confirmation. | `SubscriptionService.changeTier` (subscription-service.ts:2288) downgrade branch; `TierService.reorderTiers` (tier-service.ts:690); new Studio reorder dialog (new UI, so mockup first). The bead's SHAPE line says "subscription schedules = same machinery as the price-change fix". That is **stale**: the price change shipped as a deferred swap on Stripe metadata (`schedulePriceChange` / `applyDuePendingPriceChange`, packages/subscription/src/services/pending-price-change.ts:79/:184), and no `subscriptionSchedules` code exists. | SUBS |
| Codex-2hxff.17 | An agreement keeps paying after its review date | P1 | AGR-01, AGR-03 | The term becomes a "review by" date, not an expiry: the agreement pays until either side terminates (allowed any time) or a renegotiation replaces it. The expiring-soon email becomes a review reminder. Share-headroom validation counts only agreements live now. | `AgreementService.computeEffectiveUntil` (agreements/src/services/agreement-service.ts:1910, used at :644); `fetchExistingActiveShares` (:1871); the `effectiveUntil` predicate in `findActiveCreatorAgreementShare` (purchase/src/services/agreement-share.ts:39–75) and in the inline lookup in `SubscriptionService.executeTransfers` (subscription-service.ts:4550, query ~:4618–4640); `workers/notifications-api/src/handlers/agreement-expiring-sweep.ts` (copy). | AGR |
| Codex-2hxff.18 | Removing a creator from an organisation ends their agreements | P1 | AGR-09 | Removal or leaving terminates the member's agreements at that moment and sends the termination email; money earned before removal still drains to them. The payout agreement lookup also requires active membership. | `OrganizationService.removeMember` (organization/src/services/organization-service.ts:1143) and any leave path; `AgreementService.terminateAgreement` (agreement-service.ts:890); a membership join in both agreement lookups (agreement-share.ts:39; subscription-service.ts executeTransfers ~:4628). | AGR (OWN) |
| Codex-2hxff.19 | One agreement resolver for every payment path | P2 | AGR-04, AGR-05, AGR-06, AGR-07, AGR-08, AGR-12, AGR-13 | One shared resolver, used by every path at the sale's own timestamp, reading the canonical share column, deterministically ordered and deduped per creator, with sum(shares) ≤ 100% enforced under concurrency. Each sale records the agreement it used (`purchases.creator_org_agreement_id` / `platform_agreement_id`). `proposeAgreement` takes the lock its docs claim. | **Two lookups exist today:** `findActiveCreatorAgreementShare` (agreement-share.ts:39, INNER JOIN + `.limit(1)` with no `orderBy`, i.e. AGR-05 still present), used by `completePurchase`, `completeCoursePurchase` and `CourseSubscriptionService.writeCoursePayouts` (course-subscription-service.ts:1196); and the inline leftJoin query in `executeTransfers` (subscription-service.ts ~:4618). Also `proposeAgreement` (agreement-service.ts:268), the accept path, and the AGR-08 legacy-column reads (termination emails, `/me` aggregates). **Partly done:** AGR-07 for one-off and course purchases, which now pin `at = metadata.paidAt` (purchase-service.ts:657, :1094; commit d190e79c in #589). | AGR (FEE) |
| Codex-2hxff.20 | Revenue screens and agreement emails show real numbers and working links | P2 | AGR-02, AGR-10, AGR-11, AGR-14, WEB-02 | Show each creator's real share, not `10000 − share`. Charts plot post-platform shares on the post-platform pool with the configured fee. The revenue headline counts every revenue type. Agreement emails deep-link to pages that exist for each recipient. Admins see only actions they can take. | `AnalyticsService.getRevenueByCreator` (admin/src/services/analytics-service.ts:1033, legacy `organizationFeePercentage` :1050) and its test; the agreement email path `/studio/negotiations/${threadId}` (agreement-service.ts:1553); Studio revenue-share pie charts and page actions (`apps/web/src/routes/_org/[slug]/studio/monetisation/revenue-share/`); Studio billing headline (`studio/billing/+page.svelte`, `getOrgRevenue`). | RPT (NOTIF, AGR) |
| Codex-2hxff.21 | Support grants give access; orgless sales get entitlements; course purchases appear in history | P1 | X-02, PAY-14 (= X-01), PAY-24 | An admin complimentary grant writes a `grant` entitlement. Every completed purchase, org or orgless, writes its entitlement and appears in the seller's sales. `GET /purchases` lists content AND course purchases using `withPagination`. | `CustomerManagementService.grantContentAccess` (admin/src/services/customer-management-service.ts:324; route admin-api index.ts:502); `entitlement-writer.ts` `writeContentPurchaseEntitlement` (:53) / `writeCoursePurchaseEntitlement` (:78); `entitlements.organizationId NOT NULL` (database/src/schema/entitlements.ts) needs a migration; `PurchaseService.getPurchaseHistory` (purchase-service.ts:1585; route ecom-api routes/purchases.ts:57), `listSales` (:2571), `getSalesStats` (:2695). Related: Codex-3wzpl (EntitlementsService unused). | ACC (RPT) |
| Codex-2hxff.22 | Purchase success pages wait for our purchase record | P2 | WEB-01, WEB-03, WEB-04, WEB-05, WEB-06 | After Stripe returns, poll until OUR purchase or subscription row exists (bounded, with a "still processing — we'll email you" state), then refresh the library and subscription collections. Every return path lands on a verifying page. A failed history load shows an error, not an empty list. `openBillingPortal` gets the `.stripe.com` host check. | `CheckoutSuccess.svelte` (apps/web/src/lib/components/ui/CheckoutSuccess/, `isComplete` :40); player-paywall `successUrl` (apps/web/src/lib/remote/checkout.remote.ts:45, `/library?purchase=success`); `openBillingPortal` (account.remote.ts:421; the portal form guard is at :392); purchase-history load; `GET /checkout/verify`. New "processing" state, so mockup first. Related: Codex-gvx03. | CHK (ACC) |
| Codex-2hxff.23 | Financial records are permanent; one Stripe Customer per user; GBP asserted everywhere | P2 | PAY-16, PAY-21 (= X-04), PAY-22 (env half done by .5), PAY-23, PAY-25, SEC-02 | Purchases, payouts and refund records are never cascade-deleted (RESTRICT or anonymise). A Customer is never adopted by email from another user. `stripe-customer-integrity` is wired or deleted. `assertGbpOnly` runs at the purchase transfer site. The fee audit log records only real changes. No raw Stripe text in client error context. | Cascade FKs: `database/src/schema/ecommerce.ts:31,:34,:41,:194,:208,:308,:424…`, `payouts.ts:41,:46`; `resolveOrCreateCustomer` (purchase/src/services/resolve-customer.ts:93, email match :114); `findUsersByStripeCustomerId` / `findStripeCustomerCollisions` (stripe-customer-integrity.ts:45/:86, no caller); `assertGbpOnly` exists only in subscription-service.ts:3970 and needs a shared copy; FeeConfigService write audit (fee-config-service.ts:216/:278/:356); `SubscriptionPaymentRequiredError` context (subscription-service.ts:2388). | REC (CHK) |
| Codex-2hxff.24 | Dev and CI Stripe setup mirrors production; the customer webhook stub is removed | P3 | CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-07, CFG-10 | Dev and CI endpoints mirror production's endpoints, scopes and events. The dev router routes every event production handles. Remove the customer route and its secret. Declare `API_URL` under `env.production`. Bump stripe@19.3.1. Seeds and the e2e helper pin `apiVersion`. Seeds use the real split and seed agreements. | `.github/scripts/setup-stripe-dev-webhooks.sh:37` (connect endpoint, no `--connect`); `workers/ecom-api/src/utils/dev-webhook-router.ts:50–63` (no `product.`/`price.`); the customer route (ecom-api `middleware/verify-signature.ts:31`, `index.ts:95,:199`); `workers/ecom-api/wrangler.jsonc` `API_URL` (:100/:113, not in env.production); seed scripts in `packages/database/scripts/seed/`. | CFG |
| Codex-2hxff.25 | CI exercises real signed webhook round trips | P2 | TEST-01 | E2E covers purchase completion → entitlement → payouts, refunds (full and partial), dispute, subscription create/renew/cancel, drain on Connect activation, an agreement split, and an admin grant. Events are signed with `STRIPE_WEBHOOK_SECRET_*` (HMAC over `"<t>.<body>"`, proven against prod 2026-10-13). | New signed-event helper under `apps/web/e2e/` and `e2e/`; CI job envs in `.github/workflows/testing.yml` and `e2e-api-fast.yml`. Constraints: one PR in CI at a time, no E2E sharding, no paid Neon. Related: Codex-chh3e, Codex-vas3y. | TEST |
| Codex-2hxff.28 | Support issues refunds from an admin screen, within 14 days | P2 | (owner decision; no ledger ID) | Platform support only. A platform-owner admin-api route calls `stripe.refunds.create` (full or partial, with a reason, deterministic idempotency key), enforcing the 14-day window. The resulting `charge.refunded` webhook drives access, clawback and emails exactly like a Dashboard refund. The `refund_reviews` ops surface lives on the same screen. | New admin-api route (`policy: { auth: 'platform_owner' }`) plus admin UI; search over purchases and subscriptions; shows the split and what would be clawed back. No `refunds.create` exists in production code today. New UI, so mockup + data design reviewed BEFORE code. | CLAW (RPT) |
| Codex-2hxff.29 | Creators' bank payouts are held for the 14-day refund window | P2 | (owner decision) | Connected accounts get a platform-controlled payout schedule (e.g. daily with `delay_days` 14; check Stripe's GB limits), set at `accounts.create` and backfilled with `accounts.update`. Schedule editing is turned off in the Express Dashboard ("Bank account only"). | `ConnectAccountService` `accounts.create` (connect-account-service.ts:228); a backfill script; Stripe Dashboard Express settings (operations.md). | CONN (CLAW) |
| Codex-2hxff.30 | Clawback shortfalls are recovered from the creator's future earnings | P2 | (owner decision; ties to X-03) | Before transferring a payee's slice (sale time or drain), net off their open debts and record each deduction against its `refund_reviews` row. Owner comment: total open debt ≤ £50 not recovered in 12 months → written off (`platform_absorbed`); > £50 not recovered in 90 days → the WHOLE amount is invoiced to the creator. The creator is told at each step; debts and deductions show in their earnings. | Payout ledger transfer path (`recordSlice` :211 / `settleTransfer` :425 in payout-ledger.ts; the drains in `resolvePendingPayouts`); the `refund_reviews` schema and a resolution enum; a new write-off/invoice job (cron); earnings view (web); emails. Depends on .8 and Codex-in0g4. | CLAW (LEDG, NOTIF) |
| Codex-2hxff.32 | Every one-off content and course price is at least £1.00 | P1 | (owner decision; Stripe minimum £0.30) | **Narrowed (comment):** tiers and course plans already enforce `min(100)`. The gap is one-off CONTENT and COURSE prices, which use `priceCentsSchema` (`.min(0)`, "$100,000" message) with only a `> 0` refinement. Reuse the £1 rule and message, re-check server-side at checkout, and report existing rows under 100p. £0 stays refused. | `priceCentsSchema` (validation/src/primitives.ts:227); `content-schemas.ts:431,:584` (`> 0` refinements); journeys `oneOffPriceCents` (schemas/journeys.ts:563) needs checking too; checkout re-check in `createCheckoutSession`. | CHK (FEE) |
| Codex-2hxff.33 | A fee increase applies 30 days after an email; a decrease applies at once | P2 | (owner decision "Rises 30 days, cuts now") | Fee rows gain `effective_from`, and FeeConfigService resolves the row in force at the sale time (payment time / invoice `created`, the same `at` the agreement resolver uses). A raising write is stored at now + 30 days and emails every affected payee; a lowering write applies at once. Both are audited. | `fee_config_*` tables (database/src/schema/fee-config.ts); `FeeConfigService` (purchase/src/services/fee-config-service.ts:161, `getFeesForCreator` :173 needs an `at` argument; writes :216/:278/:356); admin-api `/api/admin/fees/*`; a new email template. Ships best with Codex-rtwpv (atomic writes). | FEE (NOTIF) |
| Codex-2hxff.34 | Creators are reminded monthly about money waiting for them | P3 | (owner decision "Hold and remind"; subject to lawyer note P5) | A monthly job on the existing notifications-api daily cron (`0 8 * * *`, production only) emails each creator with pending rows older than 30 days and no payable account, deduped per month, using template `payouts-waiting`. | `workers/notifications-api/wrangler.jsonc:174` cron; a new handler next to `agreement-expiring-sweep.ts`; a sent-at record (new column or table); reads `payouts` pending rows. | NOTIF (CONN) |
| Codex-2hxff.36 | Drop the retired organisation Connect pin column | P3 | (follow-up to .2; data-design §3d) | Run report R3 against production and keep the output, then drop `organizations.primary_connect_account_user_id` and its FK. Remove the schema field, the factory default and the "ignores the retired pin" test. | `database/src/schema/organizations.ts:40`; `test-utils/src/factories.ts`, `database.ts`, `subscription-factories.ts`; `purchase/src/__tests__/resolve-organisation-payee.integration.test.ts`; `connect-account-service.test.ts`; a new migration. No `payments` label. | OWN |
| Codex-2hxff.38 | A demote or remove racing an ownership accept can leave an org with no active owner | P2 | (PR #589 review) | The owner guard becomes atomic: add `ne(role,'owner')` to both UPDATE WHEREs and throw `OwnershipTransferRequiredError` on 0 rows (or `SELECT … FOR UPDATE`). Add a concurrency test. | `OrganizationService.updateMemberRole` (organization-service.ts:1058, guard :1071–:1081), `removeMember` (:1143, :1146–:1153), `findMembershipOrThrow` (:1416). | OWN |
| Codex-2hxff.39 | Ownership-period fallback pays the first owner for any uncovered sale time | P3 | (PR #589 review) | **Superseded by #592.** `resolveOrganisationPayee` no longer has an "earliest period" fallback. An uncovered `at` now goes to the NEXT owner (or is held as `no_owner`), by owner decision 2026-10-18, and logs a warning. Candidate to close; see §5. | `resolveOrganisationPayee` (purchase/src/utils/resolve-organisation-payee.ts:64, branches :86–:130). | OWN |
| Codex-2hxff.40 | Course-plan price-change email quotes the plan's old list price as the subscriber's current price | P2 | (PR #589 review) | The email's "from" figure is each subscription's live item `unit_amount`, which `schedulePriceChange` already retrieves, not the plan's previous list price. | `CourseSubscriptionService` price-change fan-out (course-subscription-service.ts ~:593–:640, `oldPriceFormatted` built from `move.oldAmountCents`); `schedulePriceChange` (pending-price-change.ts:79). | NOTIF (SUBS) |
| Codex-2hxff.41 | The secrets upload script can overwrite the prod portal configuration id with an empty string | P2 | (PR #589 review) | Fail fast (`${STRIPE_PORTAL_CONFIGURATION_ID:?}`) like the other required secrets. | `.github/scripts/upload-worker-secrets.sh:98`. | CFG |
| Codex-2hxff.42 | A failed ownership-offer banner read redirects a legitimate owner to access_denied | P2 | (PR #589 review) | Isolate the banner read in `getMyMembership` (catch, log, return no offer) so membership never depends on it. | `OrganizationService.getMyMembership` (organization-service.ts:856, `getPendingOwnershipOffer` call ~:886); `getPendingOwnershipOffer` (ownership-transfer.ts:167). | OWN |
| Codex-2hxff.43 | A missing mailer or subscriber email skips the 30-day price-change notice silently, yet the price still moves | P2 | (PR #589 review) | Log at error with the subscription id. **Needs an owner decision:** should a move proceed when no notice was sent? | `SubscriptionService` tier fan-out `if (!this.mailer) return;` (subscription-service.ts:4231); `CourseSubscriptionService` `if (!this.mailer \|\| !row.userEmail) continue;` (course-subscription-service.ts:619). | NOTIF (SUBS) |
| Codex-2hxff.44 | The membership-cache delete after an ownership move swallows failures | P3 | (PR #589 review) | `obs.warn` with org and user ids. Move `invalidateMemberCaches` into `@codex/worker-utils` so the admin reassign stops duplicating it and also gets the org-slug invalidation. | `workers/organization-api/src/utils/membership-invalidation.ts:65` (catch), `:97` (`invalidateMemberCaches`); `workers/admin-api/src/index.ts:737`. | OWN |
| Codex-2hxff.45 | A rejected payout-status query shows "Not connected" and the set-up CTA to a fully set-up owner | P2 | (PR #589 review) | Branch on the query's `.error` and show a load-failed state; this is the rejected-remote-query trap. | `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte` (~:98; loading gate :163–:165); `studio/subscribers/+page.svelte` (~:127; :165–:170). | CONN (web) |
| Codex-2hxff.46 | PR #589 review: low and nit follow-ups (bundle of 13) | P3 | (PR #589 review) | (a) One lock order, or map 40P01 to `OwnershipOfferNotOpenError`. (b) Don't log the support reason verbatim. (c) `GET /connect/organization-status` restricted to owner, admin and creator. (d) Reassign checks the org exists and is not deleted. (e) Accept calls `invalidateMemberCaches` once. (f) `userIdSchema` for recipient and reassign ids. (g) InternalServiceError, not 409, for an empty RETURNING. (h) Parallelise `getOwnershipView`. (i) `organization_ownership_periods.user_id` cascade. (j) Seed periods predate seeded purchases. (k) Tier fan-out has no retry. (l) Empty catches in `ownership.remote.ts`, `OwnershipCard.svelte` and `send-email.ts`. (m) A throw after commit. | `packages/organization/src/services/ownership-transfer.ts` (~:209 view, ~:576, ~:651 accept, :730 reassign); `workers/admin-api/src/index.ts` (~:725); `workers/ecom-api/src/routes/connect.ts:42`; `packages/validation/src/schemas/organization.ts:57,:72`; `database/src/schema/organization-ownership.ts`; `organization-api/src/routes/ownership.ts:159–160`. Items (i) and (k) belong in other clusters; see §2. | OWN (REC, NOTIF) |
| Codex-2hxff.47 | A payout transfer to a payee's replaced Connect account is not found, so the drain pays again | P3 | (PR #592 review) | Keep previous account ids per user when an account is replaced. Search them too, both when reconciling rows with an attempt on record and when a refund looks for a transfer to reverse. | `findTransfersForPayouts` (purchase/src/utils/payout-ledger.ts:734); `cancelUnpaidPayoutForRefund` (:663); account replacement in `ConnectAccountService`; a new account-history store. No labels. | LEDG (CONN) |
| Codex-2hxff.48 | Failed payout rows retry forever with no cap, terminal state or recorded reason | P3 | (PR #592 review) | Store the Stripe error code and type (or keep a `payout_attempts` log). A permanently failed row moves to a terminal needs-review state with one `obs.error` carrying an errorId; escalate past a retry threshold. **Needs an owner decision:** what the terminal state is and who reviews it. | `markPayoutFailed` (payout-ledger.ts:543, writes only `reason='transfer_failed'`); `payouts.reason` CHECK (migration 0099 enum: connect_not_ready, connect_restricted, transfer_failed, min_transfer_floor, no_owner); the drains and sweep. No labels. | LEDG |
| Codex-2hxff.49 | A replayed invoice re-splits with the current fee config, so one charge's slices can come from two splits | P3 | (PR #592 review) | Pin the fee configuration to `invoice.created` (as agreements and the owner already are), or derive the remaining slices from gross minus the slices already recorded. | `SubscriptionService.handleInvoicePaymentSucceeded` (:1465) → `computeSubscriptionSplit` (:701) → `resolvePayoutFees` (:659); `CourseSubscriptionService.writeCoursePayouts` (:1152) → `getFeesForCreator`. This is the same `at`-pinning as .33. No labels. | FEE (LEDG) |

### 1b. Related open beads outside the epic

The first eleven are the ones `docs/payments/status.md` names.

| Bead | Plain title | P / status | Behaviour change | Where | Domain | Note |
|---|---|---|---|---|---|---|
| Codex-in0g4 | Refund reviews can hold subscription clawback debts | P2 open | `refund_reviews.purchaseId` becomes nullable, a nullable `subscriptionId` is added with an exactly-one CHECK, and the subscription insufficient-funds branch writes a row instead of only logging. | database/src/schema/refund-reviews.ts; `recordRefundReview` (purchase-service.ts:2172); `reverseSubscriptionPayoutsForCharge` (subscription-service.ts:4362) | CLAW | Prerequisite for .30 on subscriptions; .8 names it. |
| Codex-rtwpv | Fee configuration writes are not atomic | P2 open | Wrap upsert + audit-log in `db.transaction`; cache invalidate stays fire-and-forget. | fee-config-service.ts `updatePlatformFees` :216, `updateOrgFees` :278, `deleteOrgFees`, `upsertCreatorOverride` :356, `deleteCreatorOverride` | FEE | Same write paths as .33 and PAY-16 (.23). |
| Codex-sing6 | Tier-change UX & billing correctness (epic) | P1 open | Phase 2: pending tier columns, schedule-based downgrades, `subscription_schedule.*` handlers, banner, cancel-pending. | subscription-service.ts `changeTier`; subscription-webhook.ts | SUBS | Its note says to build schedules once and reuse them for price changes. That is stale (§5). Phase 2 beads Codex-6mdyn, -9ojum, -pfi39, -ff6mo and -h2u4c are standalone (not parented). |
| Codex-1ilxl | Stripe seed cleanup archives every environment's seed objects | P1 **in_progress** | Namespace seeds per environment. | seed scripts | CFG | **Closable:** PR #549 (`134b7ba5`) is on dev AND main, but the bead is still in_progress. |
| Codex-xyb7v | Desktop admin app for platform fee config (epic) | P2 open | Future app: edit fees, view the audit log, dry-run impact. | admin-api `/api/admin/fees/*` | FEE (RPT) | Auth approach TBD. A dry-run calculator would want the single split calculator (§2 C2). |
| Codex-gvx03 | The billing-portal form echoes the raw Stripe error into the page | P1 open | `account.remote.ts` returns a fixed message and logs the raw one; fix `(platform)/account/payment/+page.svelte:123`. | apps/web/src/lib/remote/account.remote.ts ~:398–405 | REC (web) | Sibling of SEC-02 (.23) and Codex-nr7ie. |
| Codex-chh3e | Payout E2E flows are skipped in CI | P2 open | Pass `_CONNECT`/`_PAYMENT` secrets and repair the test-1 bodies. | e2e/tests/11-payout-flows-*.test.ts; testing.yml, e2e-api-fast.yml | TEST | Overlaps .25; reuse its signed-event helper. |
| Codex-vas3y | Re-enable skipped subscription E2E specs | P2 **in_progress since 2026-04-29** | Re-enable pricing-reactivate; decide on a test-hook strategy for revocation and pause specs. | apps/web/e2e/*.spec.ts | TEST | Stale in_progress. The webhook bridge option overlaps .25. |
| Codex-equ4i | Test fixtures create priced-but-free content | P2 open | Only fixture hygiene is left (~45 admin fixtures + content integration test); coverage question answered; divergence split out to Codex-al9ft (closed). | packages/admin, packages/content tests | TEST | Title overstates the remaining scope. |
| Codex-2f3wk | Payout-drain residuals 1–3 | P2 open | (1) A null guard before org payee resolution in `writePurchasePayouts`. (2) `executePurchaseTransfer` param typing. (3) Sweep counter dedupe. | purchase-service.ts `writePurchasePayouts` :1267; subscription-service.ts `sweepUnresolvedPayouts` :4949 | LEDG | **Probably stale after #592:** `executePurchaseTransfer` no longer exists (the ledger owns transfers) and `resolvePrimaryConnect` was replaced by `resolveOrganisationPayee`. Re-verify each item. Item 4 went to Codex-up7bx (closed). |
| Codex-ev3k | Webhook lifecycle hygiene (epic) | P1 open | — | — | HOOK | **Closable:** all 5 listed tasks (wqb5, hk2k, sndq, hj4d, 69pb) are closed, and .6 (#592) did the transient classification. |
| Codex-257ia | One record per Stripe event id makes webhook side effects idempotent | P2 open | One row per Stripe event id; gates side effects such as emails and cache bumps. | ecom-api webhook-handler.ts `createWebhookHandler` :64 | HOOK | Fixes the class behind PAY-19 (.8 duplicate emails) and the dedupe .9's early-fraud handling and .34 need. |
| Codex-nm5mb | Portal purchases never reach sales or payouts | P1 open | The owner wants the revenue-attribution model planned first. | purchase/subscription split + reporting | FEE (RPT) | Open owner decision; affects the split calculator. |
| Codex-v1io7 | Full account-deletion data lifecycle | P1 open | Design investigation: buyers keep access permanently, grace window, ownership. | identity, purchase, organization | REC | Interacts with .23 (RESTRICT vs anonymise). |
| Codex-904q0 | Org ownership transfer and teardown on account deletion | P2 open | Teardown/transfer path; cancel active subscriptions on deletion. | organization, ecom-api | OWN / REC | Its transfer half is now built by .2 (#589); re-scope. |
| Codex-cbbet | Subscription invoices ledger and tier price history (epic) | P2 open | Per-invoice snapshot of the split, price history, rounding dust. | subscription schema | FEE / SUBS | Same root as .49 and SUB-11 (.15). PR #592 now records per-slice ledger rows per charge, so re-scope. |
| Codex-4r55k / Codex-xjxw6 | Unified payouts ledger: drop the legacy `pending_payouts` table | P2 / P3 open | — | database/src/schema/subscriptions.ts:289 (`pending_payouts` still present) | LEDG | The `payouts` table exists, and #592 made it the single ledger. Only the drop and cleanup (xjxw6) look left. |
| Codex-xymq6 | Charge dedupe and unique index on `pending_payouts` | P2 open | — | — | LEDG | **Likely superseded** by migration 0099's `uq_payouts_creator_slice_per_charge` / `uq_payouts_org_slice_per_charge` on `payouts`. |
| Codex-r8932 | Course-subscription payout writer TOCTOU unique guard | P3 open | — | — | LEDG | **Likely superseded** by 0099 (same indexes), if course-subscription rows carry `stripe_charge_id`. Verify. |
| Codex-k9qpd | Collapse the copy-pasted transfer blocks in `executeTransfers` | P2 open | Extract one transfer executor. | subscription-service.ts `executeTransfers` :4550 (8 `transfers.create` sites vs 1 in payout-ledger.ts) | LEDG | Same cluster as the reversal and transfer engine (§2 C4/C5). |
| Codex-itvh8 | Batch the per-creator fee lookups in `executeTransfers` | P2 open | The note says a naive batch would create a second fee path, i.e. money-misroute risk. | subscription-service.ts | FEE | Fold into the single split calculator (C2). |
| Codex-xz61z | Agreement payout polish | P2 **in_progress since 2026-05-17** | I2 (owner-fallback duplicated), I5 (pin Date once), I6 (use `getActiveAgreement`). | subscription-service.ts | AGR | Stale in_progress; overlaps .19. |
| Codex-8ntg0 | Subscription cancel leaves the member's cached role in KV | P2 open | Delete `membership:{orgId}:{userId}` on cancel. | subscription-service.ts ~:1917 | ACC / SUBS | Same code as .15 and .10 lifecycle work. |
| Codex-3wzpl | EntitlementsService is registered but nothing calls it | P2 open | Use or delete. | access/src/services/entitlements-service.ts | ACC | Decide together with .21's entitlement model. |
| Codex-dox8r | The payouts list paginates by a different unit than the page shows | P1 open | One grouping key. | subscription-service.ts `listPayoutsByOrg` ~:3033; web group-transactions.ts | RPT | |
| Codex-cvx4s | Top-content table hides course and portal sales | P2 open | Left join or union the sources. | admin analytics-service.ts `getTopContent` | RPT | Sibling of WEB-02 (.20). |
| Codex-y76g2 | Studio sales lack a per-creator breakdown | P2 open | — | purchase-service.ts `listSales` :2571 / `getSalesStats` :2695 | RPT | Same read model as .20 / .21. |
| Codex-2xw0d | Unified layout for the scattered money pages | P2 open | Design brainstorm and mockups. | apps/web | RPT | Design-first. |
| Codex-nr7ie | Revenue-share toasts echo raw server errors | P2 open | — | studio/monetisation/revenue-share/+page.svelte | REC (web) | Sibling of gvx03. |
| Codex-p6sy6 | No rate limit on the payout read endpoints | P3 open | — | — | CFG | **Likely stale:** root CLAUDE.md now says `procedure()` enforces the `api` preset by default. Verify, then close. |
| Codex-i4gv0 | Payout status types are conflated | P3 open | — | — | LEDG | Ties to .48 (a new terminal state widens the enum). |
| Codex-1g5lh.23 | Show creators BNPL/Klarna eligibility when they set a price | P2 open | — | — | CHK | Pairs with .32 price-entry UX. |
| Test-infra siblings: Codex-0m75o, -elg0b, -vxmq6, -zwdt0, -1j7xp, -mgpji, -j5flp, -ajbja, -h2u4c, -ff6mo | Subscription and payout E2E and integration test hygiene | P2–P3 | — | — | TEST | Group under .25 when planning CI. |

---

## 2. Clusters: beads that share one change or one new module

**C1. One way to build services outside `procedure()` (webhook and cron composition root).**
- Beads: .7 (FeeConfigService, mailer and webAppUrl missing in webhook/cron), .13 (`payoutMailer` never passed, SUB-18), .43 (a missing mailer silently skips a notice), CFG-06 (WEB_APP_URL), and the webhook half of .34 and .33's emails.
- Today there are eight hand-built `new *Service(...)` sites in ecom-api handlers (checkout.ts:210/:323, payment-webhook.ts:268/:272, subscription-webhook.ts:232/:265, payouts-sweep.ts:68, connect-webhook.ts:64/:122). Only one of them, the course subscription, gets a FeeConfigService.
- Shared change: a `createWebhookServices(env, db, executionCtx)` in `@codex/worker-utils` that builds the same graph as `service-registry.ts`, with fee config, mailers and webAppUrl. Make the money-critical dependencies required at the type level rather than `feeConfig?:` optional with silent constant fallbacks (purchase-service.ts:173, subscription-service.ts:563, course-subscription-service.ts:90).

**C2. A single split calculator that resolves everything at one `at`.**
- Beads: .7 (floor on every path), .33 (effective-dated fees resolved at sale time), .49 (a replay must use the fee in force at `invoice.created`), .19 (agreements at the same `at`), .20 (charts should plot what the calculator produces, not a hard-coded 10%), .15 SUB-11 (amount source) and SUB-20 (platform fee in totals), Codex-rtwpv, Codex-itvh8, Codex-cbbet, Codex-xyb7v (dry-run calculator), Codex-nm5mb (portal attribution model).
- Today, two functions are both called `calculateRevenueSplit`: `@codex/purchase` revenue-calculator.ts:61 and `@codex/subscription` revenue-split.ts:31. Four split assemblers sit on top of them: `completePurchase`/`writePurchasePayouts` (purchase-service.ts:559/:1267), `completeCoursePurchase` (:1049), `computeSubscriptionSplit` (subscription-service.ts:701) and `writeCoursePayouts` (course-subscription-service.ts:1152). Three fee lookups feed them: `getFeesForCreator`, `resolvePayoutFees`, and constant fallbacks.
- Shared module: `computeSplit({ grossCents, at, organizationId, creatorIds, revenueType })` returns slices, already floored and with rounding to the org. Fees, agreements and payee are resolved inside at the same `at` (payment time or `invoice.created`).
- The resolver half already exists for the payee: `resolveOrganisationPayee` (resolve-organisation-payee.ts:64) documents "one clock" with the agreement resolver.

**C3. One agreement resolver.**
- Beads: .19 (unify), .17 (remove `effectiveUntil` as a money cutoff), .18 (membership guard plus terminate on removal), .20 AGR-02/AGR-08 (stop reading the legacy `organizationFeePercentage`), Codex-xz61z (I5/I6).
- Today there are two queries: `findActiveCreatorAgreementShare` (agreement-share.ts:39, INNER JOIN, `.limit(1)` without `orderBy`) and the inline leftJoin query in `executeTransfers` (subscription-service.ts ~:4618). They already disagree on the join.
- Build .19 first, or with .17 and .18. Otherwise .17 and .18 each have to edit both queries.

**C4. One clawback engine (reversals plus a debt ledger).**
- Beads: .8 (refund increments, retry on failure, revocation key), .9 (dispute: proportional reversal, re-send on won, hold), .10 (a full refund cancels the subscription, which needs .8's full-vs-partial classifier), .30 (net debts at transfer time; write-off at 12 months or invoice at 90 days), Codex-in0g4 (subscription debts), .47 (search replaced accounts when reversing), .28 (support screen shows "what will be clawed back" and the `refund_reviews` queue), .29 (the payout hold makes reversals succeed), .23 (refund records immutable).
- Today there are two reversal implementations: `PurchaseService.reversePayoutsForPurchase` (:1986) and `SubscriptionService.reverseSubscriptionPayoutsForCharge` (:4362). Both are on `cancelUnpaidPayoutForRefund` (payout-ledger.ts:663) since #592. `recordRefundReview` (:2172) is purchase-only.
- Shared module: `reverseCharge({ chargeId, incrementCents, cause: 'refund' | 'dispute' })` over the `payouts` ledger for every `source_type`, plus a generalised debt ledger (`refund_reviews`) with recovery and resolution states.

**C5. A platform-initiated refund primitive.** Four beads need the platform itself to refund a charge: .9 (early-fraud-warning auto-refund), .14 (auto-refund a duplicate one-off payment), .15 (cancel and refund a duplicate subscription) and .28 (the support screen). No `refunds.create` exists in production code. Build one `issueRefund({ chargeId | invoiceId, amount, reason, idempotencyKey })` and let the resulting `charge.refunded` webhook run C4, so there is one refund path, as .28's spec requires.

**C6. Payout ledger and drains: the post-#592 residue.**
- Beads: .13 (per-user drain trigger, `/me/sync` drain, email, sweep bound and lock), .48 (attempt cap, terminal state, Stripe error code), .47 (account history), .49, .9 (skip disputed rows in `isDrainablePayout` :169), .30 (netting), .34 (reads pending rows), Codex-k9qpd (8 `transfers.create` sites still in subscription-service.ts against 1 in payout-ledger.ts), Codex-2f3wk, Codex-4r55k/xjxw6 (drop legacy `pending_payouts`), Codex-xymq6/r8932 (likely superseded), Codex-i4gv0, Codex-dox8r.
- Shared module: `packages/purchase/src/utils/payout-ledger.ts` (`recordSlice`, `claimPayoutAttempts`, `settleTransfer`, `markPayoutFailed`, `findTransfersForPayouts`). Routing every transfer through it is the natural home for .48, .47 and .30.

**C7. A subscription state machine that follows Stripe, plus one "status grants access" predicate.**
- Beads: .15, .10, .16, Codex-sing6 (+ Phase 2 beads), Codex-8ntg0, .40/.43 (price-change residue), Codex-cbbet.
- Shared changes:
  1. **One subscription-status predicate.** It is duplicated today in access-decision.ts:224, entitlements-resolver.ts:54 and library.ts:205/:735 for org tiers, and `GRANTING_STATUSES` (course-subscription-service.ts:86) for course plans. .10 has to change all of them.
  2. **One event reducer with tombstones and Stripe-status mirroring**, for .15.
  3. **One mechanism for "a change that takes effect at the next renewal".** Today that is the deferred swap in pending-price-change.ts. Downgrades (.16) should either reuse it (a pending tier on metadata, applied by the same `customer.subscription.updated` hook) or deliberately bring in schedules (the sing6 Phase 2 beads). That is a decision (§3).

**C8. One purchasability rule.** .14 (the checkout gate must match `decideContentAccess`, plus the publish gate), .32 (min £1), Codex-1g5lh.23 (BNPL thresholds at price entry), and legal L1 (consent to immediate access at checkout, if the lawyer requires it). Today the gate is spread over `createCheckoutSession` (purchase-service.ts:295 / :895), the content-service publish gate (~:840), `decideContentAccess` (access-decision.ts:388) and the validation schemas. One shared predicate, `canBeSold(content)`, should be used by all four.

**C9. Access and entitlements as the single source of access.** .21 (`grant` entitlement; orgless entitlements need `entitlements.organizationId` nullable), .9 (pause and restore, library `disputedAt`), .8 (revocation key on one-off refund), .10 (no revocation on `payment_failed`), Codex-3wzpl (EntitlementsService unused), Codex-8ntg0. Decide whether `@codex/access` reads entitlements for every grant type, as `docs/payments/access.md` says, before .21's migration.

**C10. Reporting read model.** .20, .21 (orgless in `/sales`, course purchases in history), Codex-dox8r, Codex-cvx4s, Codex-y76g2, Codex-nm5mb, Codex-2xw0d, .15 SUB-20, .45. A revenue read model built from the `payouts` ledger, which since #592 has one row per slice per charge for every revenue type, would replace the per-table aggregates (`purchases`-only "Revenue", inverted legacy share, hard-coded fee in charts).

**C11. Money emails and their delivery guarantees.** .7 (creator-connect-needed), .13 (payout-released), .34 (payouts-waiting), .33 (fee increase), .30 (debt created, cleared, written off, invoiced), .17 (review reminder copy), .18 (termination on removal), .20 AGR-10 (links), .40 (amount), .43 (silent skip), .8 PAY-19 (duplicates), .46(k) (fan-out has no retry). Shared needs: C1 wiring, an event-id dedupe (Codex-257ia), and a rule for whether a money move may proceed when its notice failed (.43 decision).

**C12. Financial-record integrity.** .23 (cascades, customer adoption, GBP, audit log, SEC-02), .46(i) (ownership-period cascade), Codex-v1io7, Codex-904q0, Codex-gvx03, Codex-nr7ie. A single "money tables never cascade" migration should cover `ecommerce.ts`, `payouts.ts`, `refund-reviews.ts` and `organization-ownership.ts` together, after the anonymise-vs-restrict decision.

**C13. Ownership follow-ups.** .36, .38, .39, .42, .44 and .46 are all against `ownership-transfer.ts` and `organization-service.ts`; the natural size is one PR. .18 hooks `removeMember`, the same file.

**C14. Config and environments.** .24, .41, CFG-06 (in .7), Codex-1ilxl (done). The two script beads (.24 setup script, .41 upload script) are both one-liners in `.github/scripts/`.

**C15. Test harness.** .25 is the keystone: one signed-event helper. Codex-chh3e, Codex-vas3y and the E2E siblings reuse it, and the VERIFY recipes of .8, .9, .10, .13, .14, .15, .21 and .22 can't run in CI without it.

---

## 3. Dependencies, order and owner decisions

### Hard sequencing (code or data)

1. **Release gate for what is already on dev.** Before dev→main: R1–R4 for 0097 (#589), the 0098 check (#590), and, per the close reasons of .6/.11/.12/.37, **R5** (no duplicate slices before 0099) and **R6** (hand-reconcile failed rows from before #592). R5 and R6 are missing from `release-checklist.md` (§5). This is not a bead. It blocks nothing on dev, but it blocks shipping.
2. **.36 after the #589 deploy:** run R3 against production and keep the output before the column drop.
3. **C1 (service factory) before or with .7.** .7 then unblocks .33 (effective-dated fees need every path reading FeeConfigService) and .49 (pinning fees to `at` needs the same resolver). Codex-rtwpv belongs with .33 (same write methods).
4. **.32 with .7.** The owner decision pairs the £1 minimum price with the 25p floor. The floor is set by `PATCH /api/admin/fees/platform` only once .7 makes it apply.
5. **.19 before or with .17 and .18.** One resolver; otherwise both lookups get edited twice.
6. **.8 before .10's refund half, before .9, before .30, and before .28's backend.**
   - .10 needs the full-vs-partial classifier.
   - .9 needs proportional reversal on the same engine.
   - .30 needs a `refund_reviews` reader.
   - .28's backend relies on webhook-driven clawback.
   - Codex-in0g4 comes before .30 for subscription debts.
   - .29 is independent (Stripe settings and a backfill) but reduces .30's volume. Ship it early.
7. **C5 (refund primitive) before .9's early-fraud auto-refund, .14's duplicate refund, .15's duplicate cancel-and-refund, and .28.**
8. **.15 with or before .10.** Both rewrite status-to-access; .10 changes the access predicate in four places (§2 C7).
9. **.13 before .34.** The reminder needs the drain trigger and email wiring to be right, or creators get reminded about money that drains unannounced.
10. **.21's migration:** `entitlements.organizationId` nullable, before orgless entitlements.
11. **.25 early.** It turns most VERIFY recipes into CI checks. Codex-chh3e and Codex-vas3y build on it.

### Decisions needed first

Owner decisions and design reviews:

| Bead(s) | Open question | Source |
|---|---|---|
| .16 (+ Codex-sing6 Phase 2) | Downgrade-at-period-end mechanism: reuse the deferred swap (decided for price changes: "Deferred swap (Recommended) … not subscription schedules") or build subscription schedules? The bead and sing6 still assume schedules. | status.md Decisions; pending-price-change.ts header |
| .48 | The terminal state for a permanently failed payout, and who reviews it. | bead text |
| .43 | Should a price move go ahead when the 30-day notice was not sent? | bead text |
| .23 + Codex-v1io7 | Financial history: RESTRICT deletes or anonymise the user? And how do buyers keep access after a creator deletes their account? | .23 desired text; v1io7 |
| Codex-nm5mb | The portal revenue-attribution model ("plan the model first"). | bead text |
| .28, .16 (reorder dialog), .22 (processing state), .30 (earnings view of debts) | New UI, so an HTML mockup + data design reviewed by the owner BEFORE code (epic owner rule 3 and project memory). | epic description |
| .34, .30, .33 | Legal review of the policy drafts: L1–L7 (refund policy) and P1–P7 (creator terms). .34 is "subject to P5"; .30 cites terms §6; .33 cites terms §3. **L1 is urgent:** checkout collects no consent to immediate access, so the buyer's statutory 14-day cancellation right may survive streaming. A yes would add a checkout change (C8). | status.md Open questions; .31 close reason |
| Codex-xyb7v | Auth approach for the desktop fee app (TBD). | bead text |

Not owner decisions, but research needed first:
- .29: Stripe's GB `delay_days` minimum and maximum.
- .9: does Stripe reject a `source_transaction` transfer against a disputed charge (PAY-06 "S")?

Already decided (no blocker):
- P-1 to P-8 and AGR-01/AGR-09.
- £1 / 25p, minimum transfer off, rounding to the org.
- Early fraud warning → refund.
- Refund window 14 days; support only; hold for the window.
- Debts: from future earnings, £50 cap, write-off at 12 months or invoice at 90 days.
- Hold and remind.
- No-owner money held for the next owner.

---

## 4. Closed children (context)

| Bead | Plain title | One line |
|---|---|---|
| Codex-2hxff.1 | The payout dashboard is owner-only (IDOR fixed) | PR #589, dev 2026-10-14. SEC-01. Self-scoped login link kept. |
| Codex-2hxff.2 | One owner per organisation; org money follows the current owner | PR #589. SEC-03, SUB-22, SUB-20. `organization_ownership_periods` + `resolveOrganisationPayee`; migration 0097; R1–R4 before main. |
| Codex-2hxff.3 | Tier price changes move subscribers at their next renewal, with 30 days' notice | PR #589. SUB-03, P-6, SUB-16. Deferred swap on subscription metadata. |
| Codex-2hxff.4 | The Billing Portal uses a locked-down configuration | PR #589. SUB-10. `bpc_1UQ9QH7wyGmo4sh6hXwkCS1s`; follow-up .41. |
| Codex-2hxff.5 | Stripe objects are tagged by environment; foreign events are skipped | PR #589. CFG-09, PAY-22 (env half). `codex_env` metadata (constants/src/commerce.ts:42). |
| Codex-2hxff.6 | A transient webhook failure returns 500 so Stripe retries | PR #592, dev 2026-10-19. PAY-01, SUB-16, SUB-17. |
| Codex-2hxff.11 | The payout ledger cannot pay twice or strand rows | PR #592. SUB-02, SUB-06, PAY-07, PAY-08. Reserve-before-transfer, claim and lease, retries, migration 0099 unique indexes. |
| Codex-2hxff.12 | Every slice of every sale writes a ledger row | PR #592. SUB-04, PAY-15, SUB-14. Rounding remainder to the org. |
| Codex-2hxff.26 | Canonical payment docs written as a desired-behaviour spec | PR #585, dev 2026-10-13. `docs/payments/`. |
| Codex-2hxff.27 | Production webhooks rejected every delivery (repaired) | 2026-10-13, no code. CFG-08/08b. Endpoints recreated with fresh secrets. |
| Codex-2hxff.31 | Customer refund policy and creator payout terms drafted | PR #585. `docs/payments/policy-drafts/`. The legal review is still the owner's to arrange. |
| Codex-2hxff.35 | Production's price-change email states when the new price applies | PR #590, dev 2026-10-18. Migration 0098; post-deploy SQL check. |
| Codex-2hxff.37 | An org with no active owner holds its slice for the next owner | PR #592. Owner decision 2026-10-18 "Hold it for the next owner". |

---

## 5. Surprises

**Partly done or superseded**
- **.39 is superseded by #592.** The earliest-period fallback it describes is gone. `resolveOrganisationPayee` (resolve-organisation-payee.ts:84–130) now pays the NEXT owner for any uncovered `at`, or holds the slice as `no_owner`, and logs a warning. That follows the owner decision of 2026-10-18. Candidate to close, or re-scope to "a gap between periods should be an error, not a warning".
- **.7 is partly done.** The course-subscription webhook path already gets a FeeConfigService (subscription-webhook.ts:265–275), so course invoices resolve fees and the floor today. Still missing: PurchaseService (checkout.ts:210/:323, payment-webhook.ts:268), SubscriptionService (subscription-webhook.ts:232, payment-webhook.ts:272, payouts-sweep.ts:68, connect-webhook.ts:122), and every mailer.
- **.19 is partly done.** AGR-07 for one-off and course purchases was fixed in #589 (commit d190e79c "a one-off sale resolves its payee and agreements at the payment time", labelled Codex-2hxff.2): `purchasedAt = metadata.paidAt`. AGR-05 (INNER JOIN, unordered `limit(1)`) is still in agreement-share.ts, while the subscription path's inline lookup has moved to a leftJoin, so the two lookups now diverge in shape too.
- **.13 is partly superseded and partly stale.** Since #592 the drains claim and lease rows and write `retry_count`/`last_retry_at`, so "attempts never recorded" (bead text and connect-and-payouts.md:296) looks out of date. The bead's `/connect/sync` no longer exists: org-level Connect routes were retired by .1, and only `/connect/me/sync` remains. What still holds: `connect-webhook.ts:28` requires `codex_organization_id`, `/me/sync` releases nothing, `payoutMailer` is never passed, and the sweep is unbounded.

**Stale titles or text**
- **.32's title is stale.** Its comment narrows it: tiers and course plans already enforce £1. Only one-off content and course prices (`priceCentsSchema`) are open.
- **.16's SHAPE and Codex-sing6's note** say the price-change fix needs subscription schedules ("build once"). It does not: .3 shipped a deferred swap by owner decision, and no `subscriptionSchedules` code exists. The Phase 2 beads (Codex-6mdyn, -9ojum, -pfi39, -ff6mo) still describe schedules, and they are not parented to sing6.
- **.8 and .28 call Codex-aqk92 "still open"**, but it is closed (status.md: all its questions were answered 2026-10-13).
- **Codex-equ4i's title** overstates its scope; only fixture hygiene is left (the divergence went to Codex-al9ft, closed).

**Docs out of date with dev**
- **R5 and R6 don't exist.** status.md (:69–70), connect-and-payouts.md:211 and the close reasons of .6/.11/.12/.37 cite release-checklist R5 (the 0099 duplicate-slice check) and R6 (hand-reconcile failed rows from before #592). `origin/dev:docs/payments/release-checklist.md` has only R1–R4 and the 0098 check.
- **"No-owner money is lost" is now false in two places.** status.md :25–27 says ".37 matters before the production deploy … its org slice is logged and never recorded". release-checklist R2 says such slices are "logged and never recorded … not paid later either". Its "Assigning an owner" section says "a sale between the deploy and the assignment stays unrecorded". All of these are false since #592: the slice is held as a `no_owner` row for the next owner. Both docs were written before #592 merged.
- **status.md is behind:** it says "Last reviewed: 2026-10-14" but was edited 2026-10-18/19. Its gap table still lists closed .26 ("in progress") and closed .31. It doesn't list .36 or .38–.49 as rows (they are mentioned only in prose).

**Overlapping ledger IDs**
- PAY-22 is mapped to .5 (closed; environment half) and .23 (open; cross-user half).
- SUB-18 is mapped to both .7 and .13.
- SUB-20 is mapped to .2 (closed) and .15 (open).
- SUB-16 is mapped to .3 and .6 (both closed).
- PAY-14 = X-01 and PAY-21 = X-04 (the ledger marks these duplicates itself).

**Code duplicates worth naming in the design doc**
- Two functions named `calculateRevenueSplit`: purchase revenue-calculator.ts:61 and subscription revenue-split.ts:31.
- Two agreement lookups.
- Two reversal implementations.
- Four copies of the "subscription status grants access" predicate.
- `assertGbpOnly` lives only as a private method in subscription-service.ts:3970.
- 8 `transfers.create` call sites remain in subscription-service.ts against one in payout-ledger.ts.

**Bundled bead**
- **.46** mixes P3 nits with two items that belong elsewhere: (i) a cascade on a money table, which belongs with .23, and (k) the price-change fan-out having no retry, which belongs with .43.

**Stale status, superseded or closable outside the epic**
- **Codex-1ilxl** is still in_progress, but its PR #549 is merged to dev and main. Closable.
- **Codex-ev3k:** all 5 listed child tasks are closed, and .6 did the classification. Closable.
- **Codex-vas3y** has been in_progress since 2026-04-29, and **Codex-xz61z** since 2026-05-17.
- **Codex-xymq6** and **Codex-r8932** look superseded by 0099's unique indexes on `payouts`.
- **Codex-p6sy6** looks superseded by `procedure()` now enforcing the default rate limit.
- **Codex-2f3wk's items 1–2** reference functions #592 replaced (`executePurchaseTransfer`, `resolvePrimaryConnect`).
- **Codex-904q0**'s transfer half is now built by .2.

**Labels**
- .36, .47, .48 and .49 have no `payments` label; .36 has no labels at all. All four are parented to the epic, so `bd list --label payments` misses them.
