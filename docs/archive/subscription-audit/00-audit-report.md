# Subscription System Audit Report

**Originally dated**: 2026-04-12
**Last refreshed**: 2026-04-23 (Iteration 2 — recursive audit in progress, 20-min ticks)
**Scope**: Full subscription/purchase/access system — services, worker API, database schema, validation, frontend UX, test coverage
**Files audited**: ~80 source files across 6 packages, 1 worker, and the SvelteKit frontend
**Audit agents**: 5 specialist reviewers (service layer, worker API, test coverage, frontend UX, schema/validation)

> **Reader orientation**: Latest findings live in the **Iteration 2** section near the bottom — jump there first if you want the freshest state. The 3-phase summary below is the 2026-04-12 baseline; each subsequent iteration appends new findings, verifies prior claims, and refines the "Living Findings Ledger" table.

---

## Executive Summary

The Codex subscription system underwent a comprehensive 3-phase audit covering every layer from database schema to frontend UX. The audit discovered **1 security vulnerability** (membership paywall bypass), **1 critical Stripe resource leak**, and **significant test coverage gaps** in money-handling paths. All critical and warning-level issues have been resolved. **51 new tests** were written, **15 code fixes** applied, and **2 database migrations** created.

### Production Readiness (Before vs After)

| Layer | Before | After |
|---|---|---|
| Service Layer | 7.5/10 | 9/10 |
| Worker API | 8/10 | 9.5/10 |
| Database/Validation | 7/10 | 9/10 |
| Frontend UX | 8/10 | 9/10 |
| Test Coverage | **5/10** | **8/10** |

---

## Phase 1: Critical Fixes (Epic: Codex-nojc, P0)

### 1.1 Stripe Orphan Cleanup (Codex-nojc.1)

**Problem**: `TierService.createTier()` and `updateTier()` created Stripe Products/Prices before the DB insert. If the DB insert failed (sort order race, connection error), orphaned Stripe resources accumulated with no cleanup.

**Fix**:
- Added idempotency keys to all Stripe create calls (`randomUUID()`)
- Wrapped DB inserts in try/catch — on failure, archives Stripe Product (deactivates associated Prices)
- New `rollbackStripePriceChanges()` private method for updateTier rollback
- Cleanup failures logged but never mask the original error

**Files changed**: `packages/subscription/src/services/tier-service.ts`

### 1.2 Handler→Service Extraction (Codex-nojc.2)

**Problem**: `subscription-webhook.ts` (311 lines) contained business logic violating the CLAUDE.md rule: "NEVER put business logic in route handlers." Direct DB queries for tier names, user lookups, email composition, and a raw `db.update()` bypassing SubscriptionService.

**Fix**:
- New `handleInvoicePaymentFailed()` method on SubscriptionService
- Modified `handleSubscriptionCreated`, `handleSubscriptionDeleted`, `handleInvoicePaymentSucceeded` to return `WebhookHandlerResult` with email payload data
- Extracted `invalidateUserLibraryCache()` and `dispatchEmail()` helpers in handler
- Reduced handler from 311 → 180 lines (42% reduction)

**Files changed**: `packages/subscription/src/services/subscription-service.ts`, `workers/ecom-api/src/handlers/subscription-webhook.ts`, `packages/subscription/src/index.ts`

### 1.3 Dev Webhook Router Guard (Codex-nojc.3)

**Problem**: `/webhooks/stripe/dev` endpoint was registered unconditionally — accessible in production. Also missing `charge.refunded` routing for local refund testing.

**Fix**:
- Added inline middleware: returns 404 when `ENVIRONMENT === 'production'`
- Added payment event routing (`charge.*`, `payment_intent.*`) dispatching to `handlePaymentWebhook`

**Files changed**: `workers/ecom-api/src/index.ts`, `workers/ecom-api/src/utils/dev-webhook-router.ts`

### 1.4-1.6 P0 Test Coverage

| Tests Written | Package | Key Findings |
|---|---|---|
| 6 processRefund tests | `@codex/purchase` | **Discovered**: processRefund has no transaction (atomicity gap) and doesn't store refund metadata despite columns existing |
| 9 payout/transfer tests | `@codex/subscription` | Revenue transfer paths verified — code handles all edge cases correctly |
| 11 subscription access tests | `@codex/access` | **Discovered**: Membership paywall bypass — any org member could access paid content |

### 1.7 Security Fix: Membership Paywall Bypass (Codex-sbgm)

**Problem**: `ContentAccessService.getStreamingUrl()` org membership fallback (line ~350) only checked `status: 'active'` without filtering by role. Any active org member (including plain `member` and `subscriber` roles) could bypass payment for paid org content.

**Fix**: Added `inArray(organizationMemberships.role, ['owner', 'admin', 'creator'])` to the membership fallback query. Only management roles now bypass payment.

**Files changed**: `packages/access/src/services/ContentAccessService.ts`

---

## Phase 2: Warnings & Robustness (Epic: Codex-a32r, P1)

### 2.1 Validation/DB Enum Mismatches (Codex-a32r.1)

| Mismatch | Fix |
|---|---|
| `'article'` in validation vs `'written'` in DB | Changed validation + frontend filter to `'written'` |
| `'in-progress'` (hyphen) in test vs `'in_progress'` (underscore) in schema | Fixed test |
| `'membership'` filter concept undocumented | Added clarifying comments |

**Files changed**: `packages/validation/src/schemas/access.ts`, `packages/validation/src/schemas/access.test.ts`, `apps/web/src/lib/components/library/LibraryFilters.svelte`

### 2.2 Transaction Wrapping (Codex-a32r.2)

**Problem**: `handleSubscriptionCreated` did subscription insert + membership upsert as two separate DB calls.

**Fix**: Wrapped both operations in `db.transaction()`. Idempotency guard covers the entire transaction. Email data building remains outside (read-only).

**Files changed**: `packages/subscription/src/services/subscription-service.ts`

### 2.3 Tier Price Validation (Codex-a32r.3)

**Fix**:
- Added `.max(10000000)` to both `priceMonthly` and `priceAnnual` (prevents integer overflow)
- Added `.refine()` ensuring `priceAnnual <= priceMonthly * 12` (annual must be a discount)
- Extracted `baseTierSchema` for shared fields (Zod `.partial()` incompatible with `.refine()`)

**Files changed**: `packages/validation/src/schemas/subscription.ts`

### 2.4 PurchaseOrSubscribeModal Error Display (Codex-a32r.4)

**Problem**: Empty catch block — user clicks Subscribe, nothing happens.

**Fix**: Added `checkoutError` state, display with `role="alert"`, styled with `var(--color-error-600)`.

**Files changed**: `apps/web/src/lib/components/subscription/PurchaseOrSubscribeModal.svelte`

### 2.5 Per-Card Reactivate Error (Codex-a32r.5)

**Problem**: Single `reactivateError` string shown on all subscription cards.

**Fix**: Scoped loading and error state per-subscription using `Set<string>` and `Map<string, string>`. Svelte 5's reactive proxy handles these natively.

**Files changed**: `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`

### 2.6 Server Load Error State (Codex-a32r.6)

**Problem**: Catch block silently returned empty array — user sees "No subscriptions" when API is down.

**Fix**: Returns `{ loadError: true }` on API failure. Page shows error alert with retry button (`invalidateAll()`). New i18n messages added.

**Files changed**: `apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts`, `+page.svelte`, `apps/web/messages/en.json`

### 2.7 Checkout Success Redirect (Codex-a32r.7)

**Problem**: Login redirect lost `session_id` query parameter.

**Fix**: Preserved full current URL (including query params) as `redirect` parameter.

**Files changed**: `apps/web/src/routes/_creators/checkout/success/+page.server.ts`, `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts`

### 2.8 cancelAtPeriodEnd Column (Codex-a32r.8)

**Fix**:
- Added `cancelAtPeriodEnd` boolean column to subscriptions table (default: false)
- Updated `handleSubscriptionUpdated`, `cancelSubscription`, `reactivateSubscription`, `handleSubscriptionDeleted` to populate it
- Migration generated and applied

**Files changed**: `packages/database/src/schema/subscriptions.ts`, `packages/subscription/src/services/subscription-service.ts`

---

## Phase 3: Hardening & Test Coverage (Epic: Codex-wp9f, P2)

### 3.1-3.4 P1 Test Coverage

| Tests Written | Package | Coverage Added |
|---|---|---|
| 6 role hierarchy tests | `@codex/subscription` | Owner/admin/creator role preserved on subscribe; subscriber-only deactivated on cancel |
| 5 tier Stripe failure tests | `@codex/subscription` | Product creation fail, price creation fail, DB insert fail — cleanup verified |
| 3 signature edge case tests | `ecom-api` | Tampered payload, expired timestamp, replay attack |
| 11 library filter tests | `@codex/access` | Subscription source, membership source, search, contentType, orgId, sortBy, progress filters |

### 3.5 Rounding Dust Fix (Codex-wp9f.5)

**Problem**: `Math.floor` in creator pool distribution lost pence (100p / 3 creators = 33+33+33 = 99p, 1p lost).

**Fix**: Pre-calculate all amounts, assign remainder to first creator: `rawAmounts[0] += creatorPayoutCents - distributed`.

**Files changed**: `packages/subscription/src/services/subscription-service.ts`

### 3.6 deletedAt Columns (Codex-wp9f.6)

**Fix**: Added `deletedAt` to `stripeConnectAccounts` and `pendingPayouts`, added `updatedAt` to `pendingPayouts`. Migration created and applied.

**Files changed**: `packages/database/src/schema/subscriptions.ts`

### 3.7 ecom-api CLAUDE.md (Codex-wp9f.7)

Fully rewritten from 70 lines (3 endpoints documented, many marked "scaffolded") to comprehensive documentation covering all 4 route groups, 7 webhook endpoints, key flows, handler architecture, config variables, and strict rules.

### 3.8 BUG-xxx Comment Cleanup (Codex-wp9f.8)

Removed all BUG-009, BUG-010, BUG-014, BUG-016, BUG-020, BUG-022, BUG-023, BUG-024, BUG-025, BUG-026, BUG-030, BUG-036 prefixes from handler and service files. Kept the explanatory context where valuable.

### 3.9 ContentDetailView CTA Fix (Codex-wp9f.9)

**Problem**: Subscribe CTA linked to `/pricing` which doesn't exist on creator subdomain.

**Fix**: Added `pricingHref` prop with `buildOrgUrl()` to construct cross-subdomain pricing link using the content's org slug.

**Files changed**: `apps/web/src/lib/components/content/ContentDetailView.svelte`, `apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.svelte`

---

## Test Coverage Summary

### New Tests Written: 51

| Area | Count | Package |
|---|---|---|
| processRefund | 6 | `@codex/purchase` |
| resolvePendingPayouts + executeTransfers | 9 | `@codex/subscription` |
| Subscription/member access control | 11 | `@codex/access` |
| Membership role hierarchy | 6 | `@codex/subscription` |
| Tier Stripe failure paths | 5 | `@codex/subscription` |
| Stripe signature verification | 3 | `ecom-api` |
| Library filters + subscription sources | 11 | `@codex/access` |

### Coverage by Critical Path

| Path | Before | After |
|---|---|---|
| One-time purchase (checkout → webhook → access) | Partial | Full |
| Refund (webhook → status update → access revocation) | **None** | Covered |
| Subscription access (tier check, expiry, cancelling) | **None** | Full |
| Revenue transfers (org + creator distribution) | **None** | Covered |
| Pending payout resolution | **None** | Covered |
| Membership role bypass (security) | **None** | Covered |
| Tier CRUD with Stripe failure recovery | **None** | Covered |
| Webhook signature edge cases | Partial | Full |
| Library filtering (all sources + filters) | Partial | Full |

---

## Remaining Open Issues

| Issue | Priority | Description |
|---|---|---|
| **Codex-98yb** | P1 | processRefund missing transaction atomicity + refund metadata not stored. Purchase status update and access revocation are two separate DB calls. `stripeRefundId`, `refundAmountCents`, `refundReason` columns exist but are never populated. |

---

## Database Migrations Created

1. `0044_graceful_thunderbolts.sql` — Add `cancel_at_period_end` boolean to subscriptions table
2. `0045_add_deleted_at_connect_payouts.sql` — Add `deleted_at` to stripeConnectAccounts, add `updated_at` + `deleted_at` to pendingPayouts

---

## Architecture Improvements

### Handler Architecture (Before → After)

**Before**: `subscription-webhook.ts` was 311 lines with direct DB queries, email composition, cache invalidation, and a raw `db.update()` bypassing the service layer.

**After**: Handlers follow a thin-dispatcher pattern:
```
1. Extract Stripe event data
2. Call service method → returns WebhookHandlerResult { userId, email }
3. Invalidate cache (using userId)
4. Dispatch email (using email payload)
5. Log
```

All business logic (DB queries, email composition, status updates) lives in the service layer.

### Access Control (Before → After)

**Before**: Any active org member (including `member`/`subscriber` roles) could bypass the paywall for paid org content via the membership fallback.

**After**: Only management roles (`owner`, `admin`, `creator`) bypass payment. Regular members and subscribers must purchase or have a qualifying subscription.

---

## Recommendations for Future Work

1. **Fix Codex-98yb** (processRefund atomicity) — wrap refund operations in `db.transaction()` and populate refund metadata columns
2. **Fix pre-existing test r2Key validation failures** — 23 tests in `@codex/access` use the old `originals/x.mp4` format instead of `creatorId/originals/mediaId/filename`
3. **Fix pre-existing checkout.test.ts failures** — 3 tests expect swallowed errors but handler now throws after Phase 1 extraction
4. **Consider KV-based nonce store** for webhook replay protection beyond Stripe's 300s timestamp tolerance (low priority — idempotency keys already prevent duplicate processing)
5. **Add E2E tests** for the full checkout → webhook → access grant → streaming flow using Playwright

---

# Iteration 2 — 2026-04-23 (Recursive Refresh)

**Mode**: Self-paced 20-minute ticks. Each tick picks one subsystem and extends the Living Findings Ledger below.
**Tick 1 focus**: Verify April 12 claims against current code/schema; establish scope of "suborgs"; enumerate data-model + multi-tenancy gaps.

### Clarification: what "suborgs" means in this codebase

The user framed this review as "subscriptions + how **suborgs** are used." A grep across `packages/`, `apps/`, and `workers/` found **zero** hierarchical org structures (no `parent_organization_id`, no `organizations.parentOrganizationId`, no "suborg" identifiers). The `organizations` table is flat (`packages/database/src/schema/organizations.ts`).

What **does** exist, and is the plausible referent for "suborgs":

1. **Per-org tenancy** — every org owns its own `subscriptionTiers`, `subscriptions`, `stripeConnectAccounts`, content, branding. A user subscribing to Org A has zero access in Org B. This is the multi-tenancy story.
2. **Subdomain-based routing** (`apps/web/src/hooks.ts`) — each org appears on its own subdomain, which is cosmetic but makes orgs *feel* like sub-sites under the platform.
3. **Creator sub-spaces** — the `_creators/[username]/` route namespace gives each creator a profile/content page *within* their org. Creators are a membership role inside an org, not a separate tenant. They share their org's subscription tiers.

Every finding below is framed against this per-org-tenancy model. If the user meant something else (e.g. a **planned** suborg feature on the roadmap), call that out and I'll re-scope.

### Verification of April 12 claims (baseline audit)

| Claim | Status on 2026-04-23 | Evidence |
|---|---|---|
| Membership paywall bypass fix (Codex-sbgm) | ✅ Still applied | `ContentAccessService.getStreamingUrl` membership fallback filters by `inArray(role, ['owner','admin','creator'])` |
| `cancelAtPeriodEnd` column in `subscriptions` | ✅ Present in schema | `packages/database/src/schema/subscriptions.ts:122` |
| Migration `0044_graceful_thunderbolts.sql` adds `cancel_at_period_end` | ❌ **Filename wrong** | Actual `0044` is `0044_add_email_skipped_status.sql`. Column first appears in snapshot `0044_snapshot.json`, but the matching `.sql` file adding it doesn't surface on `grep`. Either it was added in an earlier numbered migration (rename lost the link) or a schema snapshot drifted without a matching SQL migration. **Needs reconciliation before running against a fresh DB** (otherwise a clean `pnpm db:migrate` won't produce the column). |
| Migration `0045_add_deleted_at_connect_payouts.sql` | ❌ **Does not exist** | Actual `0045` is `0045_unique_northstar.sql`. See "Bug: schema-report drift" below. |
| `deletedAt` on `stripeConnectAccounts` and `pendingPayouts` | ❌ **Not in current schema** | `packages/database/src/schema/subscriptions.ts:201–296` has neither column. Phase 3.6 claim is unverified. |
| `updatedAt` on `pendingPayouts` | ❌ **Not in current schema** | Same as above. |
| Phase 2.2 "Wrapped both operations in db.transaction()" for `handleSubscriptionCreated` | ❌ **Not applied** | `subscription-service.ts:423–472` — three sequential `this.db` calls (subscription insert → followers upsert → membership upsert). No `db.transaction()` wrapper. Same pattern in `handleSubscriptionDeleted:1014–1038`. **Phase 2.2 is partial-or-reverted**; create a bead to restore. |

### Living Findings Ledger (new in Iteration 2)

Severity scale: **P0** = data loss/security, **P1** = wrong-user-sees-wrong-thing, **P2** = UX/consistency, **P3** = hygiene.

#### Bugs & Data-Integrity Gaps

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| F1 | **P0** | Migrations | Duplicate `0051` migration number: both `0051_add_landing_page_indexes.sql` and `0051_curved_thunderbolts.sql` exist. Drizzle journal typically picks one; the other is silently skipped on apply. Unless both have been manually reconciled in `meta/_journal.json`, one of these is a **ghost migration** never reaching production. | `ls packages/database/src/migrations/` |
| F2 | **P0** | Migrations | Schema column `subscriptions.cancel_at_period_end` exists in code + snapshots from `0044` onward but grep finds no `.sql` file that creates it. If a fresh DB provisions only the `.sql` files, this column will be missing and `handleSubscriptionUpdated` (which writes it) will 500. **Confirm with `grep -rn "ADD COLUMN.*cancel" packages/database/src/migrations/`** — if nothing returns, produce a repair migration. | `grep -rn cancel_at_period_end packages/database/src/migrations/` returns only meta/*.json |
| F3 | **P1** | Webhook atomicity | `handleSubscriptionCreated` does 3 separate writes (subscription, follower, membership) without `db.transaction()`. Partial-failure state: subscription rows exist but user is not a follower or has no membership → library queries, notifications, and role-gated paths see an inconsistent user. | `subscription-service.ts:424–472` |
| F4 | **P1** | Webhook atomicity | Same problem in `handleSubscriptionDeleted`: subscription update and membership demotion are two separate DB calls. DB hiccup between them = subscription cancelled but user still listed as active `subscriber` role. | `subscription-service.ts:1014–1038` |
| F5 | **P1** | Role hygiene | Cancellation sets `organizationMemberships.status = 'inactive'` but **never changes `role`** back to `'member'`. Cancelled subscribers keep `role='subscriber'` forever. Any query that checks `role === 'subscriber'` without `status === 'active'` (e.g. analytics, badge rendering, listing "your subscribers") over-counts or wrongly includes lapsed users. | `subscription-service.ts:1026–1038` |
| F6 | **P1** | Missing FK | `contentAccess.accessType = 'subscription'` rows (when that access type is used) have **no `subscriptionId` FK**. Revocation of subscription-granted access has to rely on a derived filter (user + org + accessType). Tight coupling + slower-to-audit. Adding the FK would let `ON DELETE CASCADE` (or a view) clean up naturally and lets queries "who gained access via subscription X" answer in one JOIN. | `packages/database/src/schema/ecommerce.ts:25–79` |
| F7 | **P1** | Stripe reuse | `createCheckoutSession` passes `customer_email` but never `customer`. Per Stripe docs, `customer_email` still **creates a new Customer** on each checkout; to truly reuse an existing `stripeCustomerId` you must persist it on the user/org and pass `customer: stripeCustomerId`. BUG-022 comment claims "Stripe reuses an existing Customer object" — that is not what `customer_email` does. | `subscription-service.ts:317–336` |
| F8 | **P1** | Defensive write | `handleSubscriptionCreated` reads `item?.current_period_start ?? 0` — if the subscription item is absent, `currentPeriodStart` is inserted as epoch 1970-01-01. That corrupts reporting and `uq_active_subscription_per_user_org` fencing. Prefer throw. | `subscription-service.ts:404–436` |
| F9 | **P1** | Silent webhook | `handleSubscriptionDeleted` issues `update ... where stripeSubscriptionId = …` with no 0-row check. If the created webhook was missed (network/TTL drop), cancel → "success" log, but no row flipped. Should assert `rowsAffected === 1` or explicitly log "unknown subscription cancelled — reconciliation needed". | `subscription-service.ts:1014–1021` |
| F10 | **P1** | Role/type drift | `organizationMemberships.role` still contains `'subscriber'` and `'member'`, while `content.access_type` was normalised in migration 0048 to `'free' / 'paid' / 'followers' / 'subscribers' / 'team'`. Two taxonomies for the same concept. Any gating code that mixes them (e.g. `role === 'subscriber' OR access_type === 'subscribers'`) is brittle. | `content.ts:82` role enum vs `0048_migrate_members_to_team.sql` |
| F11 | **P2** | Schema layout | `organizationMemberships` is declared inside `packages/database/src/schema/content.ts`, not in `organizations.ts` (or its own file). Makes discovery painful and couples two domains at the import level. Refactor: move to `schema/organizations-memberships.ts` and re-export from the content module for backward compatibility. | `content.ts:36–89` |
| F12 | **P2** | Docs drift | `stripeConnectAccounts` doc comment says "One account per user (unique on userId)" but the actual constraint is `unique(userId, organizationId)` — one account per user **per org**. Misleading for any creator active in multiple orgs (they will be asked to onboard again per org — KYC friction). Align docs with code; consider whether a single Connect account per user (cross-org) would be a better product choice. | `subscriptions.ts:198 vs 240` |
| F13 | **P2** | Auto-follow | Subscribe auto-creates a `organizationFollowers` row (good affordance) but cancellation never removes it. The doc comment explicitly says "Follower persists after subscription cancellation — user must explicitly unfollow." Is that the intended product UX? If yes, document in user-facing terms ("you'll keep getting updates even after cancellation"); if no, revoke on cancel. | `subscription-service.ts:444–448` |
| F14 | **P2** | Renewal revenue split | Schema comment on `subscriptions`: "Revenue split snapshot (immutable — calculated at creation, updated on renewal)." "Immutable" + "updated on renewal" contradict. Either renewals *do* recompute the split (which is fine — the `invoice.payment_succeeded` handler can recalc) or they don't. Look at `handleInvoicePaymentSucceeded` to verify; document the real behaviour. | `subscriptions.ts:127` |
| F15 | **P2** | Unique index vs upgrade | `uq_active_subscription_per_user_org` covers statuses `active / past_due / cancelling`. An upgrade path via `stripe.subscriptions.update({ items: [{ price: NEW_PRICE }] })` keeps the **same** subscription row in our DB (no new insert), so the constraint doesn't block upgrades — good. But if any future code tries "create new subscription before cancelling old" pattern, the unique index will block it. Worth a comment in the schema so a future developer doesn't fight it. | `subscriptions.ts:157–159` |

#### Design Suggestions

| # | Suggestion | Rationale |
|---|---|---|
| S1 | Add `subscriptionId uuid references subscriptions(id) on delete cascade` to `contentAccess` (nullable, only populated when `accessType='subscription'`). | Gives a first-class revocation path, fixes F6, and lets "is this content still accessible because of my sub?" be a one-hop query. |
| S2 | Collapse `organizationMemberships.role` to management-only values (`owner/admin/creator`) and drop `'subscriber'` / `'member'`. Use the `subscriptions` table + `organizationFollowers` table as the source of truth for the two audience tiers. | Removes F10 drift. Makes the data model honestly say "membership = team; subscriber = paid audience; follower = free audience." Aligns with `docs/page-ideation/13-studio-billing.md` and with the 2026-04-15 Membership Redesign project listed in memory. |
| S3 | Wrap every side-effecting webhook handler in `db.transaction()` using `createPerRequestDbClient`. Keep outbound Stripe calls (transfers) **outside** the transaction; build a list of transfer intents, commit the DB tx, then schedule transfers via `ctx.waitUntil`. | Fixes F3/F4 without holding DB locks during Stripe network round-trips. Matches the pattern already in `@codex/purchase` per the CLAUDE.md strict rules. |
| S4 | Resolve Stripe Customer **once per user** (look up → create if missing → persist `stripeCustomerId` on `users`). Pass `customer: stripeCustomerId` to every Checkout Session. | Fixes F7 for real. Side benefit: a stable Customer means saved payment methods survive across subscriptions to different orgs. |
| S5 | Add an operator playbook for "subscription created outside our metadata flow" (e.g. created in Stripe Dashboard). Handler currently logs a warn and drops it. Either refuse (webhook responds 200 but takes no action) or have an admin tool to retro-link. | Prevents silent data loss during disaster recovery or incident cleanup. |
| S6 | Document proration behaviour explicitly in `@codex/subscription/CLAUDE.md` (mode: `create_prorations` | `always_invoice` | `none`). Right now it's called "upgrade/downgrade with proration" with no further detail. Developers have to read Stripe TypeScript to know. | Reduces surprise for anyone touching `changeTier`. |
| S7 | Add a reconciliation cron that scans open subscriptions and verifies Stripe matches our DB (status + current period). Log drift — don't auto-fix yet. | Insurance against dropped webhooks. Cheap to run weekly per org. |

#### Open questions the review cannot answer alone

1. **Did you mean the multi-tenant org model, or is there a planned "suborg" feature not yet coded?** The report assumes the former. If wrong, flag the target design doc and I'll re-scope next tick.
2. **Is it intentional that cancelled subscribers keep `organizationFollowers`?** (F13 — product decision.)
3. **Is renewing supposed to recompute the revenue split (F14)?** If yes, we need the same snapshot-at-renewal discipline as purchase records — otherwise a tier price change between renewals breaks the revenue split invariant.
4. **Is one Connect account per user-per-org the intended KYC model, or should it become one per user?** (F12.)

### Next tick's target (tick 2)

Deep-dive **`handleInvoicePaymentSucceeded` + revenue transfers**: verify F14 (renewal split), confirm F2 (the `cancel_at_period_end` migration mystery), trace `pendingPayouts` path, and sanity-check F7 against real Stripe Customer creation in the test suite.

---

## Iteration 2 · Tick 2 — 2026-04-23 (renewals + transfers deep-dive)

### Confirmations from tick 1

| From tick 1 | Status now | Evidence |
|---|---|---|
| **F2** `cancel_at_period_end` migration missing | ✅ **CONFIRMED P0** | `grep "cancel" packages/database/src/migrations/*.sql` returns `cancelled_at` + `cancel_reason` + `cancelling` status references only — **zero** hits for `cancel_at_period_end`. `0040_lean_veda.sql` creates `subscriptions` without the column. No `ADD COLUMN` in any later file. Schema snapshots `0044..0054` tracks it, meaning a Drizzle regeneration replaced the claimed `0044_graceful_thunderbolts.sql` without carrying over the DDL. **Fresh DB provision will 500 on first `handleSubscriptionUpdated`.** |
| **F14** renewal recomputes split | ✅ **CONFIRMED** | `subscription-service.ts:644-662` — `calculateRevenueSplit` runs on the renewal invoice's `amount_paid` and the result is written to the same `subscriptions` row, overwriting the creation snapshot. Schema comment "immutable snapshot" is misleading. |

### Immediate action for F2

Add a single repair migration that is idempotent:

```sql
-- packages/database/src/migrations/XXXX_add_cancel_at_period_end.sql
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;
```

Commit that, run `pnpm db:migrate` on every environment (existing envs that already have the column will noop because of `IF NOT EXISTS`). Then reconcile with `pnpm db:generate` to verify the journal is clean.

### New findings (tick 2)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| T1 | **P1** | Accounting | On renewal, `subscriptions.amountCents` and the three `*FeeCents` columns are **overwritten**. There is **no per-invoice ledger table**. If any renewal's fee ratios or amounts change (coupon, tier change mid-cycle, Stripe rounding quirk, VAT), the prior period's numbers are irrecoverable. Monthly reporting, refund disputes, and MRR-over-time are all degraded. | `subscription-service.ts:644-662` |
| T2 | **P1** | Transfer safety | `executeTransfers` runs **after** the DB status/period update and **without** a transaction envelope. A Stripe outage, worker timeout, or runtime crash mid-transfer leaves our DB saying "paid/active" while creators were not transferred and no `pendingPayouts` was written. No compensating reconciliation. | `subscription-service.ts:650-671` + `1899-2160` |
| T3 | **P1** | Silent gap | In the `orgConnect.chargesEnabled === false && creatorAgreements.length === 0` branch, the **creator pool is neither transferred nor accumulated** — it just falls off. Compare to the matching `orgFeeCents` branch that does accumulate. Money effectively evaporates to the platform balance. | `subscription-service.ts:2002-2056` (the "early return" skips the accumulator entirely when orgConnect is not ready) |
| T4 | **P1** | Rounding dust v2 | April 12 Phase 3.5 claimed rounding dust fixed, but that fix was for the **top-level** platform/org/creator split in `revenue-split.ts`. The inter-creator distribution (`Math.floor((creatorPayoutCents * sharePercent) / totalShareBps)`) still floors each creator and keeps no remainder. For 3 creators at 33/33/33 bps on a 100p pool, each gets 33p → 1p lost per renewal. Scales with renewal volume. | `subscription-service.ts:2079-2084` |
| T5 | **P1** | Schema overload | `creatorOrganizationAgreements.organizationFeePercentage` is reused with two different semantics: (a) for **purchases**, it's the org's cut (%); (b) for **subscriptions**, it's "the creator's share percentage in basis points" (literal code comment, 2059-2060). A future maintainer will be certain to mis-use this. Either split into two columns (`purchaseOrgFeeBps`, `subscriptionCreatorShareBps`) or add a `context` discriminator. | `subscription-service.ts:2058-2063` |
| T6 | **P2** | State machine | Renewal flips `status` to `ACTIVE` unconditionally. If prior status was `cancelling` (user cancelled but Stripe still renewed due to a race), we silently resurrect. Should check prior status and at minimum `obs.warn` when transitioning from `cancelling` → `active`. | `subscription-service.ts:655` |
| T7 | **P2** | Email source | Renewal and payment-failed emails use `stripeInvoice.customer_email`. Our users can change email in our own app, but Stripe's stored email won't sync until the next customer update. The receipt goes to the stale address. Prefer `users.email` lookup. | `subscription-service.ts:683-707`, and same pattern likely in `handleInvoicePaymentFailed:756-` |
| T8 | **P2** | API pressure | `handleInvoicePaymentSucceeded` always hits Stripe twice: `paymentIntents.retrieve` (when charge absent) and `subscriptions.retrieve` for period dates. On a large renewal batch (first-of-month), this doubles API calls. Consider reading `stripeInvoice.lines.data[0].period` instead of re-retrieving the subscription. | `subscription-service.ts:610, 637` |
| T9 | **P2** | Emails skip proration | `subscription_update` billing reason (proration invoice from upgrade/downgrade) does not email. Is this intentional? For a £5→£50 upgrade, users probably expect a receipt. | `subscription-service.ts:681` |
| T10 | **P2** | Connect account ambiguity | Org connect lookup: `.where(eq(organizationId, orgId)).limit(1)` with no ordering. The unique constraint is `(userId, organizationId)`, meaning multiple users in an org can each have a Connect account — which one is "the org's"? Today `limit(1)` picks an arbitrary row. Define the owner's Connect account explicitly, e.g. join on `organizationMemberships` where `role='owner'`. | `subscription-service.ts:1909-1913` |
| T11 | **P2** | Invoice skip | When an invoice arrives with no charge/payment_intent (rare but possible — e.g. $0 invoice with coupon), the handler logs warn and returns WITHOUT updating period dates on the subscription. The subscription stays stuck on the prior period forever. | `subscription-service.ts:597-620` |
| T12 | **P3** | Logging | Every pendingPayout insert failure is `obs.error` only — no counter, no alert. Finance-critical. Should bump a metric so ops can surface it. | `subscription-service.ts:2043-2050 (and peers)` |

### Design suggestions (tick 2)

| # | Suggestion | Why |
|---|---|---|
| S8 | Add a `subscription_invoices` table keyed by `stripeInvoiceId`, storing the per-invoice revenue split snapshot (amountPaidCents + three fee columns + periodStart/End + billingReason). `subscriptions.*FeeCents` can stay as a "latest" cache, but the ledger owns history. | Fixes T1. Required for SOX-ish auditability and month-over-month MRR backtesting. |
| S9 | Build the transfer intents in the DB transaction, then execute them **after** commit via `ctx.waitUntil`. Each intent is a `pending_transfers` row with idempotency key, amount, destination, and status. A reconciliation cron drives retries; success updates the row, failure leaves it for the cron. | Fixes T2. Decouples DB consistency from Stripe availability without losing durable retry state. |
| S10 | In the creator-agreement distribution loop, collect all `Math.floor` outputs, assign remaining pence to first creator (same pattern as the Phase 3.5 top-level fix). | Fixes T4 with a 4-line change. |
| S11 | Rename `creatorOrganizationAgreements.organizationFeePercentage` to something neutral like `sharePercentageBps` and document its dual semantic explicitly in the schema comment. Better: make the dual purpose a column-level discriminator (`splitContext: 'purchase' | 'subscription'`). | Fixes T5. The naming bug will bite in production once a creator is paid the wrong amount. |
| S12 | `handleInvoicePaymentSucceeded` should guard status transitions: `if (sub.status === 'cancelling') obs.warn('Unexpected renewal of cancelling subscription')` before flipping to active. | T6. Cheap defensive log. |
| S13 | Use `users.email` for all webhook-driven email targeting (`sendEmailToWorker`) — treat Stripe emails as hints only. | T7. Also closes a privacy gap where a stale email could leak subscription info to the previous owner of that address. |
| S14 | The F6 + S1 (`contentAccess.subscriptionId` FK) + S8 (`subscription_invoices` ledger) together form a **finance-grade data model**. Consider landing them as a single "subscription-accounting" epic rather than piecemeal. | Coherent architectural move, easier to justify as an epic and PR-review in one pass. |

### Updated living findings ledger — summary

| Bucket | Count | Top priority |
|---|---|---|
| P0 (blocking) | **2** (F1 dup migration, F2 missing column) | F2 — write repair migration today |
| P1 (wrong-state) | **13** (F3-F10, T1-T5) | T2 transfer safety + F3/F4 transaction envelopes |
| P2 (hygiene) | **11** | T6 state guard, F13 follower-on-cancel UX choice |
| P3 (polish) | **2** | T12 payout metric |

### Tick 3 target

**Frontend subscription UX** — trace:
- `PurchaseOrSubscribeModal.svelte` (checkout entry)
- `(platform)/account/subscriptions/+page.svelte` (list + cancel/reactivate)
- The "Subscribe" CTAs on content detail + pricing pages
- How cross-org navigation works when a user has subscriptions to multiple orgs (does the UI make that legible?)
- How failed-payment (`past_due`) is surfaced to the user

Look specifically for:
1. Whether the UI handles the new `paused` status introduced in `handleSubscriptionPaused`.
2. Whether the UI shows the auto-follow behaviour noted in F13 ("you'll keep following the org after cancelling").
3. Whether multi-org subscribers have a consolidated billing/management view.
4. Server-load `.catch()` discipline (per the CLAUDE.md streaming rules).

---

## Iteration 2 · Tick 3 — 2026-04-23 (frontend subscription UX)

### Context shift since April 12

1. **`PurchaseOrSubscribeModal.svelte` no longer exists** — the April 12 Phase 2.4 fix is on a dead component. Subscribe CTAs now flow through `SubscribeButton.svelte` + `SubscribeCTA.svelte` directly. Historical note only; no new bug.
2. `account/subscriptions/+page.server.ts` is **21 lines** and registers `depends('account:subscriptions')` — that piece from the subscription-cache-audit is in place.
3. `subscriptionCollection` is a new localStorage-backed TanStack DB collection keyed by `organizationId`. Loads via `loadSubscriptionFromServer`. This is how the app knows "what does this user currently have with this org".

### New findings (tick 3 — frontend)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| U1 | **P1** | Type drift | `subscriptionCollection.SubscriptionItem.status` type is `'active' \| 'cancelling' \| 'past_due'` — **excludes** `paused`, `cancelled`, `incomplete` which are valid backend states. If the server returns `paused`, `loadSubscriptionFromServer` still upserts it (runtime happy, TS wrong) and every downstream consumer reading `sub.status` can't narrow safely. | `apps/web/src/lib/collections/subscription.ts:39` vs schema CHECK `subscriptions.ts:164` |
| U2 | **P1** | UX gap | `account/subscriptions/+page.svelte` has **no render branch for `paused`** — no resume button, no status alert. `resumeSubscription` command exists in `subscription.remote.ts:211` but the account page never calls it. A user whose subscription is billing-paused by Stripe (dunning retry, admin pause, etc.) has literally no way to resume from our UI. | `+page.svelte:241-259` (only active/cancelling branches); `grep paused` returns no hits |
| U3 | **P1** | Regression | Current `+page.server.ts` has **no try/catch** on `api.subscription.getMine()` — API failure throws → page 500 / `+error.svelte`. The April 12 Phase 2.6 `{ loadError: true }` + retry UI is **gone**. | `+page.server.ts:16-21` |
| U4 | **P1** | Regression | April 12 Phase 2.5 claimed per-card reactivation state via `Set<string>` / `Map<string, string>`. Current code has `reactivateLoading = $state<string \| null>` and `reactivateError = $state('')` — single-slot, one card at a time. Also `reactivateError` renders on ALL cards where `reactivateLoading === null` (the guard gates visibility on absence of loading, not subscription identity), so after one failed reactivation any unrelated card gets the error banner. | `+page.svelte:41-42, 262-263` |
| U5 | **P1** | Silent failure | `handleUpdatePayment` — `try/catch {}` with the comment "Stripe will show its own error". But the failure is `openBillingPortal` (our own remote fn) returning null or throwing — Stripe is never reached. User clicks "Update payment", nothing happens, no toast, no log surfaced. | `+page.svelte:147-158` |
| U6 | **P1** | Tier-change flow | "Change tier" button redirects to `{orgUrl}/pricing` via `window.location.href`. This assumes (a) the `/pricing` route exists on every org and (b) its SubscribeCTA correctly handles the "already subscribed — upgrade instead" path (should call `changeTier` not create a new checkout, which would throw `AlreadySubscribedError`). Neither assumption is validated from this page. | `+page.svelte:232-240`; `subscription.remote.ts:149-163` has `changeTier` unused from this surface |
| U7 | **P2** | i18n gap | `statusLabel()` only has cases for `active / cancelling / past_due / cancelled`. `paused` and `incomplete` fall through to `default: return status` → the raw backend literal bleeds into UI. | `+page.svelte:53-61` |
| U8 | **P2** | Collapse loss | `loadSubscriptionFromServer` does `status: sub.cancelAtPeriodEnd ? 'cancelling' : 'active'` — loses `past_due`, `paused`, and any other server status, regardless of what the server actually returned. The earlier line 88 derives status only from `cancelAtPeriodEnd`. A subscription that is `past_due + cancelAtPeriodEnd=false` is stored as `'active'` on the client. | `apps/web/src/lib/collections/subscription.ts:87-94` |
| U9 | **P2** | Missing affordance | No "total monthly spend" or "next charge" consolidation across the N subscriptions a multi-org user has. Users with 5 subscriptions see 5 separate cards; finding out "how much does Codex cost me this month" requires mental addition. Low-effort add, high clarity win. | `+page.svelte:174-270` (no aggregate row) |
| U10 | **P2** | Missing affordance | No mention of the F13 auto-follow behaviour anywhere in the UI ("cancelling your subscription won't stop emails — unfollow in settings"). Users who cancel then still get org updates will be surprised. | `+page.svelte` — cancel dialog only has a reason textarea |
| U11 | **P2** | Dialog body | Cancel dialog asks for a free-text reason without offering preset pick-list. Text-only reasons are hard to aggregate for churn analysis. Low-cost win: radio group (`Too expensive / Not enough content / Found alternative / Other…`) with "Other" unlocking the textarea. | `+page.svelte:285-295` |
| U12 | **P2** | Empty state | When the user has never subscribed, EmptyState shows a generic "no subscriptions" message with no link to orgs / pricing / discovery. Compare with the library empty state which typically funnels users toward content. | `+page.svelte:169-173` |
| U13 | **P3** | ARIA | `Alert` for `past_due` is inline with "Update payment" button — good — but `role="alert"` on the Alert may re-announce on every re-render of the derived subscriptions. Verify idempotence for screen readers. | `+page.svelte:201-208` |

### Design suggestions (tick 3)

| # | Suggestion | Why |
|---|---|---|
| S15 | Expand `SubscriptionItem.status` type to the full backend enum (`'active' \| 'cancelling' \| 'past_due' \| 'paused' \| 'cancelled' \| 'incomplete'`). Make `loadSubscriptionFromServer` pass `sub.status` through faithfully rather than collapsing to active/cancelling. Account page adds branches for each state. | Fixes U1, U2, U8 in one go. Unlocks the backend `paused`/`resumed` lifecycle the service already implements. |
| S16 | Restore the Phase 2.6 `{ loadError: true }` + retry pattern in `+page.server.ts`. Wrap `api.subscription.getMine()` in try/catch, return a tagged error, render `Alert` + retry via `invalidateAll()`. | Fixes U3. |
| S17 | Restore per-card loading + error state: `reactivatingIds = $state(new Set<string>())` + `reactivateErrors = $state(new Map<string, string>())`. Render the error only on the matching card (`reactivateErrors.get(sub.id)`). Same for a future per-card cancel button if that multi-cancel ever ships. | Fixes U4. |
| S18 | Wire `handleUpdatePayment` to a toast/`Alert` on failure — "Couldn't open billing portal, try again in a moment" — and log to `observability`. Stripe being unreachable is the most common real failure mode; silence is the worst UX. | Fixes U5. |
| S19 | Add a dedicated "Change plan" flow from account page that calls `changeTier` (`subscription.remote.ts:149-163`) directly with tier selection UI, rather than kicking to `/pricing` and hoping SubscribeCTA picks the right branch. | Fixes U6 properly. Also keeps users on the account surface for plan management — separates "browse / subscribe" (pricing page) from "manage existing" (account page). |
| S20 | In the cancel dialog, present the cancellation taxonomy as a radio group + free-text for "Other". Persist the tag as a structured reason (e.g. `churn_reason: 'too_expensive'`) on the subscription row for later analytics; the free text stays in `cancelReason`. | Fixes U11 and gives product real churn-data. |
| S21 | Add a "subscriptions summary" block at the top of the page: total monthly spend (sum `amountCents` where `billingInterval='month'` and `status∈{active,cancelling,past_due}`), next charge date (earliest `currentPeriodEnd` for active subs), count of orgs. | Fixes U9. |
| S22 | In the cancel confirmation, surface the auto-follow behaviour explicitly: "You'll keep receiving updates from [Org] unless you also unfollow. [Unfollow too]" (checkbox). On confirm, fire `cancelSubscription` AND optionally a `followers.delete` call. | Fixes U10 and F13 at once — turns an unexpected behaviour into an informed user choice. |

### Checks on multi-tenancy UX (from the "suborgs" framing)

- Account page **does** correctly render one card per org — multi-org subscribers see each subscription distinctly. The card shows org logo + org name + tier name, which is enough to disambiguate. ✅
- "Change tier" navigates to the **target org's** `/pricing` via `buildOrgUrl` (cross-subdomain). This respects the per-org Stripe tenancy. ✅
- Cancellation happens in-place on the platform subdomain — no cross-subdomain round-trip. ✅
- But no sense of "shared user identity across orgs" is surfaced. Billing portal is Stripe's standard portal which opens for **one Stripe Customer**; a user who subscribed separately to 3 orgs has (per F7) 3 separate Stripe Customers and therefore 3 portals. The UI does not communicate this. This is the clearest UX-level evidence that F7 (Stripe Customer reuse) should be fixed. ⚠️

### Cross-referencing to the server-side issues

| Frontend finding | Back-pressure on backend issue |
|---|---|
| U1/U2 paused state | Evidence that the backend `handleSubscriptionPaused` capability is built but frontend can't exercise it → full feature still inaccessible to users. |
| U6 tier change | Evidence that `changeTier` is built but the only entry point is via the pricing page, where handling the "already subscribed" branch is the failure boundary (T6/S12). |
| U9 summary | Evidence that T1 (no `subscription_invoices` ledger) matters to users too: "what did I pay last month" is answerable from DB but not surfaceable cleanly. |
| billing portal | Evidence that F7 (Stripe Customer per user, not per user-per-org) is an urgent product-level concern. |

### Updated living findings ledger — summary

| Bucket | Count | Top priority |
|---|---|---|
| P0 (blocking) | **2** — F1, F2 | F2 repair migration |
| P1 (wrong-state) | **19** — F3-F10, T1-T5, U1-U6 | U2 (paused users stuck) + U3/U4 (regressions) + T2 (transfer atomicity) + F3/F4 (webhook atomicity) |
| P2 (hygiene) | **18** | T5 column semantic overload + U7 paused i18n |
| P3 (polish) | **3** | T12 payout metric, U13 aria |

### Tick 4 target

**Subscribe/upgrade flow + `handleSubscriptionUpdated`**. Specifically:
- Read `SubscribeCTA.svelte` (1144 lines) — understand how it branches between "new subscription" and "upgrade" when the user is already subscribed (this is the destination of the `/pricing` redirect at U6).
- Read `handleSubscriptionUpdated` in `subscription-service.ts` — verify proration mode, tier-change path, status transitions (what happens if Stripe flips `cancel_at_period_end` via a webhook while we have stale state?).
- Check if `+page.svelte` for org `/pricing` handles the "current plan" state correctly for visiting subscribers.
- Compare `subscription-context.svelte.ts` (used to render current-plan indicator across the app) with the account-page rendering — do they agree?

---

## Iteration 2 · Tick 4 — 2026-04-23 (updated + tier-change + access-gate consistency)

### New findings (tick 4)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| V1 | **P1** | Column drift | `handleSubscriptionUpdated` writes `status` derived from `cancel_at_period_end` but **never writes the `cancel_at_period_end` column itself**. If Stripe flips the flag (e.g. user cancels from the billing portal), our DB's `cancelAtPeriodEnd` stays false while `status='cancelling'`. Any code path that reads the column directly (e.g. `subscriptionCollection.cancelAtPeriodEnd`, `subscription.remote.getCurrentSubscription`) sees stale state. | `subscription-service.ts:947-976` |
| V2 | **P1** | Enum gap | `handleSubscriptionUpdated` if/else only maps `active / past_due / canceled / incomplete`. `trialing`, `unpaid`, `paused` fall through with `let status = sub.status` → we silently keep stale state. Compare with the explicit enum intersection in `handleSubscriptionResumed` (L1177-1184) — same file, two different strategies. | `subscription-service.ts:945-957` vs `1177-1184` |
| V3 | **P1** | Revenue loss | Tier change → `changeTier` updates Stripe + writes `tierId` + `billingInterval` to DB, but **never recomputes `amountCents`/`platformFeeCents`/`organizationFeeCents`/`creatorPayoutCents`**. For an upgrade from £10/mo → £20/mo, our `subscriptions.amountCents` stays at 1000 until the next `invoice.payment_succeeded` fires (typically weeks away). Any admin query against `sum(amountCents)` or MRR dashboards read the old tier's price during that window. | `subscription-service.ts:1318-1341` |
| V4 | **P1** | Undetected change | Tier detection in `handleSubscriptionUpdated` relies solely on `stripeSubscription.metadata.codex_tier_id`. A tier change via Stripe Dashboard, Stripe CLI, or a Stripe-API call that doesn't preserve metadata is **not detected**. We never back-map `items.data[0].price.id → tier` as a fallback. | `subscription-service.ts:960-971` |
| V5 | **P1** | Interval drift | Same pattern as V4: `billingInterval` is never synced in `handleSubscriptionUpdated`. Switching monthly↔annual via any path that doesn't hit our `changeTier` leaves our DB wrong. Could be read from `item.price.recurring.interval`. | `subscription-service.ts:963-976` |
| V6 | **P1** | changeTier gap | `changeTier` does not re-validate org Connect readiness. If `chargesEnabled` went false between the original subscribe and the upgrade, we allow the change; next renewal will accumulate to `pendingPayouts` without the user being warned. Parallel `createCheckoutSession` DOES validate (L291). Inconsistency. | `subscription-service.ts:1269-1381` (no connect check) |
| V7 | **P1** | Access gate divergence | `loadSubscriptionContext` returns `hasSubscription = !!currentSubscription` — no status filter. Any non-null subscription (including `paused`, `past_due`, `cancelled-but-returned-in-grace`) sets `hasSubscription=true` and `subscriptionCoversContent=true`. Backend access layer WILL correctly refuse streaming on paused/past_due, so the user sees "play" then 403s. Frontend promise ≠ backend enforcement. | `apps/web/src/lib/server/content-detail.ts:242-257` |
| V8 | **P1** | Live override no filter | `subscription-context.svelte.ts` live override (L133-156) grants access whenever `subscriptionCollection.state.get(orgId)` returns a row, regardless of status. Combined with U8 (collection collapses status to active/cancelling) this becomes a "ghost access" vector for paused/past_due subscribers on content-detail pages. | `apps/web/src/lib/utils/subscription-context.svelte.ts:133-156` |
| V9 | **P1** | Pricing load swallow | Pricing page server load does `api.subscription.getCurrent(org.id).catch(() => null)` — silent fallback. When the subscription API is down, a subscribed user sees "Subscribe" CTA, clicks it, and hits `AlreadySubscribedError`. Same Phase 2.6 pattern as U3 but in a second location. | `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.server.ts:30-33` |
| V10 | **P2** | BUG-020 reliance | `changeTier` relies on the `customer.subscription.updated` webhook to reconcile local state if the sync DB write fails ("webhook will reconcile" — L1354). But (a) per V4 the webhook only syncs fields from metadata, so we're reconciling against metadata we just wrote; (b) if the sync DB write AND the webhook are both dropped, we stay out of sync indefinitely with no alert. | `subscription-service.ts:1328-1356` |
| V11 | **P2** | Consistency | Two status-mapping strategies in one file: `handleSubscriptionUpdated` uses if/else with fall-through; `handleSubscriptionResumed` uses explicit enum intersection with ACTIVE fallback. Extract shared `mapStripeStatus(stripeStatus, currentStatus): SubscriptionStatus` helper. | `subscription-service.ts:945-957` vs `1177-1184` |
| V12 | **P2** | Wrong fallback | `handleSubscriptionResumed` falls back to ACTIVE when Stripe reports `canceled` / `trialing` / `incomplete_expired` / `unpaid`. Resurrecting a `canceled` sub to ACTIVE on a resume event is wrong — should no-op or warn. | `subscription-service.ts:1177-1184` |
| V13 | **P2** | Paused resume | `handleSubscriptionResumed` only updates `status` — doesn't resync tier/period/split from Stripe. If Stripe advanced the period during pause, we see stale period dates until next renewal. | `subscription-service.ts:1186-1192` |
| V14 | **P3** | Pricing tiers fallback | `api.tiers.list(org.id).catch(() => [])` (`+page.server.ts:30`) — same silent fallback. Page renders "no tiers" when the API fails, users assume pricing is offline, not that the page failed to load. | Same file |
| V15 | **P3** | getCurrent filter unclear | `api.subscription.getCurrent(orgId)` behaviour — does it return `cancelled` subscriptions? paused? Unclear from the client side. Documentation improvement for downstream callers (pricing page, content detail). | API surface, needs spec |

### Cross-referencing with earlier findings

| From earlier | Tick 4 reinforcement |
|---|---|
| **T1** (no `subscription_invoices` ledger) | V3 makes it worse: even the *current* `subscriptions.amountCents` is wrong between tier change and next renewal. With no ledger, finance has no correct source. |
| **T4** (inter-creator rounding dust) | V3 amplifies: every dirty re-split compounds dust. |
| **U1/U8** (frontend status collapse) | V7/V8 show the collapse becomes an **access gate bug**, not just a UI label bug. |
| **F7** (Stripe Customer per user-per-org) | V6 (Connect readiness drift on changeTier) is the payee-side version of the same "multi-org payments aren't unified" story. |
| **BUG-020 comment** in code | V10 documents the actual reliability profile — webhook reconciliation against metadata we just wrote is self-referential and doesn't help the dropped-webhook case. |

### Design suggestions (tick 4)

| # | Suggestion | Why |
|---|---|---|
| S23 | Extract `mapStripeSubscriptionStatus(stripe: Stripe.Subscription): { status, cancelAtPeriodEnd, tierId, billingInterval, amountCents }` as the **single** interpretation layer. `handleSubscriptionCreated / Updated / Resumed / Paused / Deleted` all call this and then do `UPDATE subscriptions SET ...` from the returned record. Guarantees no field drifts. | Fixes V1, V2, V4, V5, V11 in one move. |
| S24 | In `changeTier`, recompute revenue split from the new tier's *monthly* price (not waiting for the invoice). Write it via the same mapper in S23. Accept that it's "forward-looking" until the next renewal overwrites. | Fixes V3. |
| S25 | In `handleSubscriptionUpdated`, cross-check `items.data[0].price.id` against `subscription_tiers.stripe_price_{monthly,annual}_id` to detect Stripe-Dashboard tier changes even without metadata. Fall back to metadata only as hint. | Fixes V4. |
| S26 | In `changeTier`, re-validate org Connect (`chargesEnabled + payoutsEnabled`) exactly as `createCheckoutSession` does. Throw `ConnectAccountNotReadyError` on fail. | Fixes V6. |
| S27 | Add a status filter to `loadSubscriptionContext`: `hasSubscription` only true when `status in ['active', 'cancelling']` (cancelling retains access until period end). Paused / past_due return `hasSubscription: false` to match access-layer enforcement. | Fixes V7. |
| S28 | Same status filter in `subscription-context.svelte.ts liveSubscription` — reject entries whose status isn't access-granting. | Fixes V8. |
| S29 | Re-wrap all `.catch(() => null)` / `.catch(() => [])` in subscription server-loads to return a tagged `{ error: true }` discriminated union. Pricing page shows an Alert; SubscribeCTA renders "loading failed — reload". | Fixes V9, V14, and aligns with S16 on the account page. |
| S30 | Update `handleSubscriptionResumed` to (a) refuse resumption when Stripe reports `canceled` (log warn), (b) re-sync tier/period via the new S23 mapper. | Fixes V12, V13. |
| S31 | Add an **E2E state matrix test**: for each backend-emittable status (active, cancelling, past_due, paused, cancelled, incomplete), assert the account page + content-detail page + pricing page all render **something** (not empty, not the wrong CTA). Catches V7/V8/U2 permanently. | The cheapest way to enforce the backend ↔ frontend parity the existing audit has failed to maintain. |

### Running ledger

| Bucket | Count | New top priorities |
|---|---|---|
| P0 | **2** | F2 repair migration still the most urgent |
| P1 | **28** (V1-V9 added) | V7/V8 access-gate divergence (user-visible silent failure); V3 revenue-split-on-tier-change (data integrity); S23 as force-multiplier |
| P2 | **23** | S23 mapper reduces most of these to "already handled" |
| P3 | **5** | V14/V15 minor visibility items |

### Tick 5 target

**Access layer deep-dive** — `@codex/access` `ContentAccessService`:
- How does `getStreamingUrl` resolve "subscribed to this org + tier covers this content"?
- When a subscription is cancelled/paused, how does `contentAccess` get revoked, and does the revocation honour the "cancelling until period end" grace window?
- F6 (missing `subscriptionId` FK) in practice — how does the code find "content access granted via this subscription"?
- Cross-org: can a user with a subscription to Org A accidentally access Org B's content via any path?
- Worker-auth HMAC flow for internal access calls (touchpoint with `@codex/security`).

---

## Iteration 2 · Tick 5 — 2026-04-23 (access layer + revocation)

### Positive findings (good design worth preserving)

This subsystem is **substantially better engineered** than the webhook + service paths audited earlier. Worth enumerating so a refactor doesn't accidentally remove:

1. **Revocation keyspace cleanly separate from cache** — `revoked:user:{userId}:{orgId}` vs `cache:*` prefixes (`access-revocation.ts:58`). Zero semantic overlap with `@codex/cache`/`VersionedCache`.
2. **Revocation TTL is explicitly computed as 2× max presigned-URL TTL** (1200s vs 600s max) — correctly closes the "signed URL outlives access check" race window.
3. **Subscription access filter is exactly right for cancelling-until-period-end**: `inArray(status, [ACTIVE, CANCELLING]) AND currentPeriodEnd > now()` at `ContentAccessService.ts:499-504`. This matches the stated product decision ("cancel_at_period_end retains paid access through currentPeriodEnd") documented in `access-revocation.ts:19-20`.
4. **`paused` and `past_due` are correctly denied at DB filter** — they're excluded from the IN clause, so the query returns no row and access is refused. (This is the counterpart the frontend V7/V8 should mirror.)
5. **Fast-path KV short-circuit before DB transaction** (`ContentAccessService.ts:419-453`) — ~0.5ms KV read avoids opening a txn for revoked users. Good performance design.
6. **Cross-org leak properly prevented**: every access branch scopes by `contentRecord.organizationId`, and every subscription/membership/follower query scopes by that same org. A subscription to Org A can never grant access to Org B content. ✅
7. **Management-role bypass scoped to `owner/admin/creator`** (`ContentAccessService.ts:556-560`) — the Codex-sbgm fix from April 12 is still in place and uses a named constant.
8. **Follower ≠ subscriber** is an intentional product invariant, documented both in code comments (L622-628) and `@codex/access/CLAUDE.md`. Worth surfacing to users.
9. **Defensive JSON parse on revocation read** (`access-revocation.ts:138-153`) — fails open on malformed payload with obs.warn rather than crashing the streaming path.

### New findings (tick 5)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| W1 | **P1** | Atomicity | Revocation write is "owned by the route" (`subscription-service.ts:1515, 1566` refs `routes/subscriptions.ts clearAccessRevocation`) — not inside the webhook DB transaction. Combined with F3/F4 (webhook handlers not in a transaction anyway), three writes happen sequentially on `subscription.deleted`: subscription row update → membership update → KV revocation. A partial failure leaves any combination inconsistent. A user whose subscription flipped cancelled in DB but whose KV revocation write failed will still get streaming URLs until their existing signed URL expires AND the DB filter re-runs (which, if status is `cancelled` instead of `paused`, will deny — but the fast path is broken). | `subscription-service.ts:1515-1516, 1566-1567` comments confirm the hand-off pattern |
| W2 | **P1** | Missing revocation reason | `RevocationReason` enum is `{subscription_deleted, payment_failed, refund, admin_revoke}` — **no `subscription_paused` or `dispute_created`** values. But `access-revocation.ts:15-16` (module doc) claims the write sites include `customer.subscription.paused` and `charge.dispute.created`. Either: (a) the handler writes with a mismatched reason (e.g. `subscription_deleted`) for paused, losing fidelity in observability; or (b) the handler writes `reason: 'subscription_paused'`, which fails `isRevocation` validation on read (`access-revocation.ts:190`) → KV fast-path silently no-ops. Security is preserved by the DB filter below, but the fast-path design is partially broken. | `access-revocation.ts:31-35` enum vs `15-16` doc claim |
| W3 | **P2** | Factory swallow | `createContentAccessService(env)` at `ContentAccessService.ts:1814` only wires `AccessRevocation` when `env.CACHE_KV` is bound. In any deployment that misses the binding (e.g. staging misconfiguration), the fast path silently no-ops and every access check must traverse the DB. Typecheck passes, unit tests pass, monitoring won't notice until DB load spikes. | `ContentAccessService.ts:1813-1815` |
| W4 | **P2** | Revocation TTL coupling | `REVOCATION_TTL_SECONDS = 1200` is a hardcoded constant derived from "2× max presigned URL TTL (600s)". If anyone bumps the max presigned TTL (e.g. via `expirySeconds` upper bound in Zod), this constant is not recomputed. Express the relationship in code: `REVOCATION_TTL_SECONDS = MAX_PRESIGNED_URL_TTL * 2`. | `access-revocation.ts:48-51` |
| W5 | **P2** | Follower filter | `checkFollower` (`ContentAccessService.ts:574-581`) queries `organizationFollowers` with no status filter. If followers have any deleted/blocked/pending state in future (likely as the platform grows), this lookup needs to be tightened. Verify schema today — but flag as a growth concern. | `ContentAccessService.ts:574-581` |
| W6 | **P2** | UX gap on followers-only | Paid subscribers hitting followers-only content get generic `AccessDeniedError`. No hint that "this is actually free — just click Follow". Product decision to decouple follower from subscriber is fine, but the UX copy should lead the user to the free unlock. | `ContentAccessService.ts:629-680` (followers branch) + frontend handler for `AccessDeniedError` with `reason: 'followers_only'` |
| W7 | **P3** | Personal-content revocation | `ContentAccessService.ts:428-432` explicitly skips revocation for content without `organizationId` (personal content). Refund on personal-content purchases therefore can't be revoked at the KV layer — only at the DB `contentAccess` layer. Minor gap but worth documenting (or revocation could be keyed by contentId for personal content). | `ContentAccessService.ts:428-432` |
| W8 | **P2** | Stale management role | From F5: cancelled subscribers keep `role='subscriber'` with `status='inactive'`. `checkManagementMembership` uses `status='active' AND role IN (owner,admin,creator)`, so this doesn't affect access (good). But legacy `role='member'` rows with `status='active'` DO exist — and if any admin tool flips a `subscriber` to `member` without resetting status, the user still doesn't gain management access. This pathway is safe by design; worth documenting. | `ContentAccessService.ts:562-571` |
| W9 | **P3** | Transaction for reads | The access decision uses `db.transaction(async (tx) => ...)` to get "snapshot consistency" — but every query inside is a read. Postgres read-uncommitted default snapshot is consistent for a single query, and this transaction opens a connection just for serialization isolation across ~3-4 reads. Measure whether the overhead matters at scale; consider a single-select CTE-style query that returns the access decision in one round-trip. | `ContentAccessService.ts:458` |
| W10 | **P2** | F6 in practice | The `contentAccess` table still has no `subscriptionId` FK. Looking at where subscription-granted access is actually checked (here), the code doesn't read or write `contentAccess` — it computes access dynamically from `subscriptions` + `subscriptionTiers` each time. So `contentAccess` isn't used for subscription grants at all. The table's `accessType` enum includes `'subscription'` but the code path is dynamic. **Tick 1 F6 updated**: the FK gap isn't a data-integrity bug (no rows being written/stranded) — but the `'subscription'` accessType value in the enum is **unused dead enum branch**. Either start populating it (pre-grant on subscribe) or remove it from the CHECK constraint. | `ContentAccessService.ts:485-539` (subscription path) never touches `contentAccess`; `ecommerce.ts:71` accessType enum includes `'subscription'` |
| W11 | **P2** | Revocation reason exposure | `AccessDeniedError` (thrown at `ContentAccessService.ts:446-450` when revoked) includes `reason: revocation.reason` in the error context. The error is mapped to HTTP by `mapErrorToResponse` — does it leak the reason string to the client? If so, a client seeing `reason: 'refund'` knows why their access was cut. Usually fine, but worth auditing the mapper. | `ContentAccessService.ts:446-450` + `mapErrorToResponse` in `@codex/service-errors` |
| W12 | **P2** | Empty mediaItem fallthrough | `ContentAccessService.ts:481-485` — written content has no mediaItem; access check proceeds, then "media-specific validation only runs after the access check passes AND a media item exists." Two separate null-handling points for media; consider a single typed discriminator (`mediaType: 'video' | 'audio' | 'written'` on the content row) so the branching is explicit. | Implicit via separate checks |

### Cross-referencing to earlier findings

| Earlier | Tick 5 update |
|---|---|
| **F6** (contentAccess.subscriptionId FK missing) | Downgraded from "data integrity" concern — the code doesn't actually use `contentAccess` rows for subscription grants at all. It's a dead enum value. S1 suggestion is still valid IF we want to pre-materialise subscription grants for performance/audit, but it's no longer urgent for correctness. |
| **V7/V8** (frontend hasSubscription ignoring status) | **Confirmed as frontend-only divergence** — the backend correctly filters subscriptions to `status IN (active, cancelling)` with period check. The UI should mirror this filter, not drop it. |
| **T1** (no subscription_invoices ledger) | Access decision doesn't depend on this — it reads current subscription row only. The ledger gap is still real for accounting but orthogonal to access control. |
| **F5** (cancelled subscribers keep role='subscriber') | Doesn't affect access — `role='subscriber'` isn't in MANAGEMENT_ROLES. But W8 flags the hygiene concern. |

### Design suggestions (tick 5)

| # | Suggestion | Why |
|---|---|---|
| S32 | Move revocation write into the same txn path as the webhook DB update. If moving to per-request WS client, the shape is: `tx.update(subscriptions) → tx.update(memberships) → kv.put(revoked:...)` — but KV write can't be transactional with Postgres. Instead: commit the DB txn, then **before** responding, write KV. If KV fails, log + alert but don't fail the webhook (idempotency covers retries). This at least guarantees KV isn't written ahead of a failed DB update. | Fixes W1 reliably. |
| S33 | Expand `RevocationReason` enum to `{subscription_deleted, subscription_paused, payment_failed, refund, dispute_created, admin_revoke}` and update `REVOCATION_REASONS` set + `isRevocation` validator together. Audit the webhook handlers to emit the right reason. | Fixes W2. |
| S34 | Alert on missing `CACHE_KV` binding in `createContentAccessService` — `obs.error` at startup if `env.CACHE_KV` is absent. Right now it's silently absent. | Fixes W3. |
| S35 | Derive `REVOCATION_TTL_SECONDS` from `MAX_PRESIGNED_URL_TTL * 2` as an expression, or add a unit test that asserts the invariant. | Fixes W4. |
| S36 | Drop `'subscription'` from `content_access.accessType` CHECK constraint (unused dead enum value), or wire a `subscribe → contentAccess` pre-materialisation path. Pick one. | Fixes W10. |
| S37 | When throwing `AccessDeniedError(reason: 'followers_only')`, ensure the error context also includes `suggested_action: 'follow'` so the frontend can render a "Follow to unlock" affordance. | Fixes W6. |
| S38 | Audit `mapErrorToResponse` for `AccessDeniedError` context serialisation — confirm whether `reason: 'refund'` is exposed to clients. If yes, decide product-side: is that acceptable transparency, or should the client only see `reason: 'subscription_required'`? | Fixes W11. |

### Updated running ledger

| Bucket | Count | Movers |
|---|---|---|
| P0 | **2** | F2 still the blocker |
| P1 | **30** (+W1, +W2) | Access-layer revocation atomicity (W1), revocation-reason enum gap (W2) |
| P2 | **30** (+W3, +W4, +W5, +W6, +W8, +W10, +W11, +W12) | S32-S38 design proposals concentrated here |
| P3 | **7** (+W7, +W9) | Hygiene — minor |

### Tick 6 target

**`TierService` (Stripe orphan, reorder, delete-with-subscribers)**:
- Verify the April 12 Phase 1.1 Stripe orphan cleanup still works (try/catch + archive + rollbackStripePriceChanges).
- Check tier reorder under concurrent edits (`sortOrder` unique index + idempotency).
- `TierHasSubscribersError` path — can a tier be deleted if historic (cancelled) subs still reference it via `tierId onDelete: restrict`?
- Stripe webhook for `price.updated` / `product.updated` — does our code react to Stripe-Dashboard price changes (parallel to V4)?
- Tier-level content gating — the content schema has `minimumTierId`; what validation prevents a published content from depending on a deleted tier?

---

## Iteration 2 · Tick 6 — 2026-04-24 (TierService)

### Positive findings to preserve

1. **Two-phase reorder pattern** (`tier-service.ts:528-546`) avoids unique-constraint violations and CHECK (`sort_order > 0`) violations by first moving all tiers to `10000 + i + 1`, then to final `i + 1`. Textbook correct.
2. **`getTierOrThrow`** (L562-583) scopes properly by `orgId` AND `isNull(deletedAt)`. Good.
3. **`rollbackStripePriceChanges`** (L611+) is a dedicated rollback helper that archives new prices and restores old ones. The separation from the create path keeps both halves legible.
4. **`subscriptions.tierId` uses `onDelete: 'restrict'`** (`subscriptions.ts:103`) — even with historic `cancelled` subscriptions, a hard delete on the tier is blocked. Since we only soft-delete tiers anyway, this is a defence-in-depth guarantee.

### New findings (tick 6)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| X1 | **P1** | Dead FK action | `content.minimumTierId references subscriptionTiers.id ON DELETE SET NULL` (`content.ts:272-275`) but `deleteTier` soft-deletes (sets `deletedAt`) → the FK action never fires. No code sweeps content rows that point at the deleted tier. **Result**: any content published with `minimumTierId = T` where `T` gets deleted becomes unreachable — `listTiers` no longer shows `T`, so nobody can subscribe to it, but access control still compares sortOrder against `T`'s tier. On soft-delete, also `UPDATE content SET minimum_tier_id = NULL WHERE minimum_tier_id = tierId AND org_id = orgId`. | `content.ts:272-275` + `tier-service.ts:446-449` + `ContentAccessService.ts:521-523` (no `isNull(deletedAt)` on tier lookup) |
| X2 | **P1** | Active-sub check gap | `deleteTier` subscriber check is `status NOT IN ('cancelled')` — so `incomplete`, `past_due`, `paused`, `incomplete_expired`, `unpaid` subscriptions all block deletion. That's safe but an admin with 10 `incomplete` subs that never cleaned up cannot retire a tier. Consider adding a `deletionMode: 'force'` path that also soft-cancels stale non-terminal subs, or at minimum surface a clear error with cleanup instructions. | `tier-service.ts:437-443` |
| X3 | **P1** | deleteTier atomicity | Soft delete (`update subscriptionTiers`) then `stripe.products.update({active: false})` are two separate calls. If Stripe archive fails, DB says tier is deleted but Stripe Product stays active — reverse orphan. Not catastrophic (we won't reuse the Product) but an admin auditing Stripe Dashboard will see ghosts. Wrap Stripe failure in try/catch with obs.error, or schedule a reconciliation job. | `tier-service.ts:446-456` |
| X4 | **P1** | Reorder input size | `reorderTiers` iterates `tierIds` twice inside a transaction with no upper bound. 1000 tiers → 2000 UPDATEs in one txn. Validation should cap this at a sane limit (e.g. 50 tiers per org) — either in `reorderTiersSchema` or explicit service-side check. | `tier-service.ts:505-555` |
| X5 | **P1** | Reorder completeness | `reorderTiers` validates that every `tierId` belongs to the org (L518-523) but does **not** validate that `tierIds` contains **every** tier in the org. If the caller sends a subset (e.g. 2 of 5 tiers), only those 2 get new sortOrders 1 and 2 — but the other 3 retain their old sortOrders (which are also 1-based from previous order), causing **sortOrder collisions** that the unique index will allow (since the 2-phase hop avoids collision with *other* tiers being moved) but leave duplicate final values. Need: assert `tierIds.length === total tiers in org` OR only update the tiers the caller specified while keeping others' orders stable (which would need a third phase). | `tier-service.ts:505-555` |
| X6 | **P1** | Stripe-Dashboard price change | Per V4 (Tick 4), `handleSubscriptionUpdated` detects tier changes via metadata only. If an admin edits the Stripe Price (unit_amount) via Dashboard, subscribers keep paying old amount in our DB. Similarly, NEW signups use our `stripePriceMonthlyId` / `stripePriceAnnualId` columns — which still point at the old Stripe Price — so our UI shows `priceMonthly=1000` but Stripe checkout could charge whatever unit_amount the Price was reset to. **If Dashboard editing is allowed in practice, our `subscriptionTiers.priceMonthly` is not the source of truth. If Dashboard editing is forbidden, document it prominently.** | `subscriptions.ts:39-45` + `subscription-service.ts:960-971` |
| X7 | **P2** | Reorder dbWs assertion | `(this.db as typeof dbWs).transaction(...)` is a type-level assertion with no runtime guard. If the registered service receives an HTTP client (`createDbClient` return type), the runtime call fails with a misleading error. Inject `dbWs` or `createPerRequestDbClient` explicitly into the constructor when transactions are needed. | `tier-service.ts:528` |
| X8 | **P2** | Connect account ambiguity | `requireActiveConnect` uses `.where(eq(organizationId, orgId)).limit(1)` — same arbitrary selection as T10. If org has multiple Connect accounts and the owner's is disabled while a member's is active, tier ops succeed but downstream transfers may not route correctly. | `tier-service.ts:588-601` |
| X9 | **P2** | Price history | When `updateTier` changes prices, old Stripe Prices are archived (not deleted). Our `subscriptionTiers.stripePriceMonthlyId` points at the NEW Price. **Historical subscriptions continue paying the archived Price via Stripe's subscription-item `price` pointer** — but our tier row has lost the reference to the archived price. Reporting "how much is tier X earning us right now across all its generations?" requires querying Stripe. Consider a `subscription_tier_prices` audit table logging each price-change event with (old_monthly, new_monthly, old_annual, new_annual, stripe_product_id, changed_at, changed_by). | `tier-service.ts:244-420` (updateTier) |
| X10 | **P2** | Soft-deleted tier loaded in access check | `ContentAccessService.ts:521-523` does `subscriptionTiers.findFirst where id = minimumTierId` with **no `isNull(deletedAt)` filter**. A soft-deleted tier loads OK for sortOrder comparison. Usually harmless (content still gated by sortOrder ≥ deletedTier.sortOrder) but inconsistent with `getTierOrThrow` which filters. Either consistently filter, or intentionally allow (with comment). | `ContentAccessService.ts:521-523` |
| X11 | **P2** | Listing public endpoint | `listTiers(orgId)` is public (no auth). No explicit rate limiting documented. Low-cost scraping vector; public tier data isn't sensitive but we should confirm it's behind the worker's default rate limiter. | `tier-service.ts:471-483` |
| X12 | **P2** | UX copy gap | `TierHasSubscribersError` returns a count but no actionable next step. For the creator, "This tier has 3 active subscribers — cancel their subscriptions first or archive the tier instead" would be more useful than raw "Tier has active subscribers". UI concern. | `tier-service.ts:442` |
| X13 | **P3** | Audit trail | None of create/update/delete/reorder write to an audit log (e.g. `admin_actions` table). For a creator-facing tier edit, an admin-audit trail is normally required for GDPR/dispute purposes. | All tier methods |

### Cross-referencing to earlier findings

| Earlier | Tick 6 update |
|---|---|
| **V4** (Stripe-Dashboard tier change not detected) | X6 extends: **price** changes in Dashboard are also undetected, making `subscriptionTiers.priceMonthly` only-trusted-if-Dashboard-is-read-only. |
| **T10** (Connect account arbitrary selection) | X8 reproduces the same issue in `requireActiveConnect` — **pick one canonical source-of-truth for "the org's" Connect account** (e.g. owner's user_id as a column on `organizations`, or a `organizations.primary_connect_account_id` column). |
| **F6 downgrade** (contentAccess dead enum) | Bringing in X1 shows there IS a legitimate content↔tier integrity concern — just at `content.minimumTierId`, not `contentAccess`. Severity was misattributed. |

### Design suggestions (tick 6)

| # | Suggestion | Why |
|---|---|---|
| S39 | In `deleteTier`, after the soft-delete write, inside the same transaction `UPDATE content SET minimum_tier_id = NULL WHERE minimum_tier_id = :tierId AND organization_id = :orgId`. Log a warn with the count of affected content rows so the admin is alerted. | Fixes X1. Cleanup is explicit and scoped to the org. |
| S40 | Cap `reorderTiersSchema` at `z.array(uuid).max(50)`. Add a service-side assertion that the array covers **all** non-deleted tiers for the org; otherwise throw `ValidationError('Must reorder the full tier list')`. | Fixes X4 + X5. Both safety and correctness. |
| S41 | Document "Stripe Dashboard is read-only for Codex-managed products" in `@codex/subscription/CLAUDE.md` or — better — watch `product.updated` / `price.updated` webhooks and emit `obs.error('Stripe Dashboard edit detected', { productId, priceId })` so ops can see when invariants are breached. | Fixes V4 + X6. Operational safety net. |
| S42 | Introduce `organizations.primary_connect_account_user_id` (text, FK to users.id). `requireActiveConnect` and `executeTransfers` resolve through this column. Fixes the "which Connect account?" ambiguity in one pass. | Fixes T10 + X8 with a single schema change. |
| S43 | Wrap `deleteTier`'s `stripe.products.update({active: false})` in try/catch — log but don't rollback the DB soft-delete (since the product is effectively dead to us anyway; Stripe orphan is observability concern). Alternatively, introduce a reconciliation cron that fetches `subscriptionTiers where deletedAt is not null AND stripe_product_archived_at is null` and retries archiving. | Fixes X3 cleanly. |
| S44 | Add a `subscription_tier_prices` audit table: `(tier_id, monthly_cents, annual_cents, stripe_price_monthly_id, stripe_price_annual_id, effective_from, effective_until, changed_by_user_id)`. Every `updateTier` that touches prices inserts a new row and sets `effective_until` on the prior row. | Fixes X9. Pairs well with S8 (subscription_invoices ledger) — same pattern for accounting. |
| S45 | `TierHasSubscribersError` should include `{subscriberCount, suggestion: 'cancel_or_archive'}` in its context so the frontend can render: "This tier has N active subscribers. You can't delete it, but you can mark it as inactive (will stop new signups while existing subscribers retain access)." Also implies: adding an `archiveTier` / `deactivateTier` distinct from `deleteTier`. | Fixes X12 + surfaces a product feature gap. |
| S46 | Unit test matrix: `deleteTier × (no subscribers / active subscribers / only-cancelled subscribers / only-paused / only-past_due)`. For each, assert the right error (or success). Locks X2's behaviour as intentional. | Regression fencing. |

### Updated running ledger

| Bucket | Count | Movers |
|---|---|---|
| P0 | **2** | F2 migration still blocking |
| P1 | **36** (+X1-X6) | **X1 dead FK action** (content unreachable after tier delete), X5 reorder subset-collision, X6 Dashboard price drift |
| P2 | **37** (+X7-X12) | Connect ambiguity (T10+X8) is the biggest cross-tick repeat |
| P3 | **8** (+X13) | |

### Tick 7 target

**Webhook HMAC + dev-router guard + Connect-account onboarding flow**:
- Verify HMAC signature verification hasn't regressed (April 12 Phase 3.3 added 3 signature edge-case tests).
- `workers/ecom-api/src/handlers/connect-webhook.ts` — `account.updated` handling, `chargesEnabled` / `payoutsEnabled` transitions.
- `ConnectAccountService.createAccount` → Account Link URL generation.
- Check the dev-webhook-router guard (April 12 Phase 1.3 added the production 404 guard — is it still there?).
- Replay protection: how are we handling Stripe timestamp tolerance beyond the built-in 300s?
- What happens to pending creator payouts when a creator's Connect account is disabled (charges-disabled transition)?

---

## Iteration 2 · Tick 7 — 2026-04-24 (HMAC + dev-router + Connect webhooks)

### Positive findings to preserve

1. **Per-endpoint signature secrets** — each Stripe webhook endpoint has its own `STRIPE_WEBHOOK_SECRET_*` env var, matching Stripe's "endpoint signing secret per subscription in Dashboard" model. Compromise of one secret doesn't compromise all endpoints. Preserve.
2. **Dev router 404 guard** (`workers/ecom-api/src/index.ts:218-231`) — April 12 Phase 1.3 fix is still live: dev endpoint returns 404 when `ENVIRONMENT === 'production'`. ✅
3. **Raw-body signature verification** — `verify-signature.ts:66` reads `c.req.text()` before any JSON parse, which is mandatory for Stripe HMAC. ✅
4. **401 (not 500) on signature failure** — `verify-signature.ts:113` returns 401, which by Stripe policy means "do NOT retry." Good — invalid signature shouldn't retry forever.
5. **Connect-activation transition detection** — `connect-webhook.ts:44-56` uses `event.data.previous_attributes` to distinguish "just got activated" from "still active," and fires `resolvePendingPayouts` on the `!wasActive && isNowActive` edge only. Clean transition logic.
6. **`waitUntil` for payout resolution** — `connect-webhook.ts:81-99` fires `resolvePendingPayouts` as a fire-and-forget, so the webhook ACKs quickly to Stripe. Proper async pattern.
7. **Uses `createPerRequestDbClient` + `await cleanup()`** in webhook handler — matches the `@codex/database` CLAUDE.md strict rule for WS transactions in Workers. ✅

### New findings (tick 7)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| Y1 | **P1** | Production guard | `if (c.env.ENVIRONMENT === 'production')` is specific-string-match. If `ENVIRONMENT` is empty / missing / misspelled (`'PROD'`, `'Production'`), the dev router is exposed. In Cloudflare Workers, env is string-matched with zero tolerance — production rollouts that forget to set this var will expose the dev catch-all. Prefer default-deny: `if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'staging')`. | `workers/ecom-api/src/index.ts:221` |
| Y2 | **P1** | Secret routing fragility | `getWebhookSecret` uses `path.includes('/payment')`, `.includes('/connect')`, etc. (`verify-signature.ts:18-40`). Today this works because we have exactly one path per substring. If someone adds a route like `/api/internal/payment-method/debug` or `/webhooks/stripe/payment-intent`, the substring match becomes ambiguous and possibly wrong-secret → 401 loop. Replace with exact-path lookup table: `const SECRETS: Record<string, string> = { '/webhooks/stripe/payment': env.STRIPE_WEBHOOK_SECRET_PAYMENT, ... }`. | `verify-signature.ts:18-40` |
| Y3 | **P1** | Connect deactivation unnoticed | `account.updated` with `wasActive=true && isNowActive=false` transition is NOT specially handled — falls through `handleAccountUpdated` which just syncs flags. No obs.warn, no admin email, no proactive notification to the creator. Creators discover the broken state only when the next payout fails (via `pendingPayouts` row). Consider: add `wasActive && !isNowActive` branch that (a) logs at `error` severity, (b) dispatches a "your Connect is no longer receiving payouts" email to the account owner. | `connect-webhook.ts:40-103` |
| Y4 | **P1** | Optional-secret misconfiguration | `STRIPE_WEBHOOK_SECRET_CUSTOMER` and `STRIPE_WEBHOOK_SECRET_DISPUTE` are marked optional in CLAUDE.md but the worker registers `/webhooks/stripe/customer` and `/webhooks/stripe/dispute` endpoints. If Stripe Dashboard is configured with those endpoints but the secrets aren't set, `getWebhookSecret` returns undefined → `verify-signature.ts:74` returns 500 → Stripe retries → 500 loop. Either make the secrets required when the endpoints exist, or 404 those endpoints when the secret is unset. | `verify-signature.ts:28-33` + CLAUDE.md envs list |
| Y5 | **P1** | `.includes('/dev')` too broad | `verify-signature.ts:34-37` — path matches `/webhooks/stripe/dev`, but also any path containing the substring `/dev` (e.g. `/api/developer/foo`). Combined with Y1 (dev router production guard), if another route path happens to contain `/dev`, it may accidentally pick up the booking secret. Fragile. | `verify-signature.ts:34-38` |
| Y6 | **P2** | Double DB client | Connect webhook opens **two** `createPerRequestDbClient` connections: one for `ConnectAccountService`, another for `SubscriptionService` in the activation branch. Each holds a WS handle until `cleanup()`. Cold-start + connection open = measurable latency on a small fraction of webhooks. Unify by passing the first client to both services, or centralise DB client creation in `createWebhookHandler`. | `connect-webhook.ts:28-32, 70-76` |
| Y7 | **P2** | Missing metadata guard | Activation branch relies on `account.metadata?.codex_organization_id`. If metadata is absent (e.g., account restored from a backup, or created outside our platform then linked), `resolvePendingPayouts` is skipped silently. A Connect account can exist in Stripe without our metadata; we won't resolve their backlog. Track as operational concern. | `connect-webhook.ts:68-70` |
| Y8 | **P2** | Missing proactive emails | Stripe-SDK-supported events we're not acting on: `radar.early_fraud_warning.*` (stub), `payment_method.detached` (not registered), `customer.source.expiring` / `payment_method.automatically_updated` (not registered). These are low-effort wins for reducing churn (email-before-card-expires) and chargeback rates (action on fraud warning before dispute). | CLAUDE.md webhook table — stub & unregistered columns |
| Y9 | **P2** | No replay-nonce store | Stripe's 300s tolerance + our `stripeSubscriptionId` / `stripePaymentIntentId` unique constraints prevent duplicate side effects, but replays within 300s still log twice in stub handlers (`/customer`, `/dispute`), and pre-constraint failures produce duplicate `obs.error` entries. Acceptable today; worth adding KV-based nonce store when stub handlers start doing real work. | April 12 recommendation 4 — still open |
| Y10 | **P2** | Stripe-client per request | `createStripeClient(c.env.STRIPE_SECRET_KEY)` at `verify-signature.ts:83` runs on every webhook request. Stripe SDK is lightweight but does allocate. For Workers that get bursts (first-of-month renewal waves), caching the Stripe client in module scope when `STRIPE_SECRET_KEY` is stable is ~free. | `verify-signature.ts:83` |
| Y11 | **P2** | 500-on-missing-secret | `verify-signature.ts:71-75` returns 500 when the webhook secret is not configured. Stripe treats 5xx as transient → retries forever. This could produce a flood of log lines during any environment misconfiguration. Prefer 501 (Not Implemented) or 410 (Gone) so Stripe stops retrying on this class of error. | `verify-signature.ts:74` |
| Y12 | **P2** | Deauthorize no-op for payouts | `account.application.deauthorized` calls `handleAccountDeauthorized(accountId)` but we don't review outstanding subscriptions attached to this org's Connect. If an org deauthorizes while they have active subscribers, the next renewal transfer will fail and fall to `pendingPayouts`. Probably acceptable but deserves documented ops runbook ("org deauthorized → X open subscriptions → what now?"). | `connect-webhook.ts:105-121` |
| Y13 | **P3** | Log message drift | Signature-success log `obs.info('Webhook signature verified', ...)` includes `path` but doesn't redact — fine for a path string but establishes a pattern. If someone later adds query params or body excerpts to this log, the careful redaction discipline from `@codex/observability` needs to be extended. | `verify-signature.ts:95-99` |

### Cross-referencing to earlier findings

| Earlier | Tick 7 update |
|---|---|
| **F7** (per-user-per-org Stripe Customer) | Y7's metadata dependency is another manifestation: if Stripe Customer / Connect account wasn't created via our metadata flow, reconciliation paths silently skip. |
| **V4** (Stripe-Dashboard tier change undetected) + **X6** (Dashboard price change undetected) | Y8 is the same pattern at the Customer/PaymentMethod layer: Stripe events we *could* act on, ignored. |
| **W1** (revocation atomicity) | Y3 (Connect deactivation not surfaced) is the dual — an *asset* state change we don't proactively alert on; W1 is an *access* state change we don't atomically write. Both deserve structured alerts. |
| **T10 + X8** (Connect account arbitrary selection) | Y3 adds weight: if deactivation is unhandled AND the arbitrary-selection query picks the deactivated account, every operation against that org silently degrades. **S42 (`organizations.primary_connect_account_user_id`)** gets more valuable. |

### Design suggestions (tick 7)

| # | Suggestion | Why |
|---|---|---|
| S47 | Production-guard the dev router with default-deny: `if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'staging') return 404`. Same default-deny pattern anywhere else we gate by environment. | Fixes Y1. |
| S48 | Replace `getWebhookSecret` path substring matching with an explicit `Record<string, keyof Env>` lookup: `{ '/webhooks/stripe/payment': 'STRIPE_WEBHOOK_SECRET_PAYMENT', … }`. Unit-test that every registered webhook route has a lookup entry. | Fixes Y2 + Y5. |
| S49 | In `connect-webhook.ts`, add an "account deactivated" branch: when `wasActive && !isNowActive`, fire `obs.error('Connect account deactivated', { accountId, orgId })` and dispatch a notification email to the account owner via `sendEmailToWorker`. | Fixes Y3. Pairs with Y8 to round out Connect ops. |
| S50 | Make `STRIPE_WEBHOOK_SECRET_CUSTOMER` / `_DISPUTE` either fully required (validate at startup) OR 404 their endpoint when unset. Today they're a 5xx retry trap. | Fixes Y4 + Y11. |
| S51 | Register handlers (at minimum, logging + email dispatch) for: `payment_method.detached`, `customer.source.expiring`, `payment_method.automatically_updated`, `radar.early_fraud_warning.*`. Don't need complex logic initially — just proactive emails. | Fixes Y8 and creates a low-effort churn-reduction win. |
| S52 | Hoist `createStripeClient` to module scope, memoised by `STRIPE_SECRET_KEY`. Cloudflare Workers do reuse the global scope across requests on a warm isolate; this memoisation is effectively free. | Fixes Y10. |
| S53 | Unify DB client creation in `createWebhookHandler`: pass `{ db, cleanup }` to the handler function. Individual handlers then accept `db` as a param and don't open their own. | Fixes Y6. |
| S54 | If/when we get enough traffic for replay concerns: write a simple `WebhookNonceStore` KV helper, keyed by `event.id`, TTL 600s, write-before-process check. | Fixes Y9 on demand. |

### Updated running ledger

| Bucket | Count | Movers |
|---|---|---|
| P0 | **2** | F2 migration still the blocker |
| P1 | **41** (+Y1-Y5) | Y1 production guard + Y2 signature routing + Y3 Connect deactivation |
| P2 | **44** (+Y6-Y12) | Y4/Y11 5xx-retry-loop on missing optional secret |
| P3 | **9** (+Y13) | Log redaction discipline |

### Tick 8 target — synthesis mode

The report now carries **96 findings + 54 design suggestions** across 7 ticks. Tick 8 will **stop adding new findings** and instead:

1. **Deduplicate**: some findings repeat from different angles (e.g. Connect ambiguity surfaces in T10, X8, Y3). Produce a "Clustered Issues" list that collapses them.
2. **Prioritise for the user**: produce a recommended **first 10 PRs** list — which findings, if landed, would shrink the risk surface the most? Use blast-radius × effort as the scoring.
3. **Convert high-confidence findings into beads**: for the top 5-10, draft `bd create` commands the user can run verbatim.
4. **Flag open questions that need the user's call**: product decisions vs engineering decisions (e.g. "is Stripe Dashboard editing allowed in practice?" — X6/V4; "should subscribers see follower-only content?" — W6; "auto-unfollow on cancel?" — F13/S22).
5. **Summary one-page dashboard**: single table with Severity × Area heatmap for a quick executive read.

---

## Iteration 2 · Tick 8 — 2026-04-24 (SYNTHESIS)

> This tick adds **no new findings**. It clusters the 96 findings from ticks 1-7 into root-cause groups, proposes an ordered backlog, drafts beads, and surfaces the product questions the review cannot answer alone.

### C1. Clustered issues (root-cause view)

The 96 findings collapse to **12 root issues**. Fixing a root issue typically retires several findings.

| Cluster | Root issue | Severity | Findings retired | Effort |
|---|---|---|---|---|
| **C1.1** | **Migration ownership drift** — `cancel_at_period_end` exists in schema + snapshots but not in any `.sql` file; April 12 migration filenames don't match disk; duplicate `0051_*.sql` | **P0** | F1, F2 | S (1 repair migration + reconciliation) |
| **C1.2** | **Webhook handler atomicity** — no transaction around subscription+membership+follower+revocation writes in `handleSubscriptionCreated/Deleted/Paused/Resumed`; revocation is "route-owned" and out of band | **P1** | F3, F4, W1, Y3 | M (refactor to transaction + post-commit KV write) |
| **C1.3** | **Status-mapping inconsistency (single-source-of-truth gap)** — Stripe-status-to-internal-status handled differently across `Created / Updated / Resumed / Paused`; collection stores a narrower enum; frontend context has no filter; renewal flips to ACTIVE without guarding against `cancelling` | V1, V2, V4, V5, V7, V8, V11, V12, U1, U2, U8, T6 | L (S23 mapper + frontend filter + enum unification) |
| **C1.4** | **Stripe-Dashboard edits silently desync** — tier metadata tier-changes detected only via our metadata; price edits in Dashboard don't propagate to `subscriptionTiers.priceMonthly`; customer email updates not watched | **P1** | V4, X6, Y8 (partial) | S (S25 + S41 webhook listeners) |
| **C1.5** | **Revenue/accounting history loss** — `subscriptions.*FeeCents` overwritten on renewal; tier-change doesn't recompute split; no `subscription_invoices` ledger; no tier-price history; inter-creator rounding dust | T1, T4, V3, X9 | L (S8 + S10 + S24 + S44 — finance-grade data model) |
| **C1.6** | **Connect account ambiguity** — "which Connect account is the org's?" is answered by arbitrary `.limit(1)`; reactivation handled but deactivation unnoticed; KYC is per-user-per-org not per-user | F12, T10, X8, Y3, F7 (partial) | M (S42 schema column + Y3 de-activation handler + operator decision on cross-org Customer) |
| **C1.7** | **Frontend lifecycle-state regressions + gaps** — Phase 2.5/2.6 reverted (U3, U4); no `paused` branch anywhere; "Change tier" bypass; silent `handleUpdatePayment`; pricing page silently errors to "no subscription" | U2, U3, U4, U5, U6, U7, V9, V14 | M (restore loadError + per-card state + add paused/past_due branches + S19 change-tier flow) |
| **C1.8** | **Tier lifecycle holes** — dead FK action on content → soft-deleted tier; reorder accepts partial input (duplicate sortOrders); deleteTier Stripe archive out of band; cancelled-subscriber filter blocks on wrong states | X1, X2, X3, X4, X5, X10 | M (S39 content sweep + S40 full-list assertion + S43 archive recovery) |
| **C1.9** | **Role/taxonomy drift** — `organizationMemberships.role='subscriber'` persists after cancel; `'member'` vs `'subscribers'` vs `'subscriber'` triple-naming; membership lives in `content.ts` not `organizations.ts` | F5, F10, F11, W8 | M (S2 role taxonomy collapse — coordinates with 2026-04-02 Membership Redesign epic) |
| **C1.10** | **Access-layer edge gaps** — revocation reason enum missing `subscription_paused`; `CACHE_KV` binding silently optional; revocation TTL constant decoupled from max presigned TTL; personal-content not revocable | W2, W3, W4, W7 | S (enum expansion + startup assertion + constant coupling) |
| **C1.11** | **Silent error swallowing (Phase 2.6 class)** — `.catch(() => null/[])` in pricing + account + content-detail server loads; empty `handleUpdatePayment` catch; `changeTier` DB failure relying on webhook reconcile | U3, U5, V9, V10, V14 | S (S16 + S29 consistent loadError discriminator pattern) |
| **C1.12** | **Dev/ops safety gates** — production dev-router guard is specific-match not default-deny; webhook secret routing by path substring; missing secret → 5xx retry trap; Stripe client created per-request; `dbWs` cast without runtime check | Y1, Y2, Y4, Y5, Y10, Y11, X7 | S (S47 + S48 + S50 + S52 — all small diffs) |

### C2. First 10 PRs (prioritised backlog)

Scoring: **Priority = (Blast × Confidence) ÷ Effort**. Blast = findings retired. Confidence = how sure we are the fix is correct. Effort = S(1) / M(3) / L(8).

| # | PR | Cluster | Blast | Conf | Effort | Score | Key benefit |
|---|---|---|---|---|---|---|---|
| 1 | **Repair migration + reconciliation** (add `cancel_at_period_end` ADD COLUMN IF NOT EXISTS; dedupe 0051) | C1.1 | 2 | 1.0 | S(1) | **2.0** | Unblocks fresh-DB provisioning |
| 2 | **`organizations.primary_connect_account_user_id`** column + backfill + switch all `.limit(1)` lookups | C1.6 | 4 | 0.9 | M(3) | **1.2** | Removes an entire class of ambiguity-bug |
| 3 | **`mapStripeSubscriptionStatus` shared helper** used by all 5 webhook handlers | C1.3 | 4 (V1/V2/V5/V11) | 0.9 | M(3) | **1.2** | Prevents future drift; fixes `cancelAtPeriodEnd` non-write |
| 4 | **Webhook transaction envelope** (`createPerRequestDbClient` + `db.transaction`) covering sub+membership+follower writes; KV revocation post-commit | C1.2 | 4 | 0.9 | M(3) | **1.2** | Fixes the atomicity class across all webhook lifecycle events |
| 5 | **Frontend subscription status enum + filter** — expand `SubscriptionItem.status` to the full backend enum; filter `hasSubscription = status ∈ (active, cancelling)` in `loadSubscriptionContext` + `subscription-context.svelte.ts`; add `paused` / `past_due` UI branches on account page | C1.3 + C1.7 | 6 | 0.95 | M(3) | **1.9** | Closes the backend-frontend access-gate divergence + the paused-user dead-end |
| 6 | **`subscription_invoices` ledger table** + write per `invoice.payment_succeeded`; `changeTier` recomputes current-state split | C1.5 | 3 | 0.8 | L(8) | **0.3** | Finance-grade history; fixes reporting bug windows |
| 7 | **Stripe-Dashboard edit detector** — `product.updated` / `price.updated` webhooks → obs.error + optionally auto-sync back to `subscriptionTiers`. Doc policy explicitly. | C1.4 | 3 | 0.8 | S(1) | **2.4** | Operational safety net, cheap |
| 8 | **Restore Phase 2.6 + Phase 2.5** — tagged `{loadError: true}` pattern in `account/subscriptions/+page.server.ts` AND `pricing/+page.server.ts`; per-card `Set`/`Map` reactivate state | C1.7 + C1.11 | 3 | 1.0 | S(1) | **3.0** | Restores functionality the April 12 audit claimed was already done |
| 9 | **Tier deletion cleanup + reorder full-list assertion** — `deleteTier` clears `content.minimum_tier_id` in same tx; `reorderTiers` asserts array covers all tiers; cap at 50 | C1.8 | 3 | 0.95 | S(1) | **2.85** | Prevents content-unreachable-after-tier-delete class |
| 10 | **Dev/ops safety fixes** — default-deny dev router; exact-path webhook-secret table; 501 on missing secret; Stripe client module-scope memoize | C1.12 | 5 | 1.0 | S(1) | **5.0** | Highest score — all small, all correct, all remove footguns |

### C3. Recommended execution order

Different from priority score — ordering also considers dependency and review-load balance:

1. **#1** (migration repair) — unblocks everything else; should land ASAP.
2. **#10** (dev/ops safety) — small footprint, high value, doesn't touch the subscription lifecycle.
3. **#8** (Phase 2.5/2.6 restore) — undoes known regressions, mostly test+UI changes.
4. **#9** (tier deletion cleanup) — small, localised, high-clarity fix.
5. **#7** (Stripe Dashboard detector) — small, adds an operational safety net.
6. **#3** (`mapStripeSubscriptionStatus`) — refactor-first, enables #5.
7. **#5** (frontend status enum + filter) — depends on #3 being landed.
8. **#2** (canonical Connect account column) — schema change, needs a migration + data backfill + all-uses audit; land after smaller PRs.
9. **#4** (webhook transaction envelope) — the biggest lifecycle refactor; land after frontend parity (#5) so the invariants are easier to verify.
10. **#6** (`subscription_invoices` ledger) — the largest single piece of work; can be deferred to an epic, not a PR.

### C4. Draft `bd create` commands

Run these verbatim to stand up beads for the top 5 PRs. Titles deliberately terse; descriptions are not part of `bd create` args and should be added interactively or via `bd update --description`.

```bash
bd create --title="Repair cancel_at_period_end migration + dedupe 0051" --type=bug --priority=0
bd create --title="Dev/ops safety: default-deny production guard + exact-path webhook secret table" --type=bug --priority=1
bd create --title="Restore subscription Phase 2.6 loadError + Phase 2.5 per-card state" --type=bug --priority=1
bd create --title="deleteTier: clear content.minimum_tier_id + reorder full-list assertion" --type=bug --priority=1
bd create --title="Stripe Dashboard edit detector (product.updated, price.updated)" --type=feature --priority=2
bd create --title="mapStripeSubscriptionStatus shared helper for all webhook handlers" --type=task --priority=1
bd create --title="Frontend subscription status: full enum + access-gate parity with backend" --type=bug --priority=1
bd create --title="organizations.primary_connect_account_user_id canonical column" --type=feature --priority=2
bd create --title="Webhook handler transaction envelope for subscription lifecycle" --type=bug --priority=1
bd create --title="Epic: subscription_invoices ledger + tier_prices history + finance-grade accounting" --type=epic --priority=2
```

### C5. Open questions for the user (product decisions we can't make alone)

These are choices the audit surfaces but cannot resolve without product input:

| # | Question | Pointer | Why it matters |
|---|---|---|---|
| Q1 | Is **Stripe Dashboard editing** of products/prices/subscriptions considered in-bounds for Codex operators? | V4, X6 | If yes, we must implement `product.updated` / `price.updated` sync; if no, we should document prominently and optionally alert on detection. |
| Q2 | When a user **cancels a subscription**, should they also be auto-unfollowed? | F13, S22 | Current behaviour: follower persists. Some users will be surprised; some will appreciate that they keep getting free updates. |
| Q3 | When a **content gate is "followers-only"**, should paying subscribers also see it? | W6 | Current: no. CLAUDE.md says this is intentional ("free follow unlocks it"). Worth confirming this is still the desired UX. |
| Q4 | Should Stripe Customers be **unified per user** (one Customer reused across orgs) or **split per user-per-org** (current behaviour)? | F7, F12, Y7, S4 | Unified: one portal, saved payment methods cross-org, better UX. Split: cleaner per-org accounting, current architecture. |
| Q5 | For a **paused subscription**, should the account UI show "Resume" (assumes user can re-start), "Contact support" (assumes pause is admin-driven), or both? | U2, status.ts | Depends on when paused state can arise — user-facing pause vs admin-applied pause. |
| Q6 | For **`past_due` subscribers**, is current behaviour (backend denies access, frontend shows "unlocked" until they click play) acceptable, or should the UI surface the payment-retry state explicitly? | V7, V8 | Depends on how forgiving the brand wants to be during dunning. |
| Q7 | Do we want to offer a **structured cancel-reason taxonomy** (radio pick list) for churn analytics, vs the current free-text? | U11, S20 | Low engineering cost, high analytical value, but adds UX friction. |
| Q8 | For **tier deletion with cancelled subscribers** still referencing the tier, should queries that JOIN subscription→tier be expected to work (filter vs not filter by `deletedAt`)? Today this is inconsistent between `getTierOrThrow` (filters) and access check (doesn't). | X10 | Deciding this locks down whether soft-deleted tiers behave like "archived" or "truly gone." |

### C6. Severity × Area heatmap (executive read)

Cell count = findings in that bucket. Colour intensity = severity.

| Area ↓ / Severity → | **P0** | **P1** | **P2** | **P3** | **Total** |
|---|---|---|---|---|---|
| Migrations | **1** | **1** | — | — | 2 |
| Webhook handlers | — | **9** | **6** | **1** | 16 |
| Tier lifecycle | — | **6** | **6** | **1** | 13 |
| Frontend UX | — | **7** | **6** | **1** | 14 |
| Access layer | — | **2** | **8** | **2** | 12 |
| Stripe integration | — | **7** | **6** | **2** | 15 |
| Schema / FKs | — | **3** | **3** | — | 6 |
| Ops / Dev safety | — | **5** | **7** | **1** | 13 |
| Role / Identity | — | **2** | **3** | **1** | 6 |
| **Total** | **2** | **41** | **44** | **9** | **96** |

**Read of the heatmap**: two-thirds of P1 findings cluster in three areas — **webhook handlers, Stripe integration, and frontend UX**. Those three areas share a common theme: state synchronisation between Stripe and Codex. An epic that explicitly invests in "Stripe ↔ Codex state discipline" (the webhook transaction envelope + the shared status mapper + the `subscription_invoices` ledger + the Dashboard-detect webhooks) would attack the densest part of the heatmap.

### C7. Tick 8 close-out

What this report is **not**:
- A claim that the April 12 audit was wrong — the April 12 audit clearly caught real P0s (Stripe orphans, paywall bypass) and added test coverage. It has drifted because the codebase has moved since.
- An attempt to enumerate every remaining bug — the loop covered 7 focused passes; there are more subsystems to audit (notifications, admin, checkout verify, refund flow, Connect webhook secondary events).
- A substitute for running the test suite — many findings should be reinforced with targeted tests (see S31 state-matrix, S46 tier-delete matrix).

What this report **is**:
- A living map of the subscription system, with per-tick deep-dives preserved for history.
- An ordered backlog the user can act on today.
- A set of open questions the user can answer once and have the audit re-converge.

### Tick 9+ target

**If the user wants the loop to continue**, the next productive ticks would be:
- **Tick 9**: Notifications integration (how do we email subscribers reliably around lifecycle events?). The current audit touches email at several points (F3-F4 composition, T7 Stripe email source, Y8 missing proactive emails) but hasn't deep-dived.
- **Tick 10**: Refund / dispute flow (Codex-98yb open bead from April 12, plus `charge.dispute.*` stub handlers from Y9).
- **Tick 11**: Admin-side subscription operations (override grants, analytics accuracy, revenue reporting — ties to T1/V3 ledger questions).
- **Tick 12**: E2E state-matrix test harness (S31) — actually build the regression fence rather than just proposing it.

Otherwise, this is a natural stopping point for iteration 2.

---

## Iteration 2 · Tick 9 — 2026-04-24 (notifications integration)

### Positive findings to preserve

1. **Clean webhook → service → email separation** — the webhook handler doesn't compose email payloads. Service methods return `WebhookHandlerResult.email` (a shaped payload), handler fires `dispatchEmail(result)`. Good SRP.
2. **Fire-and-forget semantics** — `sendEmailToWorker` wraps the `workerFetch` in `executionCtx.waitUntil` so email never blocks the webhook 200 back to Stripe. Correct model for transactional mail.
3. **Defensive waitUntil guards** — `revokeAccess` / `clearAccess` in `subscription-webhook.ts` guard against *both* the promise throwing (`.catch` on the awaited promise) AND waitUntil itself throwing synchronously (outer try/catch). Thorough.
4. **HMAC-SHA256 worker-to-worker auth** via `workerFetch(url, options, WORKER_SHARED_SECRET)` — prevents any other worker or malicious request from triggering email sends directly.
5. **Template categorisation at dispatch time** — every `sendEmailToWorker` call specifies `category: 'transactional' | 'marketing' | 'digest'`, giving the notifications-api layer a hook for preference enforcement.

### New findings (tick 9)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| Z1 | **P1** | Silent email loss | `sendEmailToWorker`'s `.catch(() => {})` (L41-46) silently swallows any transport-layer failure. The comment claims "notifications-api audit log captures failures on its side" — but if `workerFetch` itself throws (HMAC secret rotation mid-flight, notifications-api down, network partition), the request never reaches notifications-api and neither side has an audit entry. The calling worker has no signal that the email was lost. | `packages/worker-utils/src/email/send-email.ts:40-47` |
| Z2 | **P1** | Preference enforcement unclear | `dispatchEmail` in `subscription-webhook.ts:153-160` forwards any `result.email` to notifications-api without checking `notification_preferences.emailTransactional/emailMarketing/emailDigest`. If notifications-api's `/internal/send` doesn't enforce these, users who opted out still get emails — GDPR-adjacent concern. The notifications-api CLAUDE.md hasn't been reviewed yet — this is the open question for this tick. | `workers/ecom-api/src/handlers/subscription-webhook.ts:153-160` |
| Z3 | **P1** | WEB_APP_URL empty fallback | `const webAppUrl = c.env.WEB_APP_URL \|\| '';` at `subscription-webhook.ts:168`. Emails containing `${webAppUrl}/account/subscriptions` become raw relative paths — broken click-through. Should fail fast if `WEB_APP_URL` is unset in a production deploy, not silently emit broken links. | `subscription-webhook.ts:168` |
| Z4 | **P1** | Templates outside source control | `packages/notifications/src/templates/` contains only `__tests__/`, `index.ts`, `renderer.ts` — no subscription-event template files. Templates live in DB (`TemplateService`), seeded via migrations/admin UI. Problems: (a) no code review for template content; (b) no git history / blame for template changes; (c) prod/dev/staging can drift; (d) an admin typo in `{{userName}}` interpolation silently breaks the next batch of cancellation emails. | `packages/notifications/src/templates/` + `template-service.ts` |
| Z5 | **P1** | Missing lifecycle templates | Subscription lifecycle events without confirmed email coverage: `subscription-paused`, `subscription-resumed`, `subscription-tier-changed` (upgrade/downgrade), `subscription-will-renew` (N-day reminder), `payment-method-expiring`, `payment-method-removed`. Backend handlers exist for some; email payloads are not built for them. | `subscription-service.ts` — `buildSubscription*Email` only covers `Created / Cancelled / Renewed / PaymentFailed` |
| Z6 | **P2** | Revoke/clear duplication | `revokeAccess` (L59-93) and `clearAccess` (L116-147) in `subscription-webhook.ts` are structurally identical modulo `revoke(userId, orgId, reason)` vs `clear(userId, orgId)`. Merge into `applyAccessChange(c, result, action: 'revoke' \| 'clear', reason?)` to eliminate 30+ lines of near-duplicate defensive guards. | `subscription-webhook.ts:59-147` |
| Z7 | **P2** | Email source drift | Stripe-sourced email addresses used in some handlers (`stripeInvoice.customer_email` in `handleInvoicePaymentSucceeded:683-707`), DB-sourced in others (`users.email` in `buildSubscriptionCreatedEmail:521-525`). If a user changes email in our app after subscribing, the two sources disagree until the next Stripe Customer update. Renewal receipt goes to the stale Stripe address. | `subscription-service.ts:683, 521` (already flagged as T7 but worth consolidating) |
| Z8 | **P2** | Category taxonomy ambiguity | Three categories: `transactional / marketing / digest`. "Subscription renewing in 3 days" — transactional (because billing-related) or marketing (because recurring)? Email deliverability best-practice treats reminders as marketing. Document the taxonomy in `@codex/notifications/CLAUDE.md` to prevent future drift. | Category usage sites across ecom-api handlers |
| Z9 | **P2** | No email-send metric | `sendEmailToWorker` fires-and-forgets with no counter increment (`obs.info('email.sent', ...)` or equivalent). Ops can't dashboard "emails sent per hour" without scraping logs. For a money-handling flow, counting sends (+ successes + failures) matters. | `send-email.ts:32-48` |
| Z10 | **P2** | No cache for branding | `branding-cache.ts` exists (65 lines) to cache org branding for email rendering. Each email render needs the org's logo + colours. If this cache is per-request rather than KV-backed, emails sent in quick succession for the same org re-fetch the same branding. Low-volume concern today; worth confirming. | `packages/notifications/src/services/branding-cache.ts` |
| Z11 | **P2** | Template render failure path | If `TemplateService.render` throws (e.g. missing variable, malformed Handlebars syntax, templates DB has drifted), what happens? Notifications-api presumably logs it. But the calling worker has already `waitUntil`-fired — `sendEmailToWorker` won't know. A broken template means **every** `subscription-cancelled` email silently fails until someone notices churned users don't get their confirmation. Needs a "render failure rate" alert. | `template-service.ts` + notifications-api `/internal/send` |
| Z12 | **P3** | Ordering and emails | A webhook that fires cache invalidation AND email in the same `waitUntil` can run in any order. Normally fine; but if email build queries the DB (e.g. `buildSubscriptionCreatedEmail` does `db.select().from(subscriptionTiers).where(eq(id, tierId))`) before the subscription insert is committed, we could hit a race. Today the service flow is "insert → build email → dispatch" so serialised. Verify future handlers preserve this. | `subscription-service.ts:490-506` |

### Cross-referencing to earlier findings

| Earlier | Tick 9 update |
|---|---|
| **F3/F4** (webhook atomicity) | Z12 extends: if atomicity is fixed with a transaction wrapper, email-build (which reads DB) must run either inside the tx (possible lock contention) or after commit (current pattern — preserve). |
| **T7** (stale Stripe email) | Z7 generalises to a tension between "Stripe as source of truth for customer_email" vs "Codex DB". Pick one (probably DB) and apply consistently. |
| **Y8** (missing proactive emails) | Z5 extends with specific missing lifecycle templates beyond Stripe SDK events. |
| **W2** (`subscription_paused` missing from RevocationReason enum) | Z5 notes a parallel: we have a `paused` webhook handler but no `paused` email template. Both halves need a pass. |
| **C1.11** (silent error swallowing cluster) | Z1 joins this cluster — `sendEmailToWorker`'s `.catch(() => {})` is the same shape. Consider consolidating into a single "tagged failure" helper used everywhere. |

### Design suggestions (tick 9)

| # | Suggestion | Why |
|---|---|---|
| S55 | In `sendEmailToWorker`, replace `.catch(() => {})` with `.catch(err => obs.error('email.send.transport_failed', { err, to: params.to, templateName: params.templateName }))`. Pass `obs` into the helper. | Fixes Z1. Keeps fire-and-forget semantics but makes failures observable. |
| S56 | **At the notifications-api boundary**, enforce `notification_preferences`: check `emailMarketing / emailTransactional / emailDigest` before sending. For `transactional` category: override preferences only when the email is legally required (GDPR explicitly exempts account-critical notices). Document which template keys are legal-override. | Fixes Z2. Centralises enforcement — individual calling workers don't need to know. |
| S57 | Assert `WEB_APP_URL` is set at worker startup via `createEnvValidationMiddleware` `required` list (already has it for other vars; add `WEB_APP_URL` for any worker that dispatches emails). Remove the `\|\| ''` fallback. | Fixes Z3. Fail fast. |
| S58 | Move subscription-email templates to a filesystem location under source control — e.g. `packages/notifications/src/templates/subscriptions/*.hbs`. Seed the DB from those files during deploy, not via admin UI. Admin UI could still override, but the baseline is git-tracked. | Fixes Z4. |
| S59 | Add email payload builders for: `subscription-paused`, `subscription-resumed`, `subscription-tier-changed`, `subscription-will-renew-3-days`, `payment-method-expiring`, `payment-method-removed`. Wire them into the corresponding service methods and/or webhook handlers. | Fixes Z5 + Y8. |
| S60 | Merge `revokeAccess` + `clearAccess` into a single `applyAccessChange(c, result, { action: 'revoke' \| 'clear', reason? })` that handles both paths via the same guard pattern. Keep the structured-logging distinction via the `action` field. | Fixes Z6. |
| S61 | Document the email-category taxonomy in `@codex/notifications/CLAUDE.md`: which categories bypass preferences (legally required), which respect all preferences, which respect `emailMarketing` opt-out. Add a test that asserts every `sendEmailToWorker` call site uses a documented template + category combo. | Fixes Z8 + Z2's documentation half. |
| S62 | Add a `metrics.increment('email.sent', { category, templateName })` call inside `sendEmailToWorker` (or in notifications-api's `/internal/send`). If there's no metrics helper today, at least add structured `obs.info('email.dispatched', {...})` for log-based dashboarding. | Fixes Z9. |
| S63 | Template render failure alerting: notifications-api's `/internal/send` should increment a counter and `obs.error` when template render fails. Add an integration test for every template that asserts render-with-typical-data doesn't throw. | Fixes Z11. |

### Updated running ledger

| Bucket | Count | Movers |
|---|---|---|
| P0 | **2** | F2 migration still the blocker |
| P1 | **46** (+Z1-Z5) | Z2 preference enforcement (legal risk) + Z3 broken links + Z4 templates out of SCM + Z5 missing lifecycle emails |
| P2 | **50** (+Z6-Z11) | Z11 silent template-render failure is quietly high-impact |
| P3 | **10** (+Z12) | |

### Suggested next ticks (revised after tick 9)

Tick 9 surfaced a meaningful sub-system (email) with its own distinctive failure modes. Two options:

**Option A — continue the audit loop:**
- **Tick 10**: Refund / dispute flow (Codex-98yb + `charge.dispute.*`).
- **Tick 11**: Admin-side subscription operations (override grants, revenue reporting accuracy).
- **Tick 12**: Actually build the E2E state-matrix test (S31).

**Option B — stop the audit, switch to execution:**
- The synthesis in Tick 8 gave the user an ordered backlog of 10 PRs. Further audit adds length but not leverage. Tick 9's highest-value additions (Z2, Z4) would get rolled into the existing backlog. A good stopping point if the goal is to start fixing rather than keep mapping.

Recommendation: prefer Option B. The audit is converging — each new tick is finding fewer novel P1s and more "consistent application of patterns we already surfaced." The remaining areas (refund, admin, E2E) are likely to produce mostly P2/P3 findings that fit into the existing clusters. Switching to execution now would capture the synthesis while it's fresh.

---

## Iteration 2 · Tick 10 — 2026-04-24 (refund + dispute flow)

### Confirmation: April 12 Codex-98yb is CLOSED

Worth marking explicitly — the April 12 "Remaining Open Issues" table listed Codex-98yb (P1) as: "`processRefund` missing transaction atomicity + refund metadata not stored." Reviewing the current code:

- `purchase-service.ts:747-772` — `processRefund` now wraps both the purchase status update AND the `contentAccess` soft-delete in `db.transaction()`. ✅
- `purchase-service.ts:755-757` — `stripeRefundId`, `refundAmountCents`, `refundReason` are populated from `refundDetails`. ✅
- Sibling `processDispute` (L820-884) applies the same pattern to dispute events.

**Codex-98yb can be closed.** The report from April 12 was right about the gap; the fix landed cleanly.

### Positive findings (tick 10)

1. **Idempotency + cache-safe-return** — both `processRefund` and `processDispute` early-return when already processed, but still return `{userId, orgId}` so the caller can re-bump the library cache monotonically. Means retried webhooks never leave the cache stale.
2. **Transaction-wrapped access revocation** — purchase update + contentAccess soft-delete are atomic (L747-772, L851-872). The Stripe-side refund is authoritative; our DB mirror is consistent.
3. **Honest dispute-status design note** — handler comment (payment-webhook.ts:192-198) explicitly documents why we can't add `'disputed'` to the `purchase_status` CHECK constraint and use `disputedAt` instead. Design decisions with rationale in the code are gold.
4. **Library cache bump fires even on already-processed dispute** — keeps cross-device UX correct when a replay happens.
5. **Forward-wired revocation plumbing** — `handleChargeRefunded` already has the conditional `if (result.orgId) revokeAccess(...)`; the only missing piece is `processRefund` returning `orgId` (which it can, because purchases are org-scoped).

### New findings (tick 10)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| AA1 | **P1** | Missing KV revocation on refund | `processRefund` returns `{userId}` only — no `orgId` — so `handleChargeRefunded` never writes an `AccessRevocation` KV entry. In-flight presigned R2 URLs issued just before the refund are still usable for up to `REVOCATION_TTL_SECONDS` (effectively: the rest of the URL's natural TTL). Purchases are org-scoped (`purchases.organizationId NOT NULL`), so the fix is one additional field in the return. | `purchase-service.ts:785` vs `payment-webhook.ts:172-176` |
| AA2 | **P1** | `charge.dispute.closed` unhandled | No handler for `charge.dispute.closed` (dispute resolution). Implications: (a) dispute WON (we win) — user's access remains revoked forever even though they now legitimately paid; (b) dispute LOST — we rely on Stripe firing a separate `charge.refunded`, which may or may not happen depending on how the dispute was handled. Admin has to manually clean up in either case. | `workers/ecom-api/src/index.ts:189-191` (comment notes it's unhandled) |
| AA3 | **P1** | No dispute alert to admin | `handleChargeDisputeCreated` explicitly skips email: "Admin notification email is intentionally NOT sent from this handler — deferred to a follow-up task" (L231-235). Disputes have a **Stripe-enforced evidence deadline** (`dispute.evidence_due_by`). Missing that deadline costs the platform the disputed amount with no appeal. Creators/admins need to know within minutes. | `payment-webhook.ts:231-236` |
| AA4 | **P1** | No creator-payout clawback | When a purchase is refunded or disputed-lost, the platform has already transferred the creator's share (90%) via `stripe.transfers.create` during `completePurchase` / `handleInvoicePaymentSucceeded`. `processRefund` and `processDispute` don't create a `stripe.transfers.createReversal` or debit against future pending payouts. The platform silently absorbs the creator cut. For a creator abusing refunds, this is an open loss. | `purchase-service.ts:717-789, 820-884` — no transfer reversal call |
| AA5 | **P2** | Partial refunds mis-stated | `handleChargeRefunded` uses `charge.amount_refunded` and sets `status = 'refunded'` regardless of whether the refund was partial. A user refunded £2 out of £50 has `purchase.status='refunded'` + their content access revoked — but Stripe has only refunded a fraction. Should check `amount_refunded === amount` before flipping status; partial refunds need different handling (keep access? partial refund status?). | `payment-webhook.ts:153-158` + `purchase-service.ts:750-759` |
| AA6 | **P2** | Dispute → Refund ordering race | When a dispute is lost and Stripe issues a refund, two events fire: `charge.dispute.closed` (not handled) and `charge.refunded`. If `charge.refunded` fires first, the purchase becomes `REFUNDED`. If `charge.dispute.closed` were handled and fires first, it may try to write `disputedAt` to a row whose status is about to become `refunded`. The idempotency guards cover the happy path but the ordering invariant is implicit. | Stripe docs + `payment-webhook.ts:257-268` |
| AA7 | **P2** | All contentAccess revoked regardless of source | Refund/dispute WHERE clause at `purchase-service.ts:765-770` filters by `(userId, contentId)` with no `accessType` filter. If a user both PURCHASED content AND later received a COMPLIMENTARY access grant (e.g. from admin), refunding the purchase also nukes the complimentary access. Should filter `accessType = 'purchased'` to preserve parallel grants. | `purchase-service.ts:765-770, 862-870` |
| AA8 | **P2** | Optional refund reason unvalidated | `refundReason` is Stripe's `latestRefund.reason` string, stored raw. Stripe's enum: `'duplicate' \| 'fraudulent' \| 'requested_by_customer'`. If Stripe adds a new value, we store it fine — but analytics queries assuming the enum break. Not urgent. | `payment-webhook.ts:157` + `purchase-service.ts:757` |
| AA9 | **P2** | No fraud-warning action | `radar.early_fraud_warning.created` fires BEFORE a dispute. Stripe recommends either refunding proactively (preserves goodwill, avoids dispute fee) or preparing evidence. We don't register this event. Same class as Y8 proactive-email gap. | CLAUDE.md dispute webhook stub |
| AA10 | **P2** | `refundDetails` parameter optional | `processRefund(paymentIntentId, refundDetails?)` — when called without details (future ad-hoc refund path), metadata stays null. If a new code path omits details, we lose `stripeRefundId` tracking. Consider making details required and pushing the nullability to the caller. | `purchase-service.ts:717-723` |
| AA11 | **P3** | CLAUDE.md signature drift | `packages/purchase/CLAUDE.md` documents `processRefund(purchaseId, customerId, reason?)` — but the actual signature is `processRefund(paymentIntentId, refundDetails?)`. Docs describe an admin-initiated refund flow that doesn't exist here (or lives elsewhere). Either the admin flow needs building or the docs need fixing. | `packages/purchase/CLAUDE.md` vs `purchase-service.ts:717` |
| AA12 | **P3** | `chargeId` used, not `paymentIntentId` | `payment-webhook.ts:146-148` extracts `payment_intent` from `charge`. If Stripe starts returning `charge` objects without a payment_intent (e.g. legacy charges, some Connect flows), we early-return with no action. Rare but possible. | `payment-webhook.ts:146-151` |

### Cross-referencing

| Earlier | Tick 10 update |
|---|---|
| **Codex-98yb** (April 12 open bead) | ✅ Closed — confirmed in this tick. |
| **W1** (revocation route-owned + not in tx) | AA1 is the refund analogue: the DB revocation write IS in the tx, but the KV revocation is missing entirely on refund. Same class of "revocation path inconsistency." |
| **T3** (creator pool evaporates in Connect-not-ready branch) | AA4 is the *same shape at the refund boundary* — revenue can flow out of the platform in ways that aren't reversible. Add to C1.5 (accounting history) cluster. |
| **C1.5** (revenue/accounting history loss cluster) | Expand to include: refund transfer reversals, partial-refund state, payout clawback. Strengthens the case for a `subscription_invoices` / `purchase_events` ledger (S8 + S44). |
| **Y8** (missing proactive emails) | AA3 extends — dispute alerting is proactive-email gap #1 by urgency (evidence deadline ticking). |

### Design suggestions (tick 10)

| # | Suggestion | Why |
|---|---|---|
| S64 | `processRefund` returns `{userId, orgId}` — `purchases.organizationId` is NOT NULL, so this is a one-line change. `handleChargeRefunded` then writes the AccessRevocation KV entry for the refund path, closing the in-flight presigned URL window. | Fixes AA1 — one of the simplest high-value fixes in the report. |
| S65 | Register `charge.dispute.closed` → `handleChargeDisputeClosed(event)`: if `dispute.status === 'won'`, restore `contentAccess` (set `deletedAt = NULL` filtered by userId+contentId+accessType='purchased') and clear `AccessRevocation`. If `status === 'lost'`, no-op (the companion `charge.refunded` will fire). | Fixes AA2 and closes the dispute lifecycle loop. |
| S66 | `dispute-opened` email to creator/admin — template with `{disputeAmount, evidenceDueBy, disputeReason, contentTitle, purchaseDate}` and a deep-link to the Stripe evidence form. Dispatched from `handleChargeDisputeCreated` via `sendEmailToWorker`. | Fixes AA3 — highest business-impact item in this tick. |
| S67 | In `processRefund` / `processDispute`, include a **transfer reversal step**: if `purchase.creatorPayoutCents > 0` and we have a `stripeTransferId` record for that payout, call `stripe.transfers.createReversal`. If the creator's balance is insufficient, fall back to debiting their next `pendingPayouts` entry (or creating a negative-balance `pendingPayouts` row). | Fixes AA4. Requires S44 (per-event tier price audit) style ledger to know which transfer to reverse. |
| S68 | Handle partial refunds: if `amount_refunded < amount`, update status to a new `'partially_refunded'` (requires migration to expand the CHECK constraint) AND keep access intact. Alternatively, keep simple `'refunded'` status + revoke-all — but document the policy in CLAUDE.md. | Fixes AA5. Needs product decision (does partial refund revoke access?). |
| S69 | `accessType = 'purchased'` filter in the refund/dispute revocation query. Preserves complimentary/membership/subscription access grants when a concurrent purchase is refunded. | Fixes AA7. |
| S70 | Register `radar.early_fraud_warning.created` → proactive refund OR admin-alert email. Per Stripe's own recommendation, this reduces dispute rate ≈30%. | Fixes AA9. |
| S71 | Fix `packages/purchase/CLAUDE.md` `processRefund` signature + describe the webhook-driven refund flow accurately. Add the admin-initiated refund flow as a separate documented method (or mark TBD). | Fixes AA11. |

### Convergence signal (tick 10)

Tick 10 produced **12 findings, 8 suggestions** — similar volume to tick 9. But the proportion landing in existing clusters (C1.2 atomicity, C1.5 accounting, C1.11 silent swallow, Y8 proactive emails) is higher. Novel concepts: **AA2 unhandled dispute.closed**, **AA4 payout clawback**. Both fit into the "Stripe ↔ Codex state discipline" epic mentioned in Tick 8.

### Updated ledger

| Bucket | Count | Movers |
|---|---|---|
| P0 | **2** | Still F2 migration |
| P1 | **50** (+AA1-AA4) | AA3 dispute alert (business deadline) + AA4 payout clawback (finance correctness) |
| P2 | **58** (+AA5-AA10) | Partial-refund semantics (AA5) + clawback patterns |
| P3 | **12** (+AA11-AA12) | Doc drift |

### Loop state (post-tick-10)

The audit has now covered: schema + webhook lifecycle (T1-T15), frontend UX (U1-U13), subscription updates (V1-V15), access layer (W1-W12), tier service (X1-X13), HMAC + Connect (Y1-Y13), notifications (Z1-Z12), and refund/dispute (AA1-AA12). **116 findings, 71 design suggestions, 12 root clusters (C1.1-C1.12)**.

Remaining untouched areas from the Tick 8 queue:
- **Admin-side ops** (override grants, revenue reporting) — C1.5 is already the worst offender; admin ops would extend that cluster.
- **E2E state-matrix harness (S31)** — actually building rather than proposing.

Both are valuable but neither is blocking the existing backlog. Iteration 2 can reasonably close here with the synthesis in Tick 8 as the operating document.

