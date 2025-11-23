# Refactoring Execution Plan

This document contains detailed instructions for each approved refactoring task. Each task will be executed by a specialized agent in sequence.

**Approved Tasks (in priority order):**
1. ✅ Eliminate duplicate error classes
2. ✅ Consolidate Wrangler configuration
3. ✅ Extract database query helpers
4. ✅ Create base service class
5. ✅ Extract custom worker middleware chains
6. ✅ Standardize health check configuration
7. ✅ Extract test setup helpers
8. ✅ Standardize pagination responses across APIs
9. ✅ Improve naming consistency

**Deferred Tasks:**
- ❌ Service package consolidation (future consideration)

---

## Task 1: Eliminate Duplicate Error Classes

**Agent Type:** `service-layer-architect`

**Objective:**
Remove duplicate error class definitions for `ContentNotFoundError` and `MediaNotFoundError` that exist in both `@codex/content` and `@codex/access` packages.

**Current State:**
- `packages/content/src/errors.ts` defines `ContentNotFoundError` and `MediaNotFoundError`
- `packages/access/src/errors.ts` also defines these same errors with different constructor signatures

**Detailed Instructions:**

1. **Analysis Phase:**
   - Read `packages/content/src/errors.ts` (lines 32-42)
   - Read `packages/access/src/errors.ts` (lines 11-81)
   - Document the constructor signature differences
   - Search the entire codebase for all imports and usages of these errors from both packages

2. **Decision:**
   - Use `@codex/content` as the canonical source (it was created first)
   - Update `ContentNotFoundError` constructor to support optional context parameter (backward compatible)
   - Update `MediaNotFoundError` constructor to support both signatures

3. **Implementation:**
   - Update `packages/content/src/errors.ts`:
     - Modify `ContentNotFoundError` to accept optional `context` parameter
     - Modify `MediaNotFoundError` to accept optional parameters matching access package usage
   - Update `packages/access/src/errors.ts`:
     - Remove `ContentNotFoundError` and `MediaNotFoundError` class definitions
     - Add exports: `export { ContentNotFoundError, MediaNotFoundError } from '@codex/content';`
   - Update `packages/access/package.json`:
     - Add `@codex/content` to dependencies if not already present

4. **Verification:**
   - Run `pnpm --filter @codex/access test` - all tests must pass
   - Run `pnpm --filter @codex/content test` - all tests must pass
   - Run `pnpm typecheck` - no type errors
   - Search codebase to confirm no broken imports

5. **Success Criteria:**
   - Zero duplicate error class definitions
   - All tests passing
   - No type errors
   - Backward compatibility maintained

**Expected Files Changed:**
- `packages/content/src/errors.ts` (modified - add optional parameters)
- `packages/access/src/errors.ts` (modified - remove duplicates, add re-exports)
- `packages/access/package.json` (modified - add dependency)

**Estimated Impact:** ~20 lines removed, prevents API divergence

---

### Task 1: Definition of Done Checklist

**Analysis Phase:**
- [ ] Read `packages/content/src/errors.ts` and documented all error classes
- [ ] Read `packages/access/src/errors.ts` and documented all error classes
- [ ] Identified constructor signature differences between duplicate errors
- [ ] Searched codebase for all imports of `ContentNotFoundError` from both packages
- [ ] Searched codebase for all imports of `MediaNotFoundError` from both packages
- [ ] Documented all usage locations and patterns

**Implementation Phase:**
- [ ] Updated `ContentNotFoundError` in `packages/content/src/errors.ts` to support optional context parameter
- [ ] Updated `MediaNotFoundError` in `packages/content/src/errors.ts` to support both constructor signatures
- [ ] Verified backward compatibility of updated error constructors
- [ ] Removed `ContentNotFoundError` class definition from `packages/access/src/errors.ts`
- [ ] Removed `MediaNotFoundError` class definition from `packages/access/src/errors.ts`
- [ ] Added re-export statement in `packages/access/src/errors.ts`: `export { ContentNotFoundError, MediaNotFoundError } from '@codex/content';`
- [ ] Checked if `@codex/content` is already in `packages/access/package.json` dependencies
- [ ] Added `@codex/content` to dependencies if not present

**Verification Phase:**
- [ ] Ran `pnpm --filter @codex/access test` - all tests pass
- [ ] Ran `pnpm --filter @codex/content test` - all tests pass
- [ ] Ran `pnpm typecheck` - no type errors
- [ ] Searched codebase for any remaining imports of errors from `@codex/access` and verified they work
- [ ] Verified no broken imports or missing dependencies
- [ ] Confirmed exactly 2 error classes removed from access package

**Quality Checks:**
- [ ] Code follows existing style and conventions
- [ ] No console errors or warnings during tests
- [ ] JSDoc comments preserved or updated if needed
- [ ] Backward compatibility maintained (existing code still works)

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Zero duplicate error class definitions remain in codebase

---

## Task 2: Consolidate Wrangler Configuration

**Agent Type:** `integration-orchestrator`

**Objective:**
Extract shared wrangler configuration into a base config file that all workers can extend, eliminating duplication of KV bindings, observability settings, and compatibility flags.

**Current State:**
- 4 workers each have `wrangler.jsonc` files with repeated configuration
- All workers use identical: `RATE_LIMIT_KV` binding, `observability: { enabled: true }`, `compatibility_flags: ["nodejs_compat"]`
- Environment structure is identical across workers

**Detailed Instructions:**

1. **Analysis Phase:**
   - Read all 4 wrangler files:
     - `workers/auth/wrangler.jsonc`
     - `workers/content-api/wrangler.jsonc`
     - `workers/identity-api/wrangler.jsonc`
     - `workers/stripe-webhook-handler/wrangler.jsonc`
   - Identify exact commonalities and differences
   - Check if wrangler v3+ supports `extends` (it does)

2. **Create Base Config:**
   - Create `config/cloudflare/base-wrangler.jsonc`:
     ```jsonc
     {
       "compatibility_date": "2025-01-01",
       "compatibility_flags": ["nodejs_compat"],
       "observability": {
         "enabled": true
       },
       "kv_namespaces": [
         {
           "binding": "RATE_LIMIT_KV",
           "id": "cea7153364974737b16870df08f31083"
         }
       ],
       "env": {
         "production": {
           "vars": {
             "ENVIRONMENT": "production",
             "DB_METHOD": "PRODUCTION",
             "WEB_APP_URL": "https://codex.revelations.studio",
             "API_URL": "https://api.revelations.studio"
           }
         },
         "staging": {
           "vars": {
             "ENVIRONMENT": "staging",
             "DB_METHOD": "PRODUCTION",
             "WEB_APP_URL": "https://codex-staging.revelations.studio",
             "API_URL": "https://api-staging.revelations.studio"
           }
         }
       }
     }
     ```

3. **Update Worker Configs:**
   - For each worker, replace common config with `extends`:
     - Keep worker-specific: `name`, `main`, `routes`, worker-specific bindings (R2, additional KV)
     - Remove: `compatibility_date`, `compatibility_flags`, `observability`, `RATE_LIMIT_KV`, base env vars

   Example for `workers/content-api/wrangler.jsonc`:
   ```jsonc
   {
     "$schema": "../../node_modules/wrangler/config-schema.json",
     "extends": "../../config/cloudflare/base-wrangler.jsonc",
     "name": "content-api",
     "main": "dist/index.js",
     "r2_buckets": [
       {
         "binding": "MEDIA_BUCKET",
         "bucket_name": "codex-media-production",
         "preview_bucket_name": "codex-media-test"
       }
     ],
     "env": {
       "production": {
         "name": "content-api-production",
         "routes": [
           {
             "pattern": "content-api.revelations.studio/*",
             "custom_domain": true
           }
         ]
       },
       "staging": {
         "name": "content-api-staging",
         "routes": [
           {
             "pattern": "content-api-staging.revelations.studio/*",
             "custom_domain": true
           }
         ]
       }
     }
   }
   ```

4. **Handle Worker-Specific Bindings:**
   - `auth`: Add `AUTH_SESSION_KV` to its config (worker-specific)
   - `content-api`: Keep `MEDIA_BUCKET` R2 binding
   - `identity-api`: Already has no extra bindings
   - `stripe-webhook-handler`: Check for stripe-specific vars

5. **Verification:**
   - Run `pnpm build:workers` - all workers must build successfully
   - For each worker, run `wrangler deploy --dry-run --env staging` to verify config parsing
   - Check that all bindings are correctly resolved
   - Verify no secrets are accidentally committed to base config

6. **Documentation:**
   - Add comments to base config explaining what it contains
   - Add note in each worker config about extending base

**Expected Files Changed:**
- `config/cloudflare/base-wrangler.jsonc` (new file ~60 lines)
- `workers/auth/wrangler.jsonc` (reduced from ~90 → ~40 lines)
- `workers/content-api/wrangler.jsonc` (reduced from ~86 → ~35 lines)
- `workers/identity-api/wrangler.jsonc` (reduced from ~64 → ~25 lines)
- `workers/stripe-webhook-handler/wrangler.jsonc` (reduced from ~80 → ~35 lines)

**Success Criteria:**
- All workers extend base config
- Worker configs only contain worker-specific configuration
- Dry-run deploys succeed
- ~240 lines of duplication eliminated

**Estimated Impact:** ~240 lines removed, single source of truth for shared config

---

### Task 2: Definition of Done Checklist

**Analysis Phase:**
- [ ] Read `workers/auth/wrangler.jsonc` and documented configuration
- [ ] Read `workers/content-api/wrangler.jsonc` and documented configuration
- [ ] Read `workers/identity-api/wrangler.jsonc` and documented configuration
- [ ] Read `workers/stripe-webhook-handler/wrangler.jsonc` and documented configuration
- [ ] Identified all common configuration (KV bindings, observability, compatibility flags, env structure)
- [ ] Identified worker-specific configuration (R2 buckets, additional KV namespaces, routes)
- [ ] Verified wrangler v3 supports `extends` field

**Base Config Creation:**
- [ ] Created `config/cloudflare/base-wrangler.jsonc` file
- [ ] Added `compatibility_date`, `compatibility_flags`, `observability` to base config
- [ ] Added `RATE_LIMIT_KV` binding to base config with correct ID
- [ ] Added production environment vars to base config (ENVIRONMENT, DB_METHOD, WEB_APP_URL, API_URL)
- [ ] Added staging environment vars to base config
- [ ] Added comments explaining what base config contains
- [ ] Verified no secrets accidentally included in base config

**Worker Config Updates:**
- [ ] Updated `workers/auth/wrangler.jsonc` to extend base config
- [ ] Kept `AUTH_SESSION_KV` binding in auth worker (worker-specific)
- [ ] Removed duplicate config from auth worker (compatibility, observability, RATE_LIMIT_KV, base env vars)
- [ ] Updated `workers/content-api/wrangler.jsonc` to extend base config
- [ ] Kept `MEDIA_BUCKET` R2 binding in content-api worker
- [ ] Removed duplicate config from content-api worker
- [ ] Updated `workers/identity-api/wrangler.jsonc` to extend base config
- [ ] Removed duplicate config from identity-api worker
- [ ] Updated `workers/stripe-webhook-handler/wrangler.jsonc` to extend base config
- [ ] Removed duplicate config from stripe-webhook-handler worker
- [ ] Added comments in each worker config noting it extends base

**Verification Phase:**
- [ ] Ran `pnpm build:workers` - all workers build successfully
- [ ] Ran `wrangler deploy --dry-run --env staging` for auth worker - config valid
- [ ] Ran `wrangler deploy --dry-run --env staging` for content-api worker - config valid
- [ ] Ran `wrangler deploy --dry-run --env staging` for identity-api worker - config valid
- [ ] Ran `wrangler deploy --dry-run --env staging` for stripe-webhook-handler worker - config valid
- [ ] Verified all KV bindings correctly resolved in each worker
- [ ] Verified all R2 bindings correctly resolved in content-api
- [ ] Verified environment variables correctly merged

**Quality Checks:**
- [ ] Base config uses valid JSON (no trailing commas, proper syntax)
- [ ] Worker configs use valid JSON
- [ ] No secrets committed to git
- [ ] Config IDs match existing infrastructure
- [ ] Each worker config reduced by ~50% lines

**Completion:**
- [ ] All 5 config files saved and formatted
- [ ] Changes ready for commit
- [ ] Approximately 240 lines of duplication eliminated

---

## Task 3: Extract Database Query Helpers

**Agent Type:** `database-schema-architect`

**Objective:**
Create reusable query helper functions to eliminate repeated patterns for soft deletes, scoping, and pagination across all service classes.

**Current State:**
- Soft delete checks (`isNull(table.deletedAt)`) repeated ~15 times
- Creator scoping (`eq(table.creatorId, creatorId)`) repeated ~12 times
- Pagination logic (`limit/offset`) repeated ~8 times

**Detailed Instructions:**

1. **Analysis Phase:**
   - Search for all occurrences of `isNull(.*deletedAt)` in service files
   - Search for all occurrences of `eq(.*creatorId` in service files
   - Search for all pagination patterns (`.limit(.*).offset(.*)`
   - Document current usage patterns and variations

2. **Create Query Helpers:**
   - Create `packages/database/src/utils/query-helpers.ts`:
     ```typescript
     import { SQL, and, eq, isNull } from 'drizzle-orm';
     import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

     /**
      * Soft delete filter - excludes deleted records
      * @example
      * db.query.content.findMany({
      *   where: whereNotDeleted(content)
      * })
      */
     export function whereNotDeleted<T extends PgTable>(
       table: T & { deletedAt: PgColumn }
     ): SQL {
       return isNull(table.deletedAt);
     }

     /**
      * Creator scoping - filters by creator ID
      * @example
      * db.query.content.findMany({
      *   where: withCreatorScope(content, userId)
      * })
      */
     export function withCreatorScope<T extends PgTable>(
       table: T & { creatorId: PgColumn },
       creatorId: string
     ): SQL {
       return eq(table.creatorId, creatorId);
     }

     /**
      * Organization scoping - filters by organization ID
      * @example
      * db.query.content.findMany({
      *   where: withOrgScope(content, orgId)
      * })
      */
     export function withOrgScope<T extends PgTable>(
       table: T & { organizationId: PgColumn },
       organizationId: string
     ): SQL {
       return eq(table.organizationId, organizationId);
     }

     /**
      * Pagination helper - returns limit and offset
      * @example
      * db.query.content.findMany({
      *   ...withPagination(page, pageSize)
      * })
      */
     export function withPagination(page: number, pageSize: number) {
       return {
         limit: pageSize,
         offset: (page - 1) * pageSize,
       };
     }

     /**
      * Combined: not deleted + creator scoped
      * Most common pattern in the codebase
      */
     export function scopedNotDeleted<T extends PgTable>(
       table: T & { deletedAt: PgColumn; creatorId: PgColumn },
       creatorId: string
     ): SQL {
       return and(whereNotDeleted(table), withCreatorScope(table, creatorId));
     }

     /**
      * Combined: not deleted + organization scoped
      */
     export function orgScopedNotDeleted<T extends PgTable>(
       table: T & { deletedAt: PgColumn; organizationId: PgColumn },
       organizationId: string
     ): SQL {
       return and(whereNotDeleted(table), withOrgScope(table, organizationId));
     }
     ```

3. **Export from Database Package:**
   - Update `packages/database/src/utils/index.ts` to export query helpers
   - Update `packages/database/src/index.ts` to re-export from utils

4. **Refactor Service Files:**
   - Update each service file to import and use helpers:
     - `packages/content/src/services/content-service.ts`
     - `packages/content/src/services/media-service.ts`
     - `packages/identity/src/services/organization-service.ts`
     - `packages/access/src/services/ContentAccessService.ts`

   Example refactor:
   ```typescript
   // Before
   const content = await this.db.query.content.findFirst({
     where: and(
       eq(content.id, id),
       isNull(content.deletedAt),
       eq(content.creatorId, creatorId)
     ),
     limit: 10,
     offset: (page - 1) * 10,
   });

   // After
   import { scopedNotDeleted, withPagination } from '@codex/database';

   const content = await this.db.query.content.findFirst({
     where: and(
       eq(content.id, id),
       scopedNotDeleted(content, creatorId)
     ),
     ...withPagination(page, 10),
   });
   ```

5. **Type Safety Verification:**
   - Ensure TypeScript correctly infers types
   - Test that incorrect usage (e.g., table without deletedAt) produces compile error
   - Verify autocomplete works in IDE

6. **Testing:**
   - Add unit tests for query helpers in `packages/database/src/utils/__tests__/query-helpers.test.ts`
   - Run all service tests to ensure queries still work correctly
   - Run `pnpm test:packages` - all must pass

**Expected Files Changed:**
- `packages/database/src/utils/query-helpers.ts` (new file ~120 lines)
- `packages/database/src/utils/index.ts` (modified - export helpers)
- `packages/database/src/index.ts` (modified - re-export)
- `packages/content/src/services/content-service.ts` (refactored ~15 query locations)
- `packages/content/src/services/media-service.ts` (refactored ~8 query locations)
- `packages/identity/src/services/organization-service.ts` (refactored ~10 query locations)
- `packages/access/src/services/ContentAccessService.ts` (refactored ~5 query locations)

**Success Criteria:**
- All repeated query patterns replaced with helpers
- ~80 lines of duplication removed across services
- All tests passing
- Type safety maintained
- Helper tests added

**Estimated Impact:** ~80 lines removed, enforces consistent query patterns, prevents bugs

---

### Task 3: Definition of Done Checklist

**Analysis Phase:**
- [ ] Searched for all occurrences of `isNull(.*deletedAt)` in service files
- [ ] Searched for all occurrences of `eq(.*creatorId` in service files
- [ ] Searched for all pagination patterns `.limit(.*).offset(.*)`
- [ ] Documented all current usage patterns and variations
- [ ] Counted total instances of each pattern type

**Helper Creation:**
- [ ] Created `packages/database/src/utils/query-helpers.ts` file
- [ ] Implemented `whereNotDeleted<T>()` helper function with proper types
- [ ] Implemented `withCreatorScope<T>()` helper function with proper types
- [ ] Implemented `withOrgScope<T>()` helper function with proper types
- [ ] Implemented `withPagination()` helper function
- [ ] Implemented `scopedNotDeleted<T>()` combined helper
- [ ] Implemented `orgScopedNotDeleted<T>()` combined helper
- [ ] Added JSDoc comments with @example tags for all helpers
- [ ] Verified TypeScript types are correct and restrictive

**Package Export Updates:**
- [ ] Created or updated `packages/database/src/utils/index.ts` to export query helpers
- [ ] Updated `packages/database/src/index.ts` to re-export from utils
- [ ] Verified exports are accessible from `@codex/database`

**Service Refactoring:**
- [ ] Refactored `packages/content/src/services/content-service.ts` to use helpers
- [ ] Refactored `packages/content/src/services/media-service.ts` to use helpers
- [ ] Refactored `packages/identity/src/services/organization-service.ts` to use helpers
- [ ] Refactored `packages/access/src/services/ContentAccessService.ts` to use helpers
- [ ] Added imports for query helpers in all service files
- [ ] Verified all soft delete checks now use `whereNotDeleted()`
- [ ] Verified all creator scoping uses `withCreatorScope()` or `scopedNotDeleted()`
- [ ] Verified all pagination uses `withPagination()`

**Testing:**
- [ ] Created `packages/database/src/utils/__tests__/query-helpers.test.ts` test file
- [ ] Added unit tests for `whereNotDeleted()` helper
- [ ] Added unit tests for `withCreatorScope()` helper
- [ ] Added unit tests for `withOrgScope()` helper
- [ ] Added unit tests for `withPagination()` helper
- [ ] Added unit tests for combined helpers
- [ ] Verified type safety (incorrect usage produces compile error)
- [ ] Tested IDE autocomplete works for helpers

**Verification Phase:**
- [ ] Ran `pnpm --filter @codex/database test` - all tests pass
- [ ] Ran `pnpm --filter @codex/content test` - all tests pass
- [ ] Ran `pnpm --filter @codex/identity test` - all tests pass
- [ ] Ran `pnpm --filter @codex/access test` - all tests pass
- [ ] Ran `pnpm typecheck` - no type errors
- [ ] Verified queries return correct results (behavior unchanged)

**Quality Checks:**
- [ ] Helper functions follow functional programming patterns
- [ ] No side effects in helper functions
- [ ] Type inference works correctly
- [ ] Code follows existing Drizzle patterns
- [ ] Approximately 80 lines removed across services

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] All repeated query patterns eliminated

---

## Task 4: Create Base Service Class

**Agent Type:** `service-layer-architect`

**Objective:**
Extract common service patterns into a base class to eliminate repeated constructor logic and provide shared transaction/error handling utilities.

**Current State:**
- All 5 service classes repeat identical constructor pattern
- Transaction logic repeated across services
- No standardized error handling wrapper

**Detailed Instructions:**

1. **Analysis Phase:**
   - Read all service constructors:
     - `packages/content/src/services/content-service.ts`
     - `packages/content/src/services/media-service.ts`
     - `packages/identity/src/services/organization-service.ts`
     - `packages/access/src/services/ContentAccessService.ts`
   - Document common patterns and any variations

2. **Create Base Service:**
   - Create `packages/service-errors/src/base-service.ts`:
     ```typescript
     import type { Database, DatabaseTransaction } from '@codex/database';
     import { isServiceError, wrapError } from './error-wrapper';

     /**
      * Configuration for all services
      */
     export interface ServiceConfig {
       db: Database;
       environment: 'development' | 'staging' | 'production' | 'test';
     }

     /**
      * Base class for all domain services
      * Provides common functionality: db access, transactions, error handling
      */
     export abstract class BaseService {
       protected readonly db: Database;
       protected readonly environment: string;

       constructor(config: ServiceConfig) {
         this.db = config.db;
         this.environment = config.environment;
       }

       /**
        * Execute a database transaction with automatic error wrapping
        * @example
        * return this.withTransaction(async (tx) => {
        *   const result = await tx.insert(table).values(data);
        *   return result;
        * });
        */
       protected async withTransaction<T>(
         fn: (tx: DatabaseTransaction) => Promise<T>
       ): Promise<T> {
         return this.db.transaction(fn);
       }

       /**
        * Wrap unknown errors with service context
        * Preserves ServiceError instances, wraps everything else
        */
       protected handleError(error: unknown, context?: string): never {
         if (isServiceError(error)) {
           throw error;
         }
         throw wrapError(error, {
           service: this.constructor.name,
           environment: this.environment,
           ...(context && { context }),
         });
       }
     }
     ```

3. **Export from Service Errors Package:**
   - Update `packages/service-errors/src/index.ts` to export `BaseService` and `ServiceConfig`

4. **Refactor Service Classes:**
   - Update each service to extend `BaseService`:

   Example:
   ```typescript
   // Before
   export class ContentService {
     private db: Database;
     private environment: string;

     constructor(config: { db: Database; environment: string }) {
       this.db = config.db;
       this.environment = config.environment;
     }

     async create(input: CreateContentInput, creatorId: string) {
       return this.db.transaction(async (tx) => {
         // logic
       });
     }
   }

   // After
   import { BaseService, type ServiceConfig } from '@codex/service-errors';

   export class ContentService extends BaseService {
     constructor(config: ServiceConfig) {
       super(config);
     }

     async create(input: CreateContentInput, creatorId: string) {
       return this.withTransaction(async (tx) => {
         // logic
       });
     }
   }
   ```

5. **Update Service Factories:**
   - Check if factory functions exist (e.g., `createContentService`)
   - Update to use `ServiceConfig` type
   - Ensure factories still work correctly

6. **Testing:**
   - Run all service tests
   - Verify transaction behavior unchanged
   - Verify error handling works correctly
   - Check that `this.db` and `this.environment` are accessible in services

**Expected Files Changed:**
- `packages/service-errors/src/base-service.ts` (new file ~60 lines)
- `packages/service-errors/src/index.ts` (modified - export BaseService)
- `packages/content/src/services/content-service.ts` (refactored - extend BaseService)
- `packages/content/src/services/media-service.ts` (refactored - extend BaseService)
- `packages/identity/src/services/organization-service.ts` (refactored - extend BaseService)
- `packages/access/src/services/ContentAccessService.ts` (refactored - extend BaseService)

**Success Criteria:**
- All services extend BaseService
- No duplicate constructor logic
- All tests passing
- Transaction behavior unchanged
- ~50 lines removed across services

**Estimated Impact:** ~50 lines removed, enforces consistent service structure

---

### Task 4: Definition of Done Checklist

**Analysis Phase:**
- [ ] Read all service class constructors (ContentService, MediaService, OrganizationService, ContentAccessService)
- [ ] Documented common patterns in constructors
- [ ] Identified any variations between services
- [ ] Documented transaction usage patterns
- [ ] Searched for all service instantiation locations

**Base Service Creation:**
- [ ] Created `packages/service-errors/src/base-service.ts` file
- [ ] Implemented `ServiceConfig` interface with db and environment properties
- [ ] Implemented `BaseService` abstract class
- [ ] Added protected `db` and `environment` properties
- [ ] Implemented constructor accepting `ServiceConfig`
- [ ] Implemented `withTransaction<T>()` protected method
- [ ] Implemented `handleError()` protected method with proper error wrapping
- [ ] Added comprehensive JSDoc comments

**Package Export Updates:**
- [ ] Updated `packages/service-errors/src/index.ts` to export `BaseService`
- [ ] Updated `packages/service-errors/src/index.ts` to export `ServiceConfig`
- [ ] Verified exports are accessible

**Service Refactoring:**
- [ ] Updated `ContentService` to extend `BaseService`
- [ ] Removed duplicate constructor logic from `ContentService`
- [ ] Updated transaction calls in `ContentService` to use `this.withTransaction()`
- [ ] Updated `MediaService` to extend `BaseService`
- [ ] Removed duplicate constructor logic from `MediaService`
- [ ] Updated transaction calls in `MediaService` to use `this.withTransaction()`
- [ ] Updated `OrganizationService` to extend `BaseService`
- [ ] Removed duplicate constructor logic from `OrganizationService`
- [ ] Updated transaction calls in `OrganizationService` to use `this.withTransaction()`
- [ ] Updated `ContentAccessService` to extend `BaseService`
- [ ] Removed duplicate constructor logic from `ContentAccessService`
- [ ] Updated transaction calls in `ContentAccessService` to use `this.withTransaction()`

**Factory Function Updates:**
- [ ] Checked if service factory functions exist (e.g., `createContentService`)
- [ ] Updated factory functions to use `ServiceConfig` type if present
- [ ] Verified factory functions still work correctly

**Verification Phase:**
- [ ] Ran `pnpm --filter @codex/content test` - all tests pass
- [ ] Ran `pnpm --filter @codex/identity test` - all tests pass
- [ ] Ran `pnpm --filter @codex/access test` - all tests pass
- [ ] Ran `pnpm typecheck` - no type errors
- [ ] Verified `this.db` accessible in all service methods
- [ ] Verified `this.environment` accessible in all service methods
- [ ] Verified transaction behavior unchanged

**Quality Checks:**
- [ ] All services properly extend BaseService
- [ ] No duplicate constructor code remains
- [ ] Transaction wrapper works correctly
- [ ] Error handling preserved
- [ ] Approximately 50 lines removed

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent service structure enforced

---

## Task 5: Extract Custom Worker Middleware Chains

**Agent Type:** `api-endpoint-architect`

**Objective:**
Create a middleware chain factory to eliminate repeated middleware setup in custom workers (auth, stripe-webhook-handler).

**Current State:**
- Auth worker manually applies 5-8 middleware calls
- Stripe webhook handler manually applies 5-8 middleware calls
- Middleware ordering is repeated

**Detailed Instructions:**

1. **Analysis Phase:**
   - Read `workers/auth/src/index.ts` (middleware section)
   - Read `workers/stripe-webhook-handler/src/index.ts` (middleware section)
   - Document the exact middleware order and any differences
   - Understand why these workers don't use `createWorker()` factory

2. **Create Middleware Chain Factory:**
   - Create `packages/worker-utils/src/middleware-chain.ts`:
     ```typescript
     import type { MiddlewareHandler } from 'hono';
     import {
       createLoggerMiddleware,
       createObservabilityMiddleware,
       createRequestTrackingMiddleware,
       createSecurityHeadersMiddleware,
     } from './middleware';

     export interface MiddlewareChainOptions {
       serviceName: string;
       skipLogging?: boolean;
       skipSecurityHeaders?: boolean;
       customMiddleware?: MiddlewareHandler[];
     }

     /**
      * Create standard middleware chain for workers
      * Returns array of middleware in correct execution order
      *
      * @example
      * const middlewares = createStandardMiddlewareChain({ serviceName: 'auth' });
      * for (const middleware of middlewares) {
      *   app.use('*', middleware);
      * }
      */
     export function createStandardMiddlewareChain(
       options: MiddlewareChainOptions
     ): MiddlewareHandler[] {
       const { serviceName, skipLogging, skipSecurityHeaders, customMiddleware } = options;

       const chain: MiddlewareHandler[] = [
         createRequestTrackingMiddleware(),
       ];

       if (!skipLogging) {
         chain.push(createLoggerMiddleware());
       }

       if (!skipSecurityHeaders) {
         chain.push(createSecurityHeadersMiddleware());
       }

       chain.push(createObservabilityMiddleware(serviceName));

       if (customMiddleware) {
         chain.push(...customMiddleware);
       }

       return chain;
     }

     /**
      * Apply middleware chain to Hono app
      * @example
      * applyMiddlewareChain(app, '*', { serviceName: 'auth' });
      */
     export function applyMiddlewareChain(
       app: any,
       path: string,
       options: MiddlewareChainOptions
     ): void {
       const chain = createStandardMiddlewareChain(options);
       for (const middleware of chain) {
         app.use(path, middleware);
       }
     }
     ```

3. **Export from Worker Utils:**
   - Update `packages/worker-utils/src/index.ts` to export middleware chain utilities

4. **Refactor Auth Worker:**
   - Update `workers/auth/src/index.ts`:
     ```typescript
     // Before (lines 37-37)
     app.use('*', createRequestTrackingMiddleware());

     // After
     import { applyMiddlewareChain } from '@codex/worker-utils';

     applyMiddlewareChain(app, '*', {
       serviceName: 'auth',
       skipSecurityHeaders: true, // Applied per-route
     });
     ```

5. **Refactor Stripe Webhook Handler:**
   - Update `workers/stripe-webhook-handler/src/index.ts`:
     ```typescript
     // Before (lines 47-56)
     app.use('*', createRequestTrackingMiddleware());
     app.use('*', createLoggerMiddleware());
     // ... etc

     // After
     import { applyMiddlewareChain } from '@codex/worker-utils';

     applyMiddlewareChain(app, '*', {
       serviceName: 'stripe-webhook-handler',
     });
     ```

6. **Verification:**
   - Run worker tests for auth and stripe-webhook-handler
   - Verify middleware execution order unchanged
   - Verify request tracking, logging, observability still work
   - Test health check endpoints

**Expected Files Changed:**
- `packages/worker-utils/src/middleware-chain.ts` (new file ~80 lines)
- `packages/worker-utils/src/index.ts` (modified - export chain utilities)
- `workers/auth/src/index.ts` (refactored - use chain factory)
- `workers/stripe-webhook-handler/src/index.ts` (refactored - use chain factory)

**Success Criteria:**
- Middleware chains consolidated into reusable factory
- Auth and stripe workers use chain factory
- All worker tests passing
- Middleware execution order preserved
- ~30 lines removed from workers

**Estimated Impact:** ~30 lines removed, consistent middleware ordering

---

### Task 5: Definition of Done Checklist

**Analysis Phase:**
- [ ] Read `workers/auth/src/index.ts` middleware setup section
- [ ] Read `workers/stripe-webhook-handler/src/index.ts` middleware setup section
- [ ] Documented exact middleware order in auth worker
- [ ] Documented exact middleware order in stripe-webhook-handler worker
- [ ] Identified differences between the two workers
- [ ] Understood why these workers don't use `createWorker()` factory

**Middleware Chain Factory Creation:**
- [ ] Created `packages/worker-utils/src/middleware-chain.ts` file
- [ ] Implemented `MiddlewareChainOptions` interface
- [ ] Implemented `createStandardMiddlewareChain()` function
- [ ] Implemented `applyMiddlewareChain()` function
- [ ] Added support for `serviceName` parameter
- [ ] Added support for `skipLogging` option
- [ ] Added support for `skipSecurityHeaders` option
- [ ] Added support for `customMiddleware` option
- [ ] Added comprehensive JSDoc comments with examples

**Package Export Updates:**
- [ ] Updated `packages/worker-utils/src/index.ts` to export middleware chain utilities
- [ ] Verified exports are accessible

**Auth Worker Refactoring:**
- [ ] Updated `workers/auth/src/index.ts` to import middleware chain utilities
- [ ] Replaced manual middleware application with `applyMiddlewareChain()` or `createStandardMiddlewareChain()`
- [ ] Ensured middleware order remains identical
- [ ] Removed duplicate middleware setup code
- [ ] Verified auth-specific middleware still applied correctly

**Stripe Webhook Handler Refactoring:**
- [ ] Updated `workers/stripe-webhook-handler/src/index.ts` to import middleware chain utilities
- [ ] Replaced manual middleware application with `applyMiddlewareChain()` or `createStandardMiddlewareChain()`
- [ ] Ensured middleware order remains identical
- [ ] Removed duplicate middleware setup code
- [ ] Verified stripe-specific middleware still applied correctly

**Verification Phase:**
- [ ] Ran `pnpm --filter auth test` - all tests pass
- [ ] Ran `pnpm --filter stripe-webhook-handler test` - all tests pass
- [ ] Tested auth worker `/health` endpoint locally
- [ ] Tested stripe-webhook-handler `/health` endpoint locally
- [ ] Verified request tracking still works (request IDs generated)
- [ ] Verified logging still works
- [ ] Verified observability still works
- [ ] Verified middleware execution order unchanged

**Quality Checks:**
- [ ] Middleware chain factory is reusable
- [ ] Options provide flexibility for different use cases
- [ ] Code follows existing patterns
- [ ] Approximately 30 lines removed from workers
- [ ] No behavioral changes

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent middleware ordering enforced

---

## Task 6: Standardize Health Check Configuration

**Agent Type:** `integration-orchestrator`

**Objective:**
Extract repeated health check logic (especially database checks) into reusable functions to eliminate duplication across 4 workers.

**Current State:**
- Database health check logic duplicated 4 times with identical implementation
- Each worker repeats same KV/R2 check patterns

**Detailed Instructions:**

1. **Analysis Phase:**
   - Read health check implementations in all 4 workers:
     - `workers/auth/src/index.ts` (lines 91-105)
     - `workers/content-api/src/index.ts`
     - `workers/identity-api/src/index.ts`
     - `workers/stripe-webhook-handler/src/index.ts` (lines 81-95)
   - Document exact duplication

2. **Create Standard Health Checks:**
   - Create `packages/worker-utils/src/health-checks.ts`:
     ```typescript
     import { testDbConnection } from '@codex/database';
     import type { Context } from 'hono';

     export interface HealthCheckResult {
       status: 'ok' | 'error';
       message: string;
     }

     /**
      * Standard database health check
      * Tests connection to Neon Postgres
      * @example
      * createHealthCheckHandler('service', '1.0.0', {
      *   checkDatabase: standardDatabaseCheck
      * })
      */
     export const standardDatabaseCheck = async (
       _c: Context
     ): Promise<HealthCheckResult> => {
       const isConnected = await testDbConnection();
       return {
         status: isConnected ? 'ok' : 'error',
         message: isConnected
           ? 'Database connection is healthy.'
           : 'Database connection failed.',
       };
     };

     /**
      * Create KV namespace check factory
      * Already exists as createKvCheck - just document it
      */
     // Note: createKvCheck already exists, ensure it's exported

     /**
      * Create R2 bucket check factory
      * Already exists as createR2Check - just document it
      */
     // Note: createR2Check already exists, ensure it's exported
     ```

3. **Export from Worker Utils:**
   - Update `packages/worker-utils/src/index.ts` to export health check utilities
   - Ensure `createKvCheck` and `createR2Check` are already exported

4. **Refactor Worker Health Checks:**
   - Update each worker to use `standardDatabaseCheck`:

   Example for auth worker:
   ```typescript
   // Before (workers/auth/src/index.ts lines 93-102)
   checkDatabase: async (_c: Context) => {
     const isConnected = await testDbConnection();
     return {
       status: isConnected ? 'ok' : 'error',
       message: isConnected
         ? 'Database connection is healthy.'
         : 'Database connection failed.',
     };
   }

   // After
   import { standardDatabaseCheck, createKvCheck } from '@codex/worker-utils';

   createHealthCheckHandler('auth-worker', '1.0.0', {
     checkDatabase: standardDatabaseCheck,
     checkKV: createKvCheck(['AUTH_SESSION_KV', 'RATE_LIMIT_KV']),
   })
   ```

5. **Apply to All Workers:**
   - `workers/auth/src/index.ts`
   - `workers/content-api/src/index.ts`
   - `workers/identity-api/src/index.ts`
   - `workers/stripe-webhook-handler/src/index.ts`

6. **Verification:**
   - Run each worker locally and test `/health` endpoint
   - Verify health checks correctly detect database status
   - Verify KV/R2 checks still work
   - Run all worker tests

**Expected Files Changed:**
- `packages/worker-utils/src/health-checks.ts` (new file ~40 lines)
- `packages/worker-utils/src/index.ts` (modified - export health checks)
- `workers/auth/src/index.ts` (refactored - use standardDatabaseCheck)
- `workers/content-api/src/index.ts` (refactored - use standardDatabaseCheck)
- `workers/identity-api/src/index.ts` (refactored - use standardDatabaseCheck)
- `workers/stripe-webhook-handler/src/index.ts` (refactored - use standardDatabaseCheck)

**Success Criteria:**
- All workers use `standardDatabaseCheck`
- Health check responses consistent across workers
- All health check tests passing
- ~32 lines removed from workers

**Estimated Impact:** ~32 lines removed, consistent health checks

---

### Task 6: Definition of Done Checklist

**Analysis Phase:**
- [ ] Read health check implementation in `workers/auth/src/index.ts`
- [ ] Read health check implementation in `workers/content-api/src/index.ts`
- [ ] Read health check implementation in `workers/identity-api/src/index.ts`
- [ ] Read health check implementation in `workers/stripe-webhook-handler/src/index.ts`
- [ ] Documented exact duplication in database check logic
- [ ] Verified `createKvCheck` and `createR2Check` already exist

**Standard Health Check Creation:**
- [ ] Created `packages/worker-utils/src/health-checks.ts` file
- [ ] Implemented `HealthCheckResult` interface
- [ ] Implemented `standardDatabaseCheck` function
- [ ] Added comprehensive JSDoc comments with @example tags
- [ ] Verified function signature matches existing pattern

**Package Export Updates:**
- [ ] Updated `packages/worker-utils/src/index.ts` to export health check utilities
- [ ] Verified `createKvCheck` is already exported
- [ ] Verified `createR2Check` is already exported
- [ ] Confirmed `standardDatabaseCheck` is exported

**Auth Worker Refactoring:**
- [ ] Updated `workers/auth/src/index.ts` to import `standardDatabaseCheck`
- [ ] Replaced custom database check with `standardDatabaseCheck`
- [ ] Verified health check configuration still correct
- [ ] Removed duplicate database check code

**Content-API Worker Refactoring:**
- [ ] Updated `workers/content-api/src/index.ts` to import `standardDatabaseCheck`
- [ ] Replaced custom database check with `standardDatabaseCheck`
- [ ] Verified health check configuration still correct
- [ ] Removed duplicate database check code

**Identity-API Worker Refactoring:**
- [ ] Updated `workers/identity-api/src/index.ts` to import `standardDatabaseCheck`
- [ ] Replaced custom database check with `standardDatabaseCheck`
- [ ] Verified health check configuration still correct
- [ ] Removed duplicate database check code

**Stripe Webhook Handler Refactoring:**
- [ ] Updated `workers/stripe-webhook-handler/src/index.ts` to import `standardDatabaseCheck`
- [ ] Replaced custom database check with `standardDatabaseCheck`
- [ ] Verified health check configuration still correct
- [ ] Removed duplicate database check code

**Verification Phase:**
- [ ] Tested `/health` endpoint in auth worker - returns correct status
- [ ] Tested `/health` endpoint in content-api worker - returns correct status
- [ ] Tested `/health` endpoint in identity-api worker - returns correct status
- [ ] Tested `/health` endpoint in stripe-webhook-handler worker - returns correct status
- [ ] Verified database health check detects connection failures
- [ ] Verified KV health checks work correctly
- [ ] Verified R2 health checks work correctly (content-api)
- [ ] Ran all worker tests - all pass

**Quality Checks:**
- [ ] Health check responses consistent across all workers
- [ ] Standard function is reusable
- [ ] Error messages are consistent
- [ ] Approximately 32 lines removed from workers
- [ ] No behavioral changes

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent health check responses enforced

---

## Task 7: Extract Test Setup Helpers

**Agent Type:** `test-engineer`

**Objective:**
Create reusable test setup helpers to eliminate repeated beforeAll/afterAll boilerplate across 15+ test files.

**Current State:**
- Every service test file repeats 5 lines of setup/teardown
- Pattern: `let db; beforeAll(setupTestDb); afterAll(cleanupTestDb)`

**Detailed Instructions:**

1. **Analysis Phase:**
   - Search for all test files with `setupTestDb` and `cleanupTestDb`
   - Document current patterns and any variations
   - Check if any tests have custom setup beyond standard pattern

2. **Create Test Setup Helper:**
   - Create `packages/test-utils/src/setup.ts`:
     ```typescript
     import type { Database } from '@codex/database';
     import { cleanupTestDb, setupTestDb } from './database';

     /**
      * Create test context with database setup/teardown
      * Automatically handles beforeAll/afterAll lifecycle
      *
      * @example
      * describe('ContentService', () => {
      *   const getContext = createTestContext();
      *
      *   it('should work', async () => {
      *     const { db } = getContext();
      *     // use db
      *   });
      * });
      */
     export function createTestContext() {
       let db: Database;

       beforeAll(async () => {
         db = await setupTestDb();
       });

       afterAll(async () => {
         await cleanupTestDb(db);
       });

       return () => ({ db });
     }

     /**
      * Create test context with service instance
      * Combines database setup with service instantiation
      *
      * @example
      * describe('ContentService', () => {
      *   const getContext = createServiceTest(
      *     (db) => new ContentService({ db, environment: 'test' })
      *   );
      *
      *   it('should work', async () => {
      *     const { db, service } = getContext();
      *     // use service
      *   });
      * });
      */
     export function createServiceTest<T>(
       createService: (db: Database) => T
     ) {
       let db: Database;
       let service: T;

       beforeAll(async () => {
         db = await setupTestDb();
         service = createService(db);
       });

       afterAll(async () => {
         await cleanupTestDb(db);
       });

       return () => ({ db, service });
     }
     ```

3. **Export from Test Utils:**
   - Update `packages/test-utils/src/index.ts` to export setup helpers

4. **Refactor Test Files:**
   - Update test files to use helpers. Example:

   ```typescript
   // Before
   describe('ContentService', () => {
     let db: Database;
     let service: ContentService;

     beforeAll(async () => {
       db = await setupTestDb();
       service = new ContentService({ db, environment: 'test' });
     });

     afterAll(async () => {
       await cleanupTestDb(db);
     });

     it('should create content', async () => {
       // test
     });
   });

   // After
   import { createServiceTest } from '@codex/test-utils';

   describe('ContentService', () => {
     const getContext = createServiceTest(
       (db) => new ContentService({ db, environment: 'test' })
     );

     it('should create content', async () => {
       const { service, db } = getContext();
       // test
     });
   });
   ```

5. **Target Test Files:**
   - `packages/content/src/services/__tests__/content-service.test.ts`
   - `packages/content/src/services/__tests__/media-service.test.ts`
   - `packages/identity/src/services/__tests__/organization-service.test.ts`
   - `packages/access/src/services/ContentAccessService.integration.test.ts`
   - Any other service test files found

6. **Verification:**
   - Run `pnpm test:packages` - all tests must pass
   - Verify setup/teardown still works correctly
   - Check that test isolation is maintained
   - Ensure no test database conflicts

**Expected Files Changed:**
- `packages/test-utils/src/setup.ts` (new file ~80 lines)
- `packages/test-utils/src/index.ts` (modified - export setup helpers)
- 15+ test files (refactored to use helpers)

**Success Criteria:**
- All service tests use setup helpers
- ~75 lines removed from test files
- All tests passing
- Test isolation maintained

**Estimated Impact:** ~75 lines removed, consistent test setup

---

### Task 7: Definition of Done Checklist

**Analysis Phase:**
- [ ] Searched for all test files using `setupTestDb` and `cleanupTestDb`
- [ ] Documented current test setup patterns
- [ ] Identified any custom setup variations beyond standard pattern
- [ ] Counted total instances of repeated setup code

**Test Setup Helper Creation:**
- [ ] Created `packages/test-utils/src/setup.ts` file
- [ ] Implemented `createTestContext()` function for database-only setup
- [ ] Implemented `createServiceTest<T>()` function for service + database setup
- [ ] Added proper TypeScript generics for type safety
- [ ] Added comprehensive JSDoc comments with @example tags
- [ ] Verified helpers work with Vitest lifecycle hooks

**Package Export Updates:**
- [ ] Updated `packages/test-utils/src/index.ts` to export setup helpers
- [ ] Verified exports are accessible from `@codex/test-utils`

**Test File Refactoring - Content Package:**
- [ ] Refactored `packages/content/src/services/__tests__/content-service.test.ts` to use helpers
- [ ] Removed beforeAll/afterAll boilerplate from content-service tests
- [ ] Refactored `packages/content/src/services/__tests__/media-service.test.ts` to use helpers
- [ ] Removed beforeAll/afterAll boilerplate from media-service tests
- [ ] Updated imports to use setup helpers
- [ ] Verified tests still have access to `db` and `service` instances

**Test File Refactoring - Identity Package:**
- [ ] Refactored `packages/identity/src/services/__tests__/organization-service.test.ts` to use helpers
- [ ] Removed beforeAll/afterAll boilerplate
- [ ] Verified tests still work correctly

**Test File Refactoring - Access Package:**
- [ ] Refactored `packages/access/src/services/ContentAccessService.integration.test.ts` to use helpers
- [ ] Removed beforeAll/afterAll boilerplate
- [ ] Verified integration tests still work correctly

**Test File Refactoring - Additional Files:**
- [ ] Searched for any other test files with repeated setup
- [ ] Refactored additional test files found
- [ ] Verified all refactored tests use consistent pattern

**Verification Phase:**
- [ ] Ran `pnpm test:packages` - all tests pass
- [ ] Verified test isolation maintained (no cross-test contamination)
- [ ] Verified database cleanup happens correctly
- [ ] Verified no test database conflicts
- [ ] Checked that setup/teardown timing is correct
- [ ] Ran tests multiple times to ensure reliability

**Quality Checks:**
- [ ] Test helper functions are reusable
- [ ] Type inference works correctly (IDE autocomplete)
- [ ] Approximately 75 lines removed from test files
- [ ] All tests still pass
- [ ] Test setup is consistent across all packages

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent test setup enforced

---

## Task 8: Standardize Pagination Responses

**Agent Type:** `api-endpoint-architect`

**Objective:**
Create standardized pagination response format and helper functions to ensure consistency across all API endpoints that return lists.

**Current State:**
- Pagination exists in some routes but not standardized
- No consistent response envelope for paginated data
- Page/limit logic varies across implementations

**Detailed Instructions:**

1. **Analysis Phase:**
   - Search for all routes that return lists/arrays
   - Document current pagination implementations:
     - `workers/content-api/src/routes/content.ts`
     - `workers/content-api/src/routes/media.ts`
     - `workers/identity-api/src/routes/organizations.ts`
   - Check validation schemas for pagination params
   - Identify which endpoints need pagination

2. **Create Pagination Types and Helpers:**
   - Create `packages/shared-types/src/pagination.ts`:
     ```typescript
     /**
      * Standard pagination query parameters
      */
     export interface PaginationParams {
       page?: number;
       pageSize?: number;
     }

     /**
      * Standard pagination metadata
      */
     export interface PaginationMeta {
       total: number;
       page: number;
       pageSize: number;
       totalPages: number;
       hasMore: boolean;
     }

     /**
      * Paginated response envelope
      */
     export interface PaginatedResponse<T> {
       data: T[];
       pagination: PaginationMeta;
     }
     ```

3. **Create Response Formatters:**
   - Create `packages/worker-utils/src/response-formatters.ts`:
     ```typescript
     import type { PaginatedResponse, PaginationMeta } from '@codex/shared-types';

     export const DEFAULT_PAGE_SIZE = 20;
     export const MAX_PAGE_SIZE = 100;

     /**
      * Create paginated response
      * @example
      * const response = paginatedResponse(items, total, page, pageSize);
      * return c.json(response);
      */
     export function paginatedResponse<T>(
       items: T[],
       total: number,
       page: number,
       pageSize: number
     ): PaginatedResponse<T> {
       return {
         data: items,
         pagination: {
           total,
           page,
           pageSize,
           totalPages: Math.ceil(total / pageSize),
           hasMore: page * pageSize < total,
         },
       };
     }

     /**
      * Normalize pagination params with defaults
      */
     export function normalizePaginationParams(
       page?: number,
       pageSize?: number
     ): { page: number; pageSize: number } {
       return {
         page: Math.max(1, page || 1),
         pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize || DEFAULT_PAGE_SIZE)),
       };
     }
     ```

4. **Create/Update Pagination Schemas:**
   - Update `packages/validation/src/primitives.ts`:
     ```typescript
     export const paginationQuerySchema = z.object({
       page: z.coerce.number().int().min(1).optional().default(1),
       pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
     });
     ```

5. **Update Service Layer:**
   - Add pagination support to service methods that return lists
   - Services should return `{ items: T[], total: number }`
   - Example in ContentService:
     ```typescript
     async list(
       filters: ContentFilters,
       creatorId: string,
       page: number = 1,
       pageSize: number = 20
     ) {
       const items = await this.db.query.content.findMany({
         where: scopedNotDeleted(content, creatorId),
         ...withPagination(page, pageSize),
       });

       const total = await this.db.select({ count: count() })
         .from(content)
         .where(scopedNotDeleted(content, creatorId));

       return { items, total: total[0].count };
     }
     ```

6. **Update Route Handlers:**
   - Update list endpoints to use pagination:
     ```typescript
     // Before
     app.get('/', createAuthenticatedHandler({
       handler: async (_c, ctx) => {
         const service = createContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });
         return service.list(ctx.user.id);
       }
     }));

     // After
     import { paginatedResponse, normalizePaginationParams } from '@codex/worker-utils';
     import { paginationQuerySchema } from '@codex/validation';

     app.get('/', createAuthenticatedHandler({
       schema: {
         query: contentQuerySchema.merge(paginationQuerySchema),
       },
       handler: async (c, ctx) => {
         const service = createContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });
         const { page, pageSize } = normalizePaginationParams(
           ctx.validated.query.page,
           ctx.validated.query.pageSize
         );
         const { items, total } = await service.list(
           ctx.validated.query,
           ctx.user.id,
           page,
           pageSize
         );
         return c.json(paginatedResponse(items, total, page, pageSize));
       }
     }));
     ```

7. **Apply to All List Endpoints:**
   - Content list endpoints
   - Media list endpoints
   - Organization list endpoints
   - Any other list endpoints

8. **Documentation:**
   - Document pagination format in API docs
   - Add JSDoc examples to response formatters

9. **Verification:**
   - Test pagination with various page/pageSize values
   - Verify total count is accurate
   - Test hasMore flag correctness
   - Run all API tests

**Expected Files Changed:**
- `packages/shared-types/src/pagination.ts` (new file ~30 lines)
- `packages/shared-types/src/index.ts` (export pagination types)
- `packages/worker-utils/src/response-formatters.ts` (new file ~60 lines)
- `packages/worker-utils/src/index.ts` (export formatters)
- `packages/validation/src/primitives.ts` (add paginationQuerySchema)
- Service files (add pagination params and return total)
- Route handler files (use pagination helpers)

**Success Criteria:**
- All list endpoints return paginated responses
- Consistent pagination format across all APIs
- Query params validated with schema
- Total count and hasMore flag accurate
- All tests passing

**Estimated Impact:** Consistent API responses, better client-side pagination support

---

### Task 8: Definition of Done Checklist

**Analysis Phase:**
- [ ] Searched for all routes returning lists/arrays
- [ ] Documented current pagination implementations in content-api routes
- [ ] Documented current pagination implementations in identity-api routes
- [ ] Documented current pagination implementations in media routes
- [ ] Checked validation schemas for existing pagination params
- [ ] Identified which endpoints currently have pagination
- [ ] Identified which endpoints need pagination added

**Type and Interface Creation:**
- [ ] Created `packages/shared-types/src/pagination.ts` file
- [ ] Implemented `PaginationParams` interface
- [ ] Implemented `PaginationMeta` interface
- [ ] Implemented `PaginatedResponse<T>` interface
- [ ] Added JSDoc comments to all interfaces
- [ ] Updated `packages/shared-types/src/index.ts` to export pagination types

**Response Formatter Creation:**
- [ ] Created `packages/worker-utils/src/response-formatters.ts` file
- [ ] Implemented `paginatedResponse<T>()` function
- [ ] Implemented `normalizePaginationParams()` function
- [ ] Defined `DEFAULT_PAGE_SIZE` constant (20)
- [ ] Defined `MAX_PAGE_SIZE` constant (100)
- [ ] Added comprehensive JSDoc comments with @example tags
- [ ] Updated `packages/worker-utils/src/index.ts` to export formatters

**Validation Schema Creation:**
- [ ] Updated `packages/validation/src/primitives.ts`
- [ ] Implemented `paginationQuerySchema` with Zod
- [ ] Added default values (page: 1, pageSize: 20)
- [ ] Added validation rules (min, max, coerce to number)
- [ ] Exported schema from `packages/validation/src/index.ts`

**Service Layer Updates - Content:**
- [ ] Updated `ContentService.list()` to accept page and pageSize params
- [ ] Updated query to use `withPagination()` helper
- [ ] Added count query to get total records
- [ ] Changed return type to `{ items: Content[], total: number }`
- [ ] Updated `MediaService.list()` similarly if exists

**Service Layer Updates - Identity:**
- [ ] Updated `OrganizationService.list()` to accept page and pageSize params
- [ ] Added pagination query and count
- [ ] Changed return type to `{ items, total }`

**Route Handler Updates - Content API:**
- [ ] Updated content list route to merge `paginationQuerySchema` into query schema
- [ ] Added `normalizePaginationParams()` call in handler
- [ ] Updated service call to pass page and pageSize
- [ ] Wrapped response with `paginatedResponse()`
- [ ] Updated media list route similarly
- [ ] Updated content-access list route if exists

**Route Handler Updates - Identity API:**
- [ ] Updated organization list route to add pagination
- [ ] Applied same pattern as content routes

**Verification Phase:**
- [ ] Tested pagination with page=1, pageSize=10
- [ ] Tested pagination with page=2, pageSize=20
- [ ] Tested pagination with invalid values (negative, zero)
- [ ] Tested pagination with large pageSize (> MAX_PAGE_SIZE, should be capped)
- [ ] Verified `total` count is accurate
- [ ] Verified `totalPages` calculated correctly
- [ ] Verified `hasMore` flag is correct (true when more pages exist)
- [ ] Ran `pnpm --filter content-api test` - all tests pass
- [ ] Ran `pnpm --filter identity-api test` - all tests pass
- [ ] Ran `pnpm typecheck` - no type errors

**Quality Checks:**
- [ ] All list endpoints return consistent pagination format
- [ ] Page and pageSize parameters properly validated
- [ ] Total count queries are efficient
- [ ] Response format matches API documentation
- [ ] Type safety maintained throughout

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent pagination enforced across all APIs

---

## Task 9: Improve Naming Consistency

**Agent Type:** `code-standards-enforcer`

**Objective:**
Standardize naming conventions for factory functions, ensure consistent use of `create*` prefix or direct constructors.

**Current State:**
- Mixed usage: `createContentService()` factory vs `new ContentService()` constructor
- Inconsistent factory naming: `createAuthenticatedHandler()` vs `createHealthCheckHandler()` vs direct service instantiation

**Detailed Instructions:**

1. **Analysis Phase:**
   - Search for all `create*` function patterns
   - Search for all service instantiation patterns
   - Document current usage across codebase
   - Categorize into:
     - Service factories (e.g., `createContentService`)
     - Middleware factories (e.g., `createAuthenticatedHandler`)
     - Utility factories (e.g., `createHealthCheckHandler`)

2. **Define Standard:**
   - **Decision A:** Use direct constructors for services, factories for utilities
     - Services: `new ContentService(config)` ✅
     - Middleware: `createAuthenticatedHandler(options)` ✅
     - Utilities: `createHealthCheckHandler()` ✅

   OR

   - **Decision B:** Use `create*` prefix for everything
     - Services: `createContentService(config)` ✅
     - Middleware: `createAuthenticatedHandler(options)` ✅
     - Utilities: `createHealthCheckHandler()` ✅

   **Recommendation:** Use Decision A (constructors for services, factories for utilities)

3. **Implementation (if Decision A):**
   - Remove service factory functions (e.g., `createContentService`)
   - Update all route handlers to use `new Service(config)`:
     ```typescript
     // Before
     const service = createContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });

     // After
     const service = new ContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });
     ```
   - Keep middleware/utility factories as-is (already correct)

4. **Update Package Exports:**
   - Remove factory exports from service packages
   - Ensure service classes are exported
   - Update index.ts files

5. **Search and Replace:**
   - Find all usages of service factories
   - Replace with constructor calls
   - Update imports

6. **Verification:**
   - Run `pnpm typecheck` - no type errors
   - Run all tests - must pass
   - Search codebase for any missed instances

**Expected Files Changed:**
- Service package exports (remove factories)
- All route handler files (use constructors)
- Any test files using service factories

**Success Criteria:**
- Consistent naming pattern across codebase
- All factory calls follow convention
- All tests passing
- No type errors

**Estimated Impact:** Improved code consistency, clearer mental model

---

### Task 9: Definition of Done Checklist

**Analysis Phase:**
- [ ] Searched for all `create*` function patterns in codebase
- [ ] Searched for all service instantiation patterns
- [ ] Documented current usage across all packages and workers
- [ ] Categorized patterns into: service factories, middleware factories, utility factories
- [ ] Identified inconsistencies in naming conventions
- [ ] Decided on standard: constructors for services, `create*` for utilities (or alternative)

**Standard Definition:**
- [ ] Documented the chosen naming convention standard
- [ ] Identified which patterns need to change
- [ ] Created list of all factory functions to remove/rename
- [ ] Created list of all code locations to update

**Service Factory Removal (if using Decision A):**
- [ ] Removed `createContentService` factory if it exists
- [ ] Removed `createMediaService` factory if it exists
- [ ] Removed `createOrganizationService` factory if it exists
- [ ] Removed `createContentAccessService` factory if it exists
- [ ] Updated package exports to remove factory functions
- [ ] Ensured service classes are still exported

**Route Handler Updates:**
- [ ] Updated all content-api route handlers to use `new ContentService(config)`
- [ ] Updated all identity-api route handlers to use `new OrganizationService(config)`
- [ ] Updated all access-related handlers to use `new ContentAccessService(config)`
- [ ] Updated any media-related handlers to use constructors
- [ ] Updated imports to import service classes directly
- [ ] Removed unused factory function imports

**Test File Updates:**
- [ ] Updated all test files using service factories
- [ ] Changed to use constructors: `new Service(config)`
- [ ] Verified test setup still works correctly
- [ ] Updated imports in test files

**Verification Phase:**
- [ ] Ran `pnpm typecheck` - no type errors
- [ ] Ran `pnpm test` - all tests pass
- [ ] Searched codebase for remaining `createContentService` - none found
- [ ] Searched codebase for remaining `createMediaService` - none found
- [ ] Searched codebase for remaining service factory patterns - none found
- [ ] Verified middleware factories still use `create*` prefix (correct)
- [ ] Verified utility factories still use `create*` prefix (correct)

**Quality Checks:**
- [ ] Naming convention is consistent across entire codebase
- [ ] Services use constructors, utilities use factories
- [ ] Clear mental model for when to use constructors vs factories
- [ ] Code is easier to understand
- [ ] No functional changes (behavior unchanged)

**Completion:**
- [ ] All files saved and formatted
- [ ] Changes ready for commit
- [ ] Consistent naming convention enforced

---

## Execution Order

Execute tasks in this exact order to minimize conflicts:

1. **Task 1: Eliminate Duplicate Error Classes** (minimal risk, isolated change)
2. **Task 2: Consolidate Wrangler Configuration** (config-only, no code changes)
3. **Task 6: Standardize Health Check Configuration** (small utility extraction)
4. **Task 5: Extract Custom Worker Middleware Chains** (small utility extraction)
5. **Task 3: Extract Database Query Helpers** (touches services but isolated)
6. **Task 4: Create Base Service Class** (depends on services being stable)
7. **Task 7: Extract Test Setup Helpers** (test-only changes)
8. **Task 8: Standardize Pagination Responses** (larger change, do after services stable)
9. **Task 9: Improve Naming Consistency** (final cleanup pass)

---

## Testing Strategy

After each task:
1. Run affected package tests: `pnpm --filter @codex/{package} test`
2. Run full test suite: `pnpm test`
3. Run typecheck: `pnpm typecheck`
4. Run lint: `pnpm lint:check`
5. Test affected workers locally
6. Verify build succeeds: `pnpm build`

---

## Success Metrics

- **Lines Removed:** ~527 lines across all tasks
- **Config Files Simplified:** 4 wrangler configs reduced by ~50% each
- **Test Pass Rate:** 100% maintained
- **Type Errors:** 0
- **Build Success:** All packages and workers build successfully
- **DX Improvement:** Reduced onboarding time, clearer patterns

---

## Post-Refactoring Tasks (Not in Scope)

These will be done separately after code refactoring completes:
- ✅ Package README documentation
- ✅ Architecture documentation (ARCHITECTURE.md)
- ✅ Development guide (DEVELOPMENT.md)
- ✅ Package usage guide (PACKAGE_GUIDE.md)
- ✅ CODEOWNERS file
