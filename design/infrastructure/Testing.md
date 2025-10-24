# Testing Guide

Complete testing framework for the Codex monorepo - philosophy, implementation, and examples.

## Testing Philosophy

### The Testing Pyramid

We follow the testing pyramid principle: many fast unit tests, moderate integration tests, and few E2E tests.

```
                    /\
                   /  \
                  / E2E \          (Playwright: Critical User Flows)
                 /________\
                /          \
               / Integration \     (Vitest: API Routes, Service Interactions)
              /______________\
             /                \
            /   Unit Tests     \   (Vitest: Components, Functions, Workers)
           /____________________\
```

### Best Practices

- **Test Isolation**: Each test should be independent and not rely on the state of other tests
- **Clear Naming**: Test files and descriptions should clearly indicate what is being tested
- **AAA Pattern**: Arrange, Act, Assert for clear test structure
- **Error Testing**: Explicitly test error conditions and edge cases
- **Performance**: Keep unit tests fast; optimize integration and E2E tests where possible

## Quick Start

```bash
pnpm test              # All unit/integration tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage
pnpm test:e2e          # E2E tests (Playwright)
pnpm test:all          # Everything
```

## Current Status

✅ **All tests passing**
- 9 unit tests (8 packages + 1 worker)
- 3 integration tests (1 worker)
- 2 E2E tests

## Test Organization

**Packages & Workers** - Use `/tests` directory:
```
packages/database/
├── src/
├── tests/
│   ├── unit/
│   └── integration/
└── vitest.config.ts

workers/queue-consumer/
├── src/
├── tests/
│   ├── unit/
│   └── integration/
└── vitest.config.ts
```

**SvelteKit App** - Co-locate with features:
```
apps/web/src/lib/features/auth/
├── components/
│   ├── LoginForm.svelte
│   └── LoginForm.test.ts
├── stores/
│   ├── auth.ts
│   └── auth.test.ts
└── utils/
    └── validate.test.ts
```

**E2E Tests** - Separate directory:
```
apps/web/e2e/
├── auth/
│   └── login.spec.ts
└── homepage.spec.ts
```

See [CodeStructure.md](CodeStructure.md) for complete project structure with testing details.

## Writing Tests

**Minimal Unit Test:**
```typescript
import { describe, it, expect } from 'vitest';

describe('MyFunction', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});
```

**Worker Integration Test (Miniflare):**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMiniflareHelper, type MiniflareTestHelper } from '@codex/test-utils';

describe('My Worker - Integration Tests', () => {
  let helper: MiniflareTestHelper;

  beforeEach(async () => {
    helper = createMiniflareHelper();

    await helper.setup({
      script: `
        export default {
          async fetch(request, env) {
            return new Response("Hello World!");
          }
        }
      `,
      modules: true,
      compatibilityDate: '2024-01-01',
      // Add bindings as needed
      kvNamespaces: ['MY_KV'],
      queueProducers: ['MY_QUEUE'],
    });
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should respond to fetch events', async () => {
    const response = await helper.fetch('http://localhost/');
    expect(await response.text()).toBe('Hello World!');
  });

  it('should access bindings', async () => {
    const kv = await helper.getKVNamespace('MY_KV');
    await kv.put('key', 'value');
    expect(await kv.get('key')).toBe('value');
  });
});
```

**Minimal E2E Test:**
```typescript
import { test, expect } from '@playwright/test';

test('should load page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Codex/);
});
```

## File Naming

- `*.test.ts` - Unit/integration tests (Vitest)
- `*.spec.ts` - E2E tests (Playwright)

## Configuration

**Root Config:**
- `vitest.config.ts` - Workspace projects and global coverage
- `vitest.shared.ts` - Shared test settings

**Per-Package:**
Each package has `vitest.config.ts` defining project name, environment, and test patterns.

## Test Environments

- **node** - Packages, unit tests for workers, API routes
- **happy-dom** - SvelteKit components (faster than jsdom)
- **Playwright** - E2E browser tests
- **Miniflare (workerd)** - Integration tests for Cloudflare Workers

### Cloudflare Workers Testing Strategy

We use a **two-tier approach** for worker testing:

**Unit Tests** (Fast, Node environment):
- Test pure functions and business logic
- Run in standard Node environment
- Located in `/tests/unit/`

**Integration Tests** (Realistic, Miniflare):
- Test full worker behavior with bindings
- Run in actual Workers runtime via Miniflare
- Located in `/tests/integration/`
- Use `@codex/test-utils` Miniflare helpers

**Why not @cloudflare/vitest-pool-workers?**
The `@cloudflare/vitest-pool-workers` package only supports Vitest 2.x-3.x, not our Vitest 4.0.2. We use programmatic Miniflare instead, which provides the same Workers runtime (workerd) with full control over test lifecycle.

## Coverage

Configured at root level (80% threshold for lines/functions/statements, 75% for branches).

View reports in `/coverage` after running `pnpm test:coverage`.

## Test Environment & Data Management

### Dedicated Test Database

- **Setup**: Use a separate Neon branch or local Dockerized PostgreSQL instance (`docker-compose.test.yml`)
- **Isolation**: Test database must be completely isolated from development and production
- **Resetting**: Database should be reset before each test suite to ensure clean state

### Mocking External Services

- **Principle**: External services (Stripe, RunPod, Resend, R2) should be mocked in unit/integration tests
- **Tools**: `vitest.mock()` for module mocking, custom mock objects/classes
- **E2E Exception**: Use test mode credentials for real external services in E2E tests

### Test Data Seeding

- **Strategy**: Use factories or seed scripts for realistic test data
- **Tools**: Custom TypeScript scripts, Drizzle ORM for insertions

## CI/CD Integration

- **Platform**: GitHub Actions (see [CI-CD-Pipeline.md](CI-CD-Pipeline.md))
- **Workflow**: All tests run automatically on `push` and `pull_request` to `develop`/`main`
- **E2E Scope**: E2E tests primarily run on `develop` (staging) and `main` (production) branches

## Commands

```bash
# Unit & Integration
pnpm test                   # Run all
pnpm test:watch             # Watch mode
pnpm test:coverage          # With coverage
pnpm test:ui                # Vitest UI
pnpm test:web               # Web app only
pnpm test:packages          # Packages only

# E2E
pnpm test:e2e               # Playwright tests
pnpm test:e2e:ui            # Playwright UI

# Combined
pnpm test:all               # Everything
```

## Test Utilities (@codex/test-utils)

The `@codex/test-utils` package provides shared testing utilities:

**Miniflare Helpers:**
- `createMiniflareHelper()` - Create a Miniflare test helper with sensible defaults
- `MiniflareTestHelper` - Class for managing Miniflare lifecycle
  - `setup(options)` - Initialize Miniflare with worker config
  - `cleanup()` - Dispose Miniflare instance
  - `fetch(url, init)` - Dispatch HTTP request to worker
  - `getKVNamespace(name)` - Get KV binding
  - `getD1Database(name)` - Get D1 binding
  - `getR2Bucket(name)` - Get R2 binding
  - `getQueueProducer(name)` - Get Queue binding
  - `getWorker()` - Get worker fetcher (for queue/scheduled events)
  - `getBindings()` - Get all bindings

**Database Helpers:**
- `createTestDatabase()` - Create test database connection
- Database factories and fixtures

**Usage:**
```typescript
import { createMiniflareHelper } from '@codex/test-utils';

const helper = createMiniflareHelper();
await helper.setup({ /* config */ });
// ... test code ...
await helper.cleanup();
```

## Resources

- [CodeStructure.md](CodeStructure.md) - Project structure (includes testing section)
- [CI-CD-Pipeline.md](CI-CD-Pipeline.md) - CI/CD setup with testing integration
- [Miniflare Documentation](https://miniflare.dev/) - Miniflare API reference
- [Vitest Documentation](https://vitest.dev/) - Vitest testing framework
- [Playwright Documentation](https://playwright.dev/) - E2E testing with Playwright
