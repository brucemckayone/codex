# Commerce System Audit -- Master Report

> Generated: 2026-04-10
> Scope: Subscription, Content Access, Purchase, Seed/Schema, Connect/Revenue, Frontend
> Domain reports: [01](01-subscription-service.md) | [02](02-content-access.md) | [03](03-purchase-flow.md) | [04](04-seed-data.md) | [05](05-connect-revenue.md) | [06](06-frontend-flows.md)

## Executive Summary

The commerce system has solid architecture -- Stripe Connect, dual revenue models, content access gating, and multi-party splits are all structurally sound. However, **three critical bugs block end-to-end testing**: the seed script crashes on the dropped `visibility` column (BUG-001), seed tiers have no Stripe Price IDs so subscription checkout 422s (BUG-002), and the `content_access.deletedAt` column referenced by the refund pipeline does not exist in the schema (BUG-003). Beyond these blockers, subscription-only content with no price is freely accessible to any authenticated user (BUG-004), the dev webhook router silently drops subscription checkout events (BUG-007), and the entire refund pipeline is non-functional. The audit identified **33 unique bugs** and **42 improvements** across all six domains. Estimated total fix effort is **65-90 hours** across 6 phases, with the first two phases (unblock local dev + fix core access chain) requiring approximately **15-20 hours**.

---

## Critical Path: What Blocks End-to-End Testing

The minimum set of fixes to get a user through: **view tiers -> checkout -> Stripe payment -> webhook -> access content -> see in library**.

1. **BUG-001**: Seed script crashes on dropped `visibility` column -- cannot seed any data (15 min fix)
2. **BUG-002 / BUG-003**: Seed tiers have null Stripe Price IDs -- subscription checkout returns 422 (1-2h fix with Stripe API seeding)
3. **BUG-008**: `enableSubscriptions` feature flag not set to `true` for Studio Alpha -- subscription UI hidden (5 min fix)
4. **BUG-007**: Dev webhook router routes subscription `checkout.session.completed` to purchase handler, which silently drops it -- subscription never created locally (30 min fix)
5. **BUG-004**: Content with `accessType='subscribers'` and `priceCents=null` falls through to "free" branch -- no paywall enforced (4-6h fix)
6. **BUG-013**: Library listing excludes subscription-based content entirely -- subscriber sees empty library (6-8h fix)

After these 6 fixes, a subscription checkout -> webhook -> access -> library flow works end-to-end in local dev.

---

## All Bugs -- Deduplicated & Prioritized

### P0 -- Critical (blocks core functionality)

| ID | Title | Domain(s) | File:Line | Fix Summary |
|---|---|---|---|---|
| BUG-001 | Seed writes dropped `visibility` column -- seed script crashes | Seed | `packages/database/scripts/seed/constants.ts:304+`, `scripts/seed/content.ts:66` | Remove `visibility` property from all CONTENT entries and from the insert statement |
| BUG-002 | Seed tiers have null Stripe Price IDs -- subscription checkout 422s | Subscription, Seed | `packages/database/scripts/seed/commerce.ts:205-242`, `packages/subscription/src/services/subscription-service.ts:160-169` | Create Stripe Products/Prices during seed when STRIPE_SECRET_KEY is set |
| BUG-003 | `content_access.deletedAt` column does not exist -- refund crashes | Access, Purchase, Connect | `packages/purchase/src/services/purchase-service.ts:696-705`, `packages/database/src/schema/ecommerce.ts:24-75` | Add `deletedAt` column to `content_access` table via migration |
| BUG-004 | No explicit `accessType='subscribers'` branch -- subscription-only content treated as free | Access | `packages/access/src/services/ContentAccessService.ts:227-390` | Add explicit `'subscribers'` branch before the `priceCents > 0` check |
| BUG-005 | `processRefund()` is not transactional -- partial state on failure | Access, Purchase | `packages/purchase/src/services/purchase-service.ts:669-716` | Wrap both DB operations in `db.transaction()` |
| BUG-006 | `content_access` unique constraint blocks re-purchase after refund | Access, Purchase | `packages/database/src/schema/ecommerce.ts:69-73`, `packages/purchase/src/services/purchase-service.ts:433-439` | Use `onConflictDoUpdate` in `completePurchase()` |

### P1 -- High (breaks secondary flows)

| ID | Title | Domain(s) | File:Line | Fix Summary |
|---|---|---|---|---|
| BUG-007 | Dev webhook router drops subscription-mode `checkout.session.completed` | Connect, Subscription | `workers/ecom-api/src/utils/dev-webhook-router.ts:36-40` | Change checkout route to only match `mode=payment`, or forward subscription-mode to subscription handler |
| BUG-008 | `enableSubscriptions` not set to `true` for Studio Alpha seed | Seed | `packages/database/scripts/seed/organizations.ts:134-149` | Add `enableSubscriptions: true` to Alpha's feature settings |
| BUG-009 | `invoice.payment_failed` does not update subscription status to `past_due` | Subscription, Connect | `workers/ecom-api/src/handlers/subscription-webhook.ts:174-200` | Add `handleInvoicePaymentFailed()` service method and call it from the webhook handler |
| BUG-010 | Cancellation email never fires -- metadata keys mismatch | Subscription, Connect | `workers/ecom-api/src/handlers/subscription-webhook.ts:118-137`, `packages/subscription/src/services/subscription-service.ts:184-189` | Look up customer info from DB using `codex_user_id` metadata instead of nonexistent `customerEmail` |
| BUG-011 | Revenue split on creation uses list price, not actual charged amount | Subscription | `packages/subscription/src/services/subscription-service.ts:238-239` | Use `latest_invoice.amount_paid` instead of `unit_amount` |
| BUG-012 | Pending payout inserted with empty string userId when org has no Connect | Connect | `packages/subscription/src/services/subscription-service.ts:885` | Look up org owner's userId or skip insertion when `orgConnect` is null |
| BUG-013 | Library listing excludes subscription-based content entirely | Access | `packages/access/src/services/ContentAccessService.ts:581-937` | Add `querySubscription()` data source to `listUserLibrary()` |
| BUG-014 | Pending payouts table is write-only -- no resolution mechanism | Connect, Subscription | `packages/subscription/src/services/subscription-service.ts` (entire) | Implement `resolvePendingPayouts()` triggered on Connect account activation |
| BUG-015 | Subscription access skipped when `minimumTierId` is null | Access | `packages/access/src/services/ContentAccessService.ts:288` | Handle `accessType='subscribers'` with null `minimumTierId` gracefully (treat as "any active sub") |
| BUG-016 | No `organizationMemberships` row created for subscribers | Access | `packages/subscription/src/services/subscription-service.ts:219-294` | Upsert membership with `role='subscriber'` in `handleSubscriptionCreated()` |
| BUG-017 | `processRefund()` does not set refund tracking fields | Purchase | `packages/purchase/src/services/purchase-service.ts:690-692` | Extend `processRefund()` to accept and populate `refundedAt`, `refundAmountCents`, `stripeRefundId`, `refundReason` |

### P2 -- Medium (incorrect data, poor UX)

| ID | Title | Domain(s) | File:Line | Fix Summary |
|---|---|---|---|---|
| BUG-018 | Receipt email always shows "Content purchase" -- metadata `contentTitle` never set | Purchase | `workers/ecom-api/src/handlers/checkout.ts:166-167`, `packages/purchase/src/services/purchase-service.ts:271-276` | Add `contentTitle` to Stripe session metadata |
| BUG-019 | Application fee calculation duplicated and potentially divergent | Purchase | `packages/purchase/src/services/purchase-service.ts:215-218 vs 362-371` | Extract to shared function using `calculateRevenueSplit()` |
| BUG-020 | `changeTier()` race condition -- Stripe update and DB update not atomic | Subscription | `packages/subscription/src/services/subscription-service.ts:529-557` | Add compensation mechanism; rely on `customer.subscription.updated` webhook for reconciliation |
| BUG-021 | `creatorOrganizationAgreements.organizationFeePercentage` semantically repurposed as creator share | Subscription, Connect | `packages/subscription/src/services/subscription-service.ts:904-906` | Rename column or add dedicated `creatorShareBps` column |
| BUG-022 | Subscription checkout missing `customer_email` on Stripe session | Connect | `packages/subscription/src/services/subscription-service.ts:173-191` | Pass `customer_email` from user profile to `checkout.sessions.create()` |
| BUG-023 | `listSubscribers` query includes cancelled subscriptions by default | Subscription | `packages/subscription/src/services/subscription-service.ts:691-727` | Add default status filter excluding cancelled subscriptions |
| BUG-024 | `getSubscriptionStats.totalSubscribers` counts cancelled subscriptions | Subscription | `packages/subscription/src/services/subscription-service.ts:733-741` | Filter `count(*)` to exclude cancelled status |
| BUG-025 | Renewal email shows "N/A" for next billing date | Subscription | `workers/ecom-api/src/handlers/subscription-webhook.ts:162-165` | Use subscription's `current_period_end` instead of `next_payment_attempt` |
| BUG-026 | Subscription-created email shows Stripe Product ID as plan name | Subscription | `workers/ecom-api/src/handlers/subscription-webhook.ts:85-87` | Look up tier name from DB using `codex_tier_id` metadata |
| BUG-027 | `enableSubscriptions` flag not checked on customer-facing pricing/content pages | Frontend | `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`, `content/[contentSlug]/+page.server.ts` | Pass flag from org layout and conditionally hide subscription UI |
| BUG-028 | Pricing page has no error display when checkout fails | Frontend | `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte:50-53` | Add `checkoutError` state and display alert on failure |
| BUG-029 | Platform-level `/pricing` page is a static placeholder disconnected from subscription system | Frontend | `apps/web/src/routes/(platform)/pricing/+page.svelte` | Remove from platform navigation or transform into org discovery |
| BUG-030 | No cache invalidation after subscription creation/cancellation | Access | `packages/subscription/src/services/subscription-service.ts` (entire) | Add VersionedCache invalidation to subscription webhook handlers |
| BUG-031 | Subscription success redirects to `/library?subscription=success` but param is never consumed | Frontend | `apps/web/src/lib/remote/subscription.remote.ts:91-92,137-138` | Consume param with success toast, or redirect to `/checkout/success` |
| BUG-032 | No org memberships for seed customers 1-5 | Seed | `packages/database/scripts/seed/organizations.ts:30-85` | Add `member` memberships for customers 1-5 to Studio Alpha |

### P3 -- Low (gaps, inconsistencies)

| ID | Title | Domain(s) | File:Line | Fix Summary |
|---|---|---|---|---|
| BUG-033 | `pending_payouts` missing from TABLES_TO_TRUNCATE; `reset-data.ts` missing subscription tables | Seed | `packages/database/scripts/seed-data.ts:27-53`, `scripts/reset-data.ts:20-51` | Add missing tables to both truncation lists |
| BUG-034 | Studio Beta has no Stripe Connect account in seed | Seed | `packages/database/scripts/seed/commerce.ts:287-335` | Create second Express account for Beta or document the gap |
| BUG-035 | Subscription uses fake Stripe IDs that won't validate against Stripe API | Seed | `packages/database/scripts/seed/commerce.ts:264-283` | Document limitation or create real test subscriptions |
| BUG-036 | Pending payout inserts (lines 945-951, 1021-1027) not wrapped in try/catch | Subscription | `packages/subscription/src/services/subscription-service.ts:945-951,1021-1027` | Add try/catch matching pattern used elsewhere in `executeTransfers()` |
| BUG-037 | Creator pool rounding can lose pence with multiple creators | Connect | `packages/subscription/src/services/subscription-service.ts:979-981` | Add remainder to last creator's transfer after loop |
| BUG-038 | Validation allows annual price greater than 12x monthly price | Subscription | `packages/validation/src/schemas/subscription.ts:46-65` | Add `.refine()` cross-field validation |
| BUG-039 | Delete tier dialog has no loading state (double-click possible) | Frontend | `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte:573` | Add `deleteLoading` state variable |
| BUG-040 | Delete tier error reuses `tierFormError` from create/edit dialog | Frontend | `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte:222-224` | Create separate `deleteError` state variable |
| BUG-041 | Reactivate subscription error writes to `cancelError` variable | Frontend | `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte:85-86` | Add separate `reactivateError` state |
| BUG-042 | `currentPeriodEnd` cast as `unknown as string` in subscription management | Frontend | `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte:158,169` | Fix `UserOrgSubscription` type to reflect serialized string |
| BUG-043 | Pricing page login redirect loses tier selection and billing interval | Frontend | `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte:36-54` | Encode `tierId` and `billingInterval` in redirect URL |

---

## Cross-Domain Issues

These issues span multiple domains and were not fully captured by any single agent.

### 1. The `content_access` table is structurally broken across three dimensions

The `content_access` table appears in findings from Access, Purchase, Connect, and Seed agents, but no single agent captured the full picture:

- **Schema gap**: No `deletedAt` column (BUG-003) -- blocks refunds
- **Write-only**: Records are created on purchase/complimentary grant but NEVER queried by the access check algorithm (IMP-ACC-007) -- complimentary admin grants do nothing
- **No subscription rows**: The `accessType` CHECK constraint allows `'subscription'` but no code creates these rows (IMP-CON-005, IMP-SEED-008)
- **No traceability**: No `purchaseId` or `subscriptionId` FK to trace why access was granted (IMP-SEED-001)

**Recommendation**: A dedicated work packet should decide whether `content_access` becomes the authoritative access check table (preferred) or is removed entirely. Currently it is a write-only table that misleads developers into thinking it controls access.

### 2. Asymmetric revenue flows confuse users and complicate operations

The Purchase agent documented the destination-charge model (creator gets 90% directly). The Connect agent documented the separate-charges-and-transfers model (platform collects, then distributes). The Frontend agent found no UI explanation of which model applies when. Together:

- **Purchases**: Money goes to creator's Connect account via destination charge (BUG-CON-009)
- **Subscriptions**: Money goes to platform, then transferred to org + creators via `stripe.transfers.create()`
- **No UI explanation**: The Studio monetisation page does not explain this split to creators/owners
- **Org Connect account is ignored for purchases**: Even if the org has a completed Connect account, purchase revenue only flows to the individual creator (IMP-CON-013)

### 3. Subscription feature flag is enforced studio-side only

The Frontend agent found BUG-FE-009 (customer pages don't check `enableSubscriptions`). The Seed agent found BUG-SEED-003 (flag defaults to `false`). Together: even after fixing the seed data, the flag does nothing customer-facing. An owner who disables subscriptions in the studio still has public-facing pricing pages showing tiers and accepting checkouts.

### 4. Email metadata is consistently broken across all commerce email paths

Across Subscription (BUG-SUB-003, BUG-SUB-004, IMP-SUB-009), Purchase (BUG-PUR-004, IMP-PUR-010), and Connect (IMP-CON-007) agents, every commerce email has some form of missing or incorrect metadata: wrong plan names (Stripe Product IDs), missing content titles ("Content purchase"), missing customer details preventing email delivery, and wrong date fields ("N/A"). This is a systemic pattern, not isolated bugs.

---

## Deduplication Notes

The following bugs were reported by multiple domain agents and have been merged into single unified IDs:

| Unified ID | Merged From | Description |
|---|---|---|
| BUG-002 | BUG-SUB-001, BUG-SEED-007 | Seed tiers have null Stripe Price IDs -- same root cause reported by Subscription and Seed agents |
| BUG-003 | BUG-ACC-003, BUG-PUR-001, BUG-CON-001 | `content_access.deletedAt` column missing -- reported by Access, Purchase, and Connect agents |
| BUG-005 | BUG-ACC-005 (partial), BUG-PUR-002, IMP-ACC-006 | `processRefund()` not transactional -- reported by Access and Purchase agents |
| BUG-006 | BUG-ACC-005, BUG-PUR-003 | Unique constraint blocks re-purchase after refund -- reported by Access and Purchase agents |
| BUG-010 | BUG-SUB-003, IMP-CON-007 | Cancellation email metadata missing -- reported by Subscription and Connect agents |
| BUG-014 | IMP-SUB-001, BUG-CON-004 | Pending payouts write-only with no resolution -- reported by Subscription and Connect agents |
| BUG-017 | BUG-PUR-005, IMP-PUR-010 | Refund tracking fields not populated / refund email uses unset metadata -- reported by Purchase agent (two related bugs merged) |
| BUG-021 | BUG-SUB-007, BUG-CON-006 | `organizationFeePercentage` repurposed semantically -- reported by Subscription and Connect agents |
| BUG-022 | BUG-CON-003, BUG-PUR-007 (partial) | Missing customer email/customer on Stripe sessions -- reported by Connect and Purchase agents |
| BUG-035 | BUG-SEED-006, BUG-SEED-007 (partial) | Fake Stripe IDs in seed data -- Seed agent reported for both subscriptions and tiers |

### Domain ID to Unified ID Map

| Domain ID | Unified ID | | Domain ID | Unified ID |
|---|---|---|---|---|
| BUG-SUB-001 | BUG-002 | | BUG-ACC-001 | BUG-004 |
| BUG-SUB-002 | BUG-009 | | BUG-ACC-002 | BUG-015 |
| BUG-SUB-003 | BUG-010 | | BUG-ACC-003 | BUG-003 |
| BUG-SUB-004 | BUG-025 | | BUG-ACC-004 | BUG-013 |
| BUG-SUB-005 | BUG-011 | | BUG-ACC-005 | BUG-006 |
| BUG-SUB-006 | BUG-020 | | BUG-ACC-006 | BUG-016 |
| BUG-SUB-007 | BUG-021 | | BUG-ACC-007 | BUG-030 |
| BUG-SUB-008 | BUG-036 | | BUG-ACC-008 | (low, not unified) |
| BUG-SUB-009 | BUG-036 | | BUG-PUR-001 | BUG-003 |
| BUG-SUB-010 | BUG-023 | | BUG-PUR-002 | BUG-005 |
| BUG-SUB-011 | BUG-024 | | BUG-PUR-003 | BUG-006 |
| BUG-SUB-012 | BUG-038 | | BUG-PUR-004 | BUG-018 |
| BUG-CON-001 | BUG-003 | | BUG-PUR-005 | BUG-017 |
| BUG-CON-002 | BUG-012 | | BUG-PUR-006 | BUG-019 |
| BUG-CON-003 | BUG-022 | | BUG-PUR-007 | BUG-022 (partial) |
| BUG-CON-004 | BUG-014 | | BUG-SEED-001 | BUG-001 |
| BUG-CON-005 | BUG-007 | | BUG-SEED-002 | BUG-033 |
| BUG-CON-006 | BUG-021 | | BUG-SEED-003 | BUG-008 |
| BUG-CON-007 | BUG-037 | | BUG-SEED-004 | BUG-034 |
| BUG-CON-008 | BUG-009 | | BUG-SEED-005 | BUG-032 |
| BUG-CON-009 | (noted, by design) | | BUG-SEED-006 | BUG-035 |
| BUG-FE-001 | BUG-039 | | BUG-SEED-007 | BUG-002 |
| BUG-FE-002 | BUG-040 | | BUG-SEED-008 | BUG-033 |
| BUG-FE-003 | (low, not unified) | | BUG-FE-007 | BUG-028 |
| BUG-FE-004 | BUG-031 | | BUG-FE-008 | BUG-029 |
| BUG-FE-005 | BUG-042 | | BUG-FE-009 | BUG-027 |
| BUG-FE-006 | BUG-043 | | BUG-FE-010 | (low, not unified) |
| BUG-FE-011 | (low, not unified) | | BUG-FE-012 | BUG-041 |

---

## Recommended Fix Order

### Phase 1: Unblock Local Dev (est. 3-4h)

These fixes are required to make `pnpm db:seed` work and get basic checkout functioning.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-SEED-01 | 04-seed-data | BUG-001 | 15 min | Remove `visibility` column from seed constants and insert |
| WP-SEED-02 | 04-seed-data | BUG-033 | 10 min | Add missing tables to TABLES_TO_TRUNCATE in both scripts |
| WP-SEED-03 | 04-seed-data | BUG-008 | 5 min | Set `enableSubscriptions: true` for Studio Alpha |
| WP-SUB-01 | 01-subscription | BUG-002 | 1-2h | Create Stripe Products/Prices during seed when STRIPE_SECRET_KEY is set |
| WP-CON-03 | 05-connect | BUG-007 | 30 min | Fix dev webhook router to route subscription checkout correctly |
| WP-SEED-04 | 04-seed-data | BUG-032 | 20 min | Add org memberships for customers 1-5 |

**Outcome**: Seed script runs without crashing. Subscription checkout works in dev. Subscription webhooks route correctly locally.

### Phase 2: Fix Core Access Chain (est. 12-16h)

The access algorithm, refund pipeline, and library must work correctly.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-ACC-01 | 02-content-access | BUG-004, BUG-015 | 4-6h | Refactor `getStreamingUrl()` to branch on `accessType` first; add explicit `subscribers` branch |
| WP-ACC-02 | 02-content-access | BUG-003, BUG-005, BUG-006 | 4-6h | Add `deletedAt` to `content_access`, make `processRefund()` transactional, use `onConflictDoUpdate` for re-purchase |
| WP-ACC-03 | 02-content-access | BUG-013 | 6-8h | Add subscription content to user library with `querySubscription()` data source |

**Dependencies**: WP-ACC-01 must complete before WP-ACC-03. WP-ACC-02 is independent and can run in parallel.

**Outcome**: Subscription-only content requires a subscription. Refunds revoke access. Re-purchase after refund works. Subscribers see their content in the library.

### Phase 3: Fix Purchase/Refund Pipeline (est. 8-12h)

Complete the refund tracking, email metadata, and fee reconciliation.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-PUR-01 | 03-purchase-flow | BUG-017 | 4-6h | Populate refund tracking fields, extend `processRefund()` signature, add partial refund awareness |
| WP-PUR-02 | 03-purchase-flow | BUG-018 | 1-2h | Add `contentTitle` to Stripe session metadata for receipt emails |
| WP-PUR-03 | 03-purchase-flow | BUG-019 | 2-3h | Deduplicate application fee calculation, add reconciliation check |

**Dependencies**: WP-PUR-01 depends on WP-ACC-02 (Phase 2) for the `content_access.deletedAt` migration. WP-PUR-02 and WP-PUR-03 are independent.

**Outcome**: Refunds populate all tracking fields. Receipt emails show actual content title. Fee calculations are consistent.

### Phase 4: Fix Notifications & Subscription Data Quality (est. 8-10h)

Fix all broken email paths and subscription status accuracy.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-SUB-02 | 01-subscription | BUG-009, BUG-010, BUG-025, BUG-026 | 4-6h | Add `handleInvoicePaymentFailed`, fix all 4 subscription email metadata issues |
| WP-SUB-06 | 01-subscription | BUG-023, BUG-024 | 1-2h | Fix `listSubscribers` and `getSubscriptionStats` to exclude cancelled subs |
| WP-ACC-04 | 02-content-access | BUG-016, BUG-030 | 3-4h | Create subscriber org memberships, add cache invalidation to subscription lifecycle |

**Dependencies**: None (can run in parallel with Phase 3).

**Outcome**: All commerce emails send with correct data. Subscription status is accurate. Subscriber lists are meaningful. Cache updates after subscription events.

### Phase 5: Revenue & Operations (est. 12-16h)

Fix revenue accuracy, pending payouts, and Connect improvements.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-SUB-03 | 01-subscription | BUG-011 | 1-2h | Use `latest_invoice.amount_paid` for revenue split instead of list price |
| WP-CON-02 | 05-connect | BUG-012 | 30 min | Fix empty userId in pending payout insert |
| WP-CON-04 | 05-connect | BUG-014 | 4h | Implement pending payout resolution mechanism triggered on Connect activation |
| WP-SUB-04 | 01-subscription | BUG-020, BUG-036 | 3-4h | Add compensation for `changeTier()` race condition, wrap pending payout inserts in try/catch |
| WP-CON-05 | 05-connect | BUG-022 | 1h | Add `customer_email` to subscription checkout session |
| WP-SUB-05 | 01-subscription | (IMP-SUB-001, IMP-SUB-007) | 4-6h | Build pending payout resolution system with admin visibility |

**Dependencies**: WP-SUB-04 should complete before WP-SUB-05. WP-CON-02 is standalone.

**Outcome**: Revenue tracking is accurate. Pending payouts can be resolved. Tier changes have compensation. Connect onboarding has better UX.

### Phase 6: Frontend Polish (est. 8-12h)

Fix customer-facing UX issues across pricing, checkout, and subscription management.

| WP | Source | Bugs Fixed | Effort | Description |
|---|---|---|---|---|
| WP-FE-03 | 06-frontend | BUG-027 | 2-3h | Enforce `enableSubscriptions` flag on customer-facing pages |
| WP-FE-02 | 06-frontend | BUG-028 | 30 min | Add error display to pricing page checkout |
| WP-FE-04 | 06-frontend | BUG-031 | 1-2h | Fix subscription success redirect, add success feedback |
| WP-FE-01 | 06-frontend | BUG-039, BUG-040 | 30 min | Fix tier delete dialog loading state and error variable |
| WP-FE-08 | 06-frontend | BUG-041 | 20 min | Fix reactivate error display |
| WP-FE-09 | 06-frontend | BUG-043 | 1h | Preserve tier selection through login redirect |
| WP-FE-10 | 06-frontend | BUG-029 | 1-2h | Remove or repurpose platform-level pricing page |

**Dependencies**: WP-FE-03 depends on the `enableSubscriptions` flag being properly set (Phase 1, WP-SEED-03). All others are independent.

**Outcome**: Customer-facing commerce flows have proper error handling, loading states, and feature gating.

---

## Improvements Summary

Consolidated non-bug improvements from all domains, grouped by theme.

### Access & Library Quality
| ID | Source | Description |
|---|---|---|
| IMP-ACC-001 | 02-content-access | Library merge-sort pagination incorrect for multi-source queries |
| IMP-ACC-002 | 02-content-access | Membership library query returns ALL org content, not just members-access content |
| IMP-ACC-005 | 02-content-access | Streaming URL expiry not configurable per access type |
| IMP-ACC-007 | 02-content-access | `content_access` table is write-only -- never queried by access algorithm (admin grants broken) |

### Schema & Data Integrity
| ID | Source | Description |
|---|---|---|
| IMP-SEED-001 | 04-seed-data | `content_access` lacks traceability FK to purchase/subscription |
| IMP-SEED-002 | 04-seed-data | `subscriptions` table missing `currency` column |
| IMP-SEED-003 | 04-seed-data | `purchases` and `content_access` lack `deletedAt` for soft deletes (partially addressed by BUG-003 fix) |
| IMP-SEED-004 | 04-seed-data | Timestamp timezone inconsistency between auth and commerce tables |
| IMP-SEED-006 | 04-seed-data | `pending_payouts` table missing `updatedAt` column |
| IMP-SEED-011 | 04-seed-data | `subscription_tiers` has no `features` column for tier differentiation |
| IMP-SUB-005 | 01-subscription | Dedicated creator share table needed (instead of repurposed column) |

### Performance & Indexing
| ID | Source | Description |
|---|---|---|
| IMP-ACC-003 | 02-content-access | Missing composite index for subscription access check |
| IMP-SEED-005 | 04-seed-data | Missing composite index on `content_access` for user+org+accessType queries |
| IMP-SUB-007 | 01-subscription | Missing index on `pending_payouts` for org-level resolution queries |
| IMP-CON-011 | 05-connect | MRR calculation uses integer division for annual subscriptions |

### Stripe Integration
| ID | Source | Description |
|---|---|---|
| IMP-CON-001 | 05-connect | Connect account creation missing `business_profile` and `email` |
| IMP-CON-002 | 05-connect | No `creatorOrganizationAgreements` CRUD or seed data |
| IMP-CON-004 | 05-connect | No refund handling for subscription payments (transfer reversals) |
| IMP-CON-005 | 05-connect | No subscription-mode `contentAccess` grant on creation |
| IMP-CON-009 | 05-connect | No rate limiting on Connect dashboard link generation |
| IMP-CON-013 | 05-connect | Purchase model ignores org Connect account entirely |
| IMP-PUR-001 | 03-purchase-flow | `completePurchase()` idempotency check should verify metadata consistency |
| IMP-PUR-005 | 03-purchase-flow | Revenue split uses hardcoded defaults -- no database fee lookup |
| IMP-PUR-011 | 03-purchase-flow | No partial refund support |

### Webhook & Error Handling
| ID | Source | Description |
|---|---|---|
| IMP-PUR-004 | 03-purchase-flow | Webhook handler logs permanent failure at `warn` level, not `error` |
| IMP-PUR-006 | 03-purchase-flow | `verifyCheckoutSession()` does not gracefully handle webhook race condition |
| IMP-CON-010 | 05-connect | Webhook ordering race: `account.updated` before DB record exists |
| IMP-SUB-010 | 01-subscription | Stripe API calls in webhook handler not protected against rate limits |
| IMP-SUB-002 | 01-subscription | Double DB round-trip in subscription management endpoints |
| IMP-SUB-003 | 01-subscription | No subscription access revocation on cancellation |

### Frontend UX
| ID | Source | Description |
|---|---|---|
| IMP-FE-001 | 06-frontend | Duplicated content detail page code between org and creator routes |
| IMP-FE-002 | 06-frontend | Duplicated library page code between platform and org routes |
| IMP-FE-003 | 06-frontend | No tier upgrade/downgrade flow from within content detail or subscription management |
| IMP-FE-004 | 06-frontend | No confirmation/success feedback after subscription cancel/reactivate actions |
| IMP-FE-005 | 06-frontend | Monetisation page has 5 `as QueryResult<T>` type assertions |
| IMP-FE-006 | 06-frontend | Checkout success does not invalidate library collection |
| IMP-FE-007 | 06-frontend | Free content shows same "Lifetime access" benefits as paid content |
| IMP-FE-008 | 06-frontend | Tier breakdown has hardcoded English strings (not i18n) |
| IMP-FE-009 | 06-frontend | No loading skeleton for `enableSubscriptions` toggle during load |
| IMP-FE-011 | 06-frontend | `createSubscriptionCheckout` form function defined but never used (dead code) |
| IMP-FE-012 | 06-frontend | No tier features/perks management in studio |
| IMP-FE-013 | 06-frontend | Pricing page does not show monthly-equivalent for annual prices |
| IMP-FE-014 | 06-frontend | `formatPrice(null)` returns empty string, no fallback |

### Seed Data Quality
| ID | Source | Description |
|---|---|---|
| IMP-SEED-007 | 04-seed-data | Seed Connect account creation is non-idempotent |
| IMP-SEED-008 | 04-seed-data | No seed data for `content_access` with subscription accessType |
| IMP-SEED-009 | 04-seed-data | Seed data log message counts are hardcoded strings |
| IMP-SEED-010 | 04-seed-data | No Beta-org purchases in seed data |
| IMP-SEED-012 | 04-seed-data | No Beta content seeded with subscription tier gating |

---

## Test Coverage Gaps

Consolidated from all domain reports.

### Purchase Service (`packages/purchase/src/__tests__/purchase-service.test.ts`)
- `processRefund()` -- zero tests (most bug-prone method)
- `verifyCheckoutSession()` -- zero tests
- `createPortalSession()` -- zero tests
- `formatPurchasesForClient()` -- zero tests
- `getPurchase()` -- authorization edge cases
- Edge cases: Connect account not ready, content without org, webhook retry

### Subscription Service (`packages/subscription/src/services/__tests__/subscription-service.test.ts`)
- `executeTransfers()` -- multi-creator distribution, pending payout creation, Connect not ready, transfer API failure
- `handleInvoicePaymentSucceeded()` -- charge resolution via PaymentIntent
- `changeTier()` -- Stripe API failure preserving DB state
- Revenue split accuracy through full webhook flow
- Concurrent webhook event handling

### Connect / Revenue (`packages/subscription/src/services/__tests__/`)
- `executeTransfers()` -- all paths (successful 3-party, org Connect not ready, creator Connect not ready, transfer failure)
- `calculateRevenueSplit()` -- edge cases for both purchase and subscription calculators
- Pending payout creation and resolution cycle
- Integration test: full `invoice.payment_succeeded` -> transfer flow

### Webhook Handlers (`workers/ecom-api/src/handlers/__tests__/`)
- All four subscription email paths (creation, renewal, cancellation, payment failure)
- Dev webhook router routing for subscription-mode checkout
- Refund webhook with refund detail extraction

### Content Access (`packages/access/src/services/__tests__/`)
- All four `accessType` values with all grant mechanisms
- Subscription access check with and without `minimumTierId`
- Library query with subscription source
- Pagination across merged library sources

---

## Architecture Observations

### 1. `content_access` is a write-only table

Records are INSERT-ed on purchase and complimentary grant, but the access check algorithm (`getStreamingUrl`) never queries this table. It independently checks `purchases`, `subscriptions`, and `organizationMemberships`. This means admin-granted complimentary access (written to `content_access`) has no effect on streaming access. This is the single most architecturally significant finding in the audit.

### 2. Revenue flows are fundamentally asymmetric by design

Purchases use destination charges (money goes directly to creator), while subscriptions use separate charges and transfers (money collected by platform, then distributed). This is a valid Stripe Connect pattern, but it means the same creator can receive money through two completely different Stripe mechanisms depending on whether the customer purchased content or subscribed. The Studio UI does not explain this distinction.

### 3. Subscription access is dynamic, purchase access is static

Purchase access creates a permanent `content_access` row and checks the `purchases` table at streaming time. Subscription access checks the `subscriptions` table dynamically at streaming time with no persistent record. This means subscription access is correctly revoked when subscriptions expire (the `currentPeriodEnd` check handles this), but it also means there is no audit trail of who accessed what via subscription.

### 4. The refund pipeline has cascading failures

BUG-003 (missing column) causes BUG-005 (partial state) which causes BUG-006 (re-purchase blocked). These three bugs form a chain: fixing BUG-003 alone does not resolve the others. They must be fixed together as a unit (WP-ACC-02).

### 5. Email metadata is a systemic pattern, not isolated bugs

Every commerce email path (5 total: purchase receipt, refund receipt, subscription created, subscription renewed, subscription cancelled) has incorrect or missing template data. The root cause is that Stripe session/subscription metadata is set at checkout time with `codex_*` prefixed IDs, but webhook handlers expect human-readable fields (`contentTitle`, `customerEmail`, `planName`) that were never set. A consistent pattern for resolving template data from the database at email-send time (rather than relying on Stripe metadata) would fix all five email paths at once.

### 6. Dev webhook routing diverges from production

In production, Stripe sends each event type to a specific endpoint with its own signing secret. In development, the dev webhook router receives all events on a single endpoint and dispatches based on event type. This creates the BUG-007 routing bug and means any event that could be handled by multiple production endpoints (like `checkout.session.completed`) must be carefully routed. This is a known trade-off of the single-endpoint dev proxy pattern.
