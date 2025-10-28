# Code Structure

## Overview

This project uses a **feature-based organization** approach within a pnpm workspace monorepo. Code is organized by domain/feature rather than technical type, making it easier to understand, maintain, and scale the application.

## Monorepo Structure

```
Codex/
├── apps/
│   └── web/                    # SvelteKit application
├── workers/
│   ├── queue-consumer/         # Queue processing worker
│   └── webhook-handler/        # Webhook handling worker
├── packages/
│   ├── database/               # Shared database schema & client
│   ├── validation/             # Shared Zod schemas
│   ├── cloudflare-clients/     # Shared Cloudflare service clients (R2, KV)
│   └── test-utils/             # Shared testing utilities
├── scripts/                    # Build & deployment scripts
└── infrastructure/             # Docker Compose, etc.
```

### Package Overview

- **`packages/database`**: Single source of truth for database schema (Drizzle) and the database client.
- **`packages/validation`**: Shared Zod schemas for type-safe validation across the stack.
- **`packages/cloudflare-clients`**: Framework-agnostic clients for interacting with Cloudflare services like R2 and KV.
- **`packages/test-utils`**: Shared testing utilities, including helpers for Miniflare.

## SvelteKit App Structure (apps/web)

The SvelteKit application (`apps/web`) consumes the shared packages and organizes UI and app-specific logic into a feature-based structure within `src/lib/features`.

```
apps/web/
└── src/
    ├── lib/
    │   └── features/
    │       ├── auth/
    │       ├── content-management/
    │       └── ...
    └── routes/
```

## Import Patterns

### Absolute Imports in SvelteKit App

```typescript
// Use $lib alias for app-specific imports
import { SomeComponent } from '$lib/features/some-feature/components';

// Use package imports for shared packages
import { db } from '@codex/database';
import { R2Client } from '@codex/cloudflare-clients';
```

### Imports in Workers

```typescript
// Package imports are the ONLY way to share code with workers
import { db } from '@codex/database';
```

### Import Rules

1.  **Shared packages** (`@codex/*`): Use for any code shared between the `apps/web` and `workers/*` projects.
2.  **App-specific** (`$lib/*`): Use only within the SvelteKit app (`apps/web`).
3.  **Worker-specific** (relative): Use only within a specific worker.
4.  **NEVER** import from `apps/web` into a worker or another package.

## Testing Structure

The project uses a comprehensive testing strategy with **Vitest** for unit/integration tests and **Playwright** for E2E tests.

### Test Organization

```
Codex/
├── apps/web/
│   ├── src/
│   │   ├── lib/
│   │   │   └── features/
│   │   │       └── shared/
│   │   │           └── components/
│   │   │               ├── Card.svelte
│   │   │               └── Card.test.ts          # Component unit tests
│   │   └── routes/
│   │       └── api/
│   │           └── health/
│   │               ├── +server.ts
│   │               └── server.test.ts            # API integration tests
│   ├── e2e/
│   │   └── homepage.spec.ts                      # E2E tests (Playwright)
│   ├── vitest.config.ts
│   └── playwright.config.ts
│
├── packages/
│   ├── database/
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   └── client.test.ts                    # Unit tests
│   │   └── vitest.config.ts
│   ├── validation/
│   │   ├── src/
│   │   │   ├── user-schema.ts
│   │   │   └── user-schema.test.ts               # Unit tests
│   │   └── vitest.config.ts
│   └── [other packages follow same pattern]
│
├── workers/
│   ├── queue-consumer/
│   │   └── src/
│   │       └── index.test.ts                     # Worker unit tests
│   └── webhook-handler/
│       └── src/
│           └── index.test.ts                     # Worker unit tests
│
├── vitest.config.ts                              # Root workspace config
└── vitest.shared.ts                              # Shared test config
```

### Test Organization

**Packages & Workers** - Use `/tests` directory for organized test suites:

```
packages/database/
├── src/
│   ├── client.ts
│   ├── schema.ts
│   └── index.ts
├── tests/
│   ├── unit/
│   │   ├── client.test.ts
│   │   └── schema.test.ts
│   └── integration/
│       └── database.test.ts
└── vitest.config.ts

workers/queue-consumer/
├── src/
│   └── index.ts
├── tests/
│   ├── unit/
│   │   └── handlers.test.ts
│   └── integration/
│       └── queue.test.ts
└── vitest.config.ts
```

**SvelteKit App** - Feature-scoped testing:

```
apps/web/
├── src/
│   ├── lib/
│   │   └── features/
│   │       ├── auth/
│   │       │   ├── components/
│   │       │   │   ├── LoginForm.svelte
│   │       │   │   └── LoginForm.test.ts      # Component tests
│   │       │   ├── stores/
│   │       │   │   ├── auth.ts
│   │       │   │   └── auth.test.ts            # Store tests
│   │       │   └── utils/
│   │       │       ├── validate.ts
│   │       │       └── validate.test.ts        # Utility tests
│   │       └── content/
│   │           └── [same pattern]
│   └── routes/
│       └── api/
│           └── health/
│               ├── +server.ts
│               └── server.test.ts              # API integration tests
├── e2e/
│   ├── auth/
│   │   └── login.spec.ts                       # E2E flows
│   └── homepage.spec.ts
├── vitest.config.ts
└── playwright.config.ts
```

### Test Types & Commands

```bash
# Unit/Integration Tests (Vitest)
pnpm test                    # All unit/integration
pnpm test:web                # SvelteKit app only
pnpm test:packages           # All packages only
pnpm test:coverage           # With coverage

# E2E Tests (Playwright)
pnpm test:e2e                # Full user flows
pnpm test:e2e:ui             # With Playwright UI

# All Tests
pnpm test:all                # Everything
```