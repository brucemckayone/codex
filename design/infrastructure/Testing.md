# Testing Guide

**Vitest + Playwright + Neon Ephemeral Branches**

Last Updated: 2025-11-02

---

## Quick Start

```bash
pnpm test              # All unit/integration tests
pnpm test:watch        # Watch mode
pnpm test:e2e          # E2E tests (Playwright)
pnpm test:coverage     # With coverage
```

---

## Testing Strategy

### The Testing Pyramid

```
                    /\
                   /  \
                  / E2E \          (Playwright: Critical User Flows)
                 /________\
                /          \
               / Integration \     (Vitest: API Routes, Workers)
              /______________\
             /                \
            /   Unit Tests     \   (Vitest: Components, Functions)
           /____________________\
```

### CI/CD Integration

**Every push and PR:**
1. Creates ephemeral Neon database branch
2. Runs migrations on ephemeral branch
3. Runs unit & integration tests
4. Runs E2E tests (when web changes)
5. Deletes ephemeral branch

**See:** [CI-CD-GUIDE.md](./CI-CD-GUIDE.md) for complete workflow details

---

## Test Organization

### Packages & Workers

Use `src/*.test.ts` for unit tests:

```
packages/database/
├── src/
│   ├── client.ts
│   └── client.test.ts    ← Unit tests here
└── vitest.config.ts

workers/auth/
├── src/
│   ├── index.ts
│   └── index.test.ts     ← Unit tests here
└── vitest.config.ts
```

### SvelteKit App

Co-locate tests with features:

```
apps/web/src/lib/features/auth/
├── components/
│   ├── LoginForm.svelte
│   └── LoginForm.test.ts
└── stores/
    ├── auth.ts
    └── auth.test.ts
```

### E2E Tests

Separate directory:

```
apps/web/e2e/
├── auth/
│   └── login.spec.ts
└── homepage.spec.ts
```

---

## Writing Tests

### Unit Test

```typescript
import { describe, it, expect } from 'vitest';

describe('MyFunction', () => {
  it('should calculate correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

### Database Test (with Neon)

```typescript
import { describe, it, expect } from 'vitest';
import { db } from '../client';
import { users } from '../schema';

describe('Database - Users', () => {
  it('should insert and retrieve user', async () => {
    // Insert
    await db.insert(users).values({
      email: 'test@example.com',
      name: 'Test User'
    });

    // Retrieve
    const result = await db.select().from(users).where(
      eq(users.email, 'test@example.com')
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test User');
  });
});
```

**Note:** Database tests run against ephemeral Neon branch in CI, local database in development.

### E2E Test

```typescript
import { test, expect } from '@playwright/test';

test('should load homepage', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Codex/);
});

test('should navigate to login', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Login');
  await expect(page).toHaveURL(/\/login/);
});
```

---

## Test Configuration

### Root Config

**vitest.config.ts** - Workspace configuration:

```typescript
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'workers/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
    }
  }
});
```

### Per-Package Config

Each package/worker has its own `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    name: '@codex/database',
    environment: 'node',
  }
});
```

---

## Test Environments

- **node** - Packages, workers unit tests
- **happy-dom** - SvelteKit components (faster than jsdom)
- **Playwright** - E2E browser tests

### Database Testing

**Local Development:**
- Use local Neon branch or local database
- Set `DATABASE_URL` in `.env.dev`

**CI/CD:**
- Ephemeral Neon branch created automatically
- Migrations applied before tests
- Branch deleted after tests complete

**Environment variable:**
```bash
DATABASE_URL=postgresql://neondb_owner:***@***-pooler.us-east-2.aws.neon.tech/neondb
DB_METHOD=NEON_BRANCH  # Set by CI
```

---

## Running Tests

### Unit & Integration

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Specific package
pnpm --filter @codex/database test

# With UI
pnpm test:ui
```

### E2E Tests

```bash
# All E2E tests
pnpm test:e2e

# Headed mode (see browser)
pnpm test:e2e --headed

# Specific test
pnpm test:e2e e2e/auth/login.spec.ts

# Debug mode
pnpm test:e2e --debug

# UI mode
pnpm test:e2e:ui
```

### In CI

Tests run automatically on every push/PR:

1. **Static Analysis** (parallel with tests)
   - Type checking
   - Linting
   - Format checking

2. **Unit & Integration Tests**
   - Creates ephemeral Neon branch `pr-{number}`
   - Runs migrations
   - Runs tests
   - Deletes branch

3. **E2E Tests** (separate job)
   - Creates ephemeral Neon branch `pr-{number}-e2e`
   - Runs migrations
   - Builds app with Wrangler
   - Runs Playwright tests against `http://localhost:8787`
   - Deletes branch

---

## Coverage

**Configuration:**
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'json'],
  exclude: [
    'node_modules/',
    'dist/',
    '**/*.test.ts',
    '**/*.spec.ts',
  ]
}
```

**View reports:**
```bash
pnpm test:coverage
open coverage/index.html
```

---

## Test Data Management

### Database State

**In CI:**
- Fresh ephemeral branch for each test run
- Clean state guaranteed

**Locally:**
- Use transactions for test isolation
- Or reset database between test suites

**Example transaction-based test:**
```typescript
import { describe, it, beforeEach, afterEach } from 'vitest';
import { db } from '../client';

describe('Users', () => {
  let tx;

  beforeEach(async () => {
    tx = await db.transaction();
  });

  afterEach(async () => {
    await tx.rollback();
  });

  it('should create user', async () => {
    await tx.insert(users).values({ email: 'test@example.com' });
    // Test runs in transaction, automatically rolled back
  });
});
```

### Mocking External Services

**Stripe:**
```typescript
import { vi } from 'vitest';

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    webhooks: {
      constructEvent: vi.fn()
    }
  }))
}));
```

**Better Auth:**
```typescript
vi.mock('better-auth', () => ({
  createAuth: vi.fn(() => ({
    api: {
      signIn: vi.fn().mockResolvedValue({ user: { id: '1' } })
    }
  }))
}));
```

---

## Debugging Tests

### VS Code Debug Config

Add to `.vscode/launch.json`:

```json
{
  "configurations": [
    {
      "name": "Debug Vitest Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test", "--run", "--no-coverage"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Playwright Debug

```bash
# Debug specific test
pnpm test:e2e --debug e2e/auth/login.spec.ts

# Pause on failure
pnpm test:e2e --headed --pause-on-failure

# Generate trace
pnpm test:e2e --trace on
```

---

## Common Patterns

### Testing Async Functions

```typescript
it('should handle async operations', async () => {
  const result = await fetchUser('123');
  expect(result).toBeDefined();
});
```

### Testing Error Conditions

```typescript
it('should throw on invalid input', async () => {
  await expect(
    createUser({ email: 'invalid' })
  ).rejects.toThrow('Invalid email');
});
```

### Testing Svelte Components

```typescript
import { render } from '@testing-library/svelte';
import LoginForm from './LoginForm.svelte';

it('should render login form', () => {
  const { getByText } = render(LoginForm);
  expect(getByText('Login')).toBeInTheDocument();
});
```

---

## CI/CD Test Workflow

**File:** `.github/workflows/testing.yml`

**Steps:**
1. Static analysis (parallel)
2. Create ephemeral Neon branch
3. Generate migrations from schema
4. Apply migrations to ephemeral branch
5. Run unit tests on changed packages
6. Run E2E tests (if web changed)
7. Delete ephemeral branches
8. Upload artifact (DATABASE_URL for preview deployment)

**See:** [CI-CD-GUIDE.md#workflow-reference](./CI-CD-GUIDE.md#workflow-reference)

---

## Best Practices

✅ **DO:**
- Write tests for new features
- Test error conditions
- Use transactions for database tests
- Mock external services
- Keep tests fast (<100ms per test)
- Use descriptive test names

❌ **DON'T:**
- Commit `.only` or `.skip`
- Share state between tests
- Test implementation details
- Write flaky tests
- Use `sleep()` in tests (use proper waits)

---

## Troubleshooting

### Tests fail in CI but pass locally

**Check:**
- Environment variables (CI uses ephemeral Neon branch)
- Database state (CI starts fresh)
- Timing issues (CI may be slower)

**Fix:**
- Use proper async/await
- Don't rely on order of execution
- Reset database state between tests

### Database connection errors

**In CI:**
- Check `DATABASE_URL` is passed correctly
- Verify ephemeral branch was created
- Check migrations applied successfully

**Locally:**
- Verify `DATABASE_URL` in `.env.dev`
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### E2E tests timeout

**Increase timeout:**
```typescript
test.setTimeout(60000); // 60 seconds
```

**Or in config:**
```typescript
export default defineConfig({
  use: {
    actionTimeout: 10000,
    navigationTimeout: 30000,
  }
});
```

---

## Summary

**Test Stack:**
- ✅ Vitest for unit & integration tests
- ✅ Playwright for E2E tests
- ✅ Neon ephemeral branches for database testing
- ✅ Automatic CI/CD integration

**Coverage:**
- Unit tests: Components, functions, utilities
- Integration tests: API routes, database operations
- E2E tests: Critical user flows

**For More Information:**
- [CI-CD-GUIDE.md](./CI-CD-GUIDE.md) - Complete CI/CD workflow
- [Database-Integration-Tests.md](./Database-Integration-Tests.md) - Database testing details
- [CodeStructure.md](./CodeStructure.md) - Project structure

---

**Last Updated:** 2025-11-02
**Maintained By:** DevOps Team
