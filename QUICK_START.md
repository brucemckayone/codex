# Codex Monorepo - Quick Start & Cheat Sheet

## 🚀 First Time Setup

```bash
# 1. Clone and navigate
git clone <repo>
cd Codex

# 2. Install dependencies
pnpm install

# 3. Setup environment
cp .env.dev.example .env.dev
# Edit .env.dev with your values

# 4. Start database (if developing locally)
pnpm docker:up

# 5. Run tests to verify setup
pnpm test
```

## 📁 Project Map (30 seconds)

```
apps/web/          ← Your SvelteKit app (frontend)
packages/          ← Shared code (@codex/*)
  ├── database/    ← DB client & schemas
  ├── validation/  ← Zod schemas
  ├── security/    ← Rate limiting, headers
  ├── observability/ ← Logging
  └── ...
workers/           ← Cloudflare Workers
  ├── auth/        ← Authentication
  └── stripe-webhook-handler/
```

## 🏃 Essential Commands

### Development

```bash
# Start everything
pnpm dev                    # Web app + workers + workers

# Individual development
pnpm dev:web                # Just frontend (port 5173)
pnpm dev:auth               # Just auth worker
pnpm dev:stripe-webhook-handler

# Stop services
pnpm stop                   # Stop Docker database
```

### Testing

```bash
# All tests
pnpm test                   # Run all tests once
pnpm test:watch             # Watch mode

# Specific tests
pnpm test:web               # Just web app tests
pnpm test:packages          # Just package tests

# With coverage
pnpm test:coverage          # Generate coverage reports
open coverage/index.html    # View report

# E2E tests
pnpm test:e2e               # Headless Playwright
pnpm test:e2e:ui            # With Playwright UI
```

### Building

```bash
# Build all
pnpm build                  # Packages + Workers

# Individual builds
pnpm build:packages         # All @codex/* packages
pnpm build:workers          # All Workers

# Build specific
pnpm --filter auth build
pnpm --filter @codex/security build
```

### Database

```bash
# Local database (Docker)
pnpm docker:up              # Start PostgreSQL container
pnpm docker:down            # Stop container

# Migrations
pnpm db:gen                 # Generate new migrations
pnpm db:push                # Run migrations
pnpm db:studio              # Open Drizzle Studio

# Neon (production DB)
pnpm test:neon              # Run tests against Neon
pnpm neon:create            # Create new branch
pnpm neon:cleanup           # Delete test branches
```

### Code Quality

```bash
# Linting
pnpm lint                   # Run ESLint
pnpm lint:fix               # Auto-fix issues

# Formatting
pnpm format                 # Format all files (Prettier)
pnpm format:check           # Check formatting

# Type checking
pnpm typecheck              # TypeScript compiler check
```

### Deployment

```bash
# Deploy workers
cd workers/auth
wrangler deploy --env production

# View logs
wrangler tail --env production
```

## ➕ Add Dependencies

### Shared (all projects use it)

```bash
pnpm add -w package-name           # Production
pnpm add -wD dev-package           # Development

# Examples
pnpm add -w dotenv
pnpm add -wD typescript
```

### Specific Package

```bash
pnpm --filter @codex/database add drizzle-orm
pnpm --filter auth add hono
pnpm --filter web add svelte-transitions
```

**Note:** Use correct filter name:
- Packages: `@codex/name`
- Workers: short name (e.g., `auth`)
- Web: `web`

## ✍️ Write Tests

### Package Test Template

```typescript
// packages/security/tests/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from '../src/rate-limit';

describe('rateLimit', () => {
  it('should enforce limits', async () => {
    const result = await rateLimit({ limit: 10 });
    expect(result).toBeDefined();
  });
});
```

### Worker Test Template

```typescript
// workers/auth/src/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import app from './index';

describe('Auth Worker', () => {
  it('should handle requests', async () => {
    const req = new Request('http://localhost/api');
    const env = {
      BETTER_AUTH_SECRET: 'test',
      AUTH_SESSION_KV: {} as KVNamespace,
      RATE_LIMIT_KV: {} as KVNamespace,
    };

    const res = await app.fetch(req, env);
    expect(res.status).toBeDefined();
  });
});
```

### Run Tests

```bash
pnpm test                          # All
pnpm --filter @codex/security test # Specific package
pnpm test -- --watch               # Watch mode
```

## 🔧 Configuration Files

| File | What | Where |
|------|------|-------|
| `vitest.config.ts` | Test config (root) | `/` |
| `package.json` | Workspace definition | `/` |
| `pnpm-lock.yaml` | Dependency lock | `/` |
| `.env.dev` | Dev variables | `/` (gitignored) |
| `wrangler.toml` | Worker config | `/workers/auth` |

## 🚨 Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "Cannot find module '@codex/X'" | Run `pnpm install` |
| Tests fail with DB error | Run `pnpm docker:up` |
| Build fails - "External dependency not bundled" | Check `rollupOptions.external` in vite config |
| TypeScript errors | Run `pnpm typecheck` |
| Tests slow | Run `pnpm test:packages` (skip DB tests) |
| pnpm install fails | `rm -rf node_modules && pnpm install` |

## 📋 Import Rules (CRITICAL!)

```typescript
// ✅ ALLOWED
import { db } from '@codex/database';
import { Component } from '$lib/features/auth';
import { Hono } from 'hono';

// ❌ NOT ALLOWED
import { Component } from 'apps/web/src/lib/features/auth';
import { handler } from 'workers/auth/src/index';
import fs from 'fs';  // In workers (no Node APIs)
```

## 🗂️ Add New Shared Package

```bash
# Create structure
mkdir -p packages/my-pkg/src
mkdir packages/my-pkg/tests

# Create package.json
cat > packages/my-pkg/package.json << 'EOF'
{
  "name": "@codex/my-pkg",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run"
  }
}
EOF

# Create vitest.config.ts
cat > packages/my-pkg/vitest.config.ts << 'EOF'
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@codex/my-pkg',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
EOF

# Create source
cat > packages/my-pkg/src/index.ts << 'EOF'
export function greet(name: string) {
  return `Hello, ${name}!`;
}
EOF

# Test it
pnpm install
pnpm --filter @codex/my-pkg test
```

## 📚 Environments Explained

```bash
# .env.dev (LOCAL DEVELOPMENT)
DATABASE_URL=postgresql://localhost:5432/codex
CLOUDFLARE_API_TOKEN=local_token
BETTER_AUTH_SECRET=long_secret_key

# .env.prod (CI/CD - set in GitHub Secrets)
DATABASE_URL=neon_production_url
CLOUDFLARE_API_TOKEN=prod_token

# Test uses:
# - Ephemeral Neon branch, OR
# - Local Docker, OR
# - In-memory mocks
```

## 🧪 Three Ways to Test

```bash
# 1. UNIT TESTS (Fast, mocked)
pnpm test:packages
# ⚡ Instant feedback, no DB needed

# 2. INTEGRATION TESTS (Real DB)
pnpm test
# 🔄 Real database, slightly slower

# 3. E2E TESTS (Full user flow)
pnpm test:e2e
# 🐢 Browser automation, slowest
```

## 🔐 Security Quick Reference

```typescript
// Security package includes:
import {
  securityHeaders,    // CORS, CSP, XSS protection
  rateLimit,         // Request rate limiting
  RATE_LIMIT_PRESETS, // Common presets (auth, api, etc)
  verifyWorkerAuth,  // Worker mutual TLS auth
} from '@codex/security';

// Usage:
app.use(securityHeaders({ environment: 'production' }));
app.use(rateLimit({ ...RATE_LIMIT_PRESETS.auth }));
```

## 🌍 Multi-Environment Support

```typescript
// Database auto-detects environment:
if (DATABASE_URL.includes('localhost')) {
  // Local PostgreSQL
} else if (DATABASE_URL.includes('neon')) {
  // Neon serverless (production)
}

// In workers, use Neon HTTP client (no TCP)
if (ENVIRONMENT === 'worker') {
  // Use HTTP client for edge runtime
}
```

## 📞 Get Help

- **Read:** `DEVELOPER_GUIDE.md` (comprehensive)
- **Check:** `design/security/SECURITY_FOUNDATIONS_SUMMARY.md`
- **Commands:** `pnpm help` or `wrangler --help`
- **Logs:** `wrangler tail` or `pnpm docker logs`

## ✅ Pre-Commit Checklist

Before pushing:

```bash
# 1. Format code
pnpm format

# 2. Check types
pnpm typecheck

# 3. Lint
pnpm lint:fix

# 4. Run tests
pnpm test

# 5. Build (optional, CI will do it)
pnpm build
```

---

**Everything you need to work with Codex! Start with `pnpm dev` and check `DEVELOPER_GUIDE.md` for details.** 🚀
