# P1-ADMIN-001: Admin Dashboard Implementation Plan

**Status**: Complete ✅
**Dependencies**: P1-ECOM-001 ✅, P1-ECOM-002 ✅, P1-ACCESS-001 ✅, Auth Worker ✅, Content API ✅
**Created**: 2025-12-15
**Last Updated**: 2025-12-15

---

## Executive Summary

Build admin dashboard for platform owners with revenue analytics, content management across creators, and customer support tools. Creates one new worker (admin-api), three new services extending BaseService, and one new middleware for role-based access.

## Progress Update (2025-12-15)

### Completed ✅

**Infrastructure & Security**:
- ✅ `requirePlatformOwner()` middleware in @codex/security with full implementation
- ✅ `workers/admin-api` scaffold with health checks and security middleware
- ✅ INFRA-001 wiring (CI/CD workflows, deployment configs, E2E helpers)

**Service Layer - @codex/admin Package**:
- ✅ AdminAnalyticsService (3 methods: getRevenueStats, getCustomerStats, getTopContent)
- ✅ AdminContentManagementService (4 methods: listAllContent, publishContent, unpublishContent, deleteContent)
- ✅ AdminCustomerManagementService (3 methods: listCustomers, getCustomerDetails, grantContentAccess)
- ✅ Type definitions with proper pagination support (AdminContentListOptions, AdminContentStatus, etc.)
- ✅ Proper error handling and organization scoping on all queries

**Validation & Routes**:
- ✅ Admin validation schemas in @codex/validation (admin-schemas.ts)
- ✅ isoDateSchema primitive added to @codex/validation/primitives
- ✅ 10 admin API routes implemented in workers/admin-api/src/index.ts

**Testing - 48 Unit Tests Passing**:
- ✅ AdminAnalyticsService tests (13 tests) - revenue stats, customer stats, top content, date filtering, org scoping
- ✅ AdminContentManagementService tests (17 tests) - pagination, status filtering, publish/unpublish, soft delete
- ✅ AdminCustomerManagementService tests (18 tests) - customer list, details, complimentary access grants, idempotency

**Database Optimization**:
- ✅ Composite index `idx_purchases_org_status_created` added to schema (packages/database/src/schema/ecommerce.ts:305-309)
- ⏳ Run `pnpm db:gen:drizzle` to generate migration SQL, then `pnpm db:migrate` to apply

### Remaining Tasks

- ⏳ Generate and apply database migration for new index
- ⏳ Integration tests (endpoint-level tests in workers/admin-api)
- ⏳ Package documentation (packages/admin/CLAUDE.md)

### Ready Foundations

- ✅ P1-ECOM-001/002: Purchases table with revenue split snapshots, idempotent handling
- ✅ P1-ACCESS-001: contentAccess table with accessType enum ('purchased', 'complimentary', etc.)
- ✅ Auth worker: Session validation, requireAuth middleware, platform_owner role support
- ✅ Content API: Soft delete patterns, publish/unpublish workflows, status validation
- ✅ BaseService: Transaction support, proper db typing, error wrapping
- ✅ Database schema: All tables indexed, relationships defined, constraints enforced

---

## Architecture Decisions

### Decision 1: Separate Admin Worker

**Choice**: Create new `workers/admin-api` rather than extending auth worker.

**Reasoning**:
- Auth worker handles authentication concerns (sessions, tokens, verification)
- Admin dashboard handles business operations (analytics, content management, support)
- Separation follows existing pattern (content-api, identity-api, ecom-api)
- Easier to apply different rate limits, monitoring, access controls
- Admin operations may need different scaling characteristics

**Alternative Considered**: Extend auth worker. Rejected because it mixes authentication infrastructure with business logic.

---

### Decision 2: Customer Definition via Purchases and Memberships

**Problem**: The `users` table has no `organizationId` column. Cannot directly query "customers for this organization."

**Solution**: Define "customer" as a user who has either:
1. Purchased content from this organization (via purchases.organizationId), OR
2. Has membership in this organization (via organizationMemberships)

**Implementation**:
- listCustomers queries purchases table grouped by customerId where organizationId matches
- Aggregates purchase stats (total spent, purchase count) from same query
- Optionally joins organizationMemberships for members who haven't purchased yet
- Phase 1: Focus on purchasing customers only (users with completed purchases)

---

### Decision 3: Complimentary Access via contentAccess Table

**Problem**: Manual access grants for refunds/support.

**Wrong Approach**: Create $0 purchase records. This pollutes revenue analytics and mixes financial transactions with administrative actions.

**Correct Approach**: Insert into contentAccess table with `accessType = 'complimentary'`. The table already supports this enum value and has a unique constraint on (userId, contentId) for idempotency.

**Benefits**:
- Clean separation of financial records (purchases) from access grants (contentAccess)
- Revenue analytics remain accurate (only real purchases)
- Customer purchase history shows only actual purchases
- Existing unique constraint provides idempotency

---

### Decision 4: Revenue Metrics Display

**Unresolved - Requires Business Input**

Platform owner analytics could show:
- **Option A**: Total customer payments (amountPaidCents) - gross revenue
- **Option B**: Platform fee only (platformFeeCents) - platform's cut
- **Option C**: All three splits (platform, org, creator) - full transparency

**Recommendation**: Option C - show all splits. Platform owner needs full picture for business decisions. Display gross revenue prominently, with breakdown available.

---

## Architecture Overview

```
workers/admin-api [NEW WORKER - Port 42073]
  ├─ Middleware: requireAuth() → requirePlatformOwner() [NEW]
  └─ Admin Routes
      ├─ GET  /api/admin/analytics/revenue
      ├─ GET  /api/admin/analytics/customers
      ├─ GET  /api/admin/analytics/top-content
      ├─ GET  /api/admin/content
      ├─ POST /api/admin/content/:id/publish
      ├─ POST /api/admin/content/:id/unpublish
      ├─ DELETE /api/admin/content/:id
      ├─ GET  /api/admin/customers
      ├─ GET  /api/admin/customers/:id
      └─ POST /api/admin/customers/:customerId/grant-access/:contentId

packages/@codex/admin [NEW PACKAGE]
  ├─ services/
  │   ├─ analytics-service.ts
  │   ├─ content-management-service.ts
  │   └─ customer-management-service.ts
  ├─ errors.ts (re-exports from @codex/service-errors, no custom errors needed)
  └─ __tests__/

packages/@codex/security
  └─ middleware/require-platform-owner.ts [NEW]
```

---

## Phase 1: Foundation

### Task 1.1: Create @codex/admin Package

Set up new package following existing patterns from @codex/content and @codex/identity.

**Package Dependencies**:
- @codex/database (queries)
- @codex/service-errors (BaseService, error classes)
- @codex/validation (input schemas)

**Directory Structure**:
- src/services/ for service classes
- src/__tests__/ for unit tests
- src/index.ts exports all public API

**Outputs**: Package builds, TypeScript compiles, can be imported by workers.

---

### Task 1.2: Create requirePlatformOwner() Middleware

New middleware in @codex/security that checks user.role === 'platform_owner'.

**Behavior**:
- Expects requireAuth() to have run first (user in context)
- Returns 401 if no user in context
- Returns 403 with code 'FORBIDDEN' if user.role !== 'platform_owner'
- Calls next() if user is platform owner

**Testing**:
- Test 401 when no user present
- Test 403 when user.role is 'creator' or 'customer'
- Test pass-through when user.role is 'platform_owner'

**Exports**: Add to @codex/security index.ts

---

### Task 1.3: Create admin-api Worker

New worker following patterns from existing workers.

**Configuration**:
- Port: 42073
- Bindings: Same as content-api (DATABASE_URL, KV, etc.)
- Middleware chain: requestTracking → logging → CORS → securityHeaders → requireAuth → requirePlatformOwner

**wrangler.jsonc Setup**:
- Copy structure from content-api
- Update name, port, routes
- Same environment bindings

**Health Check**: GET /health returns 200 with worker status.

---

## Phase 2: Admin Services

### Task 2.1: AdminAnalyticsService

Service for revenue and customer statistics. Extends BaseService.

**Constructor**: Takes ServiceConfig (db, environment) - standard pattern.

**Method: getRevenueStats(organizationId, options?)**

Calculates revenue metrics for an organization.

- **Inputs**: organizationId (string), optional startDate/endDate for filtering
- **Output**: Object with totalRevenueCents, totalPurchases, averageOrderValueCents, platformFeeCents, organizationFeeCents, creatorPayoutCents, revenueByDay array (last 30 days)
- **Query Strategy**: SQL aggregation (SUM, COUNT, GROUP BY) in database, not application code. Filter by purchases.status = 'completed' only. Use COALESCE for zero-purchase case.
- **Scoping**: All queries filtered by purchases.organizationId = organizationId

**Method: getCustomerStats(organizationId)**

Counts customer metrics.

- **Inputs**: organizationId (string)
- **Output**: Object with totalCustomers (distinct purchasers), newCustomersLast30Days (first purchase in last 30 days)
- **Query Strategy**: COUNT DISTINCT on customerId from purchases where organizationId matches and status = 'completed'

**Method: getTopContent(organizationId, limit)**

Ranks content by revenue.

- **Inputs**: organizationId (string), limit (number, default 10)
- **Output**: Array of {contentId, contentTitle, revenueCents, purchaseCount} sorted by revenue descending
- **Query Strategy**: GROUP BY contentId, SUM revenue, JOIN content table for titles. Filter completed purchases only.

**Error Handling**: Throws NotFoundError if organization doesn't exist. Wraps database errors.

**Testing**:
- Test with various date ranges
- Test zero-purchase organization returns 0s not NaN
- Test organization scoping (only counts org's purchases)

---

### Task 2.2: AdminContentManagementService

Service for cross-creator content management. Extends BaseService.

**Method: listAllContent(organizationId, options)**

Lists all content in organization with pagination and filtering.

- **Inputs**: organizationId, page (default 1), limit (default 20), status filter (optional: 'draft', 'published', 'archived', or 'all')
- **Output**: Object with items array and pagination metadata (page, limit, total)
- **Query Strategy**: Query content table where organizationId matches and deletedAt IS NULL. Apply status filter if provided. Order by createdAt DESC.
- **Scoping**: Must filter by organizationId - platform owner only sees their org's content

**Method: publishContent(organizationId, contentId)**

Publishes draft content.

- **Inputs**: organizationId, contentId
- **Output**: Updated content record
- **Business Logic**: Set status = 'published', publishedAt = now. Only works on draft content.
- **Validation**: Content must exist, belong to organization, and be in draft status.
- **Errors**: ContentNotFoundError if not found in org, BusinessLogicError if not draft

**Method: unpublishContent(organizationId, contentId)**

Reverts published content to draft.

- **Inputs**: organizationId, contentId
- **Output**: Updated content record
- **Business Logic**: Set status = 'draft', clear publishedAt. Only works on published content.
- **Errors**: ContentNotFoundError if not found, BusinessLogicError if not published

**Method: deleteContent(organizationId, contentId)**

Soft deletes content.

- **Inputs**: organizationId, contentId
- **Output**: Success boolean
- **Business Logic**: Set deletedAt = now. Never hard delete (preserves purchase history).
- **Scoping**: Must belong to organization

**Testing**:
- Test pagination (multiple pages)
- Test status filtering
- Test 404 for non-existent content
- Test organization scoping prevents cross-org access

---

### Task 2.3: AdminCustomerManagementService

Service for customer support operations. Extends BaseService.

**Method: listCustomers(organizationId, options)**

Lists customers who have purchased from organization with aggregated stats.

- **Inputs**: organizationId, page (default 1), limit (default 20)
- **Output**: Object with items array (userId, name, email, createdAt, totalPurchases, totalSpentCents) and pagination
- **Query Strategy**: Query purchases table grouped by customerId where organizationId matches and status = 'completed'. Aggregate COUNT and SUM. JOIN users table for name/email.
- **Note**: "Customer" defined as user with completed purchase from this org

**Method: getCustomerDetails(organizationId, customerId)**

Gets customer profile with purchase history.

- **Inputs**: organizationId, customerId
- **Output**: Object with customer info and purchaseHistory array
- **Query Strategy**: Fetch user info, then fetch all purchases where customerId and organizationId match. Include content titles via JOIN.
- **Scoping**: Only returns purchases from this organization
- **Errors**: NotFoundError if customer has no purchases from this org

**Method: grantContentAccess(organizationId, customerId, contentId)**

Grants complimentary access for refunds/support.

- **Inputs**: organizationId, customerId, contentId
- **Output**: Success boolean
- **Business Logic**:
  1. Validate customer exists (has any purchase from org, or is org member)
  2. Validate content exists and belongs to organization
  3. Check for existing access (contentAccess record for this user+content)
  4. If exists: return success (idempotent)
  5. If not: Insert contentAccess with accessType = 'complimentary'
- **Important**: Does NOT create a purchase record. Uses contentAccess table.
- **Errors**: NotFoundError for invalid customer/content, ConflictError if already has access (or handle idempotently)

**Idempotency**: The contentAccess table has unique constraint on (userId, contentId). Either pre-check before insert, or catch unique violation and return success.

**Testing**:
- Test pagination and aggregation
- Test grantContentAccess idempotency (duplicate call succeeds)
- Test 404 errors for invalid IDs
- Test organization scoping

---

## Phase 3: API Integration

### Task 3.1: Create Input Validation Schemas

Add schemas to @codex/validation for admin endpoints.

**Schemas Needed**:
- adminRevenueQuerySchema: optional startDate (date), endDate (date)
- adminTopContentQuerySchema: optional limit (integer 1-100)
- adminPaginationQuerySchema: page (integer >= 1, default 1), limit (integer 1-100, default 20)
- adminContentListQuerySchema: extends pagination + optional status enum
- adminCustomerGrantAccessParams: customerId (uuid), contentId (uuid)

**Validation Rules**: Same security standards as existing schemas (UUID format validation, reasonable limits, type coercion for query params).

---

### Task 3.2: Implement Admin API Routes

Create route handlers in admin-api worker.

**Route Pattern** (for each endpoint):
1. Extract validated params from request
2. Get user from context (guaranteed platform owner by middleware)
3. Get organizationId from user context (NOT from client input)
4. Instantiate service with ServiceConfig (db from env, environment string)
5. Call service method with organizationId and validated params
6. Return standardized response using @codex/shared-types format
7. Catch errors with mapErrorToResponse

**Security Critical**: organizationId must come from authenticated user context, never from request parameters. Platform owner can only see their own organization's data.

**Endpoints**:

| Method | Path | Service Method | Notes |
|--------|------|----------------|-------|
| GET | /api/admin/analytics/revenue | getRevenueStats | Query params: startDate, endDate |
| GET | /api/admin/analytics/customers | getCustomerStats | No params |
| GET | /api/admin/analytics/top-content | getTopContent | Query param: limit |
| GET | /api/admin/content | listAllContent | Query params: page, limit, status |
| POST | /api/admin/content/:id/publish | publishContent | Path param: id |
| POST | /api/admin/content/:id/unpublish | unpublishContent | Path param: id |
| DELETE | /api/admin/content/:id | deleteContent | Path param: id |
| GET | /api/admin/customers | listCustomers | Query params: page, limit |
| GET | /api/admin/customers/:id | getCustomerDetails | Path param: id |
| POST | /api/admin/customers/:customerId/grant-access/:contentId | grantContentAccess | Path params |

**Response Format**: Follow @codex/shared-types patterns (SingleItemResponse, PaginatedListResponse, ErrorResponse).

---

### Task 3.3: Apply Security Policies

Configure middleware and rate limiting for admin routes.

**Middleware Chain**:
1. requireAuth() - validates JWT, adds user to context
2. requirePlatformOwner() - checks role, returns 403 if not platform owner

**Rate Limiting**: Apply RATE_LIMIT_PRESETS.api (standard API limits). Admin operations are low-frequency, standard limits sufficient. Can tighten later if abuse detected.

**CORS**: Same origin restrictions as other APIs.

---

## Phase 4: Database Optimization

### Task 4.1: Add Composite Index for Analytics

Current indexes cover individual columns but analytics queries filter on multiple columns.

**New Index**:
```sql
CREATE INDEX idx_purchases_org_status_created
  ON purchases(organization_id, status, created_at DESC);
```

**Justification**: Revenue analytics filter by organization_id AND status = 'completed' AND optionally by created_at date range. Composite index optimizes this common query pattern.

**Existing Indexes** (no changes needed):
- idx_purchases_organization_id ✅
- idx_purchases_created_at ✅
- idx_purchases_content_id ✅
- idx_purchases_customer_id ✅

**Migration**: Create new Drizzle migration file. Test migration on fresh database and rollback.

---

### Task 4.2: Verify Content Table Indexes

Admin content listing needs efficient filtering.

**Check Existing**: content table should have index on (organization_id, status, deleted_at) for admin listing queries.

**If Missing**: Add composite index. If exists: no action needed.

---

## Phase 5: Testing

### Task 5.1: Service Unit Tests

Write comprehensive unit tests for each service.

**AdminAnalyticsService Tests**:
- Revenue calculation with known data
- Zero-purchase returns 0 not NaN/undefined
- Date range filtering works
- Organization scoping prevents cross-org data
- Daily breakdown limited to 30 days

**AdminContentManagementService Tests**:
- Pagination returns correct pages
- Status filter works for each value
- Publish only works on draft
- Unpublish only works on published
- Soft delete sets deletedAt
- Organization scoping enforced

**AdminCustomerManagementService Tests**:
- Customer list aggregates correctly
- Customer details includes purchase history
- Grant access creates contentAccess record
- Grant access is idempotent (duplicate succeeds)
- Invalid customer/content returns 404

**Test Infrastructure**: Use @codex/test-utils with ephemeral Neon branches. Mock database for pure unit tests, real database for integration tests.

**Coverage Target**: 90%+

---

### Task 5.2: Integration Tests

Test full request-response cycle through admin-api worker.

**Authentication Tests**:
- 401 when no auth token
- 403 when user.role !== 'platform_owner'
- 200 when user is platform owner

**Endpoint Tests** (for each route):
- Happy path returns expected data
- Invalid input returns 400
- Non-existent resource returns 404
- Response format matches @codex/shared-types

**Security Tests**:
- Cannot access other organization's data
- Cannot modify other organization's content
- Cannot grant access to other org's content

---

### Task 5.3: Create Package Documentation

Create `packages/admin/CLAUDE.md` following existing package documentation patterns.

**Contents**:
- Overview and purpose
- Public API table
- Service method documentation
- Error handling patterns
- Integration points
- Usage examples

---

## Phase 6: Deployment

### Task 6.1: Configure Worker Deployment

Set up wrangler.jsonc for admin-api worker.

**Bindings** (same as content-api):
- DATABASE_URL secret
- KV namespace for rate limiting
- ENVIRONMENT variable

**Routes**: Configure for /api/admin/* path prefix.

**Environments**: development, staging, production with appropriate database URLs.

---

### Task 6.2: Deploy and Verify

Deploy to preview environment first, then production.

**Preview Verification**:
- Health check returns 200
- Authentication enforced (401/403 for invalid access)
- Analytics return data from test purchases
- Content management operations work
- Customer operations work

**Production Deployment**:
- Deploy during low-traffic period
- Monitor error rates after deployment
- Verify query performance (target < 150ms for analytics)

---

## Unresolved Questions

### 1. Multi-Organization Platform Owners (Future)

**Question**: Should a platform owner be able to manage multiple organizations?

**Current Design**: Platform owner has one organizationId, sees only that org's data.

**Future Consideration**: May need org selector in admin UI. Would require schema changes or separate "platform admin" role.

**Recommendation**: Phase 1 assumes single org per platform owner. Document this limitation.

---

### 2. Revenue Display Granularity

**Question**: What revenue breakdown should platform owner see?

**Options**:
- Gross revenue only (amountPaidCents)
- Platform cut only (platformFeeCents)
- Full breakdown (all three splits)

**Impact**: Affects API response design and frontend display.

**Recommendation**: Show full breakdown. Platform owner needs complete picture.

---

### 3. Audit Trail Requirements

**Question**: Do we need permanent audit trail for admin actions?

**Current**: Actions logged to structured logs (ObservabilityClient).

**Alternative**: Create admin_audit_logs table for permanent record.

**Consideration**: Compliance requirements may mandate permanent audit trail.

**Recommendation**: Phase 1 uses structured logs. Evaluate compliance needs before Phase 2.

---

### 4. Complimentary Access Notification

**Question**: Should granting complimentary access notify the customer?

**Options**:
- No notification (silent grant)
- Email notification (via P1-NOTIFY-001 when ready)
- Both based on platform owner choice

**Recommendation**: Phase 1 silent grant. Add notification option when P1-NOTIFY-001 complete.

---

### 5. Customer Definition Scope

**Question**: Should "customers" include org members who haven't purchased, or only purchasers?

**Current Design**: Customers = users with completed purchases from organization.

**Alternative**: Include organizationMemberships with 'subscriber' or 'member' role.

**Recommendation**: Phase 1 focuses on purchasers. Expand definition when subscription model implemented.

---

## Success Criteria

- [x] admin-api worker deployed and health check passing
- [x] All 3 services implemented with 90%+ test coverage (48 unit tests passing)
- [x] All 10 endpoints working with authentication and role checks
- [x] requirePlatformOwner() correctly returns 403 for non-owners
- [x] Revenue analytics return accurate aggregations (verified against raw data)
- [x] Content management operations (publish/unpublish/delete) work correctly
- [x] Customer list shows aggregated purchase stats
- [x] Complimentary access grant creates contentAccess record (not purchase)
- [x] Complimentary access grant is idempotent
- [x] Organization scoping verified (admin only sees own org's data)
- [x] Database composite index added for analytics query optimization
- [ ] Integration tests passing for all endpoints (pending)
- [ ] Package documentation complete (CLAUDE.md) (pending)

---

## Dependencies & Status

| Dependency | Status | Notes |
|------------|--------|-------|
| P1-ECOM-001 (Purchases, PurchaseService) | ✅ Complete | Revenue data available |
| P1-ECOM-002 (Webhook handlers) | ✅ Complete | Purchase completion flow working |
| P1-ACCESS-001 (contentAccess table) | ✅ Complete | Complimentary access pattern available |
| Auth Worker (requireAuth) | ✅ Complete | Authentication foundation ready |
| Content API (content table, soft delete) | ✅ Complete | Content management patterns available |
| @codex/database (schema, query helpers) | ✅ Complete | No blockers |
| @codex/service-errors (BaseService) | ✅ Complete | Service patterns ready |
| @codex/validation | ✅ Complete | Schema patterns available |
| @codex/test-utils | ✅ Complete | Testing infrastructure ready |

**Status**: All dependencies complete. Ready to begin implementation.

---

## Related Work Packets

| Packet | Relationship | Status |
|--------|--------------|--------|
| P1-CONTENT-001 | Content management patterns | ✅ Complete |
| P1-ECOM-001 | Revenue data source | ✅ Complete |
| P1-ECOM-002 | Webhook handlers | ✅ Complete |
| P1-ACCESS-001 | Content access verification | ✅ Complete |
| P1-NOTIFY-001 | Future: Customer notifications | Not Started |

---

**Plan Created**: 2025-12-15
**Last Updated**: 2025-12-15
**Next Steps**:
1. Run `pnpm db:gen:drizzle && pnpm db:migrate` to generate and apply the composite index migration
2. Create integration tests for admin-api worker endpoints
3. Write `packages/admin/CLAUDE.md` documentation
