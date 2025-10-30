# Ephemeral Branch Lifecycle Documentation

This document explains the complete CI/CD workflow for Neon ephemeral database branches.

## Overview

The CI/CD pipeline creates isolated Neon database branches for every push and pull request. These ephemeral branches allow tests to run against real databases without affecting production or requiring Docker containers.

## Complete Lifecycle

### 1. Branch Creation (`create-neon-branch` job)

**Trigger**: Every push and pull request

**Process**:
```yaml
- Generate branch name:
  - Pull requests: pr-{number}
  - Pushes: push-{branch-name}-{short-sha}
  - Truncated to 63 characters (Neon limit)

- Create/reuse Neon branch:
  - Uses: neondatabase/create-branch-action@v6
  - Parent branch: main
  - Automatically reuses existing branch if name matches
```

**Outputs**:
- `db_url`: Connection string for the ephemeral database
- `branch_id`: Neon branch identifier
- `branch_name`: Generated branch name

**Why GitHub Actions vs CLI**: The `neondatabase/create-branch-action` is purpose-built for CI/CD, handles authentication securely, and provides better error handling than installing and configuring `neonctl` in runners.

---

### 2. Database Setup (`test` and `e2e-tests` jobs)

**Dependencies**: Requires `create-neon-branch` to complete first

**Environment Variables**:
```yaml
DATABASE_URL: ${{ needs.create-neon-branch.outputs.db_url }}
DB_METHOD: NEON_BRANCH
```

**Migration Process**:

#### Step 2a: Generate Migrations
```bash
pnpm --filter @codex/database db:gen:drizzle
```

- Scans all schema files in `packages/database/src/schema/`
- Includes: `test.ts`, `auth.ts` (Better Auth tables)
- Generates SQL migration files if schema changed
- Output: `packages/database/src/migrations/*.sql`

#### Step 2b: Apply Migrations
```bash
pnpm --filter @codex/database db:migrate
```

- Applies all pending migrations to ephemeral branch
- Creates tables: `test_table`, `users`, `accounts`, `sessions`, `verification_tokens`
- Uses Drizzle Kit's migration tracking

**Better Auth + Drizzle Integration**:
- Better Auth schemas are defined in `src/schema/auth.ts`
- Drizzle ORM manages all migrations (Better Auth uses `drizzleAdapter`)
- No separate Better Auth CLI migration needed
- Workflow: Define schema → Drizzle generates → Drizzle migrates

---

### 3. Test Execution

**Unit Tests** (`test` job):
```bash
# Run conditionally based on changed packages
pnpm --filter @codex/database test
pnpm --filter @codex/validation test
# ... etc
```

**E2E Tests** (`e2e-tests` job):
```bash
pnpm test:e2e
```

**Test Environment**:
- All tests use ephemeral branch via `DATABASE_URL`
- `DB_METHOD=NEON_BRANCH` ensures proper Neon configuration
- Tests verify: connections, schema, CRUD operations

---

### 4. Cleanup (`cleanup-neon-branch` job)

**Trigger**: Always runs after `test` and `e2e-tests` complete

```yaml
if: always()  # Runs even if tests fail
```

**Process**:
```yaml
- Delete branch:
  - Uses: neondatabase/delete-branch-action@v6
  - Branch ID from create-neon-branch outputs
  - Prevents accumulation of unused branches
```

**Why `always()`**: Ensures cleanup happens even if tests fail, preventing orphaned branches that consume resources.

---

## Configuration Files

### Required Secrets (GitHub Repository Settings)
```
NEON_API_KEY: API key from Neon console
STRIPE_TEST_KEY: For E2E payment tests
CLOUDFLARE_API_TOKEN: For worker deployment
CLOUDFLARE_ACCOUNT_ID: For worker deployment
```

### Required Variables (GitHub Repository Settings)
```
NEON_PROJECT_ID: Your Neon project identifier
```

### Database Configuration (`packages/database/src/config/env.config.ts`)

The configuration supports three modes:

1. **LOCAL_PROXY**: Docker-based local development
2. **NEON_BRANCH**: Ephemeral branches for CI/CD ← Used in workflow
3. **PRODUCTION**: Production database

```typescript
// CI/CD uses NEON_BRANCH mode
if (process.env.DB_METHOD === 'NEON_BRANCH') {
  // Use DATABASE_URL from environment
  // Configure for ephemeral branch
}
```

---

## Local Testing with Act

You can test the complete workflow locally using Act:

### Prerequisites
```bash
brew install act
```

### Configuration Files
- `.actrc`: Act configuration (image, secrets, env files)
- `.secrets`: GitHub secrets (NEON_API_KEY, etc.)
- `.github/.env.act`: GitHub variables (NEON_PROJECT_ID)

### Testing Workflow
```bash
# List all jobs
pnpm act:list

# Test branch creation
act -j create-neon-branch -W .github/workflows/testing.yml

# Full test (requires all dependencies)
pnpm act:test
```

**Note**: The `changes` job may fail in Act due to GitHub API requirements. This is expected and won't occur in real GitHub Actions.

---

## Workflow Diagram

```
┌─────────────────────┐
│  Push / PR Trigger  │
└──────────┬──────────┘
           │
           ├─────────────────────────────────┐
           │                                 │
           ▼                                 ▼
┌────────────────────┐          ┌────────────────────┐
│  Detect Changes    │          │ Create Neon Branch │
│  (changes job)     │          │  - Generate name   │
└──────────┬─────────┘          │  - Create/reuse    │
           │                    │  - Output db_url   │
           │                    └──────────┬─────────┘
           │                               │
           └───────────┬───────────────────┘
                       │
                       ▼
           ┌────────────────────┐
           │   Database Setup   │
           │  - Generate migs   │
           │  - Apply migs      │
           └──────────┬─────────┘
                      │
                      ├──────────────────┐
                      │                  │
                      ▼                  ▼
          ┌──────────────────┐  ┌──────────────┐
          │   Unit Tests     │  │  E2E Tests   │
          │  - DB tests      │  │  - Playwright│
          │  - Package tests │  │  - Full app  │
          └──────────┬───────┘  └──────┬───────┘
                     │                 │
                     └────────┬────────┘
                              │
                              ▼
                  ┌───────────────────┐
                  │  Cleanup Branch   │
                  │  (always runs)    │
                  └───────────────────┘
```

---

## Benefits of Ephemeral Branches

### vs Docker PostgreSQL in CI
- **Faster**: No container startup time (Neon branches are instant)
- **Cheaper**: Neon auto-suspends inactive branches
- **Simpler**: No Docker-in-Docker complexity
- **Isolated**: Each run gets fresh database

### vs Persistent Test Database
- **Clean State**: Every test run starts fresh
- **Parallel Safe**: Multiple PRs don't conflict
- **No Cleanup Required**: Automatic deletion
- **Real Environment**: Actual Postgres, not mocks

### vs Mocked Databases
- **Real SQL**: Tests actual queries and migrations
- **Catches Issues**: Schema problems, constraints, indexes
- **Production Parity**: Same Postgres version as production

---

## Troubleshooting

### Branch Creation Fails
- **Check**: `NEON_API_KEY` is valid in repository secrets
- **Check**: `NEON_PROJECT_ID` matches your Neon project
- **Check**: API key has permissions to create branches

### Migrations Fail
- **Check**: Schema files in `packages/database/src/schema/` are valid
- **Check**: `DATABASE_URL` is correctly passed to migration step
- **Check**: `DB_METHOD=NEON_BRANCH` is set

### Tests Can't Connect
- **Check**: Test job has `DATABASE_URL` environment variable
- **Check**: Migrations ran successfully before tests
- **Check**: `DB_METHOD=NEON_BRANCH` is set in test environment

### Cleanup Doesn't Run
- **Check**: Job has `if: always()` condition
- **Check**: `needs` array includes all dependent jobs
- **Check**: Branch ID is correctly passed from creation job

---

## Cost Optimization

Neon ephemeral branches are cost-effective because:

1. **Scale to Zero**: Inactive branches consume no compute resources
2. **Auto-Delete**: Branches are deleted after tests complete
3. **Shared Storage**: Branches share storage with parent
4. **Fast Creation**: No cold start costs

Typical branch lifecycle: 5-10 minutes (tests + cleanup)

---

## Future Improvements

Potential enhancements to consider:

- **Schema Caching**: Cache migration files between runs
- **Parallel Tests**: Multiple test suites using same branch
- **Preview Deployments**: Deploy workers to ephemeral endpoints
- **Branch Pooling**: Reuse branches for subsequent runs
- **Monitoring**: Track branch usage and costs

---

## References

- [Neon Branching Documentation](https://neon.com/docs/guides/branching)
- [Neon GitHub Actions](https://neon.com/docs/guides/branching-github-actions)
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)
- [Better Auth with Drizzle](https://www.better-auth.com/docs/adapters/drizzle)
- [Act Documentation](https://github.com/nektos/act)
