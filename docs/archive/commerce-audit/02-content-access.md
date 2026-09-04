# Content Access & Entitlements Audit

**Date**: 2026-04-10
**Scope**: `@codex/access`, `@codex/purchase` (processRefund), `content-api` routes, database schema
**Files audited**: 14 source files, 3 schema files, 2 route files, 1 subscription service

---

## Overview

The content access system controls who can stream/view content. It has four access models defined in `CONTENT_ACCESS_TYPE` (packages/constants/src/content.ts:55-60):

| Access Type | Meaning | Gating mechanism |
|---|---|---|
| `free` | Anyone can access | `priceCents` is null/0 |
| `paid` | One-time purchase required | `priceCents > 0` |
| `subscribers` | Subscription tier required | `minimumTierId` set |
| `members` | Org team members only | Org membership check |

### Key Files

| File | Purpose |
|---|---|
| `packages/access/src/services/ContentAccessService.ts` | Main access check logic, streaming URLs, library, playback |
| `packages/access/src/errors.ts` | AccessDeniedError, R2SigningError, etc. |
| `packages/access/src/types.ts` | Response type contracts |
| `packages/access/src/constants.ts` | Log events |
| `workers/content-api/src/routes/content-access.ts` | HTTP routes for access endpoints |
| `workers/content-api/src/index.ts` | Route mounting |
| `packages/database/src/schema/ecommerce.ts` | content_access table, purchases table |
| `packages/database/src/schema/content.ts` | content table with accessType, minimumTierId |
| `packages/database/src/schema/subscriptions.ts` | subscriptions table |
| `packages/database/src/schema/playback.ts` | video_playback table |
| `packages/purchase/src/services/purchase-service.ts` | completePurchase (creates access), processRefund |
| `packages/subscription/src/services/subscription-service.ts` | Subscription lifecycle (no access grant) |
| `packages/admin/src/services/customer-management-service.ts` | Complimentary access grants |

### Access Grant Points (INSERT into content_access)

1. **PurchaseService.completePurchase()** -- `purchase-service.ts:433` -- accessType='purchased'
2. **CustomerManagementService.grantContentAccess()** -- `customer-management-service.ts:381` -- accessType='complimentary'
3. **Test fixtures** -- `customer-management-service.test.ts:754`

**Notable absence**: No code inserts content_access rows for subscriptions. Subscription access is checked dynamically at streaming time.

---

## Access Decision Algorithm (getStreamingUrl)

File: `packages/access/src/services/ContentAccessService.ts`, lines 176-486

```
getStreamingUrl(userId, { contentId, expirySeconds })
  |
  +-- 1. BEGIN READ-ONLY TRANSACTION (read committed) [line 193]
  |
  +-- 2. Fetch content record (published, not deleted) with mediaItem [line 196-205]
  |     |-- NOT FOUND -> ContentNotFoundError [line 213]
  |     |-- No mediaItem -> ContentNotFoundError [line 221]
  |
  +-- 3. ACCESS CHECK (branching on accessType + priceCents)
  |     |
  |     +-- Branch A: accessType === 'members' [line 227]
  |     |   |-- No organizationId -> AccessDeniedError [line 229]
  |     |   |-- Check org membership (active) [line 233-245]
  |     |   |-- No membership -> AccessDeniedError [line 256]
  |     |   |-- Has membership -> GRANTED [line 262]
  |     |
  |     +-- Branch B: priceCents > 0 (ELSE IF) [line 272]
  |     |   |-- Check purchase via PurchaseService.verifyPurchase [line 274]
  |     |   |-- Has purchase -> GRANTED [line 279]
  |     |   |-- No purchase:
  |     |       |-- Check subscription (IF minimumTierId AND organizationId) [line 288]
  |     |       |   |-- Find active/cancelling sub with currentPeriodEnd > now [line 289-298]
  |     |       |   |-- Compare tier sortOrder [line 312-315]
  |     |       |   |-- Tier sufficient -> GRANTED [line 316]
  |     |       |-- No subscription access:
  |     |           |-- No organizationId -> AccessDeniedError [line 344]
  |     |           |-- Check org membership (active) [line 351-357]
  |     |           |-- No membership -> AccessDeniedError [line 372]
  |     |           |-- Has membership -> GRANTED [line 378]
  |     |
  |     +-- Branch C: ELSE (priceCents is null/0 = free) [line 386]
  |         |-- GRANTED [line 387]
  |
  +-- 4. Media readiness check (status === 'ready') [line 394]
  |     |-- Not ready -> MediaNotReadyForStreamingError [line 400]
  |
  +-- 5. Extract HLS master playlist key [line 408]
  |     |-- Missing key -> R2SigningError [line 416]
  |
  +-- 6. Validate media type (video/audio) [line 427]
  |     |-- Invalid -> InvalidContentTypeError [line 437]
  |
  +-- 7. END TRANSACTION, return { r2Key, mediaType } [line 441-450]
  |
  +-- 8. Generate signed R2 URL (OUTSIDE transaction) [line 454]
  |     |-- Signing error -> R2SigningError [line 481]
  |
  +-- 9. Return { streamingUrl, expiresAt, contentType } [line 467]
```

---

## Bugs Found

### [BUG-ACC-001] No explicit `accessType === 'subscribers'` branch -- subscribers-only content treated as free

- **Severity**: Critical
- **File**: `packages/access/src/services/ContentAccessService.ts:227-390`
- **Description**: The access check branches on `accessType === 'members'` (line 227) and then `priceCents > 0` (line 272). Content with `accessType = 'subscribers'` and `priceCents = null/0` (subscription-only, no buy-bypass) falls through to the ELSE branch at line 386 ("Free content - access granted"). Any unauthenticated-but-logged-in user can stream subscription-only content for free.
- **Impact**: **All subscription-only content is accessible to any authenticated user** without a subscription. Complete bypass of the subscription paywall for content that has no price set.
- **Root Cause**: The algorithm uses `priceCents > 0` as a proxy for "is this gated content?" but the `subscribers` access type can have `priceCents = null` (pure subscription gating). The `accessType` field is only checked for `'members'`, not `'subscribers'`.
- **Fix**: Add an explicit branch before the priceCents check:
  ```typescript
  // After the 'members' branch (line 271), add:
  else if (contentRecord.accessType === 'subscribers') {
    // Check subscription tier first
    let hasAccess = false;
    if (contentRecord.minimumTierId && contentRecord.organizationId) {
      // ... existing subscription check logic (lines 289-324)
    }
    // Fall back to purchase if priceCents > 0 (buy-bypass)
    if (!hasAccess && contentRecord.priceCents && contentRecord.priceCents > 0) {
      hasAccess = await this.purchaseService.verifyPurchase(input.contentId, userId);
    }
    // Fall back to org membership
    if (!hasAccess) {
      // ... existing membership check
    }
    if (!hasAccess) throw new AccessDeniedError(...);
  }
  ```

### [BUG-ACC-002] Subscription access skipped when minimumTierId is null

- **Severity**: High
- **File**: `packages/access/src/services/ContentAccessService.ts:288`
- **Description**: The subscription check is gated by `if (contentRecord.minimumTierId && contentRecord.organizationId)`. If a creator sets `accessType = 'subscribers'` but forgets to set `minimumTierId`, subscription access is completely skipped and falls through to the membership/denied path. This is a data integrity issue but the code should handle it gracefully rather than silently skipping.
- **Impact**: Subscribers with valid subscriptions are denied access to content the creator intended for subscribers, if the minimumTierId was not set. The creator gets bug reports they cannot diagnose.
- **Root Cause**: No validation that `accessType = 'subscribers'` requires `minimumTierId` to be non-null. The access check silently skips subscription verification.
- **Fix**: Two-pronged:
  1. Add a database CHECK constraint: `CHECK (access_type != 'subscribers' OR minimum_tier_id IS NOT NULL)`
  2. In the access service, if `accessType === 'subscribers'` and `minimumTierId` is null, log an error and treat it as "any active subscription grants access" rather than silently denying.

### [BUG-ACC-003] `content_access.deletedAt` referenced but does not exist in schema

- **Severity**: Critical (runtime error on refund)
- **File**: `packages/purchase/src/services/purchase-service.ts:696-705` (processRefund) / `packages/database/src/schema/ecommerce.ts:24-75` (schema)
- **Description**: `processRefund()` at line 698 does `.set({ deletedAt: new Date() })` on `contentAccess` and line 703 checks `isNull(contentAccess.deletedAt)`. However, the `contentAccess` table schema (ecommerce.ts:24-75) has NO `deletedAt` column. The columns are: id, userId, contentId, organizationId, accessType, expiresAt, createdAt, updatedAt.
- **Impact**: Every refund operation will fail with a database error ("column deletedAt does not exist"). **Refunds are completely broken.** This means once a user purchases content, their access cannot be revoked through Stripe refunds.
- **Root Cause**: The processRefund code was written assuming soft-delete semantics, but content_access uses hard-delete semantics (row exists = access granted). The prior code review (docs/code-review/05-database.md:216-218) documented this mismatch but it was never fixed.
- **Fix**: Either:
  - (A) Add `deletedAt` column to content_access schema (aligns with codebase soft-delete convention), OR
  - (B) Change processRefund to hard-delete: `await this.db.delete(contentAccess).where(...)` -- but this violates the codebase soft-delete rule.
  - **Recommended**: Option A -- add `deletedAt` column + migration.

### [BUG-ACC-004] Library listing excludes subscription-based content entirely

- **Severity**: High
- **File**: `packages/access/src/services/ContentAccessService.ts:581-937`
- **Description**: `listUserLibrary()` has two data sources: `queryPurchased()` (lines 683-778) queries the purchases table, and `queryMembership()` (lines 781-870) queries content in orgs where the user has an active organizationMembership. Neither source includes content accessible via subscription. The library `accessType` enum in the validation schema (packages/validation/src/schemas/access.ts:53-56) only has `'purchased' | 'membership'` -- no `'subscription'` option.
- **Impact**: A subscriber who pays monthly for content access will see an empty library (unless they also purchased individual items or are org team members). They have to navigate to each org page to find content they are paying to access.
- **Root Cause**: The library query was designed before subscriptions existed. It needs a third data source that queries content where the user has an active subscription to the content's org with a sufficient tier.
- **Fix**: Add a `querySubscription()` function that:
  1. Finds all active subscriptions for the user (with their tier sortOrder)
  2. Queries content where `minimumTierId` tier has `sortOrder <= user's tier sortOrder`
  3. Returns items with `accessType: 'subscription'`
  4. Add `'subscription'` to the `UserLibraryItem.accessType` union and the validation schema enum.

### [BUG-ACC-005] content_access unique constraint blocks re-purchase after refund

- **Severity**: High
- **File**: `packages/database/src/schema/ecommerce.ts:70-74` / `packages/purchase/src/services/purchase-service.ts:433-438`
- **Description**: The `content_access_user_content_unique` constraint on `(userId, contentId)` means only one access row can exist per user per content. When `processRefund()` attempts to soft-delete (BUG-ACC-003), and even if fixed to hard-delete the row, the flow is:
  1. Purchase: insert content_access row
  2. Refund: delete content_access row (if fixed)
  3. Re-purchase: insert content_access row -- this works if the prior row is deleted
  BUT: If processRefund is currently broken (BUG-ACC-003 -- the update sets a nonexistent column), the old row persists. The re-purchase `completePurchase()` at line 433 will fail with a unique constraint violation because the old row still exists. The purchases table explicitly allows re-purchase (no unique constraint on customerId+contentId, per comment at line 352-354), but content_access does not.
- **Impact**: After a refund, users cannot re-purchase the same content. The Stripe checkout completes, money is charged, but `completePurchase()` fails with a DB constraint error. The user is charged but gets no access.
- **Root Cause**: Mismatch between purchases table (allows multiple records per user+content) and content_access table (unique per user+content), combined with broken refund revocation.
- **Fix**: In `completePurchase()`, use `onConflictDoUpdate` for the content_access insert:
  ```typescript
  await tx.insert(contentAccess).values({...})
    .onConflictDoUpdate({
      target: [contentAccess.userId, contentAccess.contentId],
      set: {
        accessType: ACCESS_TYPES.PURCHASED,
        expiresAt: null,
        updatedAt: new Date(),
      },
    });
  ```
  This handles both fresh grants and re-grants after refund.

### [BUG-ACC-006] No organizationMemberships row created for subscribers

- **Severity**: Medium
- **File**: `packages/subscription/src/services/subscription-service.ts:219-294` (handleSubscriptionCreated)
- **Description**: When a subscription is created via `handleSubscriptionCreated()`, a `subscriptions` table row is inserted (line 260-277). However, no `organizationMemberships` row is created for the subscriber. The access check's membership fallback path (ContentAccessService.ts:351-357) checks `organizationMemberships` -- but subscribers are not members.
- **Impact**: The org membership fallback in the access algorithm cannot rescue a subscriber. This is not a direct access failure (the subscription check at line 289 should handle it), but it means subscribers are invisible to org membership queries, cannot appear in "members" lists, and any feature that relies on membership to determine "is this user affiliated with the org" will miss subscribers.
- **Root Cause**: Subscription creation and org membership are decoupled. The subscription service does not create a membership row with role='subscriber' (which IS a valid role in the CHECK constraint at content.ts:110-112).
- **Fix**: In `handleSubscriptionCreated()`, after inserting the subscription row, also upsert an `organizationMemberships` row:
  ```typescript
  await tx.insert(organizationMemberships).values({
    organizationId: orgId,
    userId,
    role: 'subscriber',
    status: 'active',
  }).onConflictDoNothing(); // Don't overwrite if they already have a higher role
  ```

### [BUG-ACC-007] No cache invalidation after subscription creation/cancellation

- **Severity**: Medium
- **File**: `packages/subscription/src/services/subscription-service.ts` (entire file -- no cache references)
- **Description**: When a subscription is created, updated, or cancelled, there is no cache invalidation. The platform uses `@codex/cache` VersionedCache for KV-backed caching. After `completePurchase()` there should be cache invalidation for the user's library version. The subscription service has zero cache references.
- **Impact**: After subscribing, a user may not see subscription-gated content until cache TTLs expire (up to 30 minutes for org config). The `listUserLibrary` response could be stale. If content versions are cached, the user sees stale access decisions.
- **Root Cause**: The subscription service was added after the caching layer but was not integrated with cache invalidation.
- **Fix**: Add VersionedCache invalidation to the subscription webhook handler (or the service itself). At minimum, invalidate:
  - User library cache after subscription creation/cancellation
  - Org content versions after subscription status change

### [BUG-ACC-008] Playback progress has no access verification

- **Severity**: Low
- **File**: `packages/access/src/services/ContentAccessService.ts:494-537` (savePlaybackProgress) / `workers/content-api/src/routes/content-access.ts:68-91`
- **Description**: `savePlaybackProgress()` accepts any `contentId` and `userId` without verifying that the user has access to that content. Any authenticated user can write playback progress for any content ID, including content they haven't purchased or subscribed to.
- **Impact**: Minor data pollution -- users could fabricate progress records for content they haven't watched. This is not a security issue (it doesn't grant access), but it means `listUserLibrary()` progress data could be misleading. Also, if library ever shows "continue watching" based on progress alone, it could show content the user cannot access.
- **Root Cause**: Progress saving was optimized for speed (no access check overhead) with the assumption that the frontend only sends progress for content being played, and the player requires a streaming URL (which does check access). However, the API endpoint is directly callable.
- **Fix**: Low priority. Either:
  - Add a lightweight access check to savePlaybackProgress, OR
  - Accept the trade-off and document it as intentional (progress is user-scoped and doesn't leak data).

---

## Improvements

### [IMP-ACC-001] Library merge-sort pagination is incorrect for multi-source queries

- **Severity**: Medium
- **File**: `packages/access/src/services/ContentAccessService.ts:872-936`
- **Description**: When both `queryPurchased()` and `queryMembership()` return items (the non-single-source path, line 882-936), both queries apply their own LIMIT/OFFSET to their respective data sources. The merge then takes the union and slices to `input.limit`. This produces incorrect results:
  - **Page 1**: Both sources fetch `LIMIT` items each from their first page. Merge works.
  - **Page 2+**: Both sources fetch `OFFSET + LIMIT` items from their respective sources, but the merged view's page 2 doesn't correspond to either source's page 2. Items may be duplicated or skipped across pages.
  - **Total count**: Line 907 `totalCount = purchaseResult.count + membershipResult.count` is correct, but the actual items on each page are wrong.
- **Impact**: Users browsing page 2+ of their library when they have both purchased and membership content will see incorrect/missing items.
- **Fix**: For the multi-source case, both queries should be issued WITHOUT offset (fetch all items up to a reasonable limit), merge-sort, then apply pagination to the merged result. Or use a UNION query in SQL.

### [IMP-ACC-002] Membership library query returns ALL org content, not just members-access content

- **Severity**: Medium
- **File**: `packages/access/src/services/ContentAccessService.ts:786-794`
- **Description**: The `queryMembership()` function includes ALL published content from orgs where the user is a member (line 787: `inArray(content.organizationId, memberOrgIds)`). It does not filter by `accessType`. This means free content from the org also appears as "membership" access type in the library, which is misleading -- free content is accessible to everyone, not just members.
- **Impact**: The library inflates the membership count with free content. Users see free content labeled as "membership" access, which is confusing. If the user's membership expires, they'd think they lost access to content that was always free.
- **Fix**: Add `eq(content.accessType, 'members')` or `inArray(content.accessType, ['members', 'subscribers'])` to the membership query conditions to only show content that actually requires membership/subscription.

### [IMP-ACC-003] Missing composite index for subscription access check

- **Severity**: Low
- **File**: `packages/database/src/schema/subscriptions.ts:151`
- **Description**: The access check at ContentAccessService.ts:289-298 queries: `subscriptions WHERE userId = ? AND organizationId = ? AND status IN ('active', 'cancelling') AND currentPeriodEnd > now()`. There is an index on `(userId, organizationId)` at line 151, but no covering index that includes `status` and `currentPeriodEnd`. The query planner must do a filter scan after the index lookup.
- **Impact**: Slight performance overhead on every subscription access check. Not critical at low volume but will matter at scale.
- **Fix**: Add a composite index: `index('idx_subscriptions_user_org_status_period').on(table.userId, table.organizationId, table.status, table.currentPeriodEnd)`

### [IMP-ACC-004] DevR2Signer returns predictable unsigned URLs

- **Severity**: Low (dev-only)
- **File**: `packages/access/src/services/ContentAccessService.ts:66-75`
- **Description**: The `DevR2Signer` returns `${baseUrl}/${r2Key}` with no signature or expiry. The `_expirySeconds` parameter is ignored. While this is fine for local development (Miniflare serves without auth), if dev-cdn is accidentally exposed, all content is accessible via predictable URLs.
- **Impact**: No production impact. Minor dev security concern if dev environment is exposed.
- **Fix**: Consider adding a token parameter even in dev mode for closer parity with production.

### [IMP-ACC-005] Streaming URL expiry not configurable per access type

- **Severity**: Low
- **File**: `packages/access/src/services/ContentAccessService.ts:454-458` / `packages/validation/src/schemas/access.ts:21-29`
- **Description**: The streaming URL expiry is configurable per request (default 3600s = 1 hour, max 7200s). However, there's no differentiation between access types. A subscriber's URL should arguably have a shorter expiry than a purchaser's URL (since subscription access can be revoked), but both get the same treatment.
- **Impact**: A subscriber who cancels mid-stream retains access until the signed URL expires (up to 2 hours). Not a significant revenue loss but technically incorrect access.
- **Fix**: Low priority. Could set different max expiry based on access type.

### [IMP-ACC-006] processRefund is not transactional

- **Severity**: Medium
- **File**: `packages/purchase/src/services/purchase-service.ts:669-716`
- **Description**: `processRefund()` performs two separate database operations: (1) update purchase status to 'refunded' (line 692-694), and (2) revoke content access (line 697-705). These are not wrapped in a transaction. If step 2 fails (and it WILL fail due to BUG-ACC-003), the purchase is marked as refunded but access remains.
- **Impact**: Partial refund state -- purchase shows "refunded" but user retains access. Combined with BUG-ACC-003, this means every refund leaves orphaned access.
- **Root Cause**: processRefund uses `this.db` (HTTP client) rather than a transaction. The method should use `this.db.transaction()`.
- **Fix**: Wrap both operations in a transaction. This also requires using the WebSocket DB client for transaction support.

### [IMP-ACC-007] content_access table is not used by the access check algorithm

- **Severity**: Medium (architecture debt)
- **File**: `packages/access/src/services/ContentAccessService.ts` (entire getStreamingUrl)
- **Description**: The `content_access` table exists and records are created on purchase (purchase-service.ts:433) and complimentary grants (customer-management-service.ts:381). However, `getStreamingUrl()` NEVER queries the content_access table. It checks access via: (1) PurchaseService.verifyPurchase (queries purchases table directly), (2) subscription check (queries subscriptions table directly), (3) org membership check (queries organizationMemberships directly). The content_access table is write-only -- no read path uses it for access decisions.
- **Impact**: The content_access table is dead weight. Complimentary access grants (via admin) are never checked by the streaming URL generator. An admin grants content access, but the user still gets AccessDeniedError because the access algorithm doesn't look at content_access.
- **Root Cause**: The access algorithm was built before the content_access table was fully integrated. It duplicates access logic instead of querying the single source of truth.
- **Fix**: Either:
  - (A) **Make content_access authoritative**: Refactor getStreamingUrl to check content_access first (for purchased/complimentary grants), then subscriptions, then membership. Insert subscription-based access rows on subscription creation.
  - (B) **Remove content_access**: If subscriptions/purchases/memberships are always checked dynamically, content_access serves no purpose. Remove it and use the existing tables as the source of truth.
  - **Recommended**: Option A -- it provides a unified access check, enables admin grants, and simplifies the algorithm.

---

## Work Packets

### WP-ACC-01: Fix Critical Access Check Algorithm (BUG-ACC-001 + BUG-ACC-002)

**Priority**: P0 -- Critical
**Effort**: 4-6 hours
**Dependencies**: None

**Scope**:
1. Refactor `getStreamingUrl()` access algorithm to branch on `contentRecord.accessType` first, not `priceCents`.
2. Add explicit `'subscribers'` branch that checks subscription tier, then falls back to purchase (if priceCents > 0), then membership.
3. Add explicit `'paid'` branch (current priceCents > 0 logic).
4. Handle edge case where `accessType = 'subscribers'` but `minimumTierId` is null (log error, treat as "any active sub grants access").
5. Use `CONTENT_ACCESS_TYPE` constants instead of string literals.

**Acceptance Criteria**:
- [ ] Content with `accessType='subscribers'` and `priceCents=null` requires active subscription
- [ ] Content with `accessType='subscribers'` and `priceCents > 0` allows either subscription OR purchase
- [ ] Content with `accessType='paid'` requires purchase, subscription, or membership (existing behavior)
- [ ] Content with `accessType='free'` grants access to all authenticated users
- [ ] Content with `accessType='members'` requires active org membership only
- [ ] Integration tests cover all four access types with all grant mechanisms
- [ ] No regression in existing streaming URL generation

### WP-ACC-02: Fix Refund Pipeline (BUG-ACC-003 + BUG-ACC-005 + IMP-ACC-006)

**Priority**: P0 -- Critical
**Effort**: 4-6 hours
**Dependencies**: None (can run in parallel with WP-ACC-01)

**Scope**:
1. Add `deletedAt` column to `content_access` table via migration.
2. Fix `processRefund()` to use the column correctly (already references it -- will work once column exists).
3. Wrap processRefund in a `db.transaction()`.
4. Change `completePurchase()` content_access insert to use `onConflictDoUpdate` to handle re-purchase after refund.
5. Ensure `content_access` queries throughout the codebase filter `WHERE deleted_at IS NULL` (add to admin query at customer-management-service.ts:368).

**Acceptance Criteria**:
- [ ] `deletedAt` column exists on `content_access` table
- [ ] Migration runs cleanly
- [ ] processRefund soft-deletes content_access row AND marks purchase as refunded, atomically
- [ ] Re-purchase after refund succeeds (onConflictDoUpdate restores access)
- [ ] Admin complimentary grant checks `deletedAt IS NULL`
- [ ] Integration test: purchase -> refund -> re-purchase -> access works end-to-end

### WP-ACC-03: Add Subscription Content to User Library (BUG-ACC-004)

**Priority**: P1 -- High
**Effort**: 6-8 hours
**Dependencies**: WP-ACC-01 (access algorithm must be correct first)

**Scope**:
1. Add `querySubscription()` to `listUserLibrary()` that finds content accessible via active subscriptions.
2. Add `'subscription'` to `UserLibraryItem.accessType` union type.
3. Add `'subscription'` to `listUserLibrarySchema.accessType` enum in validation.
4. Include subscription info (tier name, org name) in the subscription library items.
5. Fix the merge-sort pagination bug (IMP-ACC-001) while adding the third source.
6. Exclude content already returned by purchased/membership queries from subscription results.

**Acceptance Criteria**:
- [ ] Subscribers see subscription-gated content in their library
- [ ] Library items show `accessType: 'subscription'` for subscription-accessed content
- [ ] Pagination works correctly across all three sources
- [ ] No duplicate items when a user has both purchase and subscription access
- [ ] Filtering by `accessType: 'subscription'` returns only subscription content

### WP-ACC-04: Subscriber Membership + Cache Invalidation (BUG-ACC-006 + BUG-ACC-007)

**Priority**: P1 -- High
**Effort**: 3-4 hours
**Dependencies**: None

**Scope**:
1. In `handleSubscriptionCreated()`, upsert an `organizationMemberships` row with `role='subscriber'`, `status='active'`.
2. In `handleSubscriptionDeleted()`, set the subscriber membership to `status='inactive'`.
3. Add VersionedCache invalidation to the subscription webhook handler for user library and org content versions.

**Acceptance Criteria**:
- [ ] New subscribers get an organizationMemberships row with role='subscriber'
- [ ] Cancelled subscribers have their membership set to inactive
- [ ] Existing higher-role memberships are not downgraded (use onConflictDoNothing or conditional logic)
- [ ] Cache is invalidated after subscription lifecycle events
- [ ] Subscriber appears in org member lists

### WP-ACC-05: Make content_access Authoritative (IMP-ACC-007)

**Priority**: P2 -- Medium
**Effort**: 8-12 hours
**Dependencies**: WP-ACC-01, WP-ACC-02, WP-ACC-03

**Scope**:
1. Refactor `getStreamingUrl()` to check `content_access` table first for purchased/complimentary grants.
2. Insert content_access rows for subscription access (either on subscription creation or lazily on first access).
3. Update admin complimentary grants to be verified by the access algorithm.
4. Consolidate access checking into a single `hasAccess()` method that checks content_access -> subscriptions -> memberships.
5. Add proper indexes to content_access for the new query patterns.

**Acceptance Criteria**:
- [ ] Admin-granted complimentary access actually works (user can stream)
- [ ] All access types are checked through a unified path
- [ ] content_access is queried on every access check
- [ ] Subscription access is reflected in content_access (either eagerly or lazily)
- [ ] Performance is equal or better than current N-query approach

### WP-ACC-06: Library Query Quality Fixes (IMP-ACC-001 + IMP-ACC-002)

**Priority**: P2 -- Medium
**Effort**: 3-4 hours
**Dependencies**: WP-ACC-03

**Scope**:
1. Fix merge-sort pagination to use a SQL UNION approach or fetch all items before slicing.
2. Filter membership library query to exclude free content (only show `accessType IN ('members', 'subscribers')`).
3. Add the composite subscription index (IMP-ACC-003).

**Acceptance Criteria**:
- [ ] Pagination across merged sources returns correct items on every page
- [ ] Free content does not appear with accessType='membership' in library
- [ ] Subscription access check query uses an efficient index
