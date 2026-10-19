> **Snapshot, 2026-10-19, code at `origin/dev` f070a62b.** Evidence for [../architecture.md](../architecture.md). Line numbers drift: re-find a method with `grep -n` before trusting a line. Written by a read-only survey agent; not maintained.

# Payments code: architecture inventory

Surveyed: a worktree at `4bd9e70b`. `git diff HEAD origin/dev` is empty for `workers/ecom-api/src`, `packages/purchase/src` and `packages/subscription/src`, so this is origin/dev code.
Method: TypeScript-AST outline of every class and function (line ranges are inclusive and include each method's leading docblock start, not its JSDoc), code read with comments stripped, line-similarity diffing of suspected copies, and `git log` on the services.
Bug-ledger ids (PAY-xx, SUB-xx, AGR-xx, X-xx) refer to `docs/audits/payments-2026-10-13/bug-ledger.md`. **NEW** marks something I could not find in that ledger or in `docs/payments/status.md`.

---

## 1. Inventory

### Totals (production `.ts` / tests)

| Area | Prod LOC | Test LOC |
|---|---|---|
| `packages/purchase/src` | 5,902 | 10,752 |
| `packages/subscription/src` | 9,216 | 19,596 |
| `packages/agreements/src` | 2,450 | 2,553 |
| `workers/ecom-api/src` | 4,825 | 12,161 |
| Payment schema files (`packages/database/src/schema`, 8 files) | 2,405 | — |

### packages/purchase (prod)

| File | LOC | What it is |
|---|---|---|
| `services/purchase-service.ts` | 2,738 | `PurchaseService`: one-off and course checkout, completion, ledger writes, refunds, disputes, portal, sales reads |
| `utils/payout-ledger.ts` | 782 | **The seam just extracted**: slice reservation, transfers, settle, leases, refund-cancel, transfer lookup |
| `services/fee-config-service.ts` | 677 | `FeeConfigService`: 3-tier fee resolution (KV-cached), writes, audit log |
| `services/resolve-customer.ts` | 280 | `resolveOrCreateCustomer`, `withStaleCustomerRecovery` (Stripe Customer seam) |
| `services/entitlement-writer.ts` | 208 | Entitlement writes for content purchase, course purchase and course subscription |
| `services/revenue-calculator.ts` | 205 | `calculateRevenueSplit` (validated copy), `applyMinPlatformFeeFloor`, `DEFAULT_*_FEE_PERCENTAGE` |
| `types.ts` | 198 | |
| `index.ts` | 166 | barrel; exports ledger and payee helpers to `@codex/subscription` |
| `utils/resolve-organisation-payee.ts` | 162 | Organisation owner at time T, plus that owner's Connect row |
| `errors.ts` | 150 | |
| `stripe-client.ts` | 138 | `createStripeClient`, `createLazyStripeClient`, `verifyWebhookSignature` |
| `services/stripe-customer-integrity.ts` | 116 | No production caller (PAY-23) |
| `services/agreement-share.ts` | 82 | `findActiveCreatorAgreementShare`: the agreement lookup for purchases and course subscriptions |

### packages/subscription (prod)

| File | LOC | What it is |
|---|---|---|
| `services/subscription-service.ts` | 5,097 | `SubscriptionService`: org-tier lifecycle, invoices, multi-creator fan-out, ALL drains and sweep (purchases' too), subscription refunds, read models for payouts |
| `services/course-subscription-service.ts` | 1,323 | `CourseSubscriptionService`: course plans (Stripe products and prices), checkout, webhooks, course payouts |
| `services/tier-service.ts` | 1,090 | `TierService`: tier CRUD with Stripe product and price, Dashboard sync-back |
| `services/connect-account-service.ts` | 756 | `ConnectAccountService`: onboarding, status cache, account webhooks |
| `services/pending-price-change.ts` | 281 | `schedulePriceChange`, `applyDuePendingPriceChange` (shared seam) |
| `errors.ts` | 233 | |
| `services/subscription-invalidation.ts` | 136 | `invalidateForUser` (KV version bumps) |
| `index.ts` | 115 | |
| `services/stripe-status-mapper.ts` | 96 | `resolveStatus`, `mapStripeSubscriptionStatus` (shared seam) |
| `services/revenue-split.ts` | 70 | **Second** `calculateRevenueSplit` (unvalidated copy) |
| `services/index.ts` | 19 | |

### packages/agreements (prod)

| File | LOC | What it is |
|---|---|---|
| `services/agreement-service.ts` | 1,970 | Proposal and agreement lifecycle, reads, lifecycle emails |
| `services/agreement-math.ts` | 208 | `validateProposedShare`, `sumActiveCreatorShares`, legacy↔share conversion, labels |
| `errors.ts` / `types.ts` / `index.ts` / `services/index.ts` | 93 / 74 / 80 / 25 | |

The package depends only on constants, database, service-errors and shared-types. **Neither `@codex/purchase` nor `@codex/subscription` imports it**: payouts resolve agreements with their own queries.

### packages/admin (payments parts)

| File | LOC | Payments content |
|---|---|---|
| `services/analytics-service.ts` | 1,198 | `getRevenueStats` 64–102, `computeRevenueBlock` 112–181, `getSubscriberStats`/`computeSubscriberBlock` 192–335, `getCustomerStats` 480–538, `getTopContent` 555–681, `getRevenueByCreator` 1033–1197 (reads the legacy share column, AGR-02) |
| `services/customer-management-service.ts` | 423 | `grantContentAccess` 324–422 writes `content_access` only (X-02); `listCustomers` and `getCustomerDetails` read purchases |

### Database schema (payment tables)

| File | LOC | Tables |
|---|---|---|
| `ecommerce.ts` | 711 | `contentAccess`, `platformFeeConfig` (legacy), `organizationPlatformAgreements`, `agreementProposals`, `creatorOrganizationAgreements`, `purchases` |
| `subscriptions.ts` | 401 | `subscriptionTiers`, `subscriptions`, `stripeConnectAccounts`, `pendingPayouts` (**dead**: no reader or writer in any `src/`) |
| `fee-config.ts` | 367 | `feeConfigPlatform`, `feeConfigOrg`, `feeConfigOrgCreator`, `feeConfigAuditLog` |
| `payouts.ts` | 275 | `payouts` (the ledger). `sourceType` is varchar(16) and defaults to `'subscription'`; course-subscription rows also use `'subscription'` |
| `course-commerce.ts` | 255 | `courseSubscriptionPlans`, `courseSubscriptions`, `courseTierAccess` |
| `organization-ownership.ts` | 155 | `organizationOwnershipOffers`, `organizationOwnershipPeriods` |
| `entitlements.ts` | 136 | `entitlements` (source ∈ content_purchase, course_purchase, course_subscription, grant) |
| `refund-reviews.ts` | 105 | `refundReviews`, with **`purchase_id NOT NULL`**, so a subscription clawback cannot be queued |

### packages/validation (payment schemas)

`schemas/purchase.ts` 288 (checkout, sales and portal inputs, plus the metadata schemas `checkoutSessionMetadataSchema` and `courseCheckoutSessionMetadataSchema`), `schemas/subscription.ts` 350 (tiers, checkout, tier change, payout and earnings queries, Connect), `schemas/agreements.ts` 265, `schemas/course-commerce.ts` 138, `schemas/fee-config.ts` 95, `admin/admin-schemas.ts` 425 (part).

### workers/ecom-api (prod)

| File | LOC | Role |
|---|---|---|
| `routes/agreements.ts` | 915 | 15 agreement endpoints → `ctx.services.agreements.*` |
| `handlers/subscription-webhook.ts` | 701 | `handleSubscriptionWebhook`: **499-line** single function (203–701). Builds 4 services ad hoc |
| `routes/subscriptions.ts` | 515 | 18 endpoints → `ctx.services.subscription.*` |
| `handlers/checkout.ts` | 381 | `handleCheckoutCompleted` 90–276, `handleCourseCheckoutCompleted` 286–381, `resolvePaymentIntentCharge` 39–68 |
| `handlers/payment-webhook.ts` | 292 | `handleChargeRefunded` 146–198, `handleChargeDisputeCreated` 200–256, plus KV revoke, library invalidation and refund email |
| `index.ts` | 276 | 7 webhook endpoints, 8 route groups, `scheduled` |
| `routes/checkout.ts` | 241 | create, course, course-subscription, portal-session, verify |
| `utils/error-classification.ts` | 194 | `isTransientError` (walks the cause chain), `describeRootCause` |
| `handlers/connect-webhook.ts` | 179 | `account.updated` / `deauthorized`; starts the activation drain |
| `routes/course-monetisation.ts` | 179 | plan upsert/deactivate, tier access |
| `routes/connect.ts` | 149 | organization-status, me/onboard, status, sync, dashboard |
| `handlers/payouts-sweep.ts` | 147 | hourly cron → `sweepUnresolvedPayouts` |
| `middleware/verify-signature.ts` | 140 | per-endpoint signing secrets |
| `utils/webhook-handler.ts` | 131 | `createWebhookHandler`: environment filter, then 500 on transient / 200 on permanent |
| `routes/purchases.ts` / `sales.ts` / `courses.ts` | 110 / 80 / 42 | reads |
| `utils/dev-webhook-router.ts` | 95 | single dev endpoint fan-out |

Payment routes in other workers: `organization-api/src/routes/tiers.ts` (197; `tier.*` CRUD), `organization-api/src/routes/ownership.ts` (`agreements.getActiveAgreementSummaries`), `admin-api/src/index.ts` (`feeConfig.*`, 10 methods). Wiring: `packages/worker-utils/src/procedure/service-registry.ts` (1,400 LOC; payments getters 780–1135). Out of package: `packages/organization/src/services/ownership-transfer.ts` (949) **writes `payouts`** (re-homes `no_owner` rows, line 926).

### apps/web payment surfaces (non-test LOC)

| Surface | Files / LOC |
|---|---|
| `routes/_org/[slug]/studio/monetisation` (+ revenue-share, pricing-faq) | 4 / 3,499 (revenue-share hard-codes `FEES.PLATFORM_PERCENT`, line 201, AGR-11) |
| `routes/_org/[slug]/(space)/pricing` | 3 / 3,608 |
| `routes/_org/[slug]/studio/payouts` + `lib/components/studio/payouts` | 2 / 1,419 + 2 / 449 |
| `routes/_creators/studio/earnings` | 3 / 1,122 |
| `routes/_org/[slug]/studio/billing` | 2 / 686 |
| `routes/(platform)/account/subscriptions` | 2 / 691 |
| `lib/components/ui/CheckoutSuccess` | 2 / 456 |
| `routes/_org/[slug]/(space)/subscription`, `(platform)/pricing`, `_creators/checkout`, `(space)/checkout` | 357, 224, 128, 99 |
| `lib/remote/*.remote.ts` | `subscription` 652, `agreements` 246, `journey-checkout` 202, `checkout` 124, `sales` 71 |

---

## 2. Responsibility clusters inside the big services

LOC = method span from the AST outline.

### SubscriptionService (`packages/subscription/src/services/subscription-service.ts`, 5,097)

Lines 1–623 are imports and about 25 module types. Most of them are read-model DTOs: `PayoutWithCreator` 200, `CreatorPayoutBreakdown` 255, `PayoutSummary` 306, `CreatorPayoutRow` 320, `CreatorEarningsSummary` 347 and others. Also there: `derivePayoutStatus` 375, `extractInvoiceCharge` 612 and `extractInvoicePaymentIntent` 618.

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Fee resolution and split | `resolvePayoutFees` 659–690, `computeSubscriptionSplit` 701–720 | 52 |
| Cache invalidation | `invalidateIfConfigured` 747–776 | 30 |
| Checkout | `createCheckoutSession` 784–936, `verifyCheckoutSession` 955–1048 | 247 |
| Webhook lifecycle and self-heal (access via subscriptions, memberships and followers) | `ensureSubscriptionDataPresent` 1080–1274, `handleSubscriptionCreated` 1293–1352, `handleInvoicePaymentFailed` 1621–1689, `handleTrialWillEnd` 1715–1763, `handleSubscriptionUpdated` 1819–1889, `handleSubscriptionDeleted` 1901–1973, `handleSubscriptionPaused` 2001–2036, `handleSubscriptionResumed` 2068–2114 | 600 |
| Invoice → split → ledger (multi-creator fan-out, with an **inline agreement query**) | `resolveInvoiceCharge` 1422–1453, `handleInvoicePaymentSucceeded` 1465–1609, `executeTransfers` 4550–4865, `transferCreatorPoolToOwner` 4307–4329, `ledger` 4285–4292 | 524 |
| Emails (built here, returned to the worker or sent by mailer) | `buildSubscriptionCreatedEmail` 1358–1405, `buildTrialEndingSoonEmail` 1771–1809, `buildSubscriptionCancelledEmail` 2120–2161, `dispatchTierPriceChangeEmail` 4217–4279 | 192 |
| Customer self-service (Stripe subscription management) | `previewTierChange` 2177–2261, `changeTier` 2288–2485, `cancelSubscription` 2497–2536, `resumeSubscription` 2574–2638, `reactivateSubscription` 2644–2687, `getSubscriptionOrThrow` 3980–4005 | 458 |
| Tier price propagation | `propagateTierPriceToActiveSubscriptions` 4032–4204 | 173 |
| Read models / analytics | `getSubscription` 2694, `getUserSubscriptions` 2717, `listSubscribers` 2755–2864, `getSubscriptionStats` 2869–2925, `buildPayout*Conditions` 2970–3024, `listPayoutsByOrg` 3026–3144, `getPayoutSummary` 3155–3209, `listPayoutsForCreator` 3219–3288, `getEarningsSummaryForCreator` 3296–3344, `getPayoutsByCreatorBreakdown` 3372–3525 | 694 (+≈250 of DTOs) |
| **Drains and sweep (for ALL sources, purchases included)** | `resolvePendingPayouts` 3547–3743, `transferPendingGroup` 3763–3952, `assertGbpOnly` 3970–3978, `rehomeHeldPayouts` 4888–4939, `sweepUnresolvedPayouts` 4949–5096 | 596 |
| Refunds | `reverseSubscriptionPayoutsForCharge` 4362–4534 | 173 |

Nothing for disputes or entitlements. Stripe customer handling is limited to the `withStaleCustomerRecovery` wrapper in checkout.

### PurchaseService (`packages/purchase/src/services/purchase-service.ts`, 2,738)

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Checkout (Stripe sessions) | `createCheckoutSession` 295–522, `createCourseCheckoutSession` 895–1034, `verifyCheckoutSession` 2359–2466 | 476 |
| Stripe customer / **portal (a subscription concern)** | `createPortalSession` 2490–2553 | 64 |
| Sale completion (fee resolution, agreement lookup, split, purchase row, access and entitlement) | `completePurchase` 559–880, `completeCoursePurchase` 1049–1243 | 517 |
| Ledger writes | `writePurchasePayouts` 1267–1357, `recordPayoutsAfterCommit` 1367–1386, `ledger` 1388–1395, `repairPurchasePayouts` 1408–1447, `findPurchaseCreator` 1455–1473 | 178 |
| Notifications | `notifyCreatorConnectNeeded` 1480–1515 | 36 |
| Refunds | `processRefund` 1847–1952, `reversePayoutsForPurchase` 1986–2163, `recordRefundReview` 2172–2213, plus the self-heal `ensurePurchaseDataPresent` 1755–1835 (writes a purchase with code-default fees) | 407 |
| Disputes | `processDispute` 2244–2330 | 87 |
| Entitlements / access read | `verifyPurchase` 1532–1557 (called by `@codex/access`) | 26 |
| Read models | `getPurchaseHistory` 1585–1650, `formatPurchasesForClient` 1661–1680, `getPurchase` 1700–1723, `listSales` 2571–2681, `getSalesStats` 2695–2737 (+ `purchaseDateWindow` 196, `coercePurchaseStatus` 233) | 289 |

### CourseSubscriptionService (`course-subscription-service.ts`, 1,323)

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Plan management (Stripe products and prices; parallel to TierService) | `getCourseInOrgOrThrow` 144, `createPlan` 171–280, `getPlanForCourse` 283, `findPlanRow` 305, `upsertPlan` 331, `savePlanPrices` 368–547, `movePlanSubscribers` 556–649, `rollbackPriceChanges` 660–688, `deactivatePlan` 702–741 | 501 |
| Checkout | `createCheckoutSession` 750–867 | 118 |
| Webhook lifecycle and entitlements | `isCourseSubscription` 875, `ensureDataPresent` 886–963, `handleCourseSubscriptionCreated` 969–990, `handleCourseSubscriptionUpdated` 1070–1102, `handleCourseSubscriptionDeleted` 1108–1138 | 169 |
| Invoice → fees, agreement, split and ledger | `handleCourseInvoicePaymentSucceeded` 996–1064, `writeCoursePayouts` 1152–1300, `resolveInvoiceCharge` 1307–1322 | 234 |

### ConnectAccountService (`connect-account-service.ts`, 756)

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Onboarding and links | `createAccountForUser` 194–308, `isConnectPlatformNotEnabled` 318, `refreshOnboardingLink(ForUser)` 449–478, `createOnboardingLink` 724–755, `createDashboardLinkForUser` 577–588 | 193 |
| Status reads and cache (readiness) | `getAccountForUser`, `getAccount` (via org payee), `getAccountByStripeId`, `getStatusForUser`, `getOrganizationPayoutStatus` 424–443, `isReadyForUser`/`isReady` 593–607, `resolveUserIdForOrg` 640, `invalidateStatusCache` 655, `fetchStatusFromStripeForUser` 678–722, `setCache`, `normaliseRequirements` 136 | 157 |
| Webhook / sync | `handleAccountUpdated` 484–538, `handleAccountDeauthorized` 545–572, `syncAccountStatusForUser` 614–631 | 101 |

It does **not** own releasing pending money. That lives in `SubscriptionService.resolvePendingPayouts` and is started from the worker (`connect-webhook.ts` 104–146).

### TierService (`tier-service.ts`, 1,090)

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Tier CRUD with Stripe products and prices | `createTier` 188–339, `updateTier` 348–556, `deleteTier` 569–643, `reorderTiers` 690–758, `ensureSingleRecommended` 158, `getTierOrThrow` 942, `requireActiveConnect` 972–977, `rollbackStripePriceChanges` 987–1089 | 658 |
| Propagation trigger | `firePropagation` 130–151 (calls `registry.subscription.propagateTierPriceToActiveSubscriptions` through an injected closure) | 22 |
| Dashboard sync-back (webhook) | `applyStripeProductUpdate` 777–830, `recordStripePriceDrift` 844–899 | 110 |
| Reads | `listTiers`, `listAllTiers`, `getTierForAccessCheck` | 36 |

### FeeConfigService (`packages/purchase/src/services/fee-config-service.ts`, 677)

| Cluster | Methods (lines) | ≈LOC |
|---|---|---|
| Resolution (money path; KV-cached; **no time dimension**) | `getFeesForCreator` 173–190, `getFeesForOrg` 192–203, `getFeesPlatform` 205–212, `resolveFromPlatform` 519, `layerOverride` 541, `read*` 563–586, `fetch*` 590–620, module `codeDefault` 108 / `CODE_DEFAULT_*` 94–106 | ≈150 |
| Writes and audit | `updatePlatformFees` 216–274, `updateOrgFees` 278–327, `deleteOrgFees` 329, `upsertCreatorOverride` 356–418, `deleteCreatorOverride` 420, `writeAuditEntries` 624, `validateUpdates` 657, `diffUpdate` 126, `invalidateAsync` 647 | ≈300 |
| Admin reads | `getPlatformRow`, `getOrgRow`, `getCreatorOverrideRow`, `listCreatorOverrides`, `getAuditLog` 483–515 | ≈50 |

No transactions, so fee writes are not atomic (Codex-rtwpv).

---

## 3. Duplication

Similarity is identical normalised code lines (comments and blank lines stripped) as a share of the smaller method, from `difflib`.

### 3.1 Refund clawback: `PurchaseService.reversePayoutsForPurchase` (1986–2163) vs `SubscriptionService.reverseSubscriptionPayoutsForCharge` (4362–4534)

71% identical (137 vs 143 code lines). History: purchase got it in `0fe1aa73` (2026-05-16). The subscription twin was copied in `f673c1aa` (2026-07-15, Codex-13v21). Both were edited again in `4bd9e70b` (2026-10-18).

Divergences:

| Point | Purchase | Subscription | Verdict |
|---|---|---|---|
| Partial-refund denominator | `purchase.amountPaidCents` | sum of the payout rows' `amountCents` | Equal only while every slice row exists. A missing or zero-amount slice makes the subscription side over-reverse. Check against SUB-08 |
| `cancelUnpaidPayoutForRefund` failure | try/catch, log with errorId, `continue` | **not caught**: the first failure aborts the remaining rows and throws out of the webhook | **NEW** divergence, introduced by 4bd9e70b |
| `insufficient_funds` | `recordRefundReview` (needs `row.userId`) | log only, "NOT yet queued", because the `refund_reviews.purchase_id NOT NULL` schema blocks it | Known: Codex-in0g4 |
| Any other reversal error | row still flipped to `reversed` | same | Bug in both copies (PAY-04, SUB-08) |
| Second partial refund | `processRefund` returns early because the status is already REFUNDED, so nothing more is reversed | rows already `reversed` are skipped, so nothing more is reversed | Bug in both copies (PAY-03). `charge.amount_refunded` is cumulative |
| Metadata | `purchase_id` | `subscription_id`, `charge_id` | cosmetic |

Same idempotency scheme (`${transferId}_reversal${suffix}`) and same row loop. A single "reverse the slices of a charge" ledger operation removes the copy.

### 3.2 Sale recording: `completePurchase` (559–880) vs `completeCoursePurchase` (1049–1243)

82% identical (203 vs 168). Both run the same block: fee resolution with a constant fallback, then `findActiveCreatorAgreementShare`, then `effectiveOrgFee = 10000 − share`, then `calculateRevenueSplit` and `applyMinPlatformFeeFloor`, then the fee-mismatch warning, insert the purchase, write the entitlement, and after commit either `writePurchasePayouts` or `repairPurchasePayouts`.

Divergences:
- The content path has an orgless branch; the course path assumes an org.
- Only the content path writes `contentAccess` as well as the entitlement.
- The course path reuses `revenueType: 'content_purchase'`, which is deliberate (HARDENING §H4a).
- Both write `platformAgreementId: null, creatorOrgAgreementId: null` (AGR-06).

### 3.3 The "fees → agreement → split → three slices" pipeline exists four times

| Path | Fees | Agreement | Split | Slices |
|---|---|---|---|---|
| One-off (`completePurchase` + `writePurchasePayouts` 1267) | `getFeesForCreator(org, creator, 'one_off')` or platform; fallback `DEFAULT_*` (10/10) | helper, `at = paidAt` | purchase `calculateRevenueSplit` + floor; agreement folded into the org % | platform, creator (`sendTransferGroup: false`), org. Creator key `${charge}_creator` |
| Course one-off (`completeCoursePurchase`) | same | helper, `content_purchase` | same | same writer |
| Course subscription (`writeCoursePayouts` 1152–1300) | `getFeesForCreator(…, 'subscription')`; fallback `DEFAULT_*` (**10%** org) | helper, `at = invoice.created` | purchase `calculateRevenueSplit` + floor | platform, creator, org (`sendTransferGroup: false`). Creator key `${charge}_creator`. The ledger tail is about 43 lines copied from `writePurchasePayouts` |
| Org subscription (`computeSubscriptionSplit` 701 + `executeTransfers` 4550–4865) | `getFeesForOrg(org, 'subscription')`; fallback `FEES.SUBSCRIPTION_ORG_PERCENT` (**15%**) | **inline query** with a LEFT JOIN, deduplicated, `at = invoice.created` | **subscription** `calculateRevenueSplit` + floor, then a pool fan-out: floor per creator, remainder to the org | org, creator per agreement (`sendTransferGroup: true`, `hold: 'min_transfer_floor'`), or `creator_payout_to_owner` when there is no agreement |

Divergences that are or look like bugs:
- **Fee config never reaches real sales.** Every webhook and cron builds `PurchaseService` and `SubscriptionService` without `feeConfig`: `checkout.ts:210,323`, `payment-webhook.ts:268,272`, `subscription-webhook.ts:232`, `connect-webhook.ts:122`, `payouts-sweep.ts:68`. In `PurchaseService`, `feeConfig` is read only in `completePurchase` and `completeCoursePurchase`, and both run only from webhooks. So the registry injection (`service-registry.ts:827,1002`) is dead for one-off fees. Only `CourseSubscriptionService` in `subscription-webhook.ts:265–276` gets a `FeeConfigService`. Known: Codex-2hxff.7, PAY-02, SUB-01. Root cause in architecture: 8 ad-hoc construction sites with no webhook-side factory.
- **Fallback constants disagree.** Course subscription without config uses a 10% org fee (`DEFAULT_ORG_FEE_PERCENTAGE` = `FEES.ORG_PERCENT`); org subscription uses 15%. That matters only where config is absent, which today is tests plus, effectively, every org-subscription webhook. **NEW** (minor).
- `minTransferCents` is applied per creator only in `executeTransfers` (4816) and as an aggregate in the drain (3781–3807, log at 3790). Purchases and course subscriptions never apply it at record time.
- Fees are resolved at processing time, while agreements and payee use sale time (see 5.4). A replay re-splits with current fees (Codex-2hxff.49).

### 3.4 Two `calculateRevenueSplit` functions

- `purchase/src/services/revenue-calculator.ts:61–158`: validates the inputs (integer, 0–10000) and throws `RevenueCalculationError`.
- `subscription/src/services/revenue-split.ts:31–70`: no validation, and an amount ≤0 gives a zero split.

Same arithmetic: ceil the platform fee, ceil the org fee, remainder to the creator. Only 24% of lines are identical. Org subscriptions use the unvalidated copy; course subscriptions import the purchase copy. **NEW** that two copies exist (not a money bug today).

### 3.5 Agreement "active at T" predicate: 4 copies plus 1 legacy

| Location | Join | Order / ties | Note |
|---|---|---|---|
| `purchase/src/services/agreement-share.ts:39–82` (purchase, course purchase, course subscription) | INNER JOIN proposal | `.limit(1)`, no ORDER BY | A null `current_proposal_id` silently means "no agreement" (AGR-05) |
| `subscription-service.ts:4622–4652` inside `executeTransfers` | LEFT JOIN proposal | first wins; duplicates logged as errors; null share warned | |
| `agreements/agreement-service.ts:1041–1080` `getActiveAgreements` | none (returns rows) | `effectiveFrom desc` | routes only |
| `agreement-service.ts:1090–1141` `getActiveAgreementSummaries` | INNER JOIN | "now", status `active` only | ownership screens |
| `agreement-service.ts:1871–1901` `fetchExistingActiveShares` | none | reads the legacy `organizationFeePercentage`, no effective dates | AGR-03 |

The predicate body (active, or terminated after T; `effectiveFrom ≤ T`; `effectiveUntil` null or after T) is pasted three times. The canonical home, the agreements package, is not on the payout dependency path (Codex-2hxff.19).

### 3.6 Invoice → charge resolution: 3 implementations

- `SubscriptionService.resolveInvoiceCharge` (1422–1453, with `extractInvoiceCharge` and `extractInvoicePaymentIntent` at 612–622): inline payment, then expanded invoice, then `paymentIntents.retrieve().latest_charge`, then `charges.list`.
- `CourseSubscriptionService.resolveInvoiceCharge` (1307–1322): inline `payment.charge`, then expanded `payment.charge`. **No PaymentIntent fallback.** The Stripe SDK type (`stripe@19.3.1`, `InvoicePayments.d.ts`:74) says `charge` "is only surfaced if the charge object is not associated with a payment intent… the Invoice Payment surfaces the payment intent instead". Card-paid subscription invoices are PaymentIntent-backed, so this most likely returns null for every real course-subscription invoice. The result would be "Course subscription invoice has no charge — skipping payouts" (1043–1048): no ledger rows and no creator pay. The integration-test fixtures set both `payment_intent` and `charge` (`course-subscription-service.integration.test.ts:240,294,419`), which hides it. **NEW, likely P1 — verify against a real sandbox course invoice.**
- `ecom-api/handlers/checkout.ts`: `resolvePaymentIntentCharge` (39–68) is used by the course path. The content path **inlines the same block** (186–203).

### 3.7 Refund vs dispute access revocation (inside PurchaseService)

`processRefund` 1878–1913 and `processDispute` 2275–2307 have an identical transaction tail: soft-delete `contentAccess`, then revoke `entitlements` by `sourceRef` (67% of lines identical across the two methods). Revocation is inline, not in `entitlement-writer.ts`, which has no purchase-revoke function.

### 3.8 Creator payee lookup: inline 6 times; no `resolveCreatorPayee`

`stripeConnectAccounts.userId = creatorId` appears in:
- `writePurchasePayouts` 1305
- `writeCoursePayouts` 1258
- `executeTransfers` 4782 (batch)
- `cancelUnpaidPayoutForRefund` (ledger 692)
- `sweepUnresolvedPayouts` 5041
- `resolvePendingPayouts` 3564 (by `stripeAccountId`)

The org payee does have a seam (`resolveOrganisationPayee`).

### 3.9 "Payable" (Connect readiness) has 6 definitions

| Where | Rule |
|---|---|
| `payout-ledger.ts` `pendingReasonFor` 199–205 (decides whether to transfer now) | row exists && `chargesEnabled` (`payoutsEnabled` **not** checked) |
| `ConnectAccountService.isReadyForUser` 593 | `chargesEnabled && payoutsEnabled` (DB) |
| `TierService.requireActiveConnect` 972 | the same, via org payee |
| subscription and course-subscription checkout | Connect check present (purchase checkout: none, by design) |
| `connect-webhook.ts` 95 (starts the drain) | `charges_enabled && payouts_enabled` from the event |
| `sweepUnresolvedPayouts` 5060 | **live `stripe.accounts.retrieve`**, bypassing `ConnectAccountService`, so the local row is not synced |

**NEW** as a consolidated observation (SUB-04 is related).

### 3.10 Re-homing held `no_owner` money: 2 implementations in 2 packages

- `SubscriptionService.rehomeHeldPayouts` 4888–4939 (sweep): resolves the owner per row at `row.createdAt` through `resolveOrganisationPayee`.
- `organization/src/services/ownership-transfer.ts` 917–937 (`released`, line 925; in the transfer transaction): assigns every held row to `toUserId`.

Both set `reason: 'connect_not_ready'` whatever the new owner's state. The ledger does not own this state transition.

### 3.11 Transfer creation: 2 sites with different rules

| | `payout-ledger.recordSlice` 211–351 | `SubscriptionService.transferPendingGroup` 3763–3952 |
|---|---|---|
| Currency | hard-coded `CURRENCY.GBP` | row currency + `assertGbpOnly` |
| `source_transaction` | always | only if the row has a charge id |
| `transfer_group` | per caller flag | never |
| Idempotency | caller key (`${charge}_creator…`) | `payout_${id}_${attempt}` |
| Metadata `type` | payout type | `pending_payout_resolution` |
| Settle | `settleTransfer` | `settleTransfer` (shared) |

Only 8% of lines are similar. These are two genuinely separate implementations of "send this row", and the drain one sits outside the ledger module.

### 3.12 Checkout session creation

- Purchase `createCheckoutSession` vs `createCourseCheckoutSession`: 71% identical.
- Org-subscription vs course-subscription `createCheckoutSession`: 51%.

Common gaps: no idempotency key and no `expires_at` (PAY-10). Only the subscription paths check Connect. All four wrap `withStaleCustomerRecovery`, which is a good seam.

### 3.13 Plan and tier price management (TierService vs CourseSubscriptionService)

| Pair | Identical lines |
|---|---|
| `updateTier` vs `savePlanPrices` | 29% |
| `propagateTierPriceToActiveSubscriptions` vs `movePlanSubscribers` | 31% (both call the shared `schedulePriceChange`) |
| `rollbackStripePriceChanges` (103 LOC) vs `rollbackPriceChanges` (29) | — |

Parallel implementations of "a Stripe product with month and year prices"; the idempotency key prefixes differ. `ensureSubscriptionDataPresent` vs course `ensureDataPresent` are 57% identical: self-heal from Stripe metadata.

### 3.14 GBP assertion: 5 different behaviours

| Site | Behaviour |
|---|---|
| Org invoice `handleInvoicePaymentSucceeded` 1484 | `assertGbpOnly` throws `UnsupportedCurrencyError` (acknowledged 200; now raised before the UPDATE) |
| Course invoice 1032–1039 | logs, skips payouts, but **has already extended the period and the entitlement** |
| Drain 3876 | asserts the row currency |
| `recordSlice` | hard-codes GBP |
| Purchase webhooks `checkout.ts:225,334` | pass `CURRENCY.GBP` without reading `session.currency`; nothing is asserted (PAY-25) |

### 3.15 Small copies

- `isStripeError` in `purchase-service.ts:109` and `resolve-customer.ts:71`.
- An inline `StripeInvalidRequestError` check in `ensureSubscriptionDataPresent`.
- `£${(x/100).toFixed(2)}` formatting in 13 places: purchase 1, subscription 6, course 2, checkout handler 2, payment-webhook 2.
- `ledger()` deps builder in purchase 1388, subscription 4285 and course 1238 (inline).

---

## 4. Dependencies

### 4.1 Package and service graph (production)

```
@codex/agreements      → constants, database, service-errors, shared-types          (leaf; NOT used by any payout path)
@codex/purchase        → cache, constants, database, service-errors, shared-types, validation
@codex/subscription    → … + @codex/purchase   (ledger fns, resolveOrganisationPayee, FeeConfig types,
                          applyMinPlatformFeeFloor, calculateRevenueSplit [course only], DEFAULT_* fees,
                          findActiveCreatorAgreementShare, entitlement writers, withStaleCustomerRecovery)
@codex/access          → @codex/purchase   (constructs a full PurchaseService just for verifyPurchase)
@codex/organization    → writes payouts directly (ownership-transfer.ts:926)
@codex/admin           → reads purchases, payouts and subscriptions tables directly (analytics-service)
```

Runtime service-to-service calls inside packages:
- `SubscriptionService.sweepUnresolvedPayouts` → `this.resolvePendingPayouts`.
- `TierService.firePropagation` → injected closure → `registry.subscription.propagateTierPriceToActiveSubscriptions` (`service-registry.ts:1036`).
- `access-decision.ts:243` → `PurchaseService.verifyPurchase`.

There is no cross-service orchestration layer. Multi-service flows (refund, Connect activation) are orchestrated in the **worker handlers**.

### 4.2 Construction sites

| Site | Services built | Deps given (missing vs registry) |
|---|---|---|
| `service-registry.ts` 780–1135 | feeConfig, purchase, agreements, subscription, tier, connect, courseSubscription, courseAccess | full |
| `handlers/checkout.ts:210, 323` | PurchaseService ×2 | db, env (no feeConfig, mailer, webAppUrl) |
| `handlers/payment-webhook.ts:268, 272` | PurchaseService, SubscriptionService | db, env |
| `handlers/subscription-webhook.ts:232, 247, 265, 269` | SubscriptionService, TierService, CourseSubscriptionService, FeeConfigService | Subscription: no feeConfig, mailer or payoutMailer. Tier: no propagator. Course: feeConfig ✓ |
| `handlers/connect-webhook.ts:64, 122` | ConnectAccountService, SubscriptionService | Subscription: no feeConfig or payoutMailer (SUB-18) |
| `handlers/payouts-sweep.ts:68` | SubscriptionService | db, env only |

### 4.3 Stripe API calls per file (production, comment-stripped)

| File | Calls |
|---|---|
| `purchase/services/purchase-service.ts` | checkout.sessions.create ×2, .retrieve ×1, .list ×1 (self-heal); transfers.createReversal ×1; billingPortal.sessions.create ×1 |
| `purchase/utils/payout-ledger.ts` | transfers.create ×1, transfers.createReversal ×1 (surplus), transfers.list ×1 |
| `purchase/services/resolve-customer.ts` | customers.list ×1, customers.create ×1 (the only customer calls) |
| `purchase/stripe-client.ts` | webhooks.constructEventAsync |
| `subscription/services/subscription-service.ts` | checkout.sessions.create ×1, .retrieve ×1; subscriptions.retrieve ×4, .update ×3, .resume ×1; invoices.retrieve ×3, .createPreview ×1; paymentIntents.retrieve ×1; charges.list ×1; **transfers.create ×1** (drain); **transfers.createReversal ×1** (refund); **accounts.retrieve ×1** (sweep) |
| `subscription/services/pending-price-change.ts` | subscriptions.retrieve ×2, .update ×6 |
| `subscription/services/course-subscription-service.ts` | products.create ×1, .update ×3; prices.create ×4, .update ×4; checkout.sessions.create ×1; invoices.retrieve ×1 |
| `subscription/services/tier-service.ts` | products.create ×1, .update ×3; prices.create ×4, .update ×6 |
| `subscription/services/connect-account-service.ts` | accounts.create ×1, .retrieve ×2, .createLoginLink ×1; accountLinks.create ×1 |
| `ecom-api/handlers/checkout.ts` | paymentIntents.retrieve ×2 |
| `ecom-api/handlers/subscription-webhook.ts` | subscriptions.retrieve ×2 |

By API:
- **Transfers**: 2 create sites, 3 reversal sites (purchase refund, subscription refund, ledger surplus).
- **Refunds**: no `refunds.create` anywhere; refunds are issued in the Stripe Dashboard (Codex-2hxff.28).
- **Disputes**: no API calls.
- **Checkout**: 4 creates.
- **Subscriptions**: 13 calls across 3 files plus the worker.
- **Accounts**: 4 calls across 2 files.
- **Customers**: 2 calls, all in `resolve-customer.ts`.

### 4.4 `db.transaction()` sites

| File | Lines | What |
|---|---|---|
| purchase-service | 564, 1054 | sale completion: purchase + access + entitlement |
| purchase-service | 1878, 2275 | refund, dispute: status + access + entitlement (the reversal runs **after**) |
| subscription-service | 1164 | self-heal insert of subscription + follower + membership |
| subscription-service | 1915 | delete: cancel + membership inactive. Both cast `this.db as dbWs`, so transaction capability is not in the type |
| tier-service | 276, 475, 592, 733 | `dbWs` |
| agreement-service | 272, 368, 522, 725, 828, 894 | |
| admin customer-management | 330 | |
| organization ownership-transfer | in tx | ownership periods + payouts re-home |

**No transaction:** all ledger writes (by design: single-statement CAS and unique indexes), all of `CourseSubscriptionService` (status update and entitlement refresh are separate statements), all `FeeConfigService` writes, and `handleInvoicePaymentSucceeded` (subscription UPDATE, then `executeTransfers`).

### 4.5 Webhook dispatch (event → handler → service method)

| Endpoint | Event | Handler | Service calls |
|---|---|---|---|
| `/webhooks/stripe/booking` | `checkout.session.completed` (mode=payment) | `handleCheckoutCompleted` (checkout.ts 90) | `metadata.kind==='course'` → `handleCourseCheckoutCompleted` → `PurchaseService.completeCoursePurchase`; else `PurchaseService.completePurchase`. Then library invalidation and receipt email (re-sent on every redelivery, PAY-19) |
| `/webhooks/stripe/subscription` | `checkout.session.completed` (mode=subscription) | `handleSubscriptionWebhook` :336 | `stripe.subscriptions.retrieve` → course? `CourseSub.handleCourseSubscriptionCreated` : `Sub.handleSubscriptionCreated` + email |
| | `customer.subscription.updated` :388 | | course? `handleCourseSubscriptionUpdated` : `handleSubscriptionUpdated` + KV revoke/clear; then `applyDuePendingPriceChange` |
| | `customer.subscription.deleted` :459 | | course? `handleCourseSubscriptionDeleted` : `handleSubscriptionDeleted` + revoke + email |
| | `customer.subscription.paused` :496 / `.resumed` :520 | | `Sub.handleSubscriptionPaused/Resumed` only. **No course branch** |
| | `invoice.payment_succeeded` :543 | | `metadata.type==='course_subscription'` → `subscriptions.retrieve` → `CourseSub.handleCourseInvoicePaymentSucceeded`; else `Sub.handleInvoicePaymentSucceeded` (→ `executeTransfers`) |
| | `invoice.payment_failed` :668 | | `Sub.handleInvoicePaymentFailed` only. **No course branch**: a course invoice self-heals to null (no `codex_tier_id`), yet a `payment-failed` email is still built. **NEW** (verify) |
| | `customer.subscription.trial_will_end` :597 | | `Sub.handleTrialWillEnd` only |
| | `product.updated` :619 / `price.created` :639 / `price.updated` :648 | | `Tier.applyStripeProductUpdate` / `Tier.recordStripePriceDrift` / log only |
| `/webhooks/stripe/payment` and `/dispute` | `charge.refunded` | `handleChargeRefunded` (payment-webhook.ts 146) | `Sub.reverseSubscriptionPayoutsForCharge` **then** `Purchase.processRefund` (self-heal: `checkout.sessions.list`). Library invalidation; KV `revokeAccess` is dead (`processRefund` returns no `orgId`; the cast at 192 hides it, PAY-18); refund email |
| | `charge.dispute.created` | `handleChargeDisputeCreated` 200 | `Purchase.processDispute` only. No reversal and no subscription handling (PAY-05/06) |
| `/webhooks/stripe/connect` | `account.updated` | `handleConnectWebhook` 31 | `Connect.getAccountByStripeId`, `Connect.handleAccountUpdated`. On the inactive→active transition with `codex_organization_id` metadata, `Sub.resolvePendingPayouts(orgId, acct)` runs in `waitUntil`. Accounts are created with only `codex_user_id` (connect-account-service 241), so this branch never parses (SUB-05, Codex-2hxff.13) |
| | `account.application.deauthorized` | | `Connect.handleAccountDeauthorized` |
| `/webhooks/stripe/customer` | any | none (ack only) | — |
| `/webhooks/stripe/dev` | all | `routeDevWebhook` | prefix router; `checkout.session.completed` goes to both handlers |
| cron `0 * * * *` | — | `dispatchScheduled` → `runPayoutsSweep` | `Sub.sweepUnresolvedPayouts` → `rehomeHeldPayouts` / `accounts.retrieve` / `resolvePendingPayouts` |

---

## 5. Cross-cutting concerns and where they live

### 5.1 Webhook retry and error classification
- **Classification:** `ecom-api/src/utils/error-classification.ts` (`isTransientError` walks `cause` and `sourceError`; SQLSTATE, network and Stripe types). **Decision:** `utils/webhook-handler.ts` (transient → 500, else 200). **Wrapping:** `BaseService.handleError` (`@codex/service-errors`).
- The ledger throws INSERT failures and records transfer failures as `failed` rows.
- Several service paths catch and log, so the error never reaches the classifier:
  - the refund reversal loops (purchase catches cancel and update errors; subscription catches update errors);
  - `recordRefundReview`;
  - the `notify*` mailers;
  - `resolvePendingPayouts` per group (3663);
  - the sweep per group;
  - `handleCheckoutCompleted` PI retrieve (only transients rethrown).
- Out-of-band paths (the Connect activation drain in `waitUntil`, the cron) never get a Stripe retry. They rely on the hourly sweep. `dispatchScheduled` uses `console.error`.

### 5.2 Idempotency keys (all code literals)

| Purpose | Key | Site |
|---|---|---|
| Slice transfer | `${charge}_creator`, `${charge}_org_fee`, `${charge}_creator_${creatorId}`, `${charge}_creator_pool_owner` | purchase 1319/1353, course 1270/1296, subscription 4721/4831/4326. Passed into `recordSlice` |
| Drain transfer | `payout_${id}_${attempt}` | subscription 3902 |
| Refund reversal | `${transferId}_reversal${refundId or amount}` | purchase 2101, subscription 4457 |
| Surplus reversal | `${transferId}_reversal_surplus` | ledger 461 |
| Customer | `codex:resolve-customer:${userId}` | resolve-customer 147 |
| Connect account | `connect_acct_${userId}` | connect 246 |
| Tier and course plan products and prices | `tier-*-${idempotencyBase}`, `course-plan-*-${idempotencyBase}` | tier 222–419, course 209–459 |
| Price change | `price-change-{same,clear,now,tidy,apply}:${sub}:${price}` | pending-price-change 112–222 |
| Upgrade / resume | `upgrade_${sub}_${prorationDate}`, `resume_${stripeSubId}` | subscription 2376, 2606 (SUB-12/13) |
| Checkout sessions | **none** | PAY-10 |

The database-level idempotency (unique indexes `uq_payouts_*_per_charge`, ON CONFLICT DO NOTHING) lives only in the ledger.

### 5.3 Observability and errorIds
- `errorId: crypto.randomUUID()` is created ad hoc at each call site: ledger 6, subscription 7, purchase 4, other files 0. Many `obs.error` calls carry none: purchase has 11 `obs.error` but 4 errorIds; subscription 14 vs 7.
- The `payout_split_computed` event is emitted by 4 paths with different field sets.
- The worker logs root cause via `describeRootCause` (Codex-2hxff.6).

### 5.4 "At the sale's time"

| Path | Agreements | Org payee | Fees | Stored "sale time" |
|---|---|---|---|---|
| One-off / course purchase | `paidAt` (= `event.created`) | `purchase.purchasedAt ?? createdAt` | **now** (and in practice code constants) | `purchasedAt = paidAt ?? now` |
| Org subscription invoice | `invoice.created` | `invoice.created` | **now** | none (the subscription row's split columns are overwritten each invoice and by `changeTier`) |
| Course subscription invoice | `invoice.created` | `invoice.created` | **now** | none |
| Purchase self-heal (`ensurePurchaseDataPresent`) | — | — | code constants, no agreement or floor | `purchasedAt: new Date()` |
| `rehomeHeldPayouts` | — | `row.createdAt` (processing time, not sale time) | — | — |

The fee config has no time dimension, which blocks Codex-2hxff.33's 30-day notice. Fee reads go through KV (`FEE_CONFIG_*` cache types) on the money path.

### 5.5 Currency
See 3.14. `payouts.currency` defaults to `'gbp'`, and `recordSlice` never sets it. Pound formatting is repeated in 13 places.

### 5.6 Environment tagging
- **Tagged at creation** with `stripeEnvMetadata(env)`: purchase-service 5, subscription-service 4, course 6, tier 5, ledger 2, connect 1, resolve-customer 1.
- **Filtered** in exactly one place: `webhook-handler.ts` (`isForeignStripeEnvironment(ownMetadata(event))`; invoices read `parent.subscription_details.metadata`).
- `findTransfersForPayouts` matches by `payout_id` (a UUID), so a shared sandbox cannot collide. It still accepts the legacy `pending_payout_id` key from the dead `pending_payouts` table.

### 5.7 Notifications and cache invalidation: three patterns each
- **Email:**
  - a `WebhookEmailPayload` returned to the worker (org subscription);
  - an injected mailer callback (purchase, subscription `payoutMailer` and `mailer`, course, agreements); the mailer is **absent in every webhook construction**, so `creator-connect-needed` and `payout-released` effectively never send;
  - built in the worker (receipt, refund).
- **Cache:**
  - inside the service (`invalidateIfConfigured`, org subscription);
  - in the worker (`invalidateCourseBuyer`, `invalidateUserLibrary`, payment-webhook `invalidateLibrary`);
  - KV access revocation in the worker (`AccessRevocation`, from both subscription-webhook and payment-webhook).

---

## 6. Existing seams and what they own

| Seam | Owns | Does NOT own (still in services) |
|---|---|---|
| `purchase/utils/payout-ledger.ts` (782) | `recordSlice` (reserve-then-transfer, pending reasons, `no_owner` logging), `recordPlatformFee`, `settleTransfer` (+ surplus reversal), `settlePayoutPaid`, `markPayoutFailed`, `claimPayoutAttempt(s)` / `renewPayoutAttempt` (10-min lease), `cancelUnpaidPayoutForRefund`, `findTransfersForPayouts`, `isDrainablePayout`, `reportReplayMismatch` | Drain transfer creation (`transferPendingGroup`); refund reversal of paid slices (2 copies) and the `reversed` flip; `refund_reviews`; creator payee lookup; `no_owner` re-homing (2 copies, one in `@codex/organization`); min-transfer holds (decided by `executeTransfers`); payout read models |
| `purchase/utils/resolve-organisation-payee.ts` (162) | org owner at T (covering period → next owner → hold → single active owner membership) and that owner's Connect row | creator payee. It is also used for "now" readiness by TierService and ConnectAccountService (×4) |
| `agreements/services/agreement-math.ts` (208) + `AgreementService` | share validation, legacy conversion, proposal and agreement lifecycle, lifecycle emails, route reads | the payout-time resolver (`purchase/agreement-share.ts` plus the inline copy in `executeTransfers`) |
| `purchase/services/fee-config-service.ts` (677) | 3-tier resolution + KV cache, writes, audit | its own wiring: consumers take it optionally, with 3 different fallbacks; no time versioning |
| `purchase/services/revenue-calculator.ts` (205) | split arithmetic, min-platform floor, default constants | the subscription copy; the agreement fold-in; the multi-creator fan-out (`executeTransfers`) |
| `purchase/services/entitlement-writer.ts` (208) | content-purchase, course-purchase and course-subscription writes; refresh; course-sub revoke; auto-enrol | purchase-entitlement revoke (inline ×2); org-subscription access (derived from subscriptions + memberships + KV); admin grants (content_access only) |
| `purchase/services/resolve-customer.ts` (280) | Stripe Customer resolve/create + stale recovery (all 5 checkout and portal sites use it) | — (a complete seam) |
| `subscription/services/pending-price-change.ts` (281) | scheduling and applying price swaps (shared by tiers and course plans) | — |
| `subscription/services/stripe-status-mapper.ts` (96) | Stripe → local status | `handleInvoicePaymentSucceeded` still forces ACTIVE (SUB-09) |
| `subscription/services/subscription-invalidation.ts` (136) | org-subscription KV invalidation | course, purchase and refund invalidation (in the worker) |
| `ecom-api/utils/webhook-handler.ts` + `error-classification.ts` | environment filter, retry semantics | service construction (8 ad-hoc sites) |

---

## 7. Hotspots and observations

### 7.1 Largest methods (LOC)

| LOC | Method |
|---|---|
| 499 | `handleSubscriptionWebhook` (ecom-api) |
| 322 | `completePurchase` |
| 316 | `executeTransfers` |
| 228 | `PurchaseService.createCheckoutSession` |
| 209 | `TierService.updateTier` |
| 200 | `AgreementService.acceptProposal` |
| 198 | `changeTier` |
| 197 | `resolvePendingPayouts` |
| 195 | `ensureSubscriptionDataPresent` |
| 195 | `completeCoursePurchase` |
| 190 | `transferPendingGroup` |
| 187 | `handleCheckoutCompleted` (ecom-api) |
| 180 | `savePlanPrices` |
| 178 | `reversePayoutsForPurchase` |
| 173 | `reverseSubscriptionPayoutsForCharge` |
| 173 | `propagateTierPriceToActiveSubscriptions` |
| 165 | `getRevenueByCreator` (admin) |
| 154 | `getPayoutsByCreatorBreakdown` |
| 153 | `SubscriptionService.createCheckoutSession` |
| 152 | `createTier` |
| 149 | `writeCoursePayouts` |
| 149 | `handleConnectWebhook` |

### 7.2 Leaky responsibilities
- **`SubscriptionService` owns every source's drains.** `resolvePendingPayouts` groups by `purchase` vs `subscription`, and the drain had to learn purchase semantics: `c752bcdd` "route purchase-sourced retries through one_off fee policy" and `425b6d52` "pass source_transaction on retry; forward purchase metadata", both commits to subscription-service only.
- **`PurchaseService.createPortalSession` is the subscription billing portal.**
- **Refund orchestration lives in the worker.** `handleChargeRefunded` calls the subscription service, then the purchase service, then KV revoke and email.
- **The Connect activation drain trigger lives in the worker** and is keyed on org metadata, while the ledger is keyed by user.
- **`@codex/organization` writes `payouts`.** **`@codex/admin` aggregates revenue from raw tables** independently of `listSales`, `getPayoutSummary` and the rest (the third read model of the same ledger).
- **`@codex/access` constructs a `PurchaseService`** (2.7k LOC plus a Stripe client) to read one row.
- **Split state is stored per subscription, not per invoice.** `subscriptions.platformFeeCents/organizationFeeCents/creatorPayoutCents` are overwritten by `handleInvoicePaymentSucceeded` (~1530–1545), by `changeTier` 2429 and by self-heal (1180). The ledger rows are the only per-charge record.
- **Course subscriptions are only half-integrated into the subscription webhook.** Paused, resumed, payment_failed and trial_will_end have no course branch (4.5).

### 7.3 One fix applied 2–3 times (from `git log`)

| Commit(s) | What | Files |
|---|---|---|
| `0fe1aa73` (05-16) → `f673c1aa` (07-15, Codex-13v21) → `4bd9e70b` (10-18) | partial-refund reversal and insufficient_funds; later re-edited in both | purchase-service, then copied to subscription-service, then both |
| `8499a017` | `cancelled_by_refund` status | purchase-service + subscription-service |
| `bf37d471` | platform_fee unique-index race | purchase-service + subscription-service |
| `99987457` "fix(purchase,subscription): never route org-fee money to a removed owner" | — | purchase-service + subscription-service + connect + resolve-primary-connect |
| Codex-2hxff.2: `d190e79c` (purchases), `1edfefc7` (subscriptions), `56a075a9` (both + course + tier + connect) | payee and agreements at sale time | 8 files |
| Codex-2hxff.11: `0550ffc2` "purchases first", `58a947c8` "subscription and course invoices", `1e12841f` drains, `4bd9e70b` refunds | one-row-per-slice ledger rule, applied path by path | 4 commits |
| Codex-h69cg: 5 commits on 2026-05-15 | flip-flopping `source_transaction`, `transfer_group` and `application_fee_amount` | purchase + subscription |
| Codex-2hxff.5 | environment tagging | 5 service files |
| PAY-03/04 ↔ SUB-08, PAY-02 ↔ SUB-01 | the bug ledger itself records twin defects | — |

### 7.4 Notable defects surfaced by the survey (not in the ledger)
1. Course-subscription invoices most likely never record payouts: no PaymentIntent fallback in `resolveInvoiceCharge`, and fixtures that mask it (3.6).
2. `reverseSubscriptionPayoutsForCharge` does not catch a `cancelUnpaidPayoutForRefund` failure, so one row aborts the refund (3.1).
3. The no-config fallback org fee differs between course subscriptions (10%) and org subscriptions (15%) (3.3).
4. Course subscription GBP mismatch: access is extended but payouts skipped (3.14).
5. The sweep checks readiness with `accounts.retrieve`, bypassing `ConnectAccountService`, so the local row stays stale (3.9).
6. `pending_payouts` table is dead, but `findTransfersForPayouts` still matches its metadata key.
7. `payment-failed` email is likely sent for course-subscription invoices with no local state change (4.5; verify).

### 7.5 What would block extracting a **refunds module**
- **Orchestration lives in the worker** (`payment-webhook.ts` 146–198). A module needs one entry point, "charge refunded (charge, cumulative amount, refund id)", that finds the sale (purchase by PI, or org or course subscription by charge) itself.
- **Schema:** `refund_reviews.purchase_id NOT NULL` (and `onDelete: restrict`) stops subscription clawbacks being queued. It needs a `stripe_charge_id`- or `payout`-keyed review.
- **Partial-refund state is not modelled.** The purchase status is binary REFUNDED, and payout rows go straight to `reversed`, with no "reversed amount so far". Incremental refunds (Codex-2hxff.8) need a per-row reversed amount or a reversal ledger.
- **Access revocation is inline** (purchase transaction 1878–1913), with no `revokePurchaseEntitlement` in the writer. Org-subscription access revocation is KV in the worker, with no service API.
- **`processRefund` is coupled to the self-heal** `ensurePurchaseDataPresent`, which writes a purchase with code-default fees, `purchasedAt = now`, no access and no payouts.
- **Disputes share none of the reversal code** and live only in `PurchaseService`.
- **Package direction:** a refunds module covering both kinds of sale must sit in `@codex/purchase` (or a new package below `@codex/subscription`), because subscription depends on purchase. The payout rows already carry `sourceType` and the source ids, so it does not need subscription types.

### 7.6 What would block extracting a **split-calculation module**
- **Two arithmetic copies** with different validation (3.4).
- **Two split shapes.** Purchases fold the agreement into the org % before the split. Org subscriptions split at org level, then fan the post-platform pool out across N creators (floor per creator, remainder to the org), and send the creator pool to the owner when there is no agreement. For one creator the two give equal amounts, but they are different algorithms, and the minimum platform floor is applied before the fan-out in one and after the agreement fold in the other.
- **Fee inputs are resolved inside each service** from an optional `FeeConfigService`, with three fallbacks and no time parameter. A pure module needs fees passed in, and the wiring problem (Codex-2hxff.7) fixed at the construction layer first.
- **Agreement resolution is a DB query embedded in the split step** (an inline copy in `executeTransfers`). The natural owner, `@codex/agreements`, is not a dependency of purchase or subscription. Choosing where the resolver lives is a dependency-direction decision (Codex-2hxff.19).
- **The split is persisted twice with different lifetimes.** It goes on the sale row (purchase, immutable; subscription, overwritten) and in the ledger slices. The module's output must map to both, or the subscription columns should become reporting-only.
- **`minTransferCents` is a split-time concern in only one path** and a drain-time concern in another.
