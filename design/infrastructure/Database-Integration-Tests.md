# Database Integration Tests

Comprehensive integration tests for database connectivity across all applications and workers.

## Overview

Each application and worker has integration tests to verify database connectivity:

- **`packages/database`** - Core database client tests
- **`apps/web`** - Web application database integration
- **`workers/queue-consumer`** - Queue consumer worker database integration

## Test Structure

### Unit Tests vs Integration Tests

**Unit Tests** (`*.test.ts`):
- Run in isolation without external dependencies
- Always run in CI/CD pipeline
- Fast execution

**Integration Tests** (`*.integration.test.ts`):
- Require live database connection
- Test actual database connectivity
- Conditionally skip if no database available
- Slower execution but higher confidence

### Skip Behavior

Tests automatically skip if no database connection string is provided:

```typescript
const skipIntegration = !process.env.PG_CONNECTION_STRING && !process.env.DATABASE_URL;

it.skipIf(skipIntegration)('should connect to database', async () => {
  // Test code
});
```

This allows:
- Unit tests to run without database
- Integration tests to run only when database is available
- CI/CD to run both with proper setup

## Local Testing

### Prerequisites

1. Start Docker services:
   ```bash
   pnpm docker:up
   ```

2. Ensure Docker containers are running:
   ```bash
   docker ps
   # Should see: infrastructure-postgres-1 and infrastructure-neon-proxy-1
   ```

### Run All Tests

```bash
# Run all tests including integration tests
PG_CONNECTION_STRING='postgresql://postgres:postgres@db.localtest.me:5432/main' pnpm test
```

### Run Specific Package Tests

```bash
# Database package
PG_CONNECTION_STRING='postgresql://postgres:postgres@db.localtest.me:5432/main' \
  pnpm --filter @codex/database test

# Web app
PG_CONNECTION_STRING='postgresql://postgres:postgres@db.localtest.me:5432/main' \
  pnpm --filter web test

# Queue consumer worker
PG_CONNECTION_STRING='postgresql://postgres:postgres@db.localtest.me:5432/main' \
  pnpm --filter queue-consumer test
```

### Run Without Database

```bash
# Integration tests will be skipped automatically
pnpm test
```

## CI/CD Testing

### GitHub Actions

The `.github/workflows/test.yml` workflow includes:

1. **Postgres 17** service container
2. **Neon HTTP Proxy** service container
3. Wait for Neon HTTP Proxy to be ready
4. Run all tests with `PG_CONNECTION_STRING` environment variable

```yaml
services:
  postgres:
    image: postgres:17
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: main

  neon-proxy:
    image: ghcr.io/timowilhelm/local-neon-http-proxy:main
    env:
      PG_CONNECTION_STRING: postgres://postgres:postgres@postgres:5432/main
```

### Testing with Act

Test the CI/CD workflow locally using `act`:

```bash
# Run integration tests job
act -j integration-tests --container-architecture linux/amd64

# Run all tests
act --container-architecture linux/amd64
```

**Note:** Act requires Docker and simulates the GitHub Actions environment locally.

## Test Coverage

### Database Package Tests

File: `packages/database/src/client.test.ts`

- ✅ Database client exports
- ✅ Connection test function
- ✅ Successful database connection
- ✅ Simple query execution

### Web App Tests

File: `apps/web/src/lib/db/db.integration.test.ts`

- ✅ Database connection from web app context
- ✅ Import and use db instance
- ✅ Graceful error handling

### Queue Consumer Worker Tests

File: `workers/queue-consumer/tests/integration/database.integration.test.ts`

- ✅ Database connection from worker context
- ✅ Query execution
- ✅ Concurrent query handling (simulates queue processing)
- ✅ Neon HTTP driver compatibility

## Environment Variables

### Development (Local)

```bash
PG_CONNECTION_STRING=postgresql://postgres:postgres@db.localtest.me:5432/main
```

### CI/CD (GitHub Actions)

```bash
PG_CONNECTION_STRING=postgresql://postgres:postgres@db.localtest.me:5432/main
```

### Production

```bash
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/main
```

## Why `db.localtest.me`?

- Special domain that resolves to `127.0.0.1` (localhost)
- Avoids SSL hostname validation errors with Neon driver
- Required for Neon HTTP Proxy to work correctly
- Works in both local and CI/CD environments

## Architecture

```
┌─────────────────┐
│   Test Suite    │
└────────┬────────┘
         │
         ├─ PG_CONNECTION_STRING
         │  └─ postgresql://postgres:postgres@db.localtest.me:5432/main
         │
         ▼
┌─────────────────┐
│  Neon Client    │  (Configured with fetchEndpoint)
└────────┬────────┘
         │
         ├─ neonConfig.fetchEndpoint = 'http://localhost:4444/sql'
         │
         ▼
┌─────────────────┐
│ Neon HTTP Proxy │  (Port 4444)
│  (Docker)       │
└────────┬────────┘
         │
         ├─ Translates HTTP → PostgreSQL protocol
         │
         ▼
┌─────────────────┐
│  Postgres 17    │  (Port 5432)
│  (Docker)       │
└─────────────────┘
```

## Troubleshooting

### Tests skip even with database running

Check that environment variable is set:
```bash
echo $PG_CONNECTION_STRING
```

### Connection timeout errors

1. Ensure Docker is running:
   ```bash
   pnpm docker:up
   ```

2. Check Neon HTTP Proxy is accessible:
   ```bash
   curl -X POST http://localhost:4444/sql \
     -H "Content-Type: application/json" \
     -d '{"query":"SELECT 1"}'
   ```

### "invalid hostname" errors

Make sure you're using `db.localtest.me` instead of `localhost` in the connection string.

### Act fails to pull Docker images

Run with verbose logging:
```bash
act -j integration-tests -v
```

Check Docker daemon is running and you have internet connectivity.

## Best Practices

1. **Always use conditional skipping** for integration tests
2. **Test database errors** to ensure graceful failure handling
3. **Use meaningful test names** that describe what's being tested
4. **Test concurrent operations** for worker contexts
5. **Keep tests fast** - aim for <10s timeout per test
6. **Clean up resources** in afterEach/afterAll hooks if needed

## Adding New Integration Tests

1. Create test file: `*.integration.test.ts`
2. Add skip condition:
   ```typescript
   const skipIntegration = !process.env.PG_CONNECTION_STRING && !process.env.DATABASE_URL;
   ```
3. Use `it.skipIf(skipIntegration)` for integration tests
4. Test with database:
   ```bash
   PG_CONNECTION_STRING='postgresql://postgres:postgres@db.localtest.me:5432/main' \
     pnpm --filter <package> test
   ```
5. Test without database (should skip):
   ```bash
   pnpm --filter <package> test
   ```
