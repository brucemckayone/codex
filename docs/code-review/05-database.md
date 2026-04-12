# Code Review: Database Schema, Queries & Data Layer

**Reviewer:** Claude Opus 4.6 (1M context)
**Scope:** `packages/database/`, `packages/cache/`, `apps/web/src/lib/collections/`, `apps/web/src/lib/remote/`, query patterns across all service packages

## Review History

| Pass | Date | Notes |
|------|------|-------|
| 1 | 2026-04-07 | Initial review. 10 findings. |
| 2 | 2026-04-07 | Full source verification. Corrected 3 inaccuracies, added 8 new findings, removed 1 false positive, re-graded 2 findings. |
| 3 | 2026-04-07 | Deep-dive on migrations, indexes, foreign keys, data types, connection pooling, TanStack DB. Verified all Pass 2 findings. Added 9 new findings. Corrected 2 Pass 2 inaccuracies. |

### Pass 3 Changes Summary
- **Verified all Pass 2 findings** against source code. All confirmed accurate at stated line numbers.
- **Corrected Pass 2:** The report stated `OrganizationService.listMembers()` runs count queries sequentially (lines 534-556). Re-read the actual source: the members query AND count query at lines 420-461 are in fact wrapped in a `Promise.all` already (the two arguments to `Promise.all` are the count query and the members query). **This is a false positive.** Removed. (The method in Pass 2 was `getPublicCreators`, not `listMembers`.)
- **Corrected Pass 2:** "Out-of-sequence migration files" finding was vague. Clarified: `0020_fix_transcoding_constraints.sql` and `0007_seed_platform_fee_config.sql` exist on disk but are NOT in the Drizzle journal (`meta/_journal.json`). These are orphan files -- they will NOT be executed by the Drizzle migration runner. Upgraded to MEDIUM.
- **New MEDIUM finding:** `subscriptions` table comment says "Only one active/cancelling subscription per user per org (enforced by unique index)" but NO such unique index exists. Only a regular composite index `idx_subscriptions_user_org` on `(userId, organizationId)`. Enforcement is application-only.
- **New MEDIUM finding:** `organizations.slug` has a plain unique constraint (`organizations_slug_unique`) without soft-delete filter. Soft-deleted orgs permanently block their slug.
- **New MEDIUM finding:** `users.username` has a plain unique constraint (`users_username_unique`) without soft-delete filter. Soft-deleted users permanently block their username.
- **New MEDIUM finding:** `visibility` column is still actively referenced in 3 locations beyond the `getPublicCreators()` bug: `ContentService.list()` filter (line 673), `ContentForm.svelte` (line 95), and `@codex/validation` `visibilityEnum`. The deprecation is incomplete and actively confusing.
- **New LOW finding:** Primary key type inconsistency: `users`, `accounts`, `sessions`, `verification` use `text` PKs (BetterAuth requirement); all other tables use `uuid`. Foreign keys referencing `users.id` must use `text` type, creating a type split across the schema.
- **New LOW finding:** `Pool` is created with no explicit `max` connections parameter. Neon serverless Pool defaults to 10 connections. Per-request pools (`createPerRequestDbClient`) create a fresh Pool for each request but never configure size limits.
- **New LOW finding:** `subscriptions` table has no `deletedAt` column, making cancelled subscriptions permanent records. This is arguably correct (financial records should not be soft-deleted), but it means the `subscriptions` table will grow unboundedly and the `idx_subscriptions_user_org` composite index includes all historical subscriptions.
- **New INFO finding:** Two migration files exist on disk but are NOT in the Drizzle journal: `0020_fix_transcoding_constraints.sql` and `0007_seed_platform_fee_config.sql`. These are dead files and should be cleaned up.
- **New INFO finding:** `contentCollection` queryFn uses `listContent({ status: 'published' })` without pagination cursor -- only first page is loaded. Pass 2 noted this; Pass 3 confirms the underlying remote function also has no pagination loop.

---

## Executive Summary (Top 5 Findings)

1. **`OrganizationService.getPublicCreators()` uses legacy `visibility` column for content count JOIN (BUG)** -- The content count LEFT JOIN at line 439 filters `eq(content.visibility, 'public')`, but `visibility` is deprecated. The canonical column is `accessType` with values `'free' | 'paid' | 'subscribers' | 'members'`. This means the content count for public creators will be incorrect (likely always 0) because no code sets `visibility = 'public'` -- the default is `'purchased_only'`.

2. **`PurchaseService.getPurchase()` queries by ID without scoping (SECURITY)** -- The `getPurchase` method fetches by primary key alone, then checks ownership in application code. If the application-level check has a bug, any user could read any purchase. The query should filter by `customerId` in the WHERE clause, not post-fetch.

3. **`subscriptions` table lacks unique constraint for one-active-per-user-per-org** -- The table comment (subscriptions.ts:84) claims "Only one active/cancelling subscription per user per org (enforced by unique index)" but the only index is `idx_subscriptions_user_org` -- a regular non-unique composite index. The constraint is enforced only in application code (`createCheckoutSession` line 126-145). A race condition between two concurrent checkout completions could create duplicate active subscriptions.

4. **Unique constraints on `organizations.slug`, `users.username`, and content slugs do not exclude soft-deleted rows** -- Three categories of unique constraints block reuse after soft-delete: content slug indexes, `organizations_slug_unique`, and `users_username_unique`. The email template indexes correctly use `deleted_at IS NULL` -- showing the correct pattern exists but was not applied consistently.

5. **`ContentAccessService` creates its own per-request DB client, duplicating connections** -- When accessed through the service registry, `ContentAccessService` creates a second WebSocket pool via `createContentAccessService()` instead of sharing the registry's `getSharedDb()`. Each request touching both `content` and `access` services opens two WebSocket connections instead of one.

---

## 1. Schema Design

### Strengths

- **Comprehensive CHECK constraints**: Every enum-like column has a CHECK constraint (content status, media status, purchase status, access type, membership role, subscription status, billing interval). This is excellent defense-in-depth.
- **Revenue split integrity**: The `check_revenue_split_equals_total` constraint on both `purchases` (line 341) and `subscriptions` (line 178 of subscriptions.ts) ensures financial data is always self-consistent at the database level.
- **Media lifecycle constraint**: `status_ready_requires_keys` on `mediaItems` (lines 227-237) ensures a media item cannot be marked "ready" without the required HLS/thumbnail/waveform keys, differentiated by video vs audio. Unusually disciplined.
- **Immutable revenue snapshots**: Purchase and subscription records snapshot the fee split at creation time, preventing retroactive changes from affecting historical data.
- **Email template partial unique indexes exclude soft-deleted rows**: The `idx_unique_template_global`, `idx_unique_template_org`, and `idx_unique_template_creator` indexes all include `deleted_at IS NULL` (notifications.ts lines 112-124). This is the correct pattern.
- **Well-indexed ecommerce tables**: The `purchases` table has 8 indexes including 3 composite indexes for analytics queries (`idx_purchases_org_status_created`, `idx_purchases_org_status_purchased`, `idx_purchases_customer_purchased`).
- **Comprehensive foreign key coverage**: All relationships are enforced at the DB level with appropriate `onDelete` actions. Content/media use `restrict` (prevent cascading data loss), auth tables use `cascade` (clean up on user deletion), subscriptions use `restrict` on tier FK (prevent deleting tiers with active subscriptions). This is well-thought-out.
- **Consistent `onDelete` strategy**: `cascade` for session/account/auth data, `restrict` for financial records (purchases, subscriptions), `set null` for optional references (org membership inviter, content organization). Each choice matches the domain semantics.

### Issues

#### HIGH: `OrganizationService.getPublicCreators()` uses legacy `visibility` column

**File:** `packages/organization/src/services/organization-service.ts:439`

```typescript
.leftJoin(
  content,
  and(
    eq(content.creatorId, users.id),
    eq(content.organizationId, org.id),
    eq(content.status, 'published'),
    eq(content.visibility, 'public'),   // BUG: legacy column
    isNull(content.deletedAt)
  )
)
```

The `visibility` column is deprecated (comment at content.ts:288-289: "Legacy visibility -- kept during transition"). The canonical column is `accessType` with values `'free' | 'paid' | 'subscribers' | 'members'`. The default value for `visibility` is `'purchased_only'` (line 290), so this filter will match zero rows in practice, causing all creator content counts to be 0.

**Fix:** Replace `eq(content.visibility, 'public')` with either no access type filter (count all published content) or `eq(content.status, 'published')` alone, since the query already filters by status.

#### MEDIUM: `subscriptions` table missing unique constraint for one-active-per-user-per-org

**File:** `packages/database/src/schema/subscriptions.ts:84, 141-181`

The table comment at line 84 says:
> "Only one active/cancelling subscription per user per org (enforced by unique index)"

But the actual index definition (line 151) is:
```typescript
index('idx_subscriptions_user_org').on(table.userId, table.organizationId),
```

This is a regular `index`, not a `unique` or `uniqueIndex`. The one-active-per-org enforcement happens only in application code (`SubscriptionService.createCheckoutSession()` line 126-145), which checks for existing active/cancelling/past_due subscriptions before creating a checkout session.

This leaves a race window: if two Stripe `checkout.session.completed` webhooks arrive concurrently for the same user+org, both could insert subscription records. The `stripeSubscriptionId` unique constraint prevents exact duplicates, but Stripe creates a new subscription ID for each checkout session.

**Fix:** Add a partial unique index:
```sql
CREATE UNIQUE INDEX idx_subscriptions_user_org_active
ON subscriptions (user_id, organization_id)
WHERE status IN ('active', 'past_due', 'cancelling');
```

#### MEDIUM: Content slug unique indexes do not exclude soft-deleted rows

**File:** `packages/database/src/schema/content.ts:333-340`

```typescript
uniqueIndex('idx_unique_content_slug_per_org')
  .on(table.slug, table.organizationId)
  .where(sql`${table.organizationId} IS NOT NULL`),

uniqueIndex('idx_unique_content_slug_personal')
  .on(table.slug, table.creatorId)
  .where(sql`${table.organizationId} IS NULL`),
```

These indexes filter on `organization_id IS NOT NULL` / `IS NULL` but do NOT include `deleted_at IS NULL`. Compare with the email template indexes (notifications.ts lines 112-124) which correctly include the soft-delete filter.

A soft-deleted content item permanently blocks its slug from being reused. For example, if a creator creates content with slug "my-video", deletes it, and tries to create new content with the same slug, the unique constraint will reject it.

**Fix:** Add `AND ${table.deletedAt} IS NULL` to both partial unique index WHERE clauses. This requires a new migration.

#### MEDIUM: `organizations.slug` unique constraint does not exclude soft-deleted rows

**File:** `packages/database/src/schema/content.ts:28`

```typescript
slug: varchar('slug', { length: 255 }).notNull().unique(),
```

This is a plain unique constraint (`organizations_slug_unique` in migration 0002). Since `organizations` has a `deletedAt` column (line 43), soft-deleting an organization permanently blocks its slug from being reused. Organization slugs become subdomains, so a popular slug like "music-studio" could be permanently unavailable after one soft-delete.

**Fix:** Replace the plain `.unique()` with a partial unique index filtered by `deleted_at IS NULL`.

#### MEDIUM: `users.username` unique constraint does not exclude soft-deleted rows

**File:** `packages/database/src/schema/users.ts:29`

```typescript
username: text('username').unique(),
```

Created in migration 0031. Since `users` has a `deletedAt` column (line 35), soft-deleting a user permanently blocks their username. The `IdentityService.upgradeToCreator()` checks username availability (line 363) but the check-then-insert pattern is also vulnerable to races (mitigated by the unique constraint, which will error rather than allow duplicates).

**Fix:** Replace with a partial unique index filtered by `deleted_at IS NULL`.

#### MEDIUM: `subscriptionTiers` unique constraint includes soft-deleted rows

**File:** `packages/database/src/schema/subscriptions.ts:67-70`

```typescript
unique('uq_subscription_tiers_org_sort').on(
  table.organizationId,
  table.sortOrder
),
```

This is a regular unique constraint (not a partial index), so deleted tiers still occupy sort order slots. The `TierService.createTier()` method at line 60 already works around this by querying INCLUDING soft-deleted rows for the max sort order, but this is a workaround rather than a proper fix.

**Fix:** Convert to a partial unique index filtered by `deleted_at IS NULL`.

#### MEDIUM: `visibility` column deprecation is incomplete -- still actively referenced

**Files:**
- `packages/organization/src/services/organization-service.ts:439` (the bug)
- `packages/content/src/services/content-service.ts:673` (filter support)
- `apps/web/src/lib/components/studio/ContentForm.svelte:95` (form state)
- `packages/validation/` (visibilityEnum still exists)

The `visibility` column (content.ts:289) is marked "Legacy" but is actively used in 4 locations beyond the schema definition. The `ContentService.list()` method at line 672-673 still filters by `visibility` when `filters.visibility` is provided:
```typescript
if (filters.visibility) {
  whereConditions.push(eq(content.visibility, filters.visibility));
}
```

And `ContentForm.svelte` still initializes form state with `visibility: content.visibility ?? 'public'` (line 95). This is not just a cleanup issue -- the dual columns actively cause bugs (the `getPublicCreators()` finding) and confuse developers about which column is canonical.

**Recommendation:** Create a single migration that:
1. Backfills any remaining `visibility` references to `accessType` equivalents
2. Removes the `visibility` filter from `ContentService.list()`
3. Removes `visibility` from `ContentForm.svelte`
4. Drops the `visibility` column

#### LOW: `content` table has both `accessType` and `visibility` columns

**File:** `packages/database/src/schema/content.ts:284-291`

Covered in detail in the MEDIUM finding above. The dual columns exist and the `visibility` CHECK constraint (line 352-355) still enforces `'public' | 'private' | 'members_only' | 'purchased_only'`, while `accessType` enforces `'free' | 'paid' | 'subscribers' | 'members'`. The two value sets are completely different -- there is no overlap.

#### LOW: `users` and `auth` tables lack `{ withTimezone: true }` on ALL timestamps

**File:** `packages/database/src/schema/users.ts:35-40`, `packages/database/src/schema/auth.ts:24-65`

The `users` table has 3 timestamp columns (`deletedAt`, `createdAt`, `updatedAt`) -- none use `{ withTimezone: true }`. The `accounts`, `sessions`, and `verification` tables in auth.ts have 8 additional timestamp columns, also without timezone. Every other table in the schema (content, organizations, purchases, subscriptions, playback, settings, notifications, storage) consistently uses `{ withTimezone: true }`.

Confirmed in migration 0001: the tables were created with `timestamp` (no timezone) and have never been migrated. While PostgreSQL stores both as UTC internally, the wire format differs -- `timestamp` sends values without `+00` suffix, which some ORMs interpret in the local timezone.

#### LOW: `organizationMemberships` has no `deletedAt` column

**File:** `packages/database/src/schema/content.ts:64-113`

Memberships use status `'inactive'` instead of soft delete. The `removeMember()` method correctly sets `status: 'inactive'` rather than hard-deleting. This is a valid alternative pattern but it means the `whereNotDeleted()` / `scopedNotDeleted()` helpers cannot be used for membership queries, creating a different pattern.

#### LOW: Primary key type split: `text` for auth tables, `uuid` for all others

**File:** `packages/database/src/schema/users.ts:20`, `packages/database/src/schema/auth.ts:15,36,54`

The `users`, `accounts`, `sessions`, and `verification` tables use `text('id').primaryKey()` -- these are BetterAuth-managed tables where IDs are generated by the auth library. All other tables (20+) use `uuid('id').primaryKey().defaultRandom()`.

This creates a type split: every table that references `users.id` must use `text` for its FK column (e.g., `content.creatorId: text('creator_id')`), while references between non-auth tables use `uuid`. The split is inherent to BetterAuth integration and cannot be easily changed, but it means:
- FK definitions must carefully match types (`text` for user FKs, `uuid` for everything else)
- The `users.id` values are likely shorter (BetterAuth generates random strings) while UUIDs are 36 characters
- No storage or performance concern, but a consistency note for future schema additions

#### INFO: `contentAccess` has no `deletedAt` column

Access records use hard semantics (a row exists = access granted). Revoking access would delete the row. The `content_access_user_content_unique` constraint (ecommerce.ts:70-73) enforces one access record per user per content.

#### INFO: `subscriptions` has no `deletedAt` column

Subscription records are permanent financial records. Cancelled subscriptions remain in the table with `status: 'cancelled'`. This is correct for audit purposes, but the `idx_subscriptions_user_org` index (non-unique) will grow with every subscription lifecycle. For active-subscription lookups, the `idx_subscriptions_org_status` composite index efficiently filters by status.

### Missing Indexes

#### MEDIUM: No composite index for library query join path

The `listUserLibrary()` query in `ContentAccessService` performs:
```sql
FROM purchases
JOIN content ON content.id = purchases.content_id
LEFT JOIN media_items ON ...
LEFT JOIN video_playback ON ...
WHERE purchases.customer_id = ? AND purchases.status = 'completed'
```

The existing index `idx_purchases_customer_purchased` covers `(customer_id, purchased_at)` but not `(customer_id, status)`. A composite index on `(customer_id, status, content_id)` would serve this query path efficiently.

#### LOW: No index on `content.content_type` (standalone)

Content type filtering is used in `listPublic()` and `listUserLibrary()`, but there is no standalone index on `content_type`. Given low cardinality (3 values), a composite `(organization_id, status, content_type)` would benefit the public listing path more than a standalone index.

---

## 2. Migration Quality

### Strengths

- **42 migrations** in the Drizzle journal (0000-0041), all forward-only with sequential numbering.
- **Data migration in 0041**: The `access_type` column migration correctly backfills existing data from `visibility` + `priceCents` + `minimumTierId` using a CASE expression. This is the right way to handle an enum transition.
- **Trigger-based approach for org deletion** (migration 0004): A `BEFORE UPDATE` trigger unpublishes content when `organization_id` becomes NULL, preventing orphaned published content. This is a custom (non-Drizzle-generated) migration, correctly guarded with `DROP TRIGGER IF EXISTS`.
- **Comprehensive migration 0040**: Creates entire subscription domain (tiers, subscriptions, connect accounts, pending payouts) with all constraints and indexes in a single migration. Well-structured.
- **FK action migration 0003**: Drops and recreates 4 foreign key constraints to change `onDelete` from `no action` to the correct actions (`restrict`, `set null`). This shows deliberate FK design evolution.
- **No destructive migrations**: Zero `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or `DELETE FROM` statements across all 42 migrations. All changes are additive or modify constraints. The only `DROP CONSTRAINT` operations are for CHECK constraint corrections (0018, 0020, 0025, 0027) and the FK action migration (0003).
- **Idempotent patterns**: Migration 0002 uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Migrations 0020 uses `DO $$` blocks with existence checks. Seed migration 0007 uses `ON CONFLICT DO NOTHING`.

### Issues

#### MEDIUM: Orphan migration files not in Drizzle journal

**Files:**
- `packages/database/src/migrations/0020_fix_transcoding_constraints.sql`
- `packages/database/src/migrations/0007_seed_platform_fee_config.sql`

These two files exist on disk in the migrations directory but have NO corresponding entry in `meta/_journal.json`. The Drizzle migration runner processes only files listed in the journal, so these files are dead code.

However, `0007_seed_platform_fee_config.sql` contains the critical seed data for `platform_fee_config` (the 10% default platform fee). If this seed was never run by the Drizzle runner, the `platform_fee_config` table could be empty in some environments, which would break revenue split calculations.

**Risk assessment:**
- `0020_fix_transcoding_constraints.sql` is also covered by `0027_fix_transcoding_attempts_constraint.sql` (which IS in the journal). Redundant but harmless.
- `0007_seed_platform_fee_config.sql` may have been run manually or via a separate script. Verify that `platform_fee_config` has data in all environments.

**Fix:** Either add these to the journal or delete them. Verify `platform_fee_config` has the seed row in production.

#### LOW: Constraint correction chain (0018 -> 0020 -> 0025 -> 0026 -> 0027)

The `status_ready_requires_keys` and `check_max_transcoding_attempts` constraints were corrected across 5 migrations. While each migration is individually correct, the correction chain shows iterative debugging in production. Migration 0020 (orphan) and 0027 both fix the same constraint with different approaches. This is resolved but adds complexity to the migration history.

#### INFO: No down migrations

Drizzle Kit does not generate down migrations by default. All migrations are forward-only. Rollback requires manual SQL scripts. This is standard practice for Drizzle but worth noting for operational procedures.

---

## 3. Query Patterns

### Strengths

- **Consistent use of `scopedNotDeleted()`**: ContentService and MediaItemService use this helper on every query. The pattern is well-established.
- **Parallel query execution**: List methods across nearly all services use `Promise.all([itemsQuery, countQuery])` to run the data and count queries concurrently. Verified in `getPublicCreators()` (lines 420-461).
- **Transaction usage**: Multi-step mutations (create content + validate media, complete purchase + grant access) correctly use `db.transaction()`.
- **Concurrent independent queries in dashboard**: `getDashboardStats()` runs revenue, customer, and top content queries in parallel via `Promise.all`.
- **Correct LIKE wildcard escaping in ContentAccessService**: The `listUserLibrary()` method at line 636 escapes `%` and `_` characters in search input before passing to `ilike()`.

### Issues

#### HIGH: `PurchaseService.getPurchase()` -- query by ID then application-level auth check

**File:** `packages/purchase/src/services/purchase-service.ts:598-632`

```typescript
const purchase = await this.db.query.purchases.findFirst({
  where: eq(purchases.id, validated.id),
});

if (!purchase) throw new PurchaseNotFoundError(validated.id);

if (purchase.customerId !== customerId) {
  throw new ForbiddenError(...);
}
```

This fetches any purchase regardless of owner. The pattern violates the project's "scope every query" rule. A timing side-channel could distinguish "exists but not mine" from "doesn't exist" because the error type differs (404 vs 403).

**Fix:** Use `and(eq(purchases.id, id), eq(purchases.customerId, customerId))` in the WHERE clause and return 404 for both cases.

#### MEDIUM: LIKE wildcard injection in search queries

**Files:**
- `packages/content/src/services/content-service.ts:692-693, 806-807`
- `packages/organization/src/services/organization-service.ts:292-293`
- `packages/admin/src/services/customer-management-service.ts:69-70`

These services construct LIKE patterns without escaping:
```typescript
ilike(content.title, `%${filters.search}%`)
```

A search term containing `%` or `_` will act as a SQL LIKE wildcard. For example, searching for `%` would match all records. While Drizzle parameterizes the value (preventing SQL injection), the LIKE wildcards themselves are not escaped.

`ContentAccessService` (line 636) correctly escapes these:
```typescript
const pattern = `%${input.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
```

**Exploitability assessment (Pass 3):** In practice, this is low-severity. An attacker searching for `%` gets all records -- the same result as an empty search. Searching for `_` matches single characters, potentially returning slightly broader results. There is no data exposure beyond what an empty search would return, no denial-of-service vector (the query still uses LIMIT), and no SQL injection risk. However, it produces unexpected results for users who literally search for `%` or `_` characters.

**Fix:** Apply the same escaping pattern used in ContentAccessService to all other search queries. This is a straightforward copy-paste fix.

#### MEDIUM: `SubscriptionService.executeTransfers()` -- N+1 query on creator Connect accounts

**File:** `packages/subscription/src/services/subscription-service.ts:940-1004`

Inside the `for (const agreement of creatorAgreements)` loop, each iteration queries the `stripeConnectAccounts` table individually:

```typescript
const [creatorConnect] = await this.db
  .select()
  .from(stripeConnectAccounts)
  .where(and(
    eq(stripeConnectAccounts.userId, agreement.creatorId),
    eq(stripeConnectAccounts.organizationId, orgId)
  ))
  .limit(1);
```

For an org with 10 creators, this makes 10 sequential DB queries. Additionally, the loop also makes Stripe API calls (`stripe.transfers.create`) and potential `pendingPayouts` inserts, so the total round-trips per creator can be 2-3.

**Fix:** Batch-fetch all creator Connect accounts before the loop using `inArray(stripeConnectAccounts.userId, creatorIds)` and build a lookup map.

#### MEDIUM: `TierService.reorderTiers()` -- 2N sequential UPDATE queries

**File:** `packages/subscription/src/services/tier-service.ts:354-371`

The two-phase reorder executes `2 * tierIds.length` sequential UPDATE queries inside a transaction:

```typescript
// Phase 1: Move all to high temp values
for (const [i, tierId] of tierIds.entries()) {
  await tx.update(subscriptionTiers).set({ sortOrder: 10000 + i + 1 })...;
}
// Phase 2: Set to final values
for (const [i, tierId] of tierIds.entries()) {
  await tx.update(subscriptionTiers).set({ sortOrder: i + 1, updatedAt: new Date() })...;
}
```

For 5 tiers, this is 10 sequential UPDATE queries. The two-phase approach is necessary to avoid unique constraint violations, but each phase could use a single `CASE WHEN` statement instead of individual UPDATEs.

**Practical note (Pass 3):** Subscription tiers are expected to be in single digits per org (typically 3-5). At 10 queries for 5 tiers within a transaction, latency is ~50-100ms total. This is a code quality issue more than a performance issue. The bigger concern is the `uq_subscription_tiers_org_sort` constraint including soft-deleted rows (separate finding).

**Fix:** Use `sql` tagged template with a CASE expression:
```sql
UPDATE subscription_tiers
SET sort_order = CASE id WHEN $1 THEN 10001 WHEN $2 THEN 10002 ... END
WHERE id IN ($1, $2, ...)
```

#### MEDIUM: `PurchaseService.createCheckoutSession()` -- content query lacks status check in WHERE

**File:** `packages/purchase/src/services/purchase-service.ts:139-144`

```typescript
const contentRecord = await this.db.query.content.findFirst({
  where: and(
    eq(content.id, validated.contentId),
    isNull(content.deletedAt)
  ),
});
```

This query checks `deletedAt` but does not include `eq(content.status, 'published')` in the WHERE clause. The status check happens in application code at line 165. Moving it into the query would be more efficient and defensive.

#### MEDIUM: Admin re-fetch queries after mutation lack soft-delete filter

**File:** `packages/admin/src/services/content-management-service.ts:184, 249, 273`

After publishing/unpublishing content, the admin service re-fetches with:
```typescript
const updated = await tx.query.content.findFirst({
  where: eq(schema.content.id, contentId),
});
```

This bare ID query is inside a transaction that already verified the content exists and is not deleted, so it is not a security issue in practice. However, it violates the project's mandatory scoping rule.

#### LOW: `AdminAnalyticsService.getCustomerStats()` uses raw SQL CTE

**File:** `packages/admin/src/services/analytics-service.ts:160-173`

The raw SQL CTE for "new customers" is parameterized (safe from injection), but bypasses Drizzle's type system. The result requires a manual cast. This is acceptable for complex analytics queries but should be documented as an intentional exception. The `getRecentActivity()` method (lines 276-338) also uses substantial raw SQL with the same pattern.

#### LOW: `ContentAccessService.listUserLibrary()` -- merge sort pagination issue

**File:** `packages/access/src/services/ContentAccessService.ts:916-948`

When both purchased and membership sources have items, the method concatenates both result sets and trims to `input.limit`. However, each source already applied its own `LIMIT/OFFSET`, so for pages > 1 with both sources, the offset is applied independently per source. This means:
- Page 1: correct (both sources return first N items, merge takes top N)
- Page 2+: incorrect offsets when items interleave between sources

The code at line 894 detects single-source scenarios and short-circuits correctly, but the multi-source path remains problematic.

---

## 4. Scoping Compliance

### Summary

| Service | Scoping Approach | Compliant |
|---------|-----------------|-----------|
| `ContentService` | `scopedNotDeleted(content, creatorId)` on all queries | Yes |
| `MediaItemService` | `scopedNotDeleted(mediaItems, creatorId)` on all queries | Yes |
| `OrganizationService` | `whereNotDeleted(organizations)` (no creatorId on orgs) | Yes |
| `IdentityService` | `eq(users.id, userId)` + `whereNotDeleted(users)` | Yes |
| `PurchaseService` | Mixed -- checkout uses `isNull(deletedAt)`, purchase queries scope by `customerId` | Partial |
| `ContentAccessService` | Scopes by `userId` for playback, by `status`+`deletedAt` for content | Yes |
| `AdminAnalyticsService` | Scopes by `organizationId` | Yes |
| `AdminContentManagementService` | Scopes by `organizationId` + `isNull(deletedAt)` on initial fetch, bare ID on re-fetch | Partial |
| `AdminCustomerManagementService` | Scopes by `organizationId`, bare ID on user lookups | Partial |
| `SubscriptionService` | Scopes by `userId` + `organizationId` for subscriptions | Yes |
| `TierService` | Scopes by `organizationId` + `isNull(deletedAt)` | Yes |
| `TranscodingService` | Queries `mediaItems` by ID (worker-auth, no user context) | N/A |

### Notable Unscoped Queries

1. `PurchaseService.getPurchase()` -- bare ID query (HIGH, discussed above)
2. `PurchaseService.completePurchase()` -- checks existing by `stripePaymentIntentId` only (correct -- idempotency check)
3. `AdminContentManagementService` -- re-fetch after mutation by bare ID (MEDIUM, within transaction)
4. `AdminCustomerManagementService.getCustomerDetails()` -- `eq(users.id, customerId)` without `whereNotDeleted()` (line 194, LOW)
5. `AdminCustomerManagementService.grantContentAccess()` -- content query at line 334 lacks `isNull(content.deletedAt)` filter
6. `TranscodingService` -- queries `mediaItems` by ID in webhook handler (correct -- worker-auth)

---

## 5. Transaction Usage

### Strengths

- **ContentService.create()**: Transaction wraps media validation + content insert.
- **ContentService.publish()**: Transaction wraps fetch + status validation + update. The UPDATE itself includes `withCreatorScope()` (line 497).
- **PurchaseService.completePurchase()**: Transaction wraps idempotency check + purchase insert + access grant.
- **OrganizationService.create()**: Transaction wraps org insert + owner membership creation.
- **ContentAccessService.getStreamingUrl()**: Read-only transaction with `isolation: 'read committed'` and `accessMode: 'read only'` for consistent snapshot during access verification.
- **TierService.reorderTiers()**: Uses transaction (line 354) for the two-phase sort order update, correctly preventing partial reorder.

### Issues

#### LOW: `IdentityService.upgradeToCreator()` -- username check + role update not in transaction

**File:** `packages/identity/src/services/identity-service.ts:347-416`

The method checks for username uniqueness (line 363) and then updates the user's role (line 376) in separate queries, not wrapped in a transaction. A race condition could allow two users to claim the same username simultaneously. The DB's unique constraint on `username` catches this (causing an error), but a transaction with serializable isolation would be cleaner.

#### LOW: `OrganizationService.update()` -- UPDATE uses bare ID within transaction

**File:** `packages/organization/src/services/organization-service.ts:203-210`

```typescript
const [updated] = await tx.update(organizations)
  .set({ ...validated, updatedAt: new Date() })
  .where(eq(organizations.id, id))
  .returning();
```

The existence check earlier in the transaction verified the org is not deleted, but the UPDATE itself uses only `eq(id)`. Adding `whereNotDeleted()` to the UPDATE WHERE clause would prevent race conditions with concurrent soft-deletes.

#### LOW: `TierService.deleteTier()` -- not wrapped in a transaction

**File:** `packages/subscription/src/services/tier-service.ts:252-291`

The method checks for active subscribers, soft-deletes the tier, and archives the Stripe Product in three separate operations. If the Stripe API call fails after the DB update, the tier is deleted locally but not archived in Stripe. Using a transaction for the DB portion and handling Stripe as fire-and-forget (or retry) would be more robust.

---

## 6. Pagination

### Strengths

- **Consistent `withPagination()` usage**: Nearly all list methods use the helper for offset calculation.
- **`PaginatedResult` pattern**: Workers return `new PaginatedResult(items, pagination)` and `procedure()` wraps correctly.
- **Count queries run in parallel**: Most list methods run `Promise.all([items, count])`. Verified for `getPublicCreators()` -- the count and members queries are both arguments to the same `Promise.all` call.

### Issues

#### LOW: `PurchaseService.getPurchaseHistory()` -- manual offset calculation

**File:** `packages/purchase/src/services/purchase-service.ts:493`

```typescript
const offset = (validated.page - 1) * validated.limit;
```

This manually calculates offset instead of using `withPagination()`. Functionally identical, but inconsistent.

#### LOW: `AdminAnalyticsService.getRecentActivity()` -- manual offset calculation

**File:** `packages/admin/src/services/analytics-service.ts:265`

Same pattern: `const offset = (page - 1) * limit;` instead of `withPagination()`.

#### INFO: No unbounded queries found

All list methods have default pagination (typically `PAGINATION.DEFAULT`). No `findMany()` calls lack a `limit` parameter. The `TierService.listTiers()` and `listAllTiers()` methods are unbounded, but tiers per org are expected to be in single digits.

---

## 7. Caching (`@codex/cache`)

### Strengths

- **Graceful degradation**: `VersionedCache` falls back to the fetcher on any KV error, never failing the request (versioned-cache.ts:150-158).
- **Fire-and-forget writes**: Cache writes don't block responses (line 137).
- **Version-based invalidation**: Single atomic operation (`invalidate()`) makes all entries stale. No need to track keys.
- **Consistent invalidation after DB writes**: `ContentService.publish()`, `update()`, `unpublish()` and `AdminContentManagementService.publishContent()`, `unpublishContent()` all invalidate relevant cache keys.
- **`getWithResult()` variant**: Returns hit/miss status for monitoring (used by IdentityService).

### Issues

#### MEDIUM: `IdentityService.uploadAvatar()` -- cache invalidation uses bare `userId` instead of `CacheType`

**File:** `packages/identity/src/services/identity-service.ts:74`

```typescript
await this.cache.invalidate(userId);
```

This works because all user cache entries share the same version key (keyed by `userId`). However, the `get()`/`getWithResult()` calls elsewhere use `CacheType.USER_PROFILE` and `CacheType.USER_PREFERENCES` as the type parameter. The inconsistency is cosmetic (invalidation is by ID, not by type), but could confuse developers who expect `invalidate()` to take a `CacheType` argument.

Note: `updateProfile()` (line 304) and `upgradeToCreator()` (line 399) also call `this.cache.invalidate(userId)` with the same pattern. This is correct -- `invalidate(id)` bumps the version for that ID, which affects all types. The API surface is just not obvious.

#### LOW: `ContentService` -- cache invalidation via `void` prefix

**File:** `packages/content/src/services/content-service.ts:324-329`

```typescript
void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
```

Using `void` means invalidation errors are silently discarded at the call site. The `VersionedCache.invalidate()` method already catches errors internally (line 253-260), so this is doubly safe. But the `void` prefix makes it non-obvious that errors are handled.

#### INFO: Organization branding is not KV-cached in services

`PlatformSettingsFacade` queries the database directly for branding/contact/feature settings. The CLAUDE.md mentions "org branding (30min)" caching as a goal, but the implementation does not use `VersionedCache`. This is a performance gap for org landing pages which hit the DB on every request.

---

## 8. Client-Side Data Layer (TanStack DB Collections)

### Strengths

- **Browser guards on all localStorage collections**: `progressCollection` and `libraryCollection` both check `browser` before creation and return `undefined` on the server.
- **SSR-safe `useLiveQuery` wrapper**: Returns static `ssrData` during SSR, delegates to real implementation on client. The implementation (use-live-query-ssr.ts) correctly handles all three overload signatures with runtime discrimination (lines 133-145).
- **Reconciliation pattern**: `loadLibraryFromServer()` (library.ts:67-97) correctly upserts fresh items and removes stale ones by tracking existing keys.
- **Progress merge conflict resolution**: `mergeServerProgress()` (progress.ts:164-228) correctly handles local unsynced changes vs server updates from other devices, using position comparison. The logic is: unsynced local wins, synced local defers to server if server position is further.
- **Sync-to-server pattern**: `progressCollection` marks entries as `syncedAt: null` on local update, syncs in background.
- **Robust sync lifecycle**: `progress-sync.ts` correctly handles tab visibility, beforeunload (with `sendBeacon` fallback), and 30-second intervals. The `initProgressSync` function prevents double-initialization with user ID tracking (line 103).

### Issues

#### LOW: `contentCollection` loads all published content without pagination

**File:** `apps/web/src/lib/collections/content.ts:43-51`

```typescript
queryFn: async () => {
  const result = await listContent({ status: 'published' });
  return result?.items ?? [];
},
```

This loads published content into the client-side collection. The underlying API call uses a default page size, but the collection query function doesn't handle loading additional pages. As the content catalogue grows, only the first page will be in the collection.

**Pass 3 assessment:** This is intentional for now -- `contentCollection` is QueryClient-backed (session-only, not localStorage), and the first page provides enough data for initial rendering. Additional pages are loaded via server-side pagination in `+page.server.ts`. However, if a live query filters the collection client-side, items beyond page 1 will be invisible.

#### LOW: `hydrateIfNeeded` is a no-op on return visits for localStorage collections

**File:** `apps/web/src/lib/collections/hydration.ts:93-102`

```typescript
export function hydrateIfNeeded<T>(collection: CollectionKey, data: T[]): boolean {
  if (isCollectionHydrated(collection)) {
    return false;
  }
  hydrateCollection(collection, data);
  return true;
}
```

For localStorage-backed collections (library), `isCollectionHydrated` checks `state.size > 0`. On return visits, localStorage already has data, so server-side data from `+page.server.ts` is silently discarded. This is documented as intentional (hydration.ts comment, apps/web/CLAUDE.md gotcha #4), but means the only path for fresh server data to enter the library collection is via `invalidateCollection('library')` triggered by version staleness.

**Risk:** If the version invalidation mechanism has a bug (e.g., KV returns stale versions), the library collection could display stale data indefinitely. The mitigation is the `visibilitychange` handler in `(platform)/+layout.svelte` which re-runs the server load on tab return.

#### INFO: `progressCollection` has no size limit

Playback progress accumulates in localStorage indefinitely. Over time, a heavy user could accumulate hundreds of progress entries. Consider adding a cleanup mechanism for entries older than N days.

---

## 9. Connection Management

### Strengths

- **HTTP client for read-only operations**: `AdminAnalyticsService` correctly uses `createDbClient(env)` (HTTP) since it only performs aggregation queries (service-registry.ts:439).
- **Shared per-request WebSocket client**: The service registry's `getSharedDb()` creates one WebSocket pool and shares it across all services that need transactions (service-registry.ts:111-117).
- **Cleanup tracking**: The registry tracks all cleanup functions and runs them via `waitUntil()`.
- **Per-request isolation in Workers**: `createPerRequestDbClient` creates a fresh Pool per request with a cleanup function, preventing cross-request state leakage in the Cloudflare Workers isolate model.

### Issues

#### MEDIUM: `ContentAccessService` duplicates the WebSocket connection

**File:** `packages/worker-utils/src/procedure/service-registry.ts:207-214`

```typescript
get access() {
  if (!_access) {
    const result = createContentAccessService(env);
    _access = result.service;
    cleanupFns.push(result.cleanup);
  }
  return _access;
},
```

`createContentAccessService()` at `packages/access/src/services/ContentAccessService.ts:1031` internally calls `createPerRequestDbClient(env)`, creating a second WebSocket pool. Other services share `getSharedDb()`. A request touching both `content` and `access` services opens two database connections.

Additionally, `createContentAccessService()` also creates its own `PurchaseService` (line 1035) and `Stripe` client (line 1034), separate from the registry's `purchase` service. This means two Stripe client instances and two PurchaseService instances could coexist.

**Fix:** Refactor `ContentAccessService` to accept an injected `db` and `PurchaseService` from the registry.

#### LOW: `Pool` created with no explicit size configuration

**File:** `packages/database/src/client.ts:166, 258`

```typescript
_pool = new Pool({ connectionString: dbUrl });
// and
const pool = new Pool({ connectionString: dbUrl });
```

The Neon serverless `Pool` defaults to 10 connections when no `max` is specified. In Cloudflare Workers, each `createPerRequestDbClient` creates a fresh Pool that is closed after the request. The default of 10 is generous for a single request -- typically only 1-2 connections are used. Setting `max: 1` or `max: 2` for per-request pools would be more resource-efficient and prevent potential connection exhaustion on the Neon side.

For the module-level `_pool` (used by `dbWs` in tests/dev), the default of 10 is reasonable.

**Risk:** In production, each Worker request creates a per-request Pool with default `max: 10`. If Neon has a connection limit of 100 (common on free/starter plans) and 10+ concurrent requests arrive, each reserves up to 10 connection slots, potentially exhausting the pool. In practice, only 1-2 connections per request are used, but the reservation exists.

**Fix:** Set `max: 2` on per-request pools: `new Pool({ connectionString: dbUrl, max: 2 })`.

#### INFO: Module-level proxy singletons for `dbHttp` and `dbWs`

**File:** `packages/database/src/client.ts:92-117, 203-212`

The `dbHttp` and `dbWs` exports use Proxy objects backed by module-level singletons. In Cloudflare Workers (isolate model), this is safe for `dbHttp` (stateless HTTP). The codebase correctly uses `createPerRequestDbClient()` for production WebSocket needs, avoiding stale connection state.

---

## 10. Soft Deletes

### Strengths

- **No hard deletes in service code**: All service `delete()` methods set `deletedAt = new Date()`. The `db.delete()` calls found are only in test utilities (`packages/test-utils/src/database.ts` and `packages/worker-utils/src/test-utils.ts`).
- **`whereNotDeleted()` consistently applied**: The query helper is used throughout service code.
- **Soft delete in subscription domain**: `TierService.deleteTier()` (line 273) correctly sets `deletedAt` and also sets `isActive: false` as a belt-and-suspenders approach.

### Issues

#### MEDIUM: Four unique constraints do not exclude soft-deleted rows

This is a systemic issue. The following unique constraints block reuse after soft-delete:

| Table | Constraint | Columns | Should Filter `deleted_at IS NULL`? |
|-------|-----------|---------|-------------------------------------|
| `content` | `idx_unique_content_slug_per_org` | `(slug, organization_id)` | Yes -- blocks slug reuse |
| `content` | `idx_unique_content_slug_personal` | `(slug, creator_id)` | Yes -- blocks slug reuse |
| `organizations` | `organizations_slug_unique` | `(slug)` | Yes -- blocks slug reuse (subdomains) |
| `users` | `users_username_unique` | `(username)` | Yes -- blocks username reuse |
| `subscription_tiers` | `uq_subscription_tiers_org_sort` | `(organization_id, sort_order)` | Yes -- blocks sort order reuse |

Compare with the email template indexes which correctly use `deleted_at IS NULL`:
```typescript
uniqueIndex('idx_unique_template_global')
  .on(table.name)
  .where(sql`${table.scope} = 'global' AND ${table.deletedAt} IS NULL`),
```

**Fix:** Create a migration that drops and recreates all five constraints as partial unique indexes with the `deleted_at IS NULL` filter. This should be done in a single migration for consistency.

#### INFO: `organizationMemberships` uses status-based soft delete

Memberships use `status: 'inactive'` rather than a `deletedAt` column. The `removeMember()` method correctly sets `status: 'inactive'`. This is a valid pattern but differs from the rest of the codebase.

---

## 11. Foreign Key Design

### Strengths

- **Comprehensive FK coverage**: Every relationship is backed by a database-level foreign key. No orphaned references rely solely on application code.
- **Deliberate `onDelete` strategy**:
  - `CASCADE` for auth/identity data (accounts, sessions tied to users)
  - `CASCADE` for org-scoped data (memberships, settings, Connect accounts)
  - `RESTRICT` for financial records (purchases to content, subscriptions to tiers)
  - `SET NULL` for optional references (content.organizationId, content.mediaItemId, membership.invitedBy)
- **Migration 0003 correction**: FK actions were deliberately changed from `no action` to the correct domain-specific actions, showing evolving design awareness.

### Issues

#### INFO: `CASCADE` on `subscriptions.userId` could delete financial records

**File:** `packages/database/src/schema/subscriptions.ts:95`

```typescript
userId: text('user_id')
  .notNull()
  .references(() => users.id, { onDelete: 'cascade' }),
```

If a user is hard-deleted, all their subscription records cascade-delete. Since subscriptions contain financial data (revenue splits, amounts), this could destroy audit trails. However, the codebase uses soft deletes (setting `deletedAt`) rather than hard deletes, so `CASCADE` never actually fires for users. The `purchases` table also uses `CASCADE` on `customerId` (ecommerce.ts:231) with the same reasoning.

This is safe given the soft-delete discipline, but if a hard-delete path is ever added (e.g., GDPR erasure), the cascade would need to be changed to `RESTRICT` or `SET NULL` to preserve financial records.

---

## 12. Data Type Consistency

### Summary

| Type | Used By | Count | Notes |
|------|---------|-------|-------|
| `uuid` PK | All domain tables | 20+ | `uuid('id').primaryKey().defaultRandom()` |
| `text` PK | Auth tables | 4 | `text('id').primaryKey()` (BetterAuth) |
| `integer` PK | Test table | 1 | `integer().primaryKey().generatedAlwaysAsIdentity()` |
| `uuid` FK | Organization, content, ecommerce | 15+ | Consistent |
| `text` FK | User references | 10+ | Matches `users.id` type |
| `timestamp` (tz) | All domain tables | 60+ | `{ withTimezone: true }` |
| `timestamp` (no tz) | Auth tables, users | 11 | Missing `withTimezone` |
| `integer` (cents) | Financial columns | 12+ | Consistent GBP pence |
| `varchar` (enums) | Status/type columns | 15+ | All with CHECK constraints |

The type system is generally consistent. The two inconsistencies are:
1. Auth/users timestamps lack `withTimezone` (LOW, cosmetic)
2. Auth/users PKs use `text` while domain tables use `uuid` (inherent to BetterAuth, documented)

---

## Recommendations (Prioritized by Impact)

### HIGH Priority

1. **Fix `OrganizationService.getPublicCreators()` visibility filter** -- Replace `eq(content.visibility, 'public')` with `eq(content.status, 'published')` at line 439. This is an active bug causing creator content counts to always be 0. (`packages/organization/src/services/organization-service.ts:439`)

2. **Fix `PurchaseService.getPurchase()` scoping** -- Add `customerId` to the WHERE clause. Return 404 for both "not found" and "not authorized". (`packages/purchase/src/services/purchase-service.ts:603`)

3. **Add partial unique index for active subscriptions** -- Create `idx_subscriptions_user_org_active` as a unique index on `(user_id, organization_id)` WHERE `status IN ('active', 'past_due', 'cancelling')`. This enforces the one-active-per-user-per-org invariant at the DB level, closing the webhook race window. (`packages/database/src/schema/subscriptions.ts`)

### MEDIUM Priority

4. **Fix all unique constraints to exclude soft-deleted rows** -- Create a single migration that replaces all 5 unique constraints (content slug x2, org slug, username, tier sort order) with partial unique indexes filtered by `deleted_at IS NULL`. Use the email template indexes as the reference pattern. (`packages/database/src/schema/content.ts`, `users.ts`, `subscriptions.ts`)

5. **Complete `visibility` column deprecation** -- Remove `visibility` filter from `ContentService.list()` (line 672-673), remove from `ContentForm.svelte` (line 95), remove `visibilityEnum` from validation, then drop the column in a migration. The `accessType` column and migration 0041's backfill make `visibility` fully redundant.

6. **Escape LIKE wildcards in search queries** -- Apply `input.replace(/%/g, '\\%').replace(/_/g, '\\_')` pattern from ContentAccessService to ContentService, OrganizationService, and AdminCustomerManagementService.

7. **Deduplicate `ContentAccessService` DB connection** -- Refactor to accept an injected database client and PurchaseService from the service registry. (`packages/access/src/services/ContentAccessService.ts:991-1044`, `packages/worker-utils/src/procedure/service-registry.ts:207-214`)

8. **Batch Connect account lookups in `SubscriptionService.executeTransfers()`** -- Use `inArray()` to fetch all creator Connect accounts in one query before the loop. (`packages/subscription/src/services/subscription-service.ts:940-957`)

9. **Add composite index for library query** -- Create `idx_purchases_customer_status_content` on `(customer_id, status, content_id)`.

10. **Clean up orphan migration files** -- Either add `0020_fix_transcoding_constraints.sql` and `0007_seed_platform_fee_config.sql` to the journal or delete them. Verify `platform_fee_config` has the seed row in all environments.

11. **Add soft-delete filter to admin re-fetch queries** -- Add `isNull(schema.content.deletedAt)` to re-fetch queries in AdminContentManagementService.

### LOW Priority

12. **Set `max: 2` on per-request WebSocket pools** -- Prevents over-reservation of Neon connection slots. (`packages/database/src/client.ts:258`)

13. **Batch `TierService.reorderTiers()` UPDATEs** -- Replace 2N sequential UPDATEs with 2 CASE-based batch UPDATEs.

14. **Wrap `TierService.deleteTier()` in a transaction** -- Isolate DB operations from Stripe API calls.

15. **Add `withTimezone: true` to `users` and `auth` table timestamps** -- Align with all other schema definitions.

16. **Use `withPagination()` in `PurchaseService.getPurchaseHistory()` and `AdminAnalyticsService.getRecentActivity()`** -- For consistency.

17. **Implement KV caching for platform settings** -- Add cache-aside to `PlatformSettingsFacade` using `VersionedCache`.

18. **Add cleanup for `progressCollection`** -- Maximum entry count or age-based pruning for localStorage playback progress.

---

## Summary

The database layer is well-architected with strong patterns for scoping, soft deletes, transaction safety, and pagination. The schema design uses CHECK constraints extensively, and the revenue split integrity constraints are particularly impressive. The foreign key design is comprehensive and deliberate, with appropriate `onDelete` actions for each domain. The caching layer degrades gracefully and uses a clean version-based invalidation pattern.

**Pass 3 deepened the review in five areas:**

1. **Migration history** (42 migrations): No destructive operations found. Two orphan migration files (`0020_fix`, `0007_seed`) exist outside the Drizzle journal and should be cleaned up. The seed file for `platform_fee_config` is a risk -- verify the table has data in production.

2. **Index coverage**: Generally excellent, with 60+ indexes across all tables. The main gap is the library query path (`customer_id, status`). The subscription domain has good coverage for its query patterns.

3. **Foreign key constraints**: All relationships are enforced at the DB level. The `onDelete` strategy is deliberately differentiated by domain (cascade for session data, restrict for financial data, set null for optional references). One design note: `CASCADE` on financial tables is safe only because hard-deletes never occur.

4. **Data types**: Consistent `uuid` PKs across all domain tables, `text` PKs for BetterAuth tables. All financial amounts use `integer` cents consistently. The only inconsistency is `withTimezone` on auth/user timestamps.

5. **TanStack DB collections**: The SSR-safe wrapper, localStorage-backed collections, and progress sync lifecycle are all well-implemented. The `hydrateIfNeeded` no-op on return visits is intentional (documented) and safe given the version staleness mechanism. The main concern is `contentCollection` loading only the first page.

The most impactful new finding is the missing unique constraint on `subscriptions(user_id, organization_id)` for active subscriptions -- this is a data integrity gap that should be addressed before the subscription feature sees significant traffic. The systemic soft-delete-ignoring unique constraints (5 tables) should be fixed in a single coordinated migration.
