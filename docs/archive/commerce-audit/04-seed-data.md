# Seed Data & Schema Audit

## Overview

This audit covers the complete commerce/subscription seed pipeline and underlying schema, including all seed files, schema definitions, and migrations touching commerce tables. Every seed INSERT has been cross-referenced against the actual schema columns and CHECK constraints.

**Files audited:**
| File | Purpose |
|---|---|
| `packages/database/scripts/seed-data.ts` | Main seed entry point, TABLES_TO_TRUNCATE |
| `packages/database/scripts/seed/commerce.ts` | Purchases, tiers, subscriptions, connect accounts |
| `packages/database/scripts/seed/content.ts` | Content items (references visibility) |
| `packages/database/scripts/seed/organizations.ts` | Orgs, memberships, settings |
| `packages/database/scripts/seed/users.ts` | Users, accounts, sessions |
| `packages/database/scripts/seed/constants.ts` | All seed data constants and IDs |
| `packages/database/scripts/seed/playback.ts` | Video playback progress |
| `packages/database/scripts/seed/media.ts` | Media items |
| `packages/database/scripts/seed/r2.ts` | R2 file seeding |
| `packages/database/scripts/reset-data.ts` | Data reset script (parallel TABLES_TO_TRUNCATE) |
| `packages/database/src/schema/ecommerce.ts` | purchases, content_access, platform_fee_config, agreements |
| `packages/database/src/schema/subscriptions.ts` | subscription_tiers, subscriptions, stripe_connect_accounts, pending_payouts |
| `packages/database/src/schema/content.ts` | content (accessType, minimumTierId) |
| `packages/database/src/schema/settings.ts` | feature_settings (enableSubscriptions) |
| `packages/database/src/schema/users.ts` | users table |
| `packages/database/src/schema/auth.ts` | accounts, sessions |
| Migrations 0005, 0006, 0007, 0012, 0013, 0033, 0035, 0040, 0041, 0042, 0043 | Commerce-related schema changes |

---

## Seed Inventory

### Users (10 total)
| Key | Name | Email | Role | Org Memberships |
|---|---|---|---|---|
| creator | Alex Creator | creator@test.com | creator | Alpha (owner), Beta (creator) |
| viewer | Sam Viewer | viewer@test.com | customer | Alpha (member), Beta (subscriber) |
| admin | Jordan Admin | admin@test.com | admin | Beta (owner), Alpha (admin) |
| fresh | Fresh User | fresh@test.com | customer | None |
| newCreator | Riley NewCreator | newcreator@test.com | creator | None |
| customer1 | Maria Santos | maria@test.com | customer | None |
| customer2 | James Chen | james@test.com | customer | None |
| customer3 | Priya Patel | priya@test.com | customer | None |
| customer4 | Lucas Walker | lucas@test.com | customer | None |
| customer5 | Emma Wilson | emma@test.com | customer | None |

### Organizations (2 total)
| Key | Name | Slug | Owner |
|---|---|---|---|
| alpha | Studio Alpha | studio-alpha | creator@test.com |
| beta | Studio Beta | studio-beta | admin@test.com |

### Content (11 total)
| Key | Title | Org | accessType | priceCents | minimumTierId | status |
|---|---|---|---|---|---|---|
| introTs | Intro to TypeScript | alpha | free | null | null | published |
| advancedSvelte | Advanced Svelte Patterns | alpha | subscribers | 1999 | alphaPro | published |
| honoApis | Building APIs with Hono | beta | paid | 2999 | null | published |
| podcast | Tech Podcast Ep 1 | alpha | free | null | null | published |
| draft | Draft Video Lesson | alpha | free | null | null | draft |
| membersOnly | Members Only Workshop | alpha | members | null | null | published |
| privateNotes | Private Notes | alpha | free | null | null | draft |
| writtenTutorial | Written Tutorial | beta | free | null | null | published |
| archivedCourse | Legacy TypeScript Fundamentals | alpha | paid | 999 | null | archived |
| tsDeepDive | TypeScript Deep Dive | alpha | subscribers | 1499 | alphaStandard | published |
| cssMasterclass | CSS Variables Masterclass | alpha | paid | 499 | null | published |

### Purchases (13 total)
| Key | Customer | Content | Org | Amount | Date |
|---|---|---|---|---|---|
| viewerSvelte | viewer | advancedSvelte | alpha | 1999 | 3 days ago |
| viewerHono | viewer | honoApis | beta | 2999 | 3 days ago |
| adminSvelte | admin | advancedSvelte | alpha | 1999 | 5 days ago |
| c1Svelte | customer1 | advancedSvelte | alpha | 1999 | 2 days ago |
| c1TsDeep | customer1 | tsDeepDive | alpha | 1499 | 30 days ago |
| c1Css | customer1 | cssMasterclass | alpha | 499 | 60 days ago |
| c2Svelte | customer2 | advancedSvelte | alpha | 1999 | 5 days ago |
| c2TsDeep | customer2 | tsDeepDive | alpha | 1499 | 5 days ago |
| c3Css | customer3 | cssMasterclass | alpha | 499 | 3 days ago |
| c4Svelte | customer4 | advancedSvelte | alpha | 1999 | 45 days ago |
| c4TsDeep | customer4 | tsDeepDive | alpha | 1499 | 45 days ago |
| c4Css | customer4 | cssMasterclass | alpha | 499 | 45 days ago |
| c5TsDeep | customer5 | tsDeepDive | alpha | 1499 | 80 days ago |

### Content Access (14 total)
| Key | User | Content | accessType |
|---|---|---|---|
| viewerIntroTs | viewer | introTs | complimentary |
| viewerSvelte | viewer | advancedSvelte | purchased |
| viewerHono | viewer | honoApis | purchased |
| adminSvelte | admin | advancedSvelte | purchased |
| c1Svelte-c5TsDeep | customer1-5 | various | purchased |

### Subscription Tiers (3 total)
| Key | Org | Name | Monthly | Annual | Stripe IDs |
|---|---|---|---|---|---|
| alphaStandard | alpha | Standard | 499 | 4799 | all null |
| alphaPro | alpha | Pro | 999 | 9599 | all null |
| betaStandard | beta | Standard | 699 | 6699 | all null |

### Subscriptions (1 total)
| Key | User | Org | Tier | Stripe Sub ID | Status |
|---|---|---|---|---|---|
| viewerAlphaStandard | viewer | alpha | alphaStandard | sub_seed_viewer_alpha_standard | active |

### Connect Accounts (1 total, conditional)
| Key | Org | User | Condition |
|---|---|---|---|
| alphaCreator | alpha | creator | Only seeded when STRIPE_SECRET_KEY is set |

### Platform Fee Config (1 total)
| Key | Fee | Effective From |
|---|---|---|
| (single) | 1000 basis points (10%) | 2025-01-01 |

---

## Schema Analysis

### `purchases` (ecommerce.ts, lines 225-356)
- **PK**: uuid, defaultRandom
- **FKs**: customerId -> users.id (cascade), contentId -> content.id (restrict), organizationId -> organizations.id (restrict)
- **CHECK constraints**: status enum, amount positive, fee positives, revenue split = total
- **Indexes**: 11 indexes (customer, content, org, stripe PI, timestamps, composites)
- **Soft delete**: NO deletedAt column
- **Timestamp TZ**: Yes, all withTimezone

### `content_access` (ecommerce.ts, lines 24-75)
- **PK**: uuid, defaultRandom
- **FKs**: userId -> users.id (cascade), contentId -> content.id (cascade), organizationId -> organizations.id (cascade)
- **CHECK**: accessType IN ('purchased', 'subscription', 'complimentary', 'preview')
- **Unique**: (userId, contentId) -- prevents duplicate access grants
- **Soft delete**: NO deletedAt column
- **Missing**: No purchaseId or subscriptionId FK -- cannot trace back to the grant source

### `subscription_tiers` (subscriptions.ts, lines 28-77)
- **PK**: uuid, defaultRandom
- **FKs**: organizationId -> organizations.id (cascade)
- **Soft delete**: YES, has deletedAt
- **Unique**: sortOrder per org (partial, deletedAt IS NULL)
- **CHECK**: prices >= 0, sortOrder > 0
- **Currency**: No currency column -- assumes GBP implicitly

### `subscriptions` (subscriptions.ts, lines 89-186)
- **PK**: uuid, defaultRandom
- **FKs**: userId -> users.id (cascade), organizationId -> organizations.id (cascade), tierId -> subscriptionTiers.id (restrict)
- **Soft delete**: NO deletedAt column (uses status lifecycle instead)
- **CHECK**: status enum, billing_interval enum, amounts positive, revenue split = total
- **Unique**: One active sub per user per org (partial index on status IN active/past_due/cancelling)
- **Currency**: No currency column -- should match purchases pattern

### `stripe_connect_accounts` (subscriptions.ts, lines 198-245)
- **PK**: uuid, defaultRandom
- **FKs**: organizationId -> organizations.id (cascade), userId -> users.id (cascade)
- **Unique**: stripeAccountId, (userId, organizationId)
- **Soft delete**: NO deletedAt column
- **CHECK**: status IN ('onboarding', 'active', 'restricted', 'disabled')

### `pending_payouts` (subscriptions.ts, lines 254-293)
- **PK**: uuid, defaultRandom
- **FKs**: userId -> users.id (cascade), organizationId -> organizations.id (cascade), subscriptionId -> subscriptions.id (cascade)
- **Soft delete**: NO deletedAt column
- **CHECK**: amountCents > 0, reason enum
- **Missing**: No updatedAt column (only createdAt)

### `platform_fee_config` (ecommerce.ts, lines 86-114)
- **PK**: uuid, defaultRandom
- **CHECK**: percentage 0-10000
- **Indexes**: composite on (effectiveFrom, effectiveUntil)
- **Soft delete**: NO deletedAt column

### `content` (content.ts, lines 251-366) -- Commerce-relevant columns
- **accessType**: varchar(50), NOT NULL, default 'free', CHECK IN ('free', 'paid', 'subscribers', 'members')
- **priceCents**: integer, nullable, CHECK >= 0
- **minimumTierId**: uuid, FK -> subscriptionTiers.id (set null on delete)
- **visibility**: DROPPED in migration 0043 -- column no longer exists

### `feature_settings` (settings.ts, lines 145-171)
- **enableSubscriptions**: boolean, NOT NULL, default false
- Added in migration 0035

---

## Bugs Found

### BUG-SEED-001: Seed writes dropped `visibility` column (CRITICAL)
- **Location**: `constants.ts` lines 304, 319, 335, 349, 363, 378, 392, 406, 421, 437, 453; `content.ts` line 66
- **Problem**: Every content item in `CONTENT` constants defines a `visibility` property (e.g., `visibility: 'public' as const`), and `content.ts` line 66 writes it: `visibility: c.visibility`. Migration 0043 dropped the `visibility` column from the content table. This INSERT will fail with a Drizzle error because the column does not exist in the schema.
- **Evidence**: `content.ts:66` -- `visibility: c.visibility`; schema `content.ts` has no `visibility` field; migration 0042/0043 both execute `ALTER TABLE "content" DROP COLUMN "visibility"`.
- **Impact**: **Seed script will crash** on any database that has applied migration 0042+.
- **Fix**: Remove `visibility` property from all CONTENT entries in `constants.ts` and remove line 66 in `content.ts`.

### BUG-SEED-002: `pending_payouts` missing from TABLES_TO_TRUNCATE (both files)
- **Location**: `seed-data.ts` lines 27-53; `reset-data.ts` lines 20-51
- **Problem**: The `pending_payouts` table was created in migration 0035 but was never added to either TABLES_TO_TRUNCATE list. If any pending payouts exist from prior testing, they will NOT be cleared during seed/reset, potentially violating FK constraints when subscriptions are truncated (since pending_payouts has `subscription_id` FK with CASCADE).
- **Impact**: Data leak between seed runs. The CASCADE on the FK to subscriptions means the rows will likely be cleaned up indirectly when subscriptions are truncated, but this is fragile -- if CASCADE behavior changes or the truncation order matters, stale rows could remain.
- **Fix**: Add `'pending_payouts'` to both TABLES_TO_TRUNCATE lists.

### BUG-SEED-003: `enableSubscriptions` not set to true for Studio Alpha
- **Location**: `organizations.ts` lines 134-149
- **Problem**: Feature settings for both Alpha and Beta set `enableSignups: true` and `enablePurchases: true` but do NOT set `enableSubscriptions: true`. The schema defaults this to `false` (settings.ts line 157-158). Studio Alpha has subscription tiers, a subscription for viewer, and content gated by tier -- but the feature flag is off.
- **Impact**: Any UI or API code that checks `enableSubscriptions` before showing subscription features will hide them, making it impossible to test subscription flows without manually toggling the flag. The monetisation page at `/studio/monetisation` and the subscription remote likely check this flag.
- **Fix**: Add `enableSubscriptions: true` to the Alpha feature settings (and optionally Beta, since it also has tiers seeded).

### BUG-SEED-004: Studio Beta has no Stripe Connect account
- **Location**: `commerce.ts` lines 287-335
- **Problem**: The seed only creates a Connect account for Studio Alpha (conditionally, when STRIPE_SECRET_KEY is available). Studio Beta (owned by admin) has no Connect account. Yet Beta has a subscription tier seeded (betaStandard) and content (honoApis) that viewer purchased. Without a Connect account, any code path that checks for an active Connect account before allowing checkout or tier management will fail for Beta.
- **Impact**: Testing commerce flows for Studio Beta is broken. Specifically, the tier API requires a Connect account for Stripe product/price creation.
- **Fix**: Create a second Stripe Express account for Studio Beta in the seed, or document clearly that Beta is intentionally in a "no Connect" state for testing that edge case.

### BUG-SEED-005: No org memberships for customers 1-5
- **Location**: `organizations.ts` lines 30-85 (memberships); `constants.ts` lines 67-102 (customer definitions)
- **Problem**: Customers 1-5 (Maria, James, Priya, Lucas, Emma) each have purchases from Studio Alpha and content_access records referencing Alpha's org ID, but none have an `organization_memberships` row for Alpha. In many systems, a purchase implies at minimum a "member" or "subscriber" membership.
- **Impact**: Any queries that join memberships to find customers (e.g., studio customer management) will not return these 5 users. If the org space page or content access checks membership status, these customers may be denied access despite having valid purchase records and content_access entries.
- **Fix**: Add `member` (or `subscriber`) memberships for each customer to Studio Alpha, matching the membership constants pattern.

### BUG-SEED-006: Subscription uses fake Stripe IDs that won't validate
- **Location**: `commerce.ts` lines 264-283
- **Problem**: The viewer's subscription uses `stripeSubscriptionId: 'sub_seed_viewer_alpha_standard'` and `stripeCustomerId: 'cus_seed_viewer'`. These are fake IDs that don't exist in Stripe test mode. Any code that calls Stripe APIs with these IDs (e.g., to cancel, update, or retrieve the subscription) will receive a 404/invalid error from Stripe.
- **Impact**: Subscription management (cancel, upgrade, billing portal) will throw Stripe API errors. This is acceptable for seed data ONLY if all Stripe API calls are guarded against fake IDs or the development environment is properly mocked.
- **Fix**: Either (a) create a real Stripe test subscription during seeding (like Connect accounts), or (b) document that these are intentionally fake and ensure all Stripe API call paths handle the error gracefully, or (c) add a `codex_seed: 'true'` flag that skips real Stripe calls in development.

### BUG-SEED-007: Tiers have no Stripe Price IDs -- tier CRUD may break
- **Location**: `commerce.ts` lines 205-242; `constants.ts` lines 270-295
- **Problem**: All three subscription tiers are seeded with `stripeProductId`, `stripePriceMonthlyId`, and `stripePriceAnnualId` all null (defaulted by omission). Any code that reads these columns to build Stripe Checkout sessions or payment links will get null values and likely fail.
- **Impact**: Stripe checkout for subscriptions cannot work with seed data. The tier CRUD API creates these on save, but if tiers are only read (not re-saved), the null IDs persist.
- **Fix**: Similar to BUG-SEED-006: either create real Stripe products/prices during seeding (expensive, requires STRIPE_SECRET_KEY), or document the limitation and ensure the checkout flow creates them on-demand.

### BUG-SEED-008: `reset-data.ts` also missing subscription commerce tables
- **Location**: `reset-data.ts` lines 20-51
- **Problem**: The reset-data.ts TABLES_TO_TRUNCATE list is missing `stripe_connect_accounts`, `subscription_tiers`, `subscriptions`, and `pending_payouts`. These were added to seed-data.ts but the reset script was not updated in parallel.
- **Impact**: Running `pnpm db:reset` will not clear subscription/commerce data, leaving stale tiers, subscriptions, and connect accounts that may conflict with a fresh start.
- **Fix**: Add all four tables to reset-data.ts TABLES_TO_TRUNCATE.

---

## Improvements

### IMP-SEED-001: `content_access` lacks traceability FK to grant source
- **Location**: `ecommerce.ts` lines 24-75
- **Problem**: `content_access` has no `purchaseId` or `subscriptionId` column. When access is granted via purchase, there's no FK linking back to the specific purchase record. When access is granted via subscription, there's no link to the subscription.
- **Impact**: Cannot easily audit why a user has access. Revoking access on refund requires searching by (userId, contentId) rather than by purchaseId. Subscription cancellation cannot selectively revoke access records.
- **Recommendation**: Add optional `purchaseId uuid REFERENCES purchases(id)` and `subscriptionId uuid REFERENCES subscriptions(id)` columns with CHECK constraint ensuring at least one is set when accessType is 'purchased' or 'subscription'.

### IMP-SEED-002: `subscriptions` table missing `currency` column
- **Location**: `subscriptions.ts` lines 89-186
- **Problem**: The `purchases` table has an explicit `currency` column (default 'gbp'). The `subscriptions` table stores `amountCents` but has no `currency` column. The `pending_payouts` table has `currency`. This is inconsistent across commerce tables.
- **Impact**: If the platform ever supports multiple currencies, the subscription amount is ambiguous. Even now, the implicit GBP assumption is fragile.
- **Recommendation**: Add `currency varchar(3) NOT NULL DEFAULT 'gbp'` to the `subscriptions` table for consistency.

### IMP-SEED-003: `purchases` and `content_access` tables lack `deletedAt` for soft deletes
- **Location**: `ecommerce.ts`
- **Problem**: The codebase mandates soft deletes (CLAUDE.md: "MUST use soft deletes, NEVER hard-delete rows"), but `purchases`, `content_access`, `platform_fee_config`, `organization_platform_agreements`, and `creator_organization_agreements` have no `deletedAt` column.
- **Impact**: Refunded purchases cannot be soft-deleted. Content access that should be revoked must be hard-deleted, violating the codebase convention.
- **Recommendation**: Add `deletedAt` timestamp to `purchases` and `content_access` at minimum. Financial records (purchases) are especially important to retain. Consider whether agreements should also get soft deletes.

### IMP-SEED-004: Timestamp timezone inconsistency in auth tables
- **Location**: `auth.ts` (accounts, sessions, verification) vs `ecommerce.ts`, `subscriptions.ts`
- **Problem**: Auth tables (`accounts`, `sessions`, `verification`) use `timestamp()` without `{ withTimezone: true }`, while all commerce tables use `timestamp({ withTimezone: true })`. The `users` table also lacks `withTimezone`.
- **Impact**: Timezone-naive timestamps in auth/users tables vs timezone-aware in commerce tables creates inconsistency. In PostgreSQL, `timestamp` (without timezone) stores as-is and doesn't adjust for timezone context, while `timestamptz` converts to/from UTC.
- **Recommendation**: This is a broader concern beyond commerce, but any new columns should use `withTimezone: true` consistently. A migration to convert existing columns would be ideal but risky.

### IMP-SEED-005: Missing composite index on `content_access` for subscription access checks
- **Location**: `ecommerce.ts` lines 57-74
- **Problem**: `content_access` has individual indexes on `userId`, `contentId`, and `organizationId`, but no composite index for the common query pattern: "does user X have access to content Y?" which queries on `(userId, contentId)`. The unique constraint on `(userId, contentId)` serves as an implicit index, but an explicit composite on `(userId, organizationId, accessType)` would optimize "list all content user has access to in this org" queries.
- **Impact**: Library page queries that list a user's accessible content per org will do a seq scan on accessType.
- **Recommendation**: Add `index('idx_content_access_user_org_type').on(table.userId, table.organizationId, table.accessType)`.

### IMP-SEED-006: `pending_payouts` table missing `updatedAt` column
- **Location**: `subscriptions.ts` lines 254-293
- **Problem**: The `pending_payouts` table only has `createdAt` and no `updatedAt`. Every other table in the schema has `updatedAt`. When a payout is resolved (`resolvedAt` is set), the `updatedAt` should also be updated.
- **Impact**: Cannot track when a pending payout record was last modified. Inconsistent with the rest of the schema.
- **Recommendation**: Add `updatedAt` timestamp with the standard `$onUpdate` pattern.

### IMP-SEED-007: Seed Connect account creation is non-idempotent
- **Location**: `commerce.ts` lines 287-326
- **Problem**: Every seed run creates a NEW Stripe Express account via `stripe.accounts.create()`. There is no cleanup of previously created test accounts. The `.onConflictDoNothing()` on line 326 prevents DB duplicates but does not prevent Stripe-side accumulation.
- **Impact**: Over time, the Stripe test account accumulates orphaned Express accounts. While harmless in test mode, it pollutes the Stripe dashboard and wastes API calls.
- **Recommendation**: Before creating a new account, check if an active Connect account already exists for the org. If it does and the Stripe account is still valid, reuse it. Alternatively, delete old test accounts marked with `codex_seed: 'true'` metadata before creating new ones.

### IMP-SEED-008: No seed data for `content_access` with subscription accessType
- **Location**: `commerce.ts` lines 152-200
- **Problem**: All 14 content_access records use either 'purchased' or 'complimentary' accessType. Despite viewer having an active subscription to Alpha Standard tier, there are no content_access records with `accessType: 'subscription'`. The tsDeepDive content has `minimumTierId: alphaStandard`, which the viewer's subscription covers, but no subscription-based access record exists.
- **Impact**: Cannot test the subscription-based content access path in the UI. Any code that checks for `accessType = 'subscription'` in content_access will find no rows.
- **Recommendation**: Add content_access records for subscription-entitled content (at minimum, tsDeepDive for viewer with `accessType: 'subscription'`).

### IMP-SEED-009: Seed data log message count mismatch
- **Location**: `commerce.ts` line 329
- **Problem**: The log message says "13 purchases, 14 content access" but these counts are hardcoded strings. If items are added or removed, the log will be wrong.
- **Impact**: Misleading console output during seed.
- **Recommendation**: Calculate counts dynamically from the actual inserted data.

### IMP-SEED-010: No beta-org purchases in seed
- **Location**: `commerce.ts` lines 96-149
- **Problem**: All 10 additional customer purchases are from Studio Alpha. Only the original `viewerHono` purchase is from Studio Beta. This means Studio Beta's admin dashboard will show almost no purchase data.
- **Impact**: Cannot effectively test Beta's revenue analytics, customer management, or payout calculations.
- **Recommendation**: Add some purchases from Beta (e.g., customer1 or customer2 buying honoApis) to provide meaningful test data for both orgs.

### IMP-SEED-011: `subscription_tiers` has no `features` column for tier differentiation
- **Location**: `subscriptions.ts` lines 28-77
- **Problem**: Tiers only have name, description, sort order, and prices. There's no structured way to define what features each tier includes (e.g., "access to workshops", "download originals", "ad-free").
- **Impact**: Tier differentiation is purely by sortOrder (higher = more access to content gated by minimumTierId). Cannot model feature-based tier differences.
- **Recommendation**: Add a `features jsonb` column (e.g., `string[]` or `Record<string, boolean>`) for structured feature flags per tier. This can be Phase 2.

### IMP-SEED-012: No content seeded for Beta org with subscription tier gating
- **Location**: `constants.ts` lines 298-462; `commerce.ts` lines 244-255
- **Problem**: Only Alpha content has `minimumTierId` set. Beta has a `betaStandard` tier but no content references it. The tier exists but gates nothing.
- **Impact**: Cannot test subscription-based content gating for Studio Beta.
- **Recommendation**: Set `minimumTierId: TIERS.betaStandard.id` on honoApis or writtenTutorial content.

---

## Work Packets

### WP-SEED-01: Fix seed-breaking `visibility` column bug (Critical)
**Priority**: P0 -- Seed script is broken
**Bugs**: BUG-SEED-001
**Effort**: 15 minutes
**Changes**:
1. `constants.ts`: Remove `visibility` property from all 11 CONTENT entries (lines 304, 319, 335, 349, 363, 378, 392, 406, 421, 437, 453)
2. `content.ts`: Remove line 66 (`visibility: c.visibility`)
3. Verify seed runs successfully with `pnpm db:seed --force`

### WP-SEED-02: Fix TABLES_TO_TRUNCATE in both scripts
**Priority**: P1 -- Data integrity during reset/reseed
**Bugs**: BUG-SEED-002, BUG-SEED-008
**Effort**: 10 minutes
**Changes**:
1. `seed-data.ts` line 53: Add `'pending_payouts'` before closing bracket
2. `reset-data.ts` line 50: Add `'stripe_connect_accounts'`, `'subscription_tiers'`, `'subscriptions'`, `'pending_payouts'` to the list
3. Verify both scripts list the same set of tables

### WP-SEED-03: Enable subscription feature flag for Alpha
**Priority**: P1 -- Subscription testing is blocked
**Bugs**: BUG-SEED-003
**Effort**: 5 minutes
**Changes**:
1. `organizations.ts` line 138: Add `enableSubscriptions: true` to Alpha's feature settings
2. Optionally add to Beta as well (line 146)

### WP-SEED-04: Add org memberships for customers 1-5
**Priority**: P1 -- Customer management broken
**Bugs**: BUG-SEED-005
**Effort**: 20 minutes
**Changes**:
1. `constants.ts`: Add 5 new MEMBERSHIP constants (e.g., `customer1AlphaMember`, etc.)
2. `organizations.ts`: Add 5 membership inserts with `role: 'member'`, `status: 'active'`
3. Update console log count

### WP-SEED-05: Add Beta Connect account or document intentional gap
**Priority**: P2 -- Testing limitation
**Bugs**: BUG-SEED-004
**Effort**: 30 minutes
**Changes**:
1. `constants.ts`: Add `betaAdmin` to CONNECT_ACCOUNTS
2. `commerce.ts`: Create second Stripe Express account for Beta org (admin user) within the STRIPE_SECRET_KEY guard
3. OR: Add a code comment documenting that Beta intentionally lacks Connect for edge-case testing

### WP-SEED-06: Add subscription-based content_access and fix seed Stripe IDs
**Priority**: P2 -- Feature testing gaps
**Bugs**: BUG-SEED-006, BUG-SEED-007
**Improvements**: IMP-SEED-008
**Effort**: 45 minutes
**Changes**:
1. Add content_access record for viewer -> tsDeepDive with `accessType: 'subscription'`
2. Add constants for subscription-based access IDs
3. Document in seed-data.ts summary that Stripe subscription/tier IDs are intentionally fake
4. Consider adding `// WARNING: Fake Stripe IDs` comments on relevant lines

### WP-SEED-07: Schema improvements -- traceability and consistency
**Priority**: P3 -- Technical debt
**Improvements**: IMP-SEED-001, IMP-SEED-002, IMP-SEED-003, IMP-SEED-006
**Effort**: 2-3 hours (includes migration)
**Changes**:
1. Add `purchaseId` and `subscriptionId` optional FK columns to `content_access`
2. Add `currency` column to `subscriptions` table
3. Add `deletedAt` to `purchases` and `content_access`
4. Add `updatedAt` to `pending_payouts`
5. Generate and apply migration
6. Update seed to populate new columns where applicable

### WP-SEED-08: Index and query optimization
**Priority**: P3 -- Performance
**Improvements**: IMP-SEED-005
**Effort**: 30 minutes
**Changes**:
1. Add composite index `(userId, organizationId, accessType)` on `content_access`
2. Generate and apply migration
3. Verify query plans for library page queries

### WP-SEED-09: Improve seed robustness and coverage
**Priority**: P3 -- Quality of life
**Improvements**: IMP-SEED-007, IMP-SEED-009, IMP-SEED-010, IMP-SEED-012
**Effort**: 1-2 hours
**Changes**:
1. Make Connect account creation idempotent (check for existing before creating)
2. Replace hardcoded count strings with dynamic counts
3. Add Beta-org purchases for customers
4. Set minimumTierId on Beta content (honoApis)
5. Update all console.log counts to be computed
