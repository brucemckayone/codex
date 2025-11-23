# Agent Deployment Prompts

This file contains ready-to-use prompts for deploying specialized agents to execute each refactoring task. Each prompt is optimized for context efficiency and includes only the necessary file references.

---

## Task 1: Eliminate Duplicate Error Classes

**Agent Type:** `service-layer-architect`

**Prompt:**

```
You are executing Task 1 from REFACTORING_EXECUTION_PLAN.md: Eliminate Duplicate Error Classes.

OBJECTIVE:
Remove duplicate error class definitions (ContentNotFoundError, MediaNotFoundError) that exist in both @codex/content and @codex/access packages. Make @codex/content the canonical source.

REQUIRED READING (read these files first):
1. packages/content/src/errors.ts (lines 32-42 - current ContentNotFoundError and MediaNotFoundError)
2. packages/access/src/errors.ts (lines 11-81 - duplicate error definitions)
3. packages/access/package.json (check if @codex/content dependency exists)

SEARCH TASKS:
- Search codebase for: import.*ContentNotFoundError.*@codex/access
- Search codebase for: import.*MediaNotFoundError.*@codex/access
- Search codebase for: import.*ContentNotFoundError.*@codex/content
- Search codebase for: import.*MediaNotFoundError.*@codex/content

IMPLEMENTATION:
1. Update packages/content/src/errors.ts:
   - Modify ContentNotFoundError constructor to accept optional context parameter (backward compatible)
   - Modify MediaNotFoundError constructor to accept optional r2Key and contentId parameters (match access package signature)

2. Update packages/access/src/errors.ts:
   - Remove ContentNotFoundError class definition (lines 11-19)
   - Remove MediaNotFoundError class definition (lines 73-81)
   - Add: export { ContentNotFoundError, MediaNotFoundError } from '@codex/content';

3. Update packages/access/package.json:
   - Add "@codex/content": "workspace:*" to dependencies if not present

VERIFICATION COMMANDS:
- pnpm --filter @codex/access test
- pnpm --filter @codex/content test
- pnpm typecheck

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 1) to track your progress. Check off each item as you complete it.
```

---

## Task 2: Consolidate Wrangler Configuration

**Agent Type:** `integration-orchestrator`

**Prompt:**

```
You are executing Task 2 from REFACTORING_EXECUTION_PLAN.md: Consolidate Wrangler Configuration.

OBJECTIVE:
Extract shared wrangler configuration into config/cloudflare/base-wrangler.jsonc. All 4 workers will extend this base config.

REQUIRED READING (read these files first):
1. workers/auth/wrangler.jsonc
2. workers/content-api/wrangler.jsonc
3. workers/identity-api/wrangler.jsonc
4. workers/stripe-webhook-handler/wrangler.jsonc

IDENTIFY COMMONALITIES:
- compatibility_date, compatibility_flags
- observability config
- RATE_LIMIT_KV binding (ID: cea7153364974737b16870df08f31083)
- Environment structure (production/staging)
- Environment variables (ENVIRONMENT, DB_METHOD, WEB_APP_URL, API_URL)

IDENTIFY DIFFERENCES (keep in worker-specific configs):
- Worker names and routes
- AUTH_SESSION_KV binding (auth worker only)
- MEDIA_BUCKET R2 binding (content-api only)
- Stripe-specific variables (stripe-webhook-handler)

IMPLEMENTATION:
1. Create config/cloudflare/base-wrangler.jsonc with shared config
2. Update each worker's wrangler.jsonc:
   - Add: "extends": "../../config/cloudflare/base-wrangler.jsonc"
   - Remove duplicate config
   - Keep worker-specific bindings and routes
   - Add comment explaining it extends base

VERIFICATION COMMANDS:
- pnpm build:workers
- wrangler deploy --dry-run --env staging (for each worker)

CRITICAL: Do NOT commit secrets to base-wrangler.jsonc. Only configuration structure, not secret values.

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 2) to track your progress.
```

---

## Task 3: Extract Database Query Helpers

**Agent Type:** `database-schema-architect`

**Prompt:**

```
You are executing Task 3 from REFACTORING_EXECUTION_PLAN.md: Extract Database Query Helpers.

OBJECTIVE:
Create reusable query helpers to eliminate repeated patterns: soft delete checks, scoping, pagination.

SEARCH TASKS (identify all duplication):
- Search pattern: isNull\(.*deletedAt\) in packages/*/src/services/*.ts
- Search pattern: eq\(.*creatorId in packages/*/src/services/*.ts
- Search pattern: \.limit\(.*\)\.offset\( in packages/*/src/services/*.ts

REQUIRED READING (after search):
1. packages/content/src/services/content-service.ts
2. packages/content/src/services/media-service.ts
3. packages/identity/src/services/organization-service.ts
4. packages/access/src/services/ContentAccessService.ts

IMPLEMENTATION:
1. Create packages/database/src/utils/query-helpers.ts with:
   - whereNotDeleted<T>() - returns isNull(table.deletedAt)
   - withCreatorScope<T>() - returns eq(table.creatorId, creatorId)
   - withOrgScope<T>() - returns eq(table.organizationId, orgId)
   - withPagination() - returns {limit, offset}
   - scopedNotDeleted<T>() - combines whereNotDeleted + withCreatorScope
   - orgScopedNotDeleted<T>() - combines whereNotDeleted + withOrgScope

2. Update packages/database/src/utils/index.ts - export helpers
3. Update packages/database/src/index.ts - re-export from utils

4. Refactor all 4 service files to use helpers

5. Create packages/database/src/utils/__tests__/query-helpers.test.ts with unit tests

VERIFICATION COMMANDS:
- pnpm --filter @codex/database test
- pnpm --filter @codex/content test
- pnpm --filter @codex/identity test
- pnpm --filter @codex/access test
- pnpm typecheck

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 3) to track your progress.
```

---

## Task 4: Create Base Service Class

**Agent Type:** `service-layer-architect`

**Prompt:**

```
You are executing Task 4 from REFACTORING_EXECUTION_PLAN.md: Create Base Service Class.

OBJECTIVE:
Extract common service constructor and transaction patterns into a BaseService abstract class.

REQUIRED READING:
1. packages/content/src/services/content-service.ts (constructor and transaction usage)
2. packages/content/src/services/media-service.ts (constructor)
3. packages/identity/src/services/organization-service.ts (constructor)
4. packages/access/src/services/ContentAccessService.ts (constructor)

SEARCH TASKS:
- Search for: new ContentService\( to find all instantiation locations
- Search for: new OrganizationService\(
- Search for: new ContentAccessService\(
- Search for: createContentService\( (check if factory functions exist)

IMPLEMENTATION:
1. Create packages/service-errors/src/base-service.ts:
   - ServiceConfig interface (db, environment)
   - BaseService abstract class
   - protected db and environment properties
   - constructor(config: ServiceConfig)
   - protected withTransaction<T>() method
   - protected handleError() method

2. Update packages/service-errors/src/index.ts - export BaseService and ServiceConfig

3. Refactor all 4 service classes:
   - Extend BaseService
   - Remove duplicate constructor code
   - Use this.withTransaction() instead of this.db.transaction()

4. Update factory functions if they exist

VERIFICATION COMMANDS:
- pnpm --filter @codex/content test
- pnpm --filter @codex/identity test
- pnpm --filter @codex/access test
- pnpm typecheck

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 4) to track your progress.
```

---

## Task 5: Extract Custom Worker Middleware Chains

**Agent Type:** `api-endpoint-architect`

**Prompt:**

```
You are executing Task 5 from REFACTORING_EXECUTION_PLAN.md: Extract Custom Worker Middleware Chains.

OBJECTIVE:
Create middleware chain factory to eliminate repeated middleware setup in auth and stripe-webhook-handler workers.

REQUIRED READING:
1. workers/auth/src/index.ts (lines 30-50 - middleware setup)
2. workers/stripe-webhook-handler/src/index.ts (lines 40-65 - middleware setup)
3. packages/worker-utils/src/middleware.ts (existing middleware factories)

DOCUMENT:
- Exact middleware order in auth worker
- Exact middleware order in stripe-webhook-handler
- Differences between the two

IMPLEMENTATION:
1. Create packages/worker-utils/src/middleware-chain.ts:
   - MiddlewareChainOptions interface (serviceName, skipLogging, skipSecurityHeaders, customMiddleware)
   - createStandardMiddlewareChain(options) - returns MiddlewareHandler[]
   - applyMiddlewareChain(app, path, options) - applies chain to app

2. Update packages/worker-utils/src/index.ts - export new utilities

3. Refactor workers/auth/src/index.ts:
   - Import applyMiddlewareChain
   - Replace lines 30-50 with chain factory call

4. Refactor workers/stripe-webhook-handler/src/index.ts:
   - Import applyMiddlewareChain
   - Replace lines 40-65 with chain factory call

VERIFICATION COMMANDS:
- pnpm --filter auth test
- pnpm --filter stripe-webhook-handler test
- Test /health endpoints locally

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 5) to track your progress.
```

---

## Task 6: Standardize Health Check Configuration

**Agent Type:** `integration-orchestrator`

**Prompt:**

```
You are executing Task 6 from REFACTORING_EXECUTION_PLAN.md: Standardize Health Check Configuration.

OBJECTIVE:
Extract repeated database health check logic into a reusable standardDatabaseCheck function.

REQUIRED READING:
1. workers/auth/src/index.ts (lines 91-105 - health check)
2. workers/content-api/src/index.ts (health check section)
3. workers/identity-api/src/index.ts (health check section)
4. workers/stripe-webhook-handler/src/index.ts (lines 81-95 - health check)

IDENTIFY DUPLICATION:
All 4 workers have identical database health check code:
```typescript
checkDatabase: async (_c: Context) => {
  const isConnected = await testDbConnection();
  return {
    status: isConnected ? 'ok' : 'error',
    message: isConnected ? 'Database connection is healthy.' : 'Database connection failed.',
  };
}
```

IMPLEMENTATION:
1. Create packages/worker-utils/src/health-checks.ts:
   - HealthCheckResult interface
   - standardDatabaseCheck async function (matches pattern above)

2. Update packages/worker-utils/src/index.ts - export health check utilities

3. Update all 4 workers:
   - Import standardDatabaseCheck
   - Replace custom database check with: checkDatabase: standardDatabaseCheck

VERIFICATION COMMANDS:
- Test /health endpoint in each worker
- pnpm --filter auth test
- pnpm --filter content-api test
- pnpm --filter identity-api test
- pnpm --filter stripe-webhook-handler test

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 6) to track your progress.
```

---

## Task 7: Extract Test Setup Helpers

**Agent Type:** `test-engineer`

**Prompt:**

```
You are executing Task 7 from REFACTORING_EXECUTION_PLAN.md: Extract Test Setup Helpers.

OBJECTIVE:
Create reusable test setup helpers to eliminate repeated beforeAll/afterAll boilerplate.

SEARCH TASKS:
- Search pattern: setupTestDb in packages/*/src/**/*.test.ts
- Search pattern: cleanupTestDb in packages/*/src/**/*.test.ts

REQUIRED READING (sample test files):
1. packages/content/src/services/__tests__/content-service.test.ts
2. packages/identity/src/services/__tests__/organization-service.test.ts
3. packages/access/src/services/ContentAccessService.integration.test.ts

IDENTIFY PATTERN:
Every test file has:
```typescript
let db: Database;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await cleanupTestDb(db); });
```

IMPLEMENTATION:
1. Create packages/test-utils/src/setup.ts:
   - createTestContext() - returns () => ({ db })
   - createServiceTest<T>(createService) - returns () => ({ db, service })

2. Update packages/test-utils/src/index.ts - export setup helpers

3. Refactor all test files found in search (approximately 15 files):
   - Replace beforeAll/afterAll boilerplate with createTestContext() or createServiceTest()

VERIFICATION COMMANDS:
- pnpm test:packages
- Run tests multiple times to ensure reliability

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 7) to track your progress.
```

---

## Task 8: Standardize Pagination Responses

**Agent Type:** `api-endpoint-architect`

**Prompt:**

```
You are executing Task 8 from REFACTORING_EXECUTION_PLAN.md: Standardize Pagination Responses.

OBJECTIVE:
Create standardized pagination format across all list endpoints with proper types, validators, and response formatters.

SEARCH TASKS:
- Search for route handlers returning arrays: app\.get\(.*\[\] in workers/*/src/routes/*.ts
- Search for existing pagination: pagination|pageSize|page in workers/*/src/routes/*.ts

REQUIRED READING:
1. workers/content-api/src/routes/content.ts (list endpoints)
2. workers/content-api/src/routes/media.ts (list endpoints)
3. workers/identity-api/src/routes/organizations.ts (list endpoints)

IMPLEMENTATION (in order):
1. Create packages/shared-types/src/pagination.ts:
   - PaginationParams, PaginationMeta, PaginatedResponse<T> interfaces

2. Create packages/worker-utils/src/response-formatters.ts:
   - paginatedResponse<T>() function
   - normalizePaginationParams() function
   - Constants: DEFAULT_PAGE_SIZE=20, MAX_PAGE_SIZE=100

3. Update packages/validation/src/primitives.ts:
   - paginationQuerySchema (page: default 1, pageSize: default 20, max 100)

4. Update service layer methods to accept page/pageSize and return { items, total }

5. Update route handlers to use pagination helpers

VERIFICATION COMMANDS:
- Test pagination with various page/pageSize values
- pnpm --filter content-api test
- pnpm --filter identity-api test
- pnpm typecheck

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 8) to track your progress.
```

---

## Task 9: Improve Naming Consistency

**Agent Type:** `code-standards-enforcer`

**Prompt:**

```
You are executing Task 9 from REFACTORING_EXECUTION_PLAN.md: Improve Naming Consistency.

OBJECTIVE:
Standardize naming: use constructors for services, keep create* prefix for utilities/middleware.

SEARCH TASKS:
- Search for: createContentService in entire codebase
- Search for: createMediaService in entire codebase
- Search for: createOrganizationService in entire codebase
- Search for: createContentAccessService in entire codebase
- Search for: create[A-Z]\w+ (all create* patterns)

DECISION STANDARD:
- Services: Use `new ContentService(config)` (direct constructor)
- Utilities/Middleware: Keep `createHealthCheckHandler()` pattern

IMPLEMENTATION:
1. If service factory functions exist:
   - Remove from package exports
   - Ensure service classes are exported

2. Update all route handlers:
   - Replace createContentService() with new ContentService()
   - Update imports

3. Update all test files using service factories

VERIFICATION COMMANDS:
- pnpm typecheck
- pnpm test
- Search codebase to confirm no service factories remain

Use the Definition of Done checklist in REFACTORING_EXECUTION_PLAN.md (Task 9) to track your progress.
```

---

## General Instructions for All Tasks

### Before Starting Any Task:

1. **Read the full task specification** in REFACTORING_EXECUTION_PLAN.md
2. **Use the Definition of Done checklist** - check off items as you complete them
3. **Update REFACTORING_STATUS.md** when task is complete

### Context Efficiency Tips:

- **Read only required files** - Don't read entire packages
- **Use search first** - Identify exact locations before reading files
- **Read specific line ranges** - Most prompts include line numbers
- **Batch file reads** - Read related files together in parallel

### After Completing Each Task:

1. Check all items in Definition of Done checklist
2. Run all verification commands
3. Update REFACTORING_STATUS.md:
   - Change status from ⬜ to ✅
   - Add any notes about deviations or issues
4. Commit changes with descriptive message

### Execution Order (Critical):

Execute tasks in this sequence only:
1. Task 1 → 2 → 6 → 5 → 3 → 4 → 7 → 8 → 9

Do not start a task until the previous task is complete and committed.

---

## Quick Reference: Required Files by Task

| Task | Files to Read | Files to Create | Files to Modify |
|------|---------------|-----------------|-----------------|
| 1 | 3 files | 0 | 3 files |
| 2 | 4 files | 1 file | 4 files |
| 3 | 4 files | 2 files | 6 files |
| 4 | 4 files | 1 file | 6 files |
| 5 | 3 files | 1 file | 3 files |
| 6 | 5 files | 1 file | 5 files |
| 7 | 4 files | 1 file | 15+ files |
| 8 | 4 files | 3 files | 10+ files |
| 9 | All routes | 0 | 10+ files |

---

## Emergency Rollback

If any task causes critical failures:

```bash
# Rollback last commit
git reset --hard HEAD~1

# Mark task as failed in REFACTORING_STATUS.md
# Document issue in task notes
# Discuss with team before retrying
```
