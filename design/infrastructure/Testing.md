# Testing Guide

Bare-bones testing setup for unit, integration, and E2E tests across the Codex monorepo.

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
- 8 package tests
- 1 worker test
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

- **node** - Packages, workers, API routes
- **happy-dom** - SvelteKit components (faster than jsdom)
- **Playwright** - E2E browser tests

**Note on Cloudflare Workers**: Currently using standard Node environment for worker tests. The `@cloudflare/vitest-pool-workers` package (Miniflare) only supports Vitest 2.x-3.x, not our Vitest 4.0.2. When compatibility is added, we can switch to use the Workers pool for more realistic worker testing.

## Coverage

Configured at root level (80% threshold for lines/functions/statements, 75% for branches).

View reports in `/coverage` after running `pnpm test:coverage`.

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

## Resources

- [testing-framework-proposal.md](../testing-framework-proposal.md) - Original testing framework design
- [CodeStructure.md](CodeStructure.md) - Project structure (includes testing section)
