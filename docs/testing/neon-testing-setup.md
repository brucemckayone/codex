# Neon Testing Setup Guide

## Overview

This project uses [neon-testing](https://github.com/starmode-base/neon-testing) for database integration tests in CI. This library creates ephemeral Neon Postgres branches for each test file, providing complete isolation while maintaining production-like schema and constraints.

## Architecture

### Hybrid Testing Strategy

We use a cost-optimized hybrid approach:

- **Local Development**: Uses `DATABASE_URL` from `.env.dev` (FREE - no branch creation)
- **CI/CD**: Uses neon-testing to create ephemeral branches per test file (Isolated, reliable)

This saves 200+ branch creations per day during local development!

### How It Works in CI

1. **Branch Creation**: GitHub Actions creates a Neon branch from `production` using `neondatabase/create-branch-action`
2. **Migration**: Drizzle applies all migrations to this branch
3. **Test Execution**: For each test file:
   - neon-testing reads `NEON_PARENT_BRANCH_ID` environment variable
   - Creates an ephemeral branch cloned from the migrated parent
   - Sets `DATABASE_URL` to point to the ephemeral branch
   - Test runs with complete schema and data isolation
   - After completion, ephemeral branch is automatically deleted
4. **Cleanup**: Parent test branch is deleted after all tests complete

## Critical Configuration

### 1. Test Utils - withNeonTestBranch()

**Location**: `packages/test-utils/src/database.ts`

```typescript
export function withNeonTestBranch() {
  if (process.env.CI === 'true') {
    const config = {
      apiKey: process.env.NEON_API_KEY!,
      projectId: process.env.NEON_PROJECT_ID!,
      autoCloseWebSockets: true,
      parentBranchId: process.env.NEON_PARENT_BRANCH_ID, // CRITICAL
    };
    const fixture = makeNeonTesting(config);
    fixture();
  }
}
```

**Key Points**:
- Must be called at module level (not in beforeAll/beforeEach)
- `parentBranchId` tells neon-testing which branch to clone from
- Without `parentBranchId`, it uses project default (which may lack migrations)

### 2. CI Workflow Configuration

**Location**: `.github/workflows/testing.yml`

```yaml
- name: Run tests for affected packages with Turborepo
  env:
    NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
    NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}
    NEON_PARENT_BRANCH_ID: ${{ steps.create-branch.outputs.branch_id }}  # CRITICAL
    DB_METHOD: NEON_BRANCH
```

**Key Points**:
- `NEON_PARENT_BRANCH_ID` must point to the branch that has migrations applied
- This is the output from `create-branch-action` step
- Without this, tests will fail with "Failed query" errors

### 3. Turborepo Environment Passthrough

**Location**: `turbo.json`

```json
{
  "tasks": {
    "test": {
      "env": [
        "DATABASE_URL",
        "DB_METHOD",
        "NODE_ENV",
        "CI",
        "NEON_API_KEY",
        "NEON_PROJECT_ID",
        "NEON_PARENT_BRANCH_ID"  // CRITICAL
      ]
    }
  }
}
```

**Key Points**:
- Turborepo requires explicit declaration of environment variables
- Without this, the parent branch ID won't reach test processes
- This was a key issue that caused initial test failures

### 4. WebSocket Configuration

**Location**: `packages/test-utils/src/database.ts`

```typescript
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configure Neon serverless WebSocket for Node.js environment
neonConfig.webSocketConstructor = ws;

// Also polyfill global WebSocket for other code that might need it
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws as unknown as typeof WebSocket;
}
```

**Key Points**:
- Required for `@neondatabase/serverless` in Node.js v21 and earlier
- Enables both neon-testing API calls and database connections
- Must be configured before neon-testing initialization

### 5. Test Environment for CORS

**Location**: Test files that use database in web app

```typescript
// @vitest-environment node

import { withNeonTestBranch } from '@codex/test-utils';

// Uses Node environment (not happy-dom) to allow neon-testing API calls
// happy-dom blocks CORS requests to Neon API, causing test failures
withNeonTestBranch();

describe('Database Integration', () => {
  // tests...
});
```

**Key Points**:
- happy-dom enforces CORS restrictions
- neon-testing needs to make API calls to `console.neon.tech`
- Node environment allows unrestricted HTTP requests

## Usage in Test Files

### Standard Pattern

```typescript
// Must be at top of file
// @vitest-environment node  // Only needed in web app tests

import {
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
  withNeonTestBranch,
  type Database
} from '@codex/test-utils';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// MUST be at module level (not inside beforeAll)
withNeonTestBranch();

describe('My Service Tests', () => {
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();

    // Validate connection before running tests
    try {
      await validateDatabaseConnection(db);
    } catch (error) {
      console.warn('Database connection failed:', error);
      throw error;
    }
  });

  afterAll(async () => {
    await teardownTestDatabase(); // Closes connection
  });

  it('should work with database', async () => {
    // Test implementation
  });
});
```

### Key Rules

1. **Call withNeonTestBranch() at module level** - Not in beforeAll/beforeEach
2. **Use validateDatabaseConnection()** - Catches connection issues early
3. **Call teardownTestDatabase() in afterAll** - Closes connection properly
4. **Each test file gets its own branch** - Full isolation, no cleanup needed between tests

## Troubleshooting

### "Failed query" Errors

**Symptom**: Tests fail with "Failed query: insert into ..." messages

**Causes**:
1. `NEON_PARENT_BRANCH_ID` not set or not passed through Turborepo
2. Parent branch doesn't have migrations applied
3. neon-testing is using production branch (which lacks schema)

**Solution**: Verify all configuration points above, especially Turborepo env passthrough

### "Cross-Origin Request Blocked" Errors

**Symptom**: CORS errors from happy-dom when running tests

**Cause**: happy-dom environment blocks external API calls

**Solution**: Add `// @vitest-environment node` to top of test file

### "Class extends value undefined" Errors

**Symptom**: neon-testing plugin fails to load in Vite

**Cause**: WebSocket configuration not set before neon-testing initialization

**Solution**: Ensure `neonConfig.webSocketConstructor = ws` is called early

### Connection Hangs or Timeouts

**Symptom**: Tests hang or timeout when accessing database

**Causes**:
1. WebSocket not properly configured
2. Database pool not closed in afterAll
3. DATABASE_URL points to wrong branch

**Solution**:
- Verify WebSocket config
- Ensure `teardownTestDatabase()` is called
- Add logging to verify DATABASE_URL value

## Environment Variables

### Required in CI

| Variable | Source | Purpose |
|----------|--------|---------|
| `NEON_API_KEY` | GitHub Secrets | API key for Neon console access |
| `NEON_PROJECT_ID` | GitHub Variables | Neon project identifier |
| `NEON_PARENT_BRANCH_ID` | CI workflow output | Branch to clone ephemeral branches from |
| `DATABASE_URL` | Set by neon-testing | Connection string to ephemeral branch |
| `DB_METHOD` | CI workflow | Set to `NEON_BRANCH` for CI tests |
| `CI` | GitHub Actions | Triggers neon-testing activation |

### Local Development

| Variable | Source | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | `.env.dev` | Connection to local proxy or dev branch |
| `DB_METHOD` | `.env.dev` | Usually `LOCAL_PROXY` |

## Cost Optimization

### Why This Matters

Neon charges for:
- Branch storage
- Compute time on branches
- API calls for branch creation

### Our Strategy

```typescript
// In packages/test-utils/src/database.ts
export function withNeonTestBranch() {
  if (process.env.CI === 'true') {  // Only in CI
    const fixture = makeNeonTesting(config);
    fixture();
  }
  // No-op in local development - use existing DATABASE_URL
}
```

**Benefits**:
- Local development: 0 branch creations (FREE)
- CI: ~50 branch creations per run (necessary for isolation)
- Savings: 200+ branch creations per day

## Package-Specific Vitest Configuration

### Packages with neon-testing

```typescript
// packages/identity/vitest.config.identity.ts
export default packageVitestConfig({
  packageName: 'identity',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true,  // Enable ephemeral branches
});
```

### Web App with neon-testing

```typescript
// apps/web/vitest.config.ts
const shouldUseNeonTesting = process.env.CI === 'true';
const plugins = shouldUseNeonTesting
  ? [sveltekit(), neonTesting()]
  : [sveltekit()];

export default defineProject({
  plugins,
  test: {
    environment: 'happy-dom',  // Default for component tests
    // Override with @vitest-environment node for database tests
  },
});
```

## Database Client Lazy Initialization

### Why It Works

The database client uses a Proxy pattern:

```typescript
function createDbWsProxy() {
  return new Proxy({} as DatabaseClient, {
    get(_target, prop) {
      const db = initializeDbWs();  // Called on first access
      return Reflect.get(db, prop, db);
    },
  });
}
```

**Timing**:
1. Test file imports - Proxy created (no DB connection)
2. Vitest setup - neon-testing sets DATABASE_URL
3. beforeAll - Services initialized
4. First DB access - Connection established with correct URL

This ensures the database client picks up the ephemeral branch's DATABASE_URL.

## Testing Agent Guidelines

When working with database tests:

1. **Always use withNeonTestBranch()** at module level
2. **Verify environment variable passthrough** in turbo.json
3. **Check parent branch has migrations** before running tests
4. **Use node environment** for tests that need neon-testing API access
5. **Close connections properly** in afterAll hooks
6. **Don't modify cached database clients** - let Proxy pattern handle it
7. **Test locally first** with LOCAL_PROXY to avoid costs
8. **Monitor CI logs** for parent branch ID confirmation

## Common Patterns

### Creating Test Data

```typescript
import { createUniqueSlug } from '@codex/test-utils';

it('should create record', async () => {
  const record = await service.create({
    name: 'Test',
    slug: createUniqueSlug('test'),  // Timestamped unique slug
  });
  expect(record.id).toBeDefined();
});
```

### Isolation Between Tests

```typescript
// No cleanup needed between tests in same file!
// Each test file gets its own database branch

it('test 1', async () => {
  await service.create({ slug: 'same-slug' });
});

it('test 2', async () => {
  // Fresh database - no conflict!
  await service.create({ slug: 'same-slug' });
});
```

### Transaction Testing

```typescript
import { withTransaction } from '@codex/test-utils';

it('should rollback on error', async () => {
  await expect(
    withTransaction(db, async (tx) => {
      await tx.insert(table).values({ data });
      throw new Error('Rollback');
    })
  ).rejects.toThrow();

  // Verify rollback
  const records = await db.select().from(table);
  expect(records).toHaveLength(0);
});
```

## References

- [neon-testing GitHub](https://github.com/starmode-base/neon-testing)
- [Neon Branching Documentation](https://neon.com/docs/guides/branching)
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver)
- [Vitest Environment Configuration](https://vitest.dev/guide/environment.html)
- [Turborepo Environment Variables](https://turbo.build/repo/docs/core-concepts/caching#environment-variables)

## Changelog

### 2025-11-17 - Initial neon-testing Implementation
- Configured neon-testing with parent branch support
- Added WebSocket configuration for Node.js
- Fixed CORS issues with node environment
- Added Turborepo environment variable passthrough
- All database integration tests now passing in CI
