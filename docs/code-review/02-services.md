# Service Layer Code Review

**Scope**: All service packages in `packages/` (9 packages, 18 service files, ~10,174 LOC)
**Date**: 2026-04-07
**Reviewer**: Claude Code

## Review History

| Pass | Date | Focus | Notes |
|---|---|---|---|
| 1 | 2026-04-07 | Initial sweep of 8 service packages | Missed `@codex/subscription` entirely |
| 2 | 2026-04-07 | Verification of all Pass 1 claims, expanded coverage to 9 packages | Corrected 3 false/inaccurate findings, added 11 new findings |
| 3 | 2026-04-07 | Deep verification of Pass 2 claims, DI patterns, return type consistency, duplication quantification | Corrected raw Error count (25, not 28), added 7 new findings, refined duplication estimates |

### Pass 3 Corrections

- **CORRECTED raw Error count**: Pass 2 claimed 28 raw `throw new Error()` calls. Actual count is **25 in production service code** (26 total, 1 in test file). The discrepancy was likely caused by counting some service-registry `throw new Error()` calls in `worker-utils` which are outside the service layer scope.
- **VERIFIED TOCTOU race in subscription webhooks**: The `handleSubscriptionCreated()` claim is **CONFIRMED VALID** but severity is appropriately rated. The idempotency check (line 237) and insert (line 271) are not wrapped in a transaction. Concurrent webhook deliveries could both pass the check. However, the `stripeSubscriptionId` unique constraint provides defense-in-depth -- the second insert would fail with a constraint violation, which propagates as an unhandled DB error. The real risk is noisy error logs, not data corruption.
- **VERIFIED audit log loss**: The `sendEmail()` claim is **CONFIRMED VALID**. The entire flow (insert audit log + send email + update status) is wrapped in a single `db.transaction()` (lines 207-261). On failure, the catch block (lines 247-258) updates the audit log to FAILED, then re-throws. The re-throw causes the transaction to rollback, losing both the initial PENDING insert and the FAILED status update. Failed sends leave zero audit trail.
- **VERIFIED dead code interfaces**: Both `TemplateServiceConfig` and `NotificationPreferencesServiceConfig` are exported from the package barrel (`notifications/src/index.ts`) but never consumed by any constructor. They are part of the public API surface but functionally unused. The `NotificationPreferencesServiceConfig.db` type is `typeof schema` (wrong -- should be a database client), confirming it was never properly integrated.

### Pass 3 New Findings

- **NEW**: `PurchaseService.getPurchaseHistory()` returns non-standard `{ items, total, page, limit }` instead of `PaginatedListResponse<T>` -- the only service to deviate from the standard pagination envelope.
- **NEW**: `OrganizationService.listMembers()` runs item and count queries sequentially (not `Promise.all`), unlike every other paginated list method which uses concurrent queries.
- **NEW**: Service constructor patterns diverge into 4 distinct approaches (detailed in DI section below).
- **NEW**: `NotificationsService` instantiates `BrandingSettingsService` and `ContactSettingsService` ad-hoc inside `resolveBrandTokens()` -- violates the "use ctx.services for all services" principle at the inter-package level.
- **NEW**: Multiple Stripe client instances created across registry getters (subscription, tier, connect, purchase each call `createStripeClient()` independently).
- **NEW**: `ContentAccessService.listUserLibrary()` returns its own `UserLibraryResponse` interface (defined locally, not from `@codex/shared-types`) -- functionally identical to `PaginatedListResponse` but not type-compatible.
- **NEW**: `AnalyticsService.getTopContent()` uses `|| 1` instead of `Math.ceil()` alone for totalPages, introducing an inconsistency where an empty result returns `totalPages: 1` instead of `0`.

---

## Executive Summary (Top 5 Findings)

1. **BUG: `instanceof BaseService` in TemplateService** (line 124) -- checks `error instanceof BaseService` instead of `error instanceof ServiceError`. `BaseService` is not an error class, so this always evaluates to `false`, causing typed `ServiceError` instances to be wrapped as `InternalServiceError`, losing their original status code and error code.

2. **ContentAccessService does not extend BaseService** -- the most complex service (streaming, access control, library) bypasses `BaseService` entirely, managing its own `db`, `obs`, and error handling manually via `this.config.*`. This breaks the architectural contract and means no `this.handleError()`.

3. **Audit log loss on email send failure** -- `NotificationsService.sendEmail()` wraps audit log creation and email sending in a single transaction. When sending fails, the catch block updates the audit log to FAILED then re-throws, causing the entire transaction (including the FAILED status update) to rollback. Failed sends leave no audit trail.

4. **25 raw `throw new Error(...)` calls in production service code** violate the "MUST throw typed ServiceError subclasses" rule. Breakdown: MediaItemService (5), ContentAccessService factory (5), TranscodingService (4), TemplateService (3), OrganizationService (2), NotificationsService (2), BrandingSettingsService (2), TierService (1), revenue-split (1).

5. **Significant code duplication** -- the paginated-list pattern is repeated in 16 methods across 9 services. 13 of these are near-identical (`build conditions + Promise.all([findMany, count]) + return { items, pagination }`). A shared `paginatedQuery()` abstraction would eliminate ~260 lines.

---

## Cross-Cutting Analysis (Pass 3 Deep-Dives)

### A. Dependency Injection Patterns

Services use **4 distinct constructor patterns**, creating inconsistency:

| Pattern | Services | How It Works |
|---|---|---|
| **1. Implicit (BaseService only)** | ContentService, OrganizationService, TemplateService, NotificationPreferencesService, Admin services (3) | No explicit constructor; relies on `BaseService(config: ServiceConfig)`. Uses `setCache()` mutation for optional deps. |
| **2. Extended config interface** | IdentityService, MediaItemService | Extends `ServiceConfig` with extra fields (`r2Service`, `cache`, etc.). Constructor calls `super(config)` then assigns extra props. |
| **3. Separate constructor params** | PurchaseService, SubscriptionService, TierService, ConnectAccountService | Takes `ServiceConfig` as first arg, `Stripe` as second. Constructor calls `super(config)` then assigns `this.stripe`. |
| **4. Manual (no BaseService)** | ContentAccessService | Takes custom `ContentAccessServiceConfig` with `db`, `r2`, `obs`, `purchaseService`. No inheritance. Factory function handles construction. |

**Recommendation**: Standardize on Pattern 2 (extended config interface) for all services. Pattern 3 (separate params) could adopt an extended config that includes the Stripe client. Pattern 1's `setCache()` mutation is a code smell -- cache should be a constructor dependency.

### B. Return Type Consistency

All paginated list methods return `PaginatedListResponse<T>` from `@codex/shared-types` except:

| Service | Method | Actual Return Type | Issue |
|---|---|---|---|
| **PurchaseService** | `getPurchaseHistory()` | `{ items, total, page, limit }` | Missing `pagination` wrapper and `totalPages`. A separate `formatPurchasesForClient()` method converts it. |
| **ContentAccessService** | `listUserLibrary()` | `UserLibraryResponse` (local interface) | Shape matches `PaginatedListResponse` but is a distinct type. |

All other services consistently return `PaginatedListResponse<T>`. Single-item queries consistently return `T | null` for optional lookups and `T` for required ones (throwing `NotFoundError` if absent).

### C. Service-to-Service Communication

**No circular dependencies.** The dependency graph is clean and acyclic:

```
access -> purchase (runtime: PurchaseService instantiation)
access -> content  (type: re-exports error classes)
content -> transcoding (runtime: path utility functions)
content -> organization (type: Organization type import)
notifications -> platform-settings (runtime: BrandingSettingsService, ContactSettingsService)
image-processing -> transcoding (runtime: path utilities)
```

**Concern**: `NotificationsService.resolveBrandTokens()` (lines 88-126) creates ad-hoc `BrandingSettingsService` and `ContactSettingsService` instances inside the method body:
```typescript
const brandingService = new BrandingSettingsService({
  db: this.db,
  environment: this.environment,
  organizationId,
});
```
This bypasses the service registry and creates a new service on every cache miss. It should accept these as constructor dependencies or resolve them from the registry.

### D. Stripe Client Duplication

The service registry creates **4 separate Stripe client instances** -- one each for `purchase`, `subscription`, `tier`, and `connect` getters (lines 300, 325, 347, 366 of `service-registry.ts`). Each calls `createStripeClient(env.STRIPE_SECRET_KEY)`. While `createStripeClient()` likely returns a lightweight wrapper, sharing a single instance would be cleaner and save initialization time.

### E. Paginated List Pattern -- Precise Quantification

**16 methods** implement paginated list queries. By structural similarity:

**Near-identical (extractable to shared helper -- 13 methods, ~325 lines):**

| # | Service | Method | Lines |
|---|---|---|---|
| 1 | ContentService | `list()` | 651-748 (97) |
| 2 | ContentService | `listPublic()` | 768-862 (94) |
| 3 | MediaItemService | `list()` | 373-440 (67) |
| 4 | OrganizationService | `list()` | 279-337 (58) |
| 5 | OrganizationService | `getPublicCreators()` | 382-488 (106) |
| 6 | OrganizationService | `getPublicMembers()` | 924-1007 (83) |
| 7 | SubscriptionService | `listSubscribers()` | 693-729 (36) |
| 8 | TemplateService | `listGlobalTemplates()` | 54-90 (36) |
| 9 | TemplateService | `listOrgTemplates()` | 211-253 (42) |
| 10 | TemplateService | `listCreatorTemplates()` | 383-421 (38) |
| 11 | AdminContentManagementService | `listAllContent()` | 42-103 (61) |
| 12 | AdminCustomerManagementService | `listCustomers()` | 43-155 (112) |
| 13 | AdminAnalyticsService | `getTopContent()` | 194-366 (172) |

**Structural variants (not directly extractable):**

| # | Service | Method | Why Different |
|---|---|---|---|
| 14 | OrganizationService | `listMembers()` | Sequential count query (not `Promise.all`), JOIN, custom mapping |
| 15 | ContentAccessService | `listUserLibrary()` | Dual-source merge (purchased + membership), complex mapping |
| 16 | PurchaseService | `getPurchaseHistory()` | Non-standard return type, no `withPagination()` |

**Core duplicated boilerplate per instance** (~20 lines):
```typescript
const [items, countResult] = await Promise.all([
  this.db.query.TABLE.findMany({ where, limit, offset, orderBy, with }),
  this.db.select({ total: count() }).from(TABLE).where(WHERE),
]);
const total = Number(countResult[0]?.total ?? 0);
const totalPages = Math.ceil(total / limit);
return { items, pagination: { page, limit, total, totalPages } };
```

**Estimated savings**: A `paginatedQuery()` helper in `@codex/database` (accepting table, conditions, pagination, options) could reduce each 20-line boilerplate to ~5 lines. Net savings: ~195 lines from the 13 extractable methods.

---

## Per-Service Findings

### 1. `@codex/content` -- ContentService (916 LOC) + MediaItemService (511 LOC)

**Files**:
- `packages/content/src/services/content-service.ts`
- `packages/content/src/services/media-service.ts`
- `packages/content/src/errors.ts`

#### BaseService usage
Both services properly extend `BaseService`. ContentService uses implicit constructor (Pattern 1) with `setCache()` mutation; MediaItemService has an explicit constructor via extended config (Pattern 2) for its `r2` dependency.

#### Error handling
**ContentService** uses standalone `wrapError()` from `../errors` (re-exports from `@codex/service-errors`) rather than `this.handleError()`. Functionally equivalent since `wrapError()` already checks `isServiceError()`, but `handleError()` adds service-name context automatically.

The error re-throw pattern is thorough: each mutation method explicitly checks `instanceof` for known error types before calling `wrapError()`. Example from `publish()` (lines 524-531):
```typescript
if (error instanceof ContentNotFoundError || error instanceof BusinessLogicError) {
  throw error;
}
throw wrapError(error, { contentId: id, creatorId });
```

**MediaItemService** has **5 raw `throw new Error(...)`** calls:
- Line 108: `throw new Error(Generated r2Key '${r2Key}' failed validation)` -- should be `ValidationError`
- Line 127: `throw new Error('Failed to create media item')` -- should be `InternalServiceError`
- Line 176: `throw new Error('R2 service not configured...')` -- should be `InternalServiceError`
- Line 183: `throw new Error(Cannot upload: media status is '${media.status}')` -- should be `InvalidMediaStateError` or `BusinessLogicError`
- Line 186: `throw new Error('Media has no r2Key')` -- should be `InternalServiceError`

Note: Lines 108 and 127 are inside a try/catch that calls `wrapError()`, so the raw `Error` gets wrapped to `InternalServiceError` -- but this means the semantic error type is lost. Lines 176, 183, 186 are OUTSIDE any try/catch, so raw `Error` propagates to `procedure()` where `mapErrorToResponse()` catches it as a 500. The error messages are descriptive but violate the contract.

#### Data scoping
All queries in ContentService use `scopedNotDeleted(content, creatorId)` or `withCreatorScope(content, creatorId)`. MediaItemService uses `scopedNotDeleted(mediaItems, creatorId)`. The `listPublic()` method correctly uses `isNull(content.deletedAt)` without creator scoping (intentionally public). All correct.

#### Transactions
Correctly used for `create()` (line 154), `publish()` (line 449), `unpublish()` (line 548), `delete()` (line 607). The `update()` method (lines 260-334) also uses a transaction for slug-conflict checking + update atomicity. `list()` and `listPublic()` use `Promise.all()` on independent read queries -- correct, though the two queries may see different snapshots (acceptable for list views).

#### Dead code
`ContentAlreadyPublishedError` is defined in `errors.ts` (lines 89-93), exported from `index.ts`, and has dedicated tests in `errors.test.ts`, but is never thrown anywhere in service code. The `publish()` method silently succeeds for already-published content rather than throwing this error.

---

### 2. `@codex/organization` -- OrganizationService (1,007 LOC)

**File**: `packages/organization/src/services/organization-service.ts`

#### BaseService usage
Properly extends `BaseService` (Pattern 1, implicit constructor).

#### Error handling
**Raw Error throws**:
- Line 103: `throw new Error('Failed to create organization')` -- should be `InternalServiceError`
- Line 560: `throw new Error('Failed to get member count')` -- should be `InternalServiceError`

Both are inside try/catch blocks that call `wrapError()`, so they get wrapped. But the descriptive message is lost.

**`removeMember()` (lines 869-911) has no try/catch**. The method body is `return await this.db.transaction(async (tx) => { ... })` with no error wrapping. If the transaction throws a database error (connection failure, constraint violation other than the handled cases), it propagates as a raw Drizzle/Neon error. `MemberNotFoundError` and `LastOwnerError` ARE `ServiceError` subclasses and propagate correctly, but unhandled DB errors would be caught by `mapErrorToResponse()` in `procedure()` as generic 500s. Still a consistency issue vs. every other mutation in this service.

#### Data scoping
Organization queries use `whereNotDeleted(organizations)` -- correct because orgs are shared entities, not creator-scoped. `getBySlug()` and `getPublicCreators()` correctly filter by `whereNotDeleted(organizations)`.

**`listMembers()` (lines 497-586)**: Confirmed -- does NOT filter by `deletedAt` on the memberships table. The conditions at line 523 only check `organizationMemberships.organizationId` plus optional `role` and `status` filters. If the memberships table has a `deletedAt` column and supports soft delete, this could return deleted memberships. However, `removeMember()` sets `status: 'inactive'` rather than `deletedAt`, so in practice the `status` filter at the API layer likely handles this. Still, if memberships were soft-deleted elsewhere, they'd leak through.

**`listMembers()` sequential count query**: Unlike every other paginated list method in the codebase, the item query (line 534) and count query (line 553) are awaited sequentially instead of using `Promise.all`. This adds one extra DB round-trip per request. Minor but inconsistent.

#### Code duplication
**Last-owner guard**: Identical logic in `updateMemberRole()` (lines 810-826) and `removeMember()` (lines 883-899). Both query owner count from `organizationMemberships` with identical WHERE conditions and throw `LastOwnerError()`.

**`getPublicCreators()` (lines 382-488) vs `getPublicMembers()` (lines 924-1007)**: Both follow the same slug-lookup + parallel count/data query pattern. `getPublicCreators` adds a content-count LEFT JOIN and restricts to `owner/admin/creator` roles; `getPublicMembers` is simpler but structurally identical. A shared helper would reduce ~80 lines.

---

### 3. `@codex/identity` -- IdentityService (571 LOC)

**File**: `packages/identity/src/services/identity-service.ts`

#### BaseService usage
Properly extends `BaseService` via extended `IdentityServiceConfig` (Pattern 2, adds `r2Service`, `r2PublicUrlBase`, `cache`).

#### Error handling
**Best in the codebase**. Consistently uses `this.handleError()` throughout: lines 133, 178, 319, 414, 484, 567. This is the prescribed pattern per CLAUDE.md rules.

#### Cache invalidation
`uploadAvatar()` (line 74): Uses `this.cache.invalidate(userId)` -- passes only `userId` without a `CacheType`. This differs from `getProfile()` which uses `CacheType.USER_PROFILE`, and `getNotificationPreferences()` which uses `CacheType.USER_PREFERENCES`. The invalidation still works because the cache implementation accepts a key without type, but semantics are inconsistent.

#### Duplicate username check
Username uniqueness logic is duplicated between `updateProfile()` (lines 259-271) and `upgradeToCreator()` (lines 362-369). Both do:
```typescript
const other = await this.db.query.users.findFirst({
  where: and(eq(users.username, input.username), ne(users.id, userId), whereNotDeleted(users))
});
if (other) throw new UsernameTakenError(input.username);
```
Could be extracted to `private validateUsernameAvailability(username, userId)`.

#### Duplicate notification preferences
`getNotificationPreferences()` and `updateNotificationPreferences()` (lines 426-570) manage the same `notificationPreferences` table that `NotificationPreferencesService` in the notifications package also manages. The Identity version uses an `onConflictDoUpdate` upsert + cache-aside pattern with `VersionedCache`; the Notifications version uses a check-then-insert approach without caching. Both coexist via different workers (identity-api vs notifications-api). This is a maintainability concern -- changes to the preferences schema need updating in two places.

---

### 4. `@codex/access` -- ContentAccessService (1,044 LOC)

**File**: `packages/access/src/services/ContentAccessService.ts`

Note: The access CLAUDE.md incorrectly references `content-access-service.ts` (kebab-case) -- the actual filename is `ContentAccessService.ts` (PascalCase).

#### Does NOT extend BaseService (Pattern 4)
ContentAccessService uses manual DI via constructor config:
```typescript
export class ContentAccessService {
  constructor(private config: ContentAccessServiceConfig) {}
}
```
This means: no `this.db`, `this.environment`, `this.obs`; all accessed via `this.config.*`. No `this.handleError()` -- uses standalone `wrapError()` from `@codex/service-errors`. No auto-scoped `ObservabilityClient`. This is the most significant architectural deviation in the service layer.

The factory function `createContentAccessService()` (lines 991-1044) has **5 raw `throw new Error(...)`** for missing env vars. These are config validation errors that run at service construction time, so they're less dangerous than runtime throws, but still violate the contract.

**Duplicate DB connection**: The factory creates its own `createPerRequestDbClient()` (line 1031), separate from the service registry's shared DB client. This means requests touching both `content` and `access` services open two WebSocket connections instead of one. Cross-referenced with database review finding #4.

#### Return type deviation
`listUserLibrary()` returns `UserLibraryResponse` (lines 107-115), a locally-defined interface that is structurally identical to `PaginatedListResponse<UserLibraryItem>` but is a distinct type. This prevents type-safe interop with code expecting `PaginatedListResponse`.

#### Method complexity
`getStreamingUrl()` is 323 lines (lines 169-492) with deeply nested conditional logic for access control (free vs paid vs membership vs subscription tier). The access decision tree handles:
1. Members-only content (requires active org membership)
2. Paid content with purchase check
3. Paid content with subscription tier check (sort order comparison)
4. Paid content with org membership fallback
5. Free content

Each branch has detailed logging. This would benefit from extraction into helper methods.

`listUserLibrary()` is 358 lines (lines 591-949) -- the longest method in the codebase. Well-structured internally (uses extracted helper functions `queryPurchased()`, `queryMembership()`, `buildContentFilters()`, `buildProgressFilters()`, `mapProgress()`), but still very long. The merge-sort logic (lines 890-935) for combining purchased and membership items could be a separate method.

#### Raw SQL usage
`listUserLibrary()` uses raw SQL for the exclusion subquery (line 803):
```typescript
sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} = ${PURCHASE_STATUS.COMPLETED})`
```
This uses parameterized schema references (not raw table names), which is safer than hardcoded table names.

#### Transaction usage
`getStreamingUrl()` correctly uses `db.transaction()` with explicit `isolationLevel: 'read committed'` and `accessMode: 'read only'` for the access verification (lines 436-438). Well-designed.

---

### 5. `@codex/purchase` -- PurchaseService (824 LOC)

**File**: `packages/purchase/src/services/purchase-service.ts`

#### BaseService usage
Properly extends `BaseService` (Pattern 3, `ServiceConfig` + Stripe as separate param).

#### Error handling
Uses standalone `wrapError()` rather than `this.handleError()`. Error re-throw patterns are thorough -- each method explicitly lists the `ServiceError` subclasses it re-throws.

**Pass 1 correction (retained)**: The `completePurchase()` error handling at lines 394-406 is **correct**. `wrapError()` checks `isServiceError(error)` first (line 156 of `base-errors.ts`) and returns the error unchanged if it's already a `ServiceError`. So `PaymentProcessingError` (which extends `InternalServiceError extends ServiceError`) passes through `wrapError()` without re-wrapping. No fix needed.

#### Non-standard return type
`getPurchaseHistory()` (lines 469-530) returns:
```typescript
Promise<{ items: PurchaseWithContent[]; total: number; page: number; limit: number; }>
```
This is the **only service method** that returns a non-standard pagination envelope. All other services return `PaginatedListResponse<T>` which has `{ items, pagination: { page, limit, total, totalPages } }`. A separate `formatPurchasesForClient()` method (lines 541-578) converts this to the standard shape, suggesting the inconsistency is known but not yet resolved.

#### Revenue calculator
`revenue-calculator.ts` (171 LOC): Well-implemented with thorough validation, defensive checks, and clear documentation. Uses integer math only with proper rounding. No issues found.

---

### 6. `@codex/notifications` -- NotificationsService (382 LOC), TemplateService (664 LOC), NotificationPreferencesService (258 LOC)

**Files**:
- `packages/notifications/src/services/notifications-service.ts`
- `packages/notifications/src/services/template-service.ts`
- `packages/notifications/src/services/notification-preferences-service.ts`

#### BaseService usage
All three services extend `BaseService`. NotificationsService uses a custom `NotificationsServiceConfig` (extends ServiceConfig with emailProvider, fromEmail, etc.). TemplateService and NotificationPreferencesService use implicit constructors (Pattern 1).

#### BUG: `instanceof BaseService` check (TemplateService line 124)

```typescript
if (error instanceof BaseService) throw error; // Re-throw specialized errors
```

`BaseService` is not an error class -- it's the abstract service base class. This check will **never** be true. It should be `error instanceof ServiceError`. As a result, any typed `ServiceError` thrown during `createGlobalTemplate()` will fall through to the `InternalServiceError` wrapper on line 125, losing the original error code and HTTP status.

**Impact**: Only affects `createGlobalTemplate()`. The other create methods (`createOrgTemplate` line 298, `createCreatorTemplate` line 459) use plain `throw error` in catch blocks, which correctly propagates typed errors.

**Inconsistency in create method error handling**: The three `create*Template()` methods each handle errors differently:
- `createGlobalTemplate()`: `instanceof BaseService` (BUG) then `InternalServiceError`
- `createOrgTemplate()`: `throw error` (correct but no wrapping)
- `createCreatorTemplate()`: `throw error` (correct but no wrapping)

#### Raw Error throws
TemplateService has 3 raw `throw new Error(...)`:
- Line 112: `throw new Error('Failed to create global template')`
- Line 285: `throw new Error('Failed to create organization template')`
- Line 443: `throw new Error('Failed to create creator template')`

NotificationsService has:
- Line 65: `throw new Error('EmailProvider is required')` (constructor) -- acceptable for config validation
- Line 222: `throw new Error('Failed to create audit log')` -- should be `InternalServiceError`

#### Dead code: `TemplateServiceConfig` and `NotificationPreferencesServiceConfig`

`TemplateServiceConfig` (lines 30-33) defines `{ db, environment }` -- identical to `ServiceConfig`. Since `TemplateService` extends `BaseService` and has no explicit constructor, this interface is never used as a constructor parameter. Exported from the package barrel but functionally dead.

`NotificationPreferencesServiceConfig` (lines 26-29) defines `{ db: typeof schema; environment }` -- note the `db` type is `typeof schema` (the Drizzle schema object), not a database client type. This is incorrect and also dead code (never used as constructor parameter). Also exported from the barrel.

#### `biome-ignore noExplicitAny` (line 641)

```typescript
// biome-ignore lint/suspicious/noExplicitAny: Drizzle transaction type is complex to extract
tx?: any
```

The `DatabaseTransaction` type IS already defined in `@codex/content` `types.ts` and could be moved to `@codex/database` as a shared export.

#### Code duplication in TemplateService
Three `list*Templates()` methods, three `create*Template()` methods, three `update*Template()` methods, three `delete*Template()` methods -- nearly identical except for scope filter (GLOBAL/ORGANIZATION/CREATOR) and authorization check. A scope-parameterized approach could reduce ~300 lines.

#### Audit log transaction concern (CONFIRMED)
`sendEmail()` wraps audit log + email sending in one transaction (lines 207-261). The flow:
1. Insert audit log (PENDING) into `tx`
2. Try `sendWithRetry()` -- if success, update to SUCCESS, return result (transaction commits)
3. If failure, update audit log to FAILED, then `throw error`

The `throw error` on line 258 exits the transaction callback. Drizzle rollbacks the entire transaction including the FAILED status update. **Failed email sends leave no audit trail.** Fix: insert the audit log outside the transaction, or use two separate transactions (one for audit, one for the send+status-update).

#### Ad-hoc service instantiation
`resolveBrandTokens()` (lines 88-126) creates new `BrandingSettingsService` and `ContactSettingsService` instances on every cache miss. These are not injected via constructor or resolved from the service registry. This pattern:
- Creates unnecessary object allocation per request
- Bypasses any service lifecycle management
- Cannot be mocked in tests without module-level mocking

---

### 7. `@codex/admin` -- AdminAnalyticsService (408 LOC), AdminContentManagementService (350 LOC), AdminCustomerManagementService (378 LOC)

**Files**:
- `packages/admin/src/services/analytics-service.ts`
- `packages/admin/src/services/content-management-service.ts`
- `packages/admin/src/services/customer-management-service.ts`

#### BaseService usage
All three services properly extend `BaseService` (Pattern 1). `AdminContentManagementService` has an additional `setCache()` mutation.

#### Error handling
Consistent pattern: re-throw known errors (via `instanceof` check), wrap unknown with `wrapError()`. Does not use `this.handleError()`.

#### Data scoping
All queries are scoped by `organizationId` -- correct for admin operations. Verified: `deleteContent` WHERE clause (content-management-service.ts) includes both `eq(content.id, contentId)` and `eq(content.organizationId, organizationId)`.

#### totalPages inconsistency
`AnalyticsService.getTopContent()` (line 361) uses `Math.ceil(total / limit) || 1` -- the `|| 1` fallback means an empty result set returns `totalPages: 1` instead of `0`. Every other service returns `totalPages: 0` when `total` is 0 (because `Math.ceil(0 / limit) === 0`). This is a minor semantic inconsistency that could confuse frontend pagination logic.

#### Raw SQL in AnalyticsService
`getCustomerStats()` uses raw SQL via `this.db.execute(sql\`...\`)` (lines 160-173) with a CTE query. It uses raw table name strings (`purchases`, `customer_id`, `purchased_at`) rather than schema references. If table names change via migration, this SQL would break silently.

`getRecentActivity()` has extensive raw SQL (lines 276-338) for a UNION ALL query. Uses raw table names (`purchases`, `content`, `organization_memberships`, `users`). Same concern. However, Drizzle does not support UNION ALL via query builder, so raw SQL is the pragmatic choice.

---

### 8. `@codex/transcoding` -- TranscodingService (901 LOC)

**File**: `packages/transcoding/src/services/transcoding-service.ts`

#### BaseService usage
Properly extends `BaseService` (Pattern 2, extended config with RunPod credentials).

#### Error handling
The custom error hierarchy is the most complete of all services: `TranscodingMediaNotFoundError`, `InvalidMediaStateError`, `MaxRetriesExceededError`, `RunPodApiError`, `MediaOwnershipError`, `TranscodingJobNotFoundError`, `InvalidMediaTypeError`.

**Raw Error throws** in constructor (lines 106-112): Three `throw new Error(...)` for missing config. Acceptable for constructor validation -- these run at startup, not at request time.

Line 171: `throw new Error('Input file not uploaded (r2Key missing)')` -- should be `InvalidMediaStateError` or `ValidationError`. This runs at request time and is NOT inside a try/catch that calls `wrapError()`.

#### `getMediaForTranscoding` vs `getMediaForTranscodingInternal` duplication
Lines 630-688 vs 696-730: Share ~90% of code (identical column selections, same `TranscodingMediaItem` cast). The only difference: `getMediaForTranscoding` validates creator ownership with a secondary query, while `getMediaForTranscodingInternal` skips it. A single method with an optional `creatorId` parameter would be cleaner.

#### `dispatchRunPodJob` error handling
Lines 816-867: Intentionally catches all errors and marks media as `failed` instead of throwing. Well-designed for `waitUntil()` usage. Includes double-failure protection: if `markTranscodingFailed()` itself throws, the error is logged (lines 892-898) to prevent silent failures.

---

### 9. `@codex/subscription` -- SubscriptionService (1,006 LOC), TierService (428 LOC), ConnectAccountService (287 LOC), revenue-split (68 LOC)

**Files**:
- `packages/subscription/src/services/subscription-service.ts`
- `packages/subscription/src/services/tier-service.ts`
- `packages/subscription/src/services/connect-account-service.ts`
- `packages/subscription/src/services/revenue-split.ts`
- `packages/subscription/src/errors.ts`

#### BaseService usage
All three services properly extend `BaseService` (Pattern 3, ServiceConfig + Stripe).

#### Error handling -- GOOD
`SubscriptionService`, `TierService`, and `ConnectAccountService` all use `this.handleError()` consistently (matching the prescribed pattern from CLAUDE.md). This makes them, along with `IdentityService`, the most compliant services.

Custom error hierarchy is clean: `TierNotFoundError`, `TierHasSubscribersError`, `AlreadySubscribedError`, `SubscriptionCheckoutError`, `SubscriptionNotFoundError`, `ConnectAccountNotFoundError`, `ConnectAccountNotReadyError`, `CreatorConnectRequiredError`.

**One raw Error throw**: `TierService` line 116: `throw new Error('Failed to insert tier record')` -- should be `InternalServiceError`. Inside a try/catch that calls `this.handleError()`, so it gets wrapped, but the descriptive message is lost.

**Revenue-split** line 61: `throw new Error('Revenue split mismatch...')` -- a sanity-check assertion. Since this should never trigger in practice (the math is designed to guarantee the sum equals the input), it's acceptable as a fail-fast mechanism, but could be `InternalServiceError` for consistency.

#### Inconsistent `deletedAt` filtering
`SubscriptionService.createCheckoutSession()` (line 117) and `changeTier()` (line 510) use:
```typescript
sql`${subscriptionTiers.deletedAt} IS NULL`
```
While `TierService` uses:
```typescript
isNull(subscriptionTiers.deletedAt)
```
These are functionally identical, but mixing raw SQL and Drizzle operators for the same check is inconsistent. The Drizzle `isNull()` form is preferred.

#### Transaction safety in webhook handlers (CONFIRMED)
`handleSubscriptionCreated()` (lines 218-296) performs an idempotency check (query existing, line 237) then inserts if not found (line 271), but these are NOT wrapped in a transaction. Under concurrent webhook deliveries (which Stripe can do), there's a TOCTOU race: two simultaneous webhooks could both pass the idempotency check and both attempt to insert.

**Defense-in-depth**: The unique constraint on `stripeSubscriptionId` prevents duplicate data. The second insert would fail with a constraint violation error. This error propagates as an unhandled DB error (not a `ServiceError`), which `mapErrorToResponse()` catches as a generic 500.

**Practical severity**: Low-to-medium. Stripe retries webhooks that return 500, which could create a retry loop. Fix: wrap check+insert in a transaction, or catch unique-constraint violations explicitly with `isUniqueViolation()` (pattern already used in OrganizationService and ContentService).

`handleInvoicePaymentSucceeded()` (lines 302-407) updates the subscription record (line 379) then executes revenue transfers (line 394) -- not wrapped in a transaction. If the DB update succeeds but transfers fail, the subscription record reflects the new period while transfers remain incomplete. The `pendingPayouts` table provides eventual consistency for failed transfers, so this is acceptable by design.

#### Multi-party transfer resilience
`executeTransfers()` (lines 826-1005) has good resilience: failed transfers are caught and accumulated as `pendingPayouts` records rather than failing the webhook. This is correct -- webhook handlers should not throw.

**Unprotected `pendingPayouts` insert**: If the `pendingPayouts` insert itself fails (e.g., DB connection dropped), the error would propagate up and potentially fail the webhook handler. This edge case is not caught. The `try/catch` around `stripe.transfers.create()` does not extend to the `pendingPayouts` insert inside it.

#### TierService `reorderTiers()` DB type cast
Line 354:
```typescript
await (this.db as typeof import('@codex/database').dbWs).transaction(async (tx) => {
```
This casts `this.db` to `dbWs` to access `transaction()`. This is technically unnecessary because `BaseService.db` is typed as `ServiceDatabase = typeof dbHttp | typeof dbWs`, and both support `transaction()` in Drizzle. The cast adds fragility (if the service is instantiated with `dbHttp`, the transaction semantics differ) and visual noise. Other services simply call `this.db.transaction()` without casting.

#### ConnectAccountService
Well-structured with clear separation: `createAccount`, `getAccount`, `handleAccountUpdated`, `createDashboardLink`, `isReady`, `syncAccountStatus`. Error handling uses `this.handleError()`. No issues found beyond the general pattern observations.

#### Test coverage
4 test files exist: `revenue-split.test.ts`, `connect-account-service.test.ts`, `subscription-service.test.ts`, `tier-service.test.ts`. Good coverage for a new package.

---

## Code Duplication Matrix

| Pattern | Content | Org | Identity | Access | Purchase | Notifications | Admin | Transcoding | Subscription |
|---|---|---|---|---|---|---|---|---|---|
| **Paginated list** | `list()`, `listPublic()` | `list()`, `listMembers()`, `getPublicCreators()`, `getPublicMembers()` | -- | `listUserLibrary()` | `getPurchaseHistory()` | `listGlobal*`, `listOrg*`, `listCreator*` | `listAllContent()`, `listCustomers()`, `getTopContent()` | -- | `listSubscribers()` |
| **Fetch-then-not-found** | `get()`, `update()`, `publish()`, `unpublish()`, `delete()` | `update()`, `delete()` | `fetchProfileFromDB()` | `getStreamingUrl()` | `getPurchase()` | Multiple template methods | `publishContent()`, `unpublishContent()`, `deleteContent()`, `getCustomerDetails()` | `getMediaForTranscoding()` | `getSubscriptionOrThrow()`, `getTierOrThrow()` |
| **Soft delete** | `delete()` | `delete()` | -- | -- | -- | `delete*Template()` | `deleteContent()` | -- | `deleteTier()` |
| **Error re-throw** (instanceof + throw + wrapError/handleError) | All mutations | All mutations except `removeMember` | -- (uses `handleError`) | `getStreamingUrl()` | All mutations | Some mutations | All mutations | `getMediaForTranscoding()` | All mutations (uses `handleError`) |
| **Username uniqueness** | -- | -- | `updateProfile()`, `upgradeToCreator()` | -- | -- | -- | -- | -- | -- |
| **Last owner guard** | -- | `updateMemberRole()`, `removeMember()` | -- | -- | -- | -- | -- | -- | -- |
| **Cache invalidation** | `publish()`, `unpublish()` | -- | `uploadAvatar()`, `updateProfile()`, `upgradeToCreator()`, `updateNotificationPreferences()` | -- | -- | -- | `publishContent()`, `unpublishContent()` | -- | -- |

### Extractable abstractions

1. **`paginatedQuery(db, table, whereConditions, orderBy, pagination, options?)`** -- Shared helper for `Promise.all([findMany, count])` + pagination response. Used in 13 near-identical methods across 9 services. Would eliminate ~195 lines.

2. **`requireEntity(query, ErrorClass)`** -- Shared helper for "query, throw NotFoundError if null" pattern used 20+ times. Could be a protected `BaseService` method.

3. **`softDelete(db, table, id, scopeConditions)`** -- Shared helper for the fetch-check-exists-then-set-deletedAt pattern. Used in 5+ services.

---

## Error Handling Compliance

### `handleError()` vs `wrapError()` usage by service

| Service | Pattern Used | CLAUDE.md Compliance |
|---|---|---|
| **IdentityService** | `this.handleError()` | Compliant |
| **SubscriptionService** | `this.handleError()` | Compliant |
| **TierService** | `this.handleError()` | Compliant |
| **ConnectAccountService** | `this.handleError()` | Compliant |
| **ContentService** | `wrapError()` with manual `instanceof` re-throw | Functional but verbose |
| **MediaItemService** | `wrapError()` | Functional but no service context |
| **OrganizationService** | `wrapError()` with manual `instanceof` re-throw | Functional but verbose |
| **PurchaseService** | `wrapError()` with manual `instanceof` re-throw | Functional but verbose |
| **ContentAccessService** | `wrapError()` (no BaseService) | Non-compliant |
| **TemplateService** | **`instanceof BaseService` (BUG)** + `InternalServiceError` | Broken |
| **NotificationsService** | Direct `throw error` (no wrapping in most paths) | Partially compliant |
| **Admin services (3)** | `wrapError()` with manual `instanceof` re-throw | Functional but verbose |
| **TranscodingService** | `wrapError()` with manual `instanceof` re-throw | Functional but verbose |

The codebase has two camps: services written earlier use `wrapError()` with manual `instanceof` checks; newer services (identity, subscription) use `this.handleError()`. Both work, but `handleError()` is prescribed by CLAUDE.md and is less error-prone (no risk of forgetting to list an error type in the `instanceof` chain).

---

## Recommendations (Prioritized by Impact)

### Critical (Fix Now)

| # | Finding | Location | Fix |
|---|---|---|---|
| C1 | **BUG**: `instanceof BaseService` should be `instanceof ServiceError` | `notifications/src/services/template-service.ts:124` | Replace `BaseService` with `ServiceError` import |
| C2 | **Audit log lost on email send failure** | `notifications/src/services/notifications-service.ts:207-261` | Insert audit log outside the transaction, or use nested savepoint, or two-phase: insert PENDING before tx, update status after |
| C3 | **ContentAccessService does not extend BaseService** | `access/src/services/ContentAccessService.ts:144` | Refactor to extend BaseService, move `obs` and `db` to base class |

### High (Fix This Sprint)

| # | Finding | Location | Fix |
|---|---|---|---|
| H1 | **25 raw `throw new Error(...)` calls** in service code | Multiple files (see per-service findings) | Replace with typed `ServiceError` subclasses |
| H2 | **Inconsistent error wrapping**: some use `handleError()`, most use `wrapError()` | 9 of 13 services use `wrapError()` | Standardize on `this.handleError()` per CLAUDE.md |
| H3 | **`biome-ignore noExplicitAny`** in TemplateService | `notifications/src/services/template-service.ts:641` | Extract `DatabaseTransaction` type to `@codex/database` and reuse |
| H4 | **`removeMember()` has no error wrapping** | `organization/src/services/organization-service.ts:869-911` | Add try/catch with `handleError()` matching other mutation methods |
| H5 | **Subscription webhook TOCTOU** | `subscription/src/services/subscription-service.ts:218-296` | Catch unique-constraint violations with `isUniqueViolation()` for silent idempotency, or wrap in transaction |
| H6 | **`PurchaseService.getPurchaseHistory()` non-standard return type** | `purchase/src/services/purchase-service.ts:469-530` | Return `PaginatedListResponse<PurchaseWithContent>` directly; remove `formatPurchasesForClient()` bridge |

### Medium (Plan for Next Cycle)

| # | Finding | Location | Fix |
|---|---|---|---|
| M1 | **Extract `paginatedQuery()` helper** | 13 near-identical methods across 9 services | Add to `@codex/database` or `BaseService`, saves ~195 lines |
| M2 | **Extract `requireEntity()` helper** | Fetch-then-not-found pattern repeated 20+ times | Add to BaseService as protected method |
| M3 | **TemplateService CRUD duplication** (3x list, 3x create, 3x update, 3x delete) | `notifications/src/services/template-service.ts` | Refactor to scope-parameterized methods |
| M4 | **Org service: duplicate last-owner guard** | `organization/src/services/organization-service.ts:810-826, 883-899` | Extract to `private ensureNotLastOwner(tx, orgId)` |
| M5 | **Identity: duplicate username uniqueness check** | `identity/src/services/identity-service.ts:259-271, 362-369` | Extract to `private validateUsernameAvailability()` |
| M6 | **ContentAccessService.listUserLibrary()** at 358 lines | `access/src/services/ContentAccessService.ts:591-949` | Already has good internal structure; extract merge-sort (lines 890-935) |
| M7 | **Duplicate notification preferences** in identity + notifications | `identity/src/services/identity-service.ts:426-570` vs `notifications/src/services/notification-preferences-service.ts` | Choose one canonical owner; identity uses cache-aside, notifications does not |
| M8 | **TranscodingService: duplicate media fetch** | `transcoding/src/services/transcoding-service.ts:630-688, 696-730` | Merge to single method with optional `creatorId` param |
| M9 | **Subscription deletedAt filtering inconsistency** | `subscription/src/services/subscription-service.ts:117, 510` | Use `isNull()` instead of `sql` template for consistency |
| M10 | **Standardize constructor DI patterns** | All services | Adopt Pattern 2 (extended config) universally; remove `setCache()` mutations |
| M11 | **Share single Stripe client** in service registry | `worker-utils/src/procedure/service-registry.ts:300-376` | Create once, pass to all Stripe-dependent services |
| M12 | **NotificationsService ad-hoc service creation** | `notifications/src/services/notifications-service.ts:88-126` | Inject BrandingSettingsService/ContactSettingsService via constructor |
| M13 | **`listMembers()` sequential count query** | `organization/src/services/organization-service.ts:534-556` | Wrap in `Promise.all` for consistency and performance |

### Low (Nice to Have)

| # | Finding | Location | Fix |
|---|---|---|---|
| L1 | **Dead code**: `ContentAlreadyPublishedError` defined but never thrown | `content/src/errors.ts:89-93` | Remove or document planned usage |
| L2 | **Dead code**: `TemplateServiceConfig` interface | `notifications/src/services/template-service.ts:30-33` | Remove from source and package exports |
| L3 | **Dead code**: `NotificationPreferencesServiceConfig` interface (wrong `db` type) | `notifications/src/services/notification-preferences-service.ts:26-29` | Remove from source and package exports |
| L4 | **Raw SQL table names** in AnalyticsService | `admin/src/services/analytics-service.ts:160-173, 276-338` | Use schema references where possible |
| L5 | **Access factory raw Error throws** for missing env vars | `access/src/services/ContentAccessService.ts:1005-1017` | Replace with `ValidationError` or `ConfigurationError` |
| L6 | **TierService `reorderTiers()` unnecessary cast** | `subscription/src/services/tier-service.ts:354` | Remove cast; `this.db.transaction()` works on both `dbHttp` and `dbWs` |
| L7 | **Access CLAUDE.md incorrect filename** | `packages/access/CLAUDE.md` reference section | Change `content-access-service.ts` to `ContentAccessService.ts` |
| L8 | **`UserLibraryResponse` local type** | `access/src/services/ContentAccessService.ts:107-115` | Replace with `PaginatedListResponse<UserLibraryItem>` from `@codex/shared-types` |
| L9 | **AnalyticsService `getTopContent()` totalPages inconsistency** | `admin/src/services/analytics-service.ts:361` | Remove `|| 1` to match all other services (empty = 0 pages) |
| L10 | **`pendingPayouts` insert unprotected** in `executeTransfers()` | `subscription/src/services/subscription-service.ts:863` | Wrap `pendingPayouts` insert in its own try/catch |

---

## Test Coverage Assessment

| Service | Test Files | Coverage Assessment |
|---|---|---|
| **content** | `content-service.test.ts`, `media-service.test.ts`, `content-service-thumbnail.test.ts`, `integration.test.ts`, `errors.test.ts` | Good. Has both unit and integration tests. Thumbnail upload tested separately. |
| **organization** | `organization-service.test.ts`, `errors.test.ts` | Good. Integration-style tests with real DB setup. |
| **identity** | `identity-service.test.ts` | Single file for 8 methods. May lack coverage for edge cases in `upgradeToCreator()` and notification preferences. |
| **access** | `ContentAccessService.integration.test.ts` | Single integration test. Missing unit tests for `listUserLibrary()` merge logic and subscription-tier access path. |
| **purchase** | `purchase-service.test.ts`, `revenue-calculator.test.ts`, `errors.test.ts` | Good. Revenue calculator has dedicated tests. |
| **notifications** | `notifications-service.test.ts`, `template-service.test.ts`, `notification-preferences-service.test.ts`, `branding-cache.test.ts`, `renderer.test.ts`, `renderer_xss.test.ts`, `template-repository.test.ts`, `template-validation.test.ts`, `providers.test.ts`, `in-memory-provider.test.ts` | **Best in the codebase.** 10 test files. |
| **admin** | `analytics-service.test.ts`, `content-management-service.test.ts`, `customer-management-service.test.ts` | Good. Each service has its own test file. |
| **transcoding** | `transcoding-service.test.ts`, `paths.test.ts` | Present. Paths well-tested. Webhook and retry flows could use more coverage. |
| **subscription** | `subscription-service.test.ts`, `tier-service.test.ts`, `connect-account-service.test.ts`, `revenue-split.test.ts` | Good for a new package. 4 test files covering all services. |

### Notable test gaps
- `ContentAccessService.listUserLibrary()` merge-sort logic (dual-source pagination)
- `ContentAccessService.getStreamingUrl()` subscription-tier access path (new code)
- `IdentityService.upgradeToCreator()` edge cases (concurrent upgrades, race conditions)
- `TranscodingService.triggerJobInternal()` + `dispatchRunPodJob()` background dispatch
- `OrganizationService.removeMember()` error paths (no error wrapping = no test for wrapped errors)
- `SubscriptionService.handleSubscriptionCreated()` concurrent webhook delivery (TOCTOU)
- `SubscriptionService.executeTransfers()` failure accumulation paths + `pendingPayouts` insert failure
- `TemplateService.createGlobalTemplate()` `instanceof BaseService` bug (test would catch the error type mutation)

---

## Service Layer Statistics

| Metric | Value |
|---|---|
| Total service packages | 9 |
| Total service files | 18 |
| Total lines of code | ~10,174 |
| Largest service | `ContentAccessService` (1,044 LOC) |
| Longest method | `listUserLibrary()` (358 lines) |
| Services extending BaseService | 12 of 13 (ContentAccessService excluded) |
| Services using `handleError()` | 4 (Identity, SubscriptionService, TierService, ConnectAccountService) |
| Services using `wrapError()` | 9 (Content, Media, Org, Access, Purchase, Admin x3, Transcoding) |
| Raw `throw new Error()` count | 25 (across 9 production files) |
| Custom error classes | 30+ across all packages |
| Confirmed bugs | 1 (`instanceof BaseService` in TemplateService) |
| Paginated list methods | 16 (13 near-identical, 3 structural variants) |
| Constructor DI patterns | 4 (should be 1-2) |
| Service-to-service dependencies | 6 (acyclic, no circular deps) |
| Duplicate Stripe client instances | 4 (in service registry) |

### Cross-reference with database review (05-database.md)
- Finding C3 (ContentAccessService duplicate DB connection) corroborates 05-database finding #4
- Finding M9 (deletedAt filtering inconsistency) corroborates 05-database pattern observations
- Finding L4 (raw SQL table names) corroborates 05-database finding on AnalyticsService
- Finding H5 (webhook TOCTOU) is complementary to 05-database's N+1 findings in the same service
