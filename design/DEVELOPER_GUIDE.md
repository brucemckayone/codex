# Codex Monorepo - Complete Developer Guide

**Last Updated:** November 3, 2025
**Vitest Version:** 4.0.2
**Node Version:** 18+
**Package Manager:** pnpm 10.18.3

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Adding Dependencies](#adding-dependencies)
5. [Writing Tests](#writing-tests)
6. [Environments & Configuration](#environments--configuration)
7. [Building & Deployment](#building--deployment)
8. [Common Tasks](#common-tasks)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

```bash
# Node 18+ and pnpm required
node --version  # Should be 18+
pnpm --version  # Should be 10.18.3
```

### Setup

```bash
# Clone and install
git clone <repo>
cd Codex
pnpm install

# Load environment variables
cp .env.dev.example .env.dev

# Start development
pnpm dev

# Run tests
pnpm test

# Run specific tests
pnpm test:web          # SvelteKit app only
pnpm test:packages     # All packages only
pnpm test:coverage     # With coverage report
```

---

## Architecture Overview

### The Codex Stack

```
┌─────────────────────────────────────────────────────────────┐
│                   Codex Monorepo                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Frontend (apps/web)                        │   │
│  │  SvelteKit 5 + TypeScript + Tailwind CSS           │   │
│  │  - Feature-based components                         │   │
│  │  - Server-side routing                             │   │
│  │  - Integration tests with Playwright               │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │      Shared Packages (packages/*)                   │   │
│  │                                                      │   │
│  │  @codex/database      → Drizzle ORM + schemas      │   │
│  │  @codex/validation    → Zod schemas (type-safe)    │   │
│  │  @codex/security      → Rate limiting, headers     │   │
│  │  @codex/observability → Logging & metrics          │   │
│  │  @codex/cloudflare    → R2 & KV clients           │   │
│  │  @codex/test-utils    → Miniflare helpers          │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │      Cloudflare Workers (workers/*)                 │   │
│  │                                                      │   │
│  │  auth-worker          → BetterAuth + sessions      │   │
│  │  stripe-webhook       → Payment webhook handler    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │      Infrastructure & Services                      │   │
│  │                                                      │   │
│  │  Neon Database   → PostgreSQL serverless           │   │
│  │  Cloudflare R2   → Object storage                  │   │
│  │  Cloudflare KV   → Edge key-value cache            │   │
│  │  Stripe API      → Payment processing              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Concepts

**Monorepo**: Single repository with multiple projects sharing code and dependencies via pnpm workspaces.

**Packages**: Shared code libraries used by multiple projects (imported as `@codex/*`).

**Workers**: Cloudflare Workers that run at the edge (deployed separately from the main app).

**Workspaces**: pnpm's way of linking packages so changes are immediately reflected (no build needed).

---

## Project Structure

### Directory Map

```
Codex/
├── apps/
│   └── web/                    # SvelteKit frontend application
│       ├── src/
│       │   ├── lib/
│       │   │   └── features/   # Feature-based code organization
│       │   ├── routes/         # SvelteKit routing
│       │   └── app.html        # HTML shell
│       ├── e2e/                # Playwright E2E tests
│       └── vitest.config.ts    # Test configuration
│
├── workers/
│   ├── auth/                   # Authentication worker (BetterAuth)
│   │   ├── src/
│   │   │   ├── index.ts        # Main worker handler
│   │   │   ├── index.test.ts   # Unit tests
│   │   │   └── middleware.test.ts # Middleware tests
│   │   ├── wrangler.jsonc        # Cloudflare config
│   │   └── vite.auth-worker.config.ts
│   │
│   └── stripe-webhook-handler/ # Stripe webhook handler
│       ├── src/
│       ├── wrangler.jsonc
│       └── vite.stripe-webhook-handler.config.ts
│
├── packages/
│   ├── database/               # Database client & schema
│   │   ├── src/
│   │   │   ├── schema/         # Drizzle schema definitions
│   │   │   ├── client.ts       # Database client
│   │   │   └── client.test.ts
│   │   └── migrations/         # SQL migrations
│   │
│   ├── validation/             # Shared Zod schemas
│   │   ├── src/
│   │   │   ├── user-schema.ts
│   │   │   └── *.test.ts
│   │   └── vitest.config.ts
│   │
│   ├── security/               # Security utilities
│   │   ├── src/
│   │   │   ├── headers.ts      # Security headers middleware
│   │   │   ├── rate-limit.ts   # Rate limiting
│   │   │   └── worker-auth.ts  # Worker authentication
│   │   ├── tests/
│   │   │   ├── headers.test.ts
│   │   │   ├── rate-limit.test.ts
│   │   │   └── worker-auth.test.ts
│   │   ├── vite.security.config.ts
│   │   └── vitest.config.ts
│   │
│   ├── observability/          # Logging & metrics
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── redact.ts       # Sensitive data masking
│   │   └── vitest.config.ts
│   │
│   ├── cloudflare-clients/     # Cloudflare service clients
│   │   ├── src/
│   │   │   ├── r2/             # R2 bucket client
│   │   │   └── kv/             # KV namespace client
│   │   └── vitest.config.ts
│   │
│   └── test-utils/             # Shared testing utilities
│       ├── src/
│       │   ├── miniflare-helpers.ts # Miniflare setup
│       │   └── helpers.test.ts
│       └── vitest.config.ts
│
├── infrastructure/
│   ├── wrangler/               # Wrangler configurations
│   │   └── R2/                 # R2 CORS & bucket configs
│   ├── neon/                   # Docker Compose for local DB
│   │   └── docker-compose*.yml
│   └── design/
│       ├── d2/                 # Architecture diagrams
│       └── security/           # Security documentation
│
├── vitest.config.ts            # Root workspace test config
├── package.json                # Root workspace definition
├── pnpm-lock.yaml              # Dependency lock file
└── .env.dev                    # Development environment (gitignored)
```

### Import Rules (CRITICAL!)

```typescript
// ✅ DO: Import from shared packages
import { db } from '@codex/database';
import { rateLimit } from '@codex/security';
import { validateUser } from '@codex/validation';

// ✅ DO: Use $lib alias in SvelteKit app
import { Component } from '$lib/features/auth/components';

// ✅ DO: Import packages in workers
import { securityHeaders } from '@codex/security';

// ❌ DON'T: Import from other projects
// DON'T import from 'apps/web' in workers
// DON'T import from 'workers/auth' in other places

// ❌ DON'T: Use relative imports across workspace boundaries
// DON'T do: import from '../../../packages/database'
```

---

## Adding Dependencies

### Adding to Root (Global)

```bash
# Install for all workspaces
pnpm add -w some-package

# Install dev dependency for all workspaces
pnpm add -wD some-dev-package

# Examples:
pnpm add -w dotenv          # Shared across all projects
pnpm add -wD typescript     # Used by all projects
```

**When to use:** Shared utilities that all projects need (vitest, typescript, eslint, prettier).

### Adding to Specific Package

```bash
# Add to one package
pnpm --filter @codex/security add some-package

# Add to a worker
pnpm --filter auth add some-package

# Add to the web app
pnpm --filter web add some-package

# Examples:
pnpm --filter @codex/database add drizzle-orm
pnpm --filter auth add better-auth
pnpm --filter web add svelte-transitions
```

**When to use:** Package-specific dependencies (not shared with other projects).

### Important Package Groups

#### Packages That Export Code

```json
{
  "main": "./src/index.ts",        // Points to source during dev
  "types": "./src/index.ts",       // TypeScript types
  "exports": {
    ".": "./src/index.ts"          // ESM export
  }
}
```

**These packages are imported as `@codex/*`:**
- `@codex/database` - Database client and schemas
- `@codex/validation` - Zod schemas
- `@codex/security` - Rate limiting, headers, auth
- `@codex/observability` - Logging utilities
- `@codex/cloudflare-clients` - R2 and KV helpers
- `@codex/test-utils` - Testing utilities

#### Packages That Build

```json
{
  "main": "./dist/index.js",       // Points to built output
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "vite build --config vite.security.config"
  }
}
```

**These packages need to be built before use:**
- `@codex/security` - Built to `dist/` for distribution

### Dependency Resolution

**How imports work:**

```
When you: import { rateLimit } from '@codex/security'
         ↓
1. pnpm looks in package.json exports
2. Finds "./src/index.ts" (during dev)
3. Loads source directly (no build needed)
4. TypeScript resolves types from same file
```

---

## Writing Tests

### Test Structure Overview

```
Three tiers of testing:

1. Unit Tests          → Fast, test individual functions
2. Integration Tests   → Medium, test multiple components
3. E2E Tests         → Slow, test full user flows
```

### Unit Tests (in source directories)

**For Packages:**

```typescript
// packages/security/src/rate-limit.ts
export function createRateLimiter(options: RateLimitOptions) {
  // implementation
}

// packages/security/tests/rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../src/rate-limit';

describe('Rate Limiting', () => {
  it('should enforce rate limits', () => {
    const limiter = createRateLimiter({ requests: 10, window: 60000 });
    expect(limiter).toBeDefined();
  });
});
```

**For Workers (without Miniflare):**

```typescript
// workers/auth/src/index.ts
import app from 'hono';

export default app;

// workers/auth/src/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import app from './index';

describe('Auth Worker', () => {
  it('should export a Hono app', () => {
    expect(app.fetch).toBeDefined();
  });

  it('should handle requests', async () => {
    const req = new Request('http://localhost/api/auth/session');
    const env = {
      BETTER_AUTH_SECRET: 'test-secret',
      WEB_APP_URL: 'http://localhost:3000',
      AUTH_SESSION_KV: {} as KVNamespace,
      RATE_LIMIT_KV: {} as KVNamespace,
    };

    const res = await app.fetch(req, env);
    expect(res.status).toBeDefined();
  });
});
```

**Key Points:**
- Import the actual implementation
- Mock external dependencies (KV, databases)
- Test one thing per test
- Use `vi.fn()` for mocking functions
- Use `vi.mock()` for module mocking

### Integration Tests (for packages with services)

```typescript
// packages/database/src/client.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, testDbConnection } from './client';

describe('Database Client', () => {
  beforeAll(async () => {
    // Setup: Connect to test database
    await testDbConnection();
  });

  afterAll(async () => {
    // Cleanup: Close connection
  });

  it('should connect to database', async () => {
    const result = await db.query('SELECT 1');
    expect(result).toBeDefined();
  });

  it('should insert and query data', async () => {
    const user = await db
      .insert(users)
      .values({ email: 'test@example.com' })
      .returning();
    expect(user).toHaveLength(1);
  });
});
```

**Key Points:**
- Use real database or test database
- Setup/teardown in `beforeAll`/`afterAll`
- Test actual database operations
- Tests take longer but are more realistic

### Worker Integration Tests (Skipped)

Current auth worker integration tests are **intentionally skipped** because:

1. **Challenge**: Miniflare can't resolve external dependencies (better-auth, hono) unless bundled
2. **Solution**: We test the Hono app directly without Miniflare
3. **Future**: Use Wrangler dev mode for true E2E testing

```typescript
// workers/auth/src/index.integration.test.ts
describe.skip('Auth Worker (integration)', () => {
  // These tests require a fully bundled worker
  // Better approach: Use `wrangler dev` for E2E testing
  it.todo('health check returns healthy');
  it.todo('reads seeded KV');
});
```

### E2E Tests (Playwright)

```typescript
// apps/web/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await page.goto('http://localhost:5173/login');

  await page.fill('input[name=email]', 'user@example.com');
  await page.fill('input[name=password]', 'password123');
  await page.click('button[type=submit]');

  await expect(page).toHaveURL('/dashboard');
});
```

**Run E2E tests:**

```bash
pnpm test:e2e              # Headless
pnpm test:e2e:ui           # With UI
```

---

## Environments & Configuration

### Three Ways to Run Tests

#### 1. Local Development (with Neon ephemeral branches)

```bash
# Setup one-time
pnpm docker:up              # Start local PostgreSQL
pnpm db:gen                 # Generate migrations
pnpm db:push                # Run migrations

# Run tests (uses .env.dev)
pnpm test

# Cleanup
pnpm docker:down
```

**Pros:** Fast, local, complete control
**Cons:** Need Docker, slower than in-memory

#### 2. Neon Ephemeral Database (CI-friendly)

```bash
# Setup
pnpm test:neon              # Creates ephemeral branch, runs tests

# Cleanup (automatic)
pnpm neon:cleanup           # Delete all test branches
```

**How it works:**

```
1. Creates new ephemeral Neon branch
2. Runs migrations
3. Tests run against real Postgres
4. Branch auto-deletes after test
```

**Pros:** Real database, automatic cleanup
**Cons:** Network dependent, slightly slower

#### 3. In-Memory Testing (fastest, for unit tests)

```bash
# Just run tests (uses Node environment)
pnpm test:packages          # Packages with mocked services
```

**Pros:** Instant feedback, no setup
**Cons:** Only works with mocked dependencies

### Environment Variables

**`.env.dev` (for local development):**

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/codex

# Cloudflare
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ACCOUNT_ID=your_account

# Authentication
BETTER_AUTH_SECRET=your_secret_key_at_least_32_chars
SESSION_SECRET=your_session_secret

# URLs
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**`.env.prod` (for production - in CI/CD):**

```bash
# Set via GitHub Secrets or Cloudflare KV
DATABASE_URL=neon_production_url
CLOUDFLARE_API_TOKEN=production_token
BETTER_AUTH_SECRET=production_secret
```

### Database Connection Methods

The codebase supports three ways to connect to the database:

```typescript
// packages/database/src/config/env.config.ts

// 1. Direct PostgreSQL (local development)
if (DATABASE_URL.includes('localhost')) {
  // Use local connection
}

// 2. Neon Serverless Driver (production)
if (DATABASE_URL.includes('neon')) {
  // Use serverless driver
}

// 3. Neon HTTP Client (workers/edge runtime)
if (ENVIRONMENT === 'worker') {
  // Use HTTP client for Cloudflare Workers
}
```

---

## Building & Deployment

### Build Processes

#### Packages (Source → Source)

```bash
# Most packages don't need building
# They export TypeScript directly

# @codex/security is the exception:
pnpm --filter @codex/security build

# Output: packages/security/dist/index.js
#         packages/security/dist/index.d.ts
```

#### Workers (Source → JavaScript Bundle)

```bash
# Build auth worker
pnpm --filter auth build

# Output:
# - workers/auth/dist/index.js (bundled JavaScript)
# - workers/auth/dist/index.d.ts (TypeScript definitions)

# Build stripe worker
pnpm --filter stripe-webhook-handler build
```

**Build Configuration:**

```typescript
// workers/auth/vite.auth-worker.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',           // Output directory
    minify: false,            // Keep readable for debugging
    sourcemap: true,          // Include source maps
    lib: {
      entry: 'src/index.ts',
      fileName: 'index',      // Output as index.js
      formats: ['es'],        // ESM format
    },
    rollupOptions: {
      external: [
        /^@codex\//,           // Don't bundle shared packages
        'hono',               // Externalize runtime deps
        'better-auth',
      ],
    },
  },
});
```

#### Web App (SvelteKit)

```bash
# Build for production
pnpm --filter web build

# Output:
# - apps/web/build/          # Optimized JavaScript
# - apps/web/.svelte-kit/    # SvelteKit artifacts
```

### Build All

```bash
pnpm build                 # Builds packages + workers

# Breakdown:
pnpm build:packages        # Build @codex packages
pnpm build:workers         # Build Cloudflare Workers
```

### Deployment Workflow

```
1. Run tests (pnpm test)
   ↓
2. Build all (pnpm build)
   ↓
3. Deploy workers (wrangler deploy)
   ↓
4. Deploy web app (vercel deploy or similar)
   ↓
5. Database migrations (pnpm db:push)
```

---

## Common Tasks

### Task: Add a New Shared Package

```bash
# 1. Create directory
mkdir -p packages/my-feature

# 2. Create basic structure
cat > packages/my-feature/package.json << 'EOF'
{
  "name": "@codex/my-feature",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
EOF

# 3. Create vitest config
cat > packages/my-feature/vitest.config.ts << 'EOF'
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@codex/my-feature',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
});
EOF

# 4. Create source and test
mkdir -p packages/my-feature/src
cat > packages/my-feature/src/index.ts << 'EOF'
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
EOF

cat > packages/my-feature/src/index.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';
import { greet } from './index';

describe('greet', () => {
  it('should greet by name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });
});
EOF

# 5. Install and test
pnpm install
pnpm --filter @codex/my-feature test

# 6. Use in another package
pnpm --filter web add @codex/my-feature
```

### Task: Add a Dependency to a Worker

```bash
# 1. Add to worker
pnpm --filter auth add hono

# 2. Update imports
// workers/auth/src/index.ts
import { Hono } from 'hono';

const app = new Hono();

# 3. If you need database access
pnpm --filter auth add @codex/database

# 4. Use in worker
import { db } from '@codex/database';

const result = await db.query.users.findFirst();
```

### Task: Write a Test for a Package

```bash
# 1. Create test file in same directory as source
# packages/security/src/rate-limit.ts
# packages/security/tests/rate-limit.test.ts

# 2. Import and test
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimit } from '../src/rate-limit';

describe('RateLimit', () => {
  let rateLimiter: RateLimit;

  beforeEach(() => {
    rateLimiter = new RateLimit({
      requests: 10,
      window: 60000,
    });
  });

  it('should allow requests under limit', async () => {
    const result = await rateLimiter.check('user123');
    expect(result.allowed).toBe(true);
  });

  it('should reject requests over limit', async () => {
    // Make 11 requests
    for (let i = 0; i < 11; i++) {
      await rateLimiter.check('user123');
    }

    const result = await rateLimiter.check('user123');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });
});

# 3. Run tests
pnpm --filter @codex/security test

# 4. Watch mode for development
pnpm --filter @codex/security test:watch
```

### Task: Update Database Schema

```bash
# 1. Edit schema file
# packages/database/src/schema/users.ts
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

# 2. Generate migration
pnpm db:gen

# 3. Review generated SQL
# Check packages/database/src/migrations/

# 4. Push to database
pnpm db:push

# 5. Update tests
# Migrations run automatically in tests via drizzle config
pnpm test
```

### Task: Deploy a Worker

```bash
# 1. Build the worker
pnpm --filter auth build

# 2. Deploy to Cloudflare
cd workers/auth
wrangler deploy --env production

# 3. Verify deployment
curl https://auth.example.com/health

# 4. View logs
wrangler tail --env production
```

### Task: Run Tests with Coverage

```bash
# All tests with coverage
pnpm test:coverage

# Package tests only
pnpm test:packages --coverage

# View HTML report
open coverage/index.html
```

---

## Troubleshooting

### Issue: Import Error - "Cannot find module '@codex/X'"

**Cause:** Package not exported in package.json

**Fix:**

```json
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**Or run:** `pnpm install` to rebuild workspace links

---

### Issue: Test Fails - "Worker is not defined"

**Cause:** Miniflare not properly configured

**Fix:** Use direct Hono app testing instead:

```typescript
// ❌ Wrong
import { Miniflare } from 'miniflare';
const mf = new Miniflare({ /* ... */ });

// ✅ Right
import app from './index';
const res = await app.fetch(req, env);
```

---

### Issue: Database Connection Fails in Tests

**Cause:** `.env.dev` not loaded or database not running

**Fix:**

```bash
# 1. Check .env.dev exists
ls -la .env.dev

# 2. Start local database
pnpm docker:up

# 3. Wait for health check
sleep 3 && pnpm docker:up

# 4. Run tests
pnpm test
```

---

### Issue: Build Fails - "External dependency 'hono' not bundled"

**Cause:** Worker not configured to externalize dependencies

**Fix:** Update `vite.config.ts`:

```typescript
rollupOptions: {
  external: [
    /^@codex\//,    // Shared packages
    'hono',         // Hono framework
    'better-auth',  // Any other external deps
  ],
}
```

---

### Issue: pnpm install fails

**Cause:** lockfile corruption or Node version mismatch

**Fix:**

```bash
# 1. Check Node version
node --version  # Should be 18+

# 2. Clear pnpm cache
pnpm store prune

# 3. Remove lockfile and reinstall
rm pnpm-lock.yaml
pnpm install

# 4. If still failing
rm -rf node_modules
pnpm install
```

---

### Issue: TypeScript Errors but Code Works

**Cause:** Package exports not correctly resolved

**Fix:**

```bash
# Regenerate TypeScript configurations
pnpm install

# Clear build caches
rm -rf .svelte-kit
rm -rf packages/*/dist
rm -rf workers/*/dist

# Rebuild
pnpm build
```

---

### Issue: Tests Run Slowly

**Cause:** Running integration tests instead of unit tests

**Fix:**

```bash
# Run only fast unit tests
pnpm test:packages

# Or skip slow database tests
pnpm test -- --exclude '**/client.test.ts'

# Run in parallel (if supported)
pnpm test -- --reporter=verbose
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Root test configuration |
| `package.json` | Workspace definition + scripts |
| `pnpm-lock.yaml` | Dependency lockfile |
| `.env.dev` | Development environment (gitignored) |
| `packages/*/package.json` | Package metadata |
| `workers/*/wrangler.jsonc` | Cloudflare Worker config |
| `packages/database/src/schema/*` | Database schemas |
| `design/security/SECURITY.md` | Security architecture |

---

## Additional Resources

- **Design Docs:** `/design/infrastructure/`
- **Security:** `/design/security/SECURITY_FOUNDATIONS_SUMMARY.md`
- **Database:** `/packages/database/src/migrations/`
- **Tests:** `pnpm test --help`
- **Wrangler:** `wrangler --help`

---

## Summary

This codebase follows these patterns:

1. **Feature-based organization** - Code grouped by domain, not technical type
2. **Shared packages** - Common code extracted to `@codex/*` packages
3. **Type safety** - TypeScript + Zod for runtime validation
4. **Testing pyramid** - Unit → Integration → E2E
5. **Edge computing** - Cloudflare Workers for auth, webhooks
6. **Database as a service** - Neon PostgreSQL (serverless)
7. **Zero-config development** - Everything via pnpm scripts

**Best Practices:**

- Always check `import` rules before importing
- Write tests alongside code (same directory)
- Use mocking for external dependencies
- Test against real databases in integration tests
- Deploy with `wrangler` for workers
- Use `pnpm` not `npm` (workspace-aware)

Good luck! 🚀
