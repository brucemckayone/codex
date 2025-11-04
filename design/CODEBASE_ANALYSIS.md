# Codex Monorepo: Comprehensive Codebase Analysis

**Generated:** November 3, 2025  
**Analysis Scope:** Full monorepo structure, configuration, and relationships

---

## Table of Contents

1. [Directory Structure Overview](#directory-structure-overview)
2. [Monorepo Architecture](#monorepo-architecture)
3. [pnpm Workspace Configuration](#pnpm-workspace-configuration)
4. [Package Ecosystem](#package-ecosystem)
5. [Worker Architecture](#worker-architecture)
6. [Build System & Vite Configuration](#build-system--vite-configuration)
7. [Testing Strategy](#testing-strategy)
8. [Database Setup & Migrations](#database-setup--migrations)
9. [Environment Management](#environment-management)
10. [Dependency Relationships](#dependency-relationships)
11. [CI/CD Pipeline](#cicd-pipeline)
12. [Key Implementation Patterns](#key-implementation-patterns)

---

## 1. Directory Structure Overview

```
Codex/ (root monorepo)
├── .github/                           # GitHub Actions & configuration
│   ├── workflows/                     # CI/CD pipelines
│   │   ├── testing.yml               # PR/push testing with Neon ephemeral branches
│   │   ├── deploy-production.yml     # Production deployment workflow
│   │   ├── preview-deploy.yml        # Preview environment deployment
│   │   └── static_analysis.yml       # Linting & type checking
│   ├── scripts/                      # Helper scripts
│   │   └── manage-production-dns.sh  # Cloudflare DNS management
│   └── README.md
│
├── apps/                              # User-facing applications
│   └── web/                          # SvelteKit web application
│       ├── src/
│       │   ├── lib/                  # Shared components & utilities
│       │   │   ├── features/         # Feature-based organization
│       │   │   ├── components/       # UI components
│       │   │   └── db/               # Database integration
│       │   ├── routes/               # SvelteKit routes
│       │   ├── tests/                # Setup files
│       │   └── app.html
│       ├── e2e/                      # Playwright E2E tests
│       ├── vitest.config.ts
│       ├── vite.config.ts
│       └── package.json
│
├── workers/                           # Cloudflare Workers
│   ├── auth/                         # BetterAuth worker
│   │   ├── src/
│   │   │   ├── index.ts             # Main auth app (Hono)
│   │   │   ├── index.test.ts        # Unit tests
│   │   │   └── index.integration.test.ts
│   │   ├── vite.auth-worker.config.ts
│   │   ├── vitest.config.ts
│   │   ├── wrangler.toml            # Worker configuration
│   │   └── package.json
│   │
│   └── stripe-webhook-handler/       # Stripe webhook worker
│       ├── src/
│       │   ├── index.ts             # Main webhook handler (Hono)
│       │   ├── middleware/          # Signature verification
│       │   ├── schemas/             # Zod schemas for events
│       │   ├── utils/               # Helper utilities
│       │   ├── index.test.ts
│       │   └── security.test.ts
│       ├── vite.stripe-webhook-handler.config.ts
│       ├── vitest.config.ts
│       ├── wrangler.toml
│       └── package.json
│
├── packages/                          # Shared libraries (internal)
│   ├── database/                    # Database schema & client
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── index.ts        # Export point
│   │   │   │   ├── auth.ts         # BetterAuth tables (users, accounts, sessions)
│   │   │   │   └── test.ts         # Test/example tables
│   │   │   ├── config/
│   │   │   │   ├── drizzle.config.ts
│   │   │   │   └── env.config.ts    # DB URL resolution logic
│   │   │   ├── migrations/          # Drizzle migrations
│   │   │   ├── client.ts            # Drizzle client factory
│   │   │   └── index.ts
│   │   ├── vite.database.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   ├── validation/                 # Zod validation schemas
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── user-schema.ts      # User validation
│   │   │   └── example.test.ts
│   │   ├── vite.validation.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   ├── cloudflare-clients/         # Cloudflare R2 & KV clients
│   │   ├── src/
│   │   │   ├── r2/
│   │   │   │   ├── types.ts
│   │   │   │   ├── client.ts       # R2 client implementation
│   │   │   │   └── index.ts
│   │   │   ├── kv/
│   │   │   │   ├── types.ts
│   │   │   │   ├── client.ts       # KV client implementation
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── vite.cloudflare-clients.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   ├── security/                  # Security utilities for workers
│   │   ├── src/
│   │   │   ├── headers.ts         # Security headers middleware
│   │   │   ├── rate-limit.ts      # KV-based rate limiting
│   │   │   ├── worker-auth.ts     # Worker-to-worker authentication
│   │   │   └── index.ts
│   │   ├── tests/                 # Unit tests
│   │   ├── vite.security.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   ├── observability/             # Logging & observability
│   │   ├── src/
│   │   │   ├── index.ts          # Main client & helpers
│   │   │   ├── redact.ts         # Data redaction utilities
│   │   │   └── [other utilities]
│   │   ├── vite.observability.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   └── test-utils/                # Testing utilities
│       ├── src/
│       │   ├── miniflare-helpers.ts   # Miniflare setup
│       │   ├── database.ts
│       │   ├── factories.ts            # Test data factories
│       │   ├── helpers.ts
│       │   └── index.ts
│       ├── vite.test-utils.config.ts
│       ├── vitest.config.ts
│       └── package.json
│
├── infrastructure/                    # Local development setup
│   ├── neon/
│   │   ├── docker-compose.dev.local.yml      # Local PostgreSQL
│   │   └── docker-compose.dev.ephemeral.yml  # Ephemeral testing
│   ├── cloudflare-tunnel/
│   │   └── config.yml              # Tunnel configuration
│   └── wrangler/
│       ├── wrangler.jsonc          # Shared wrangler config
│       └── R2/
│           ├── cors-config-preview.json
│           └── cors-config-production.json
│
├── design/                            # Architecture & design docs
│   ├── infrastructure/
│   │   ├── README.md               # Documentation index
│   │   ├── CICD.md                # CI/CD pipeline details
│   │   ├── SECURITY.md            # Security architecture
│   │   ├── CLOUDFLARE-SETUP.md
│   │   ├── CodeStructure.md
│   │   ├── EnvironmentManagement.md
│   │   ├── Testing.md
│   │   └── d2/                    # Diagrams
│   │       ├── ci-cd-pipeline.d2
│   │       ├── deployment-architecture.d2
│   │       └── [other diagrams]
│   └── security/
│       ├── SECURITY_FOUNDATIONS_SUMMARY.md
│       ├── SECURITY_IMPLEMENTATION_CHECKLIST.md
│       └── SECURITY_QUICK_REFERENCE.md
│
├── config/                            # Shared configuration
│   └── eslint/
│       └── index.js                # ESLint configuration
│
├── scripts/                           # Utility scripts
│   └── build.sh                   # Build script
│
├── package.json                       # Root package.json (monorepo config)
├── pnpm-workspace.yaml               # pnpm workspaces declaration
├── pnpm-lock.yaml                    # Dependency lock file
├── tsconfig.json                     # Root TypeScript config
├── vitest.config.ts                  # Root vitest config
├── vitest.workspace.ts               # Vitest workspace config
├── eslint.config.js                  # Root ESLint config
├── .prettierrc                        # Prettier config
├── .env.dev                          # Development environment variables
└── .env.prod                         # Production environment variables
```

---

## 2. Monorepo Architecture

### Type: pnpm Workspaces

The Codex project uses **pnpm workspaces** for monorepo management, not lerna or other tools.

**Key Benefits:**
- **Efficient dependency resolution**: Single `node_modules` at root level
- **Workspace links**: Internal packages (`@codex/*`) use `workspace:*` protocol
- **Speed**: Fast installation and builds
- **Isolation**: Each package has its own `node_modules` symlinks

### Workspace Declaration

**File:** `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
```

This declares three workspace types:
1. **apps**: User-facing applications (currently: `web`)
2. **workers**: Cloudflare Workers (currently: `auth`, `stripe-webhook-handler`)
3. **packages**: Shared libraries (6 packages)

---

## 3. pnpm Workspace Configuration

### Root package.json Dependencies

**Location:** `/Users/brucemckay/development/Codex/package.json`

**Root-level Direct Dependencies:**
```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "mysql2": "^3.15.3"
  }
}
```

**Root-level Dev Dependencies (Tools):**
- **Build Tools:** Vite ^6.4.1, TypeScript ^5.7.3
- **Testing:** Vitest ^4.0.2, Playwright ^1.56.1
- **Deployment:** Wrangler ^4.45.0, Cloudflare Workers Types
- **Linting:** ESLint ^9.38.0, Prettier ^3.6.2
- **Formatting:** Prettier-plugin-svelte ^3.4.0
- **Container:** Miniflare ^4.20251008.0 (local workers simulation)
- **Framework:** SvelteKit, @sveltejs plugins
- **Utilities:** Concurrently, dotenv, wait-on, husky, lint-staged

**Scripts (Root Level):**
```bash
# Docker management
pnpm docker:up                  # Start local PostgreSQL
pnpm docker:down               # Stop local PostgreSQL
pnpm docker:up:ephemeral       # Start ephemeral testing DB

# Development
pnpm dev                        # Run all apps (web, workers)
pnpm dev:web                   # SvelteKit app only
pnpm dev:stripe-webhook-handler
pnpm dev:auth

# Testing
pnpm test                       # Run all tests (vitest)
pnpm test:watch               # Watch mode
pnpm test:coverage            # With coverage
pnpm test:ui                  # Vitest UI
pnpm test:web                 # Web app only
pnpm test:packages            # All packages only
pnpm test:e2e                 # Playwright E2E
pnpm test:all                 # Vitest + Playwright

# Code Quality
pnpm lint                      # ESLint
pnpm lint:fix
pnpm format                    # Prettier
pnpm format:check
pnpm typecheck                 # TypeScript check

# Database
pnpm db:gen                   # Generate Drizzle migrations
pnpm db:push                  # Push migrations to DB
pnpm neon:create              # Create Neon ephemeral branch
pnpm neon:list
pnpm neon:delete
pnpm neon:cleanup

# Building
pnpm build                     # Build packages + workers
pnpm build:packages           # Only packages
pnpm build:workers            # Only workers
```

---

## 4. Package Ecosystem

### 4.1 @codex/database

**Purpose:** Single source of truth for database schema and client  
**Type:** Internal shared library  
**Package Name:** `@codex/database`

**Key Files:**
- `src/schema/index.ts` - Schema exports
- `src/schema/auth.ts` - BetterAuth tables (users, accounts, sessions, etc.)
- `src/schema/test.ts` - Test/example tables
- `src/config/drizzle.config.ts` - Drizzle configuration
- `src/config/env.config.ts` - Environment & database URL resolution
- `src/client.ts` - Drizzle client factory
- `src/migrations/` - Auto-generated SQL migration files

**Technologies:**
- **ORM:** Drizzle ORM (type-safe, schema-first)
- **Database:** Neon Postgres (serverless, git-like branching)
- **Auth Integration:** BetterAuth (Drizzle adapter)
- **Migrations:** drizzle-kit

**Database Schema Overview:**

Tables include:
- `users` - User accounts
- `accounts` - OAuth/provider accounts
- `sessions` - User sessions
- `verificationTokens` - Email verification & password reset tokens
- `test` - Example/placeholder tables

**Build Configuration:**
- TypeScript compilation only
- Exports: `./src/index.ts` for ESM

**Environment Resolution:**

The `env.config.ts` handles three database connection methods:

1. **LOCAL_PROXY** (dev): Local PostgreSQL via Neon proxy (Docker)
   - URL: `postgres://postgres:postgres@db.localtest.me:5432/main`
   
2. **NEON_BRANCH** (CI/testing): Ephemeral Neon branch
   - Isolated database per test run
   - Auto-cleanup
   
3. **PRODUCTION**: Production Neon database
   - Long-lived connection

**Dependencies:**
```json
{
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "better-auth": "^1.3.34",
    "drizzle-orm": "^0.36.4",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@better-auth/cli": "^1.3.34",
    "drizzle-kit": "^0.29.1"
  }
}
```

**Workspace Dependencies:** None (no internal deps)

**Used By:**
- `apps/web` - Query & mutation access
- `workers/auth` - Session management
- `workers/stripe-webhook-handler` - Event persistence
- `packages/test-utils` - Test database setup

---

### 4.2 @codex/validation

**Purpose:** Shared Zod validation schemas  
**Type:** Internal shared library  
**Package Name:** `@codex/validation`

**Key Files:**
- `src/index.ts` - Validation schema exports
- `src/user-schema.ts` - User validation schema
- `src/example.test.ts` - Test examples

**Technologies:**
- **Schema Validation:** Zod ^3.24.1
- **Runtime validation** with TypeScript inference

**Used By:**
- `workers/auth` - Validate auth requests
- `workers/stripe-webhook-handler` - Validate webhook payloads
- `apps/web` - Form & input validation

**Exports:**
```typescript
// Example structure
export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  // ... other fields
});
```

**Build:** TypeScript compilation only

---

### 4.3 @codex/cloudflare-clients

**Purpose:** Framework-agnostic Cloudflare service clients  
**Type:** Internal shared library  
**Package Name:** `@codex/cloudflare-clients`

**Key Files:**
- `src/r2/` - R2 object storage client
  - `client.ts` - S3-compatible client
  - `types.ts` - TypeScript types
- `src/kv/` - KV namespace client
  - `client.ts` - Key-value store client
  - `types.ts` - TypeScript types

**Technologies:**
- **AWS SDK:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- **Type-Safe:** Full TypeScript support
- **Worker-Compatible:** Works in Cloudflare Workers context

**R2 Client Capabilities:**
- Upload to object storage
- Pre-signed URL generation (for direct uploads)
- Delete operations
- List operations

**KV Client Capabilities:**
- Get/Put operations
- TTL management
- Structured data handling

**Build:** Uses Vite + DTS for type definitions

**Used By:**
- `apps/web` - File uploads to R2
- `workers/stripe-webhook-handler` - Event archiving
- `workers/auth` - Session caching via KV

---

### 4.4 @codex/security

**Purpose:** Shared security utilities for Cloudflare Workers  
**Type:** Internal shared library (NEW - security foundations)  
**Package Name:** `@codex/security`

**Key Files:**
- `src/headers.ts` - Security headers middleware
- `src/rate-limit.ts` - KV-based rate limiting
- `src/worker-auth.ts` - Worker-to-worker authentication
- `src/index.ts` - Main exports

**Technologies:**
- **Framework:** Hono (for middleware compatibility)
- **Runtime:** Cloudflare Workers

**Security Headers Features:**
```typescript
// CSP presets available:
- CSP_PRESETS.api (restrictive, API only)
- CSP_PRESETS.web (more permissive, for SvelteKit)
- Custom CSP directives support

// Headers provided:
- X-Frame-Options
- X-Content-Type-Options
- Content-Security-Policy
- Strict-Transport-Security
- And more...
```

**Rate Limiting:**
```typescript
// Presets available:
- RATE_LIMIT_PRESETS.auth (login endpoints - strict)
- RATE_LIMIT_PRESETS.webhook (webhook endpoints - lenient)
- RATE_LIMIT_PRESETS.api (general API - moderate)

// KV-based storage for distributed rate limit state
```

**Worker Authentication:**
- Signature generation for worker-to-worker requests
- Verification middleware
- Cross-worker communication security

**Build:** Vite + DTS configuration

**Used By:**
- `workers/auth` - Apply security headers, rate limit login
- `workers/stripe-webhook-handler` - Security headers, rate limiting
- `apps/web` - Could use for API endpoints

---

### 4.5 @codex/observability

**Purpose:** Centralized logging and observability client  
**Type:** Internal shared library

**Key Files:**
- `src/index.ts` - Main ObservabilityClient class
- `src/redact.ts` - Sensitive data redaction utilities

**ObservabilityClient API:**
```typescript
class ObservabilityClient {
  // Methods
  log(event: LogEvent)
  info(message: string, metadata?: Record<string, unknown>)
  warn(message: string, metadata?: Record<string, unknown>)
  error(message: string, metadata?: Record<string, unknown>)
  debug(message: string, metadata?: Record<string, unknown>)
  trackRequest(metrics: RequestMetrics)
  trackError(error: Error, context?: ErrorContext)
}

// Helper functions
createRequestTimer(obs, request)  // Measure request duration
trackRequestError(obs, error, request)  // Log errors
```

**Data Redaction:**
- Masks sensitive fields (emails, tokens, passwords)
- Configurable redaction modes
- Environment-aware (stricter in production)

**Current Implementation:**
- Console logging with JSON serialization
- Ready for external service integration (Axiom, Baselime, etc.)

**Used By:**
- `workers/stripe-webhook-handler` - Request metrics & error tracking
- `workers/auth` - Error logging
- Can be used in `apps/web` for browser logging

---

### 4.6 @codex/test-utils

**Purpose:** Shared testing utilities and helpers  
**Type:** Internal shared library  
**Private:** yes

**Key Files:**
- `src/miniflare-helpers.ts` - Miniflare setup for worker testing
- `src/database.ts` - Database test utilities
- `src/factories.ts` - Test data factories
- `src/helpers.ts` - General test helpers
- `src/index.ts` - Exports

**Miniflare Integration:**
- Simulates Cloudflare Workers locally
- KV namespace mocking
- R2 storage simulation
- Request/Response simulation

**Database Testing:**
- Test database setup
- Transaction management
- Cleanup utilities

**Test Data Factories:**
- Generate realistic test data
- Support for relationships
- Bulk operations

**Used By:**
- `workers/auth` - Unit & integration tests
- `workers/stripe-webhook-handler` - Webhook testing
- `apps/web` - Database integration tests

---

## 5. Worker Architecture

### Overview

Codex has two Cloudflare Workers deployed as microservices:

1. **Auth Worker** - Authentication & session management
2. **Stripe Webhook Handler** - Payment processing & events

Both use **Hono** framework for routing and middleware.

### 5.1 Auth Worker

**Location:** `workers/auth/`  
**Deployment Names:**
- Production: `auth-worker-production`
- Staging: `auth-worker-staging`
- Development: Local via `wrangler dev`

**Domain Bindings:**
```
Production:  auth.revelations.studio
Staging:     auth-staging.revelations.studio
```

**Technology Stack:**
- **Framework:** Hono ^4.6.20
- **Auth:** BetterAuth ^1.3.34 (with Drizzle adapter)
- **Database:** PostgreSQL (Neon) via @codex/database
- **Security:** @codex/security (headers, rate limiting)
- **Observability:** @codex/observability (logging)

**Main Components:**

```typescript
// src/index.ts structure
const app = new Hono<{ Bindings: Bindings }>();

// Bindings (environment variables & services):
- ENVIRONMENT: "development" | "staging" | "production"
- DATABASE_URL: Neon connection string
- SESSION_SECRET: Session encryption key
- BETTER_AUTH_SECRET: BetterAuth secret
- WEB_APP_URL: Base URL for auth redirects
- API_URL: API worker URL
- AUTH_SESSION_KV: KV namespace for session caching
- RATE_LIMIT_KV: KV namespace for rate limit state

// Middleware chain
1. securityHeaders() - Add security headers
2. rateLimiter() - Rate limit login attempts
3. sessionHandler() - Cache sessions in KV
4. authHandler() - BetterAuth handler
```

**BetterAuth Configuration:**
- Email/password authentication
- Email verification required
- Session: 24 hours expiration
- Session cache: 5-minute TTL in KV
- Additional user fields: `role` (default: "customer")

**Endpoints (handled by BetterAuth):**
```
POST   /api/auth/email/login
POST   /api/auth/email/signup
POST   /api/auth/email/verify
POST   /api/auth/password/reset
POST   /api/auth/session  (GET session)
POST   /api/auth/logout
... and more
```

**Environment Variables (wrangler.toml):**
```toml
[env.production]
name = "auth-worker-production"
[env.production.vars]
ENVIRONMENT = "production"
WEB_APP_URL = "https://codex.revelations.studio"
API_URL = "https://api.revelations.studio"

[[env.production.routes]]
pattern = "auth.revelations.studio/*"
custom_domain = true
```

**KV Namespaces:**
```
AUTH_SESSION_KV    - Session caching (24hr TTL)
RATE_LIMIT_KV      - Login attempt rate limiting
```

**Build Process:**
- Vite build with `vite.auth-worker.config.ts`
- Output: `dist/index.js`
- Rollup config: Externalize @codex/* and hono
- Type generation with vite-plugin-dts

**Testing:**
- Unit tests: `src/index.test.ts`
- Integration tests: `src/index.integration.test.ts`
- Mock KV namespaces and environment
- Tests run on Node environment (not browser)

---

### 5.2 Stripe Webhook Handler Worker

**Location:** `workers/stripe-webhook-handler/`  
**Deployment Names:**
- Production: `stripe-webhook-handler-production`
- Staging: `stripe-webhook-handler-staging`

**Domain Bindings:**
```
Production:  api.revelations.studio/webhooks/stripe/*
Staging:     api-staging.revelations.studio/webhooks/stripe/*
```

**Technology Stack:**
- **Framework:** Hono ^4.6.20
- **Payment Processing:** Stripe ^19.2.0
- **Database:** PostgreSQL via @codex/database
- **Security:** @codex/security (headers, rate limiting, signature verification)
- **Observability:** @codex/observability (metrics, error tracking)
- **Validation:** @codex/validation (Zod schemas)

**Webhook Endpoints:**

Six separate endpoints for better scalability and separation of concerns:

1. **POST /webhooks/stripe/payment**
   - Handles: `payment_intent.*`, `charge.*`
   - Status: Placeholder (implementation pending)

2. **POST /webhooks/stripe/subscription**
   - Handles: `customer.subscription.*`, `invoice.*`
   - Status: Placeholder (implementation pending)

3. **POST /webhooks/stripe/connect**
   - Handles: `account.*`, `capability.*`, `person.*`
   - Status: Placeholder (implementation pending)

4. **POST /webhooks/stripe/customer**
   - Handles: `customer.created`, `customer.updated`, `customer.deleted`
   - Status: Placeholder (implementation pending)

5. **POST /webhooks/stripe/booking**
   - Handles: `checkout.session.*`
   - Status: Placeholder (implementation pending)

6. **POST /webhooks/stripe/dispute**
   - Handles: `charge.dispute.*`, `radar.early_fraud_warning.*`
   - Status: Placeholder (implementation pending)

**Middleware Stack:**
```typescript
app.use('*', securityHeaders(...))      // Add security headers
app.use('*', rateLimit(...))             // Rate limiting (webhook-preset)
app.use('*', requestTiming(...))         // Track request metrics
app.onError(errorHandler)                // Error tracking
```

**Signature Verification:**
- Custom middleware: `src/middleware/verify-signature.ts`
- Validates Stripe webhook signatures before processing
- Prevents replay attacks

**Environment Variables (wrangler.toml):**
```toml
[env.production]
name = "stripe-webhook-handler-production"
[env.production.vars]
ENVIRONMENT = "production"
WEB_APP_URL = "https://codex.revelations.studio"
AUTH_WORKER_URL = "https://auth.revelations.studio"

[[env.production.routes]]
pattern = "api.revelations.studio/webhooks/stripe/*"
custom_domain = true

[[env.production.routes]]
pattern = "api.revelations.studio/health"
custom_domain = true

# Secrets (set via CI/CD):
# - DATABASE_URL
# - STRIPE_SECRET_KEY
# - STRIPE_WEBHOOK_SECRET_PAYMENT (and others for each endpoint)
```

**Testing:**
- Unit tests: `src/index.test.ts`
- Security tests: `src/security.test.ts`
- Schema tests for event validation
- Miniflare for local worker testing

---

## 6. Build System & Vite Configuration

### Root-Level Vitest Configuration

**File:** `vitest.config.ts`

**Purpose:** Central test orchestration across monorepo

**Key Configuration:**
```typescript
projects: [
  'apps/web',
  'packages/database',
  'packages/validation',
  'packages/cloudflare-clients',
  'packages/security',
  'packages/test-utils',
  'workers/auth',
  'workers/stripe-webhook-handler',
],

// Coverage (global, cannot be overridden):
coverage: {
  provider: 'v8',
  enabled: false,  // Use --coverage flag
  reporters: ['text', 'json', 'html', 'lcov'],
  reportsDirectory: './coverage',
  
  // Include patterns
  include: [
    'apps/*/src/**/*.{js,ts,svelte}',
    'packages/*/src/**/*.{js,ts}',
    'workers/*/src/**/*.{js,ts}',
  ],
  
  // Exclude patterns (tests, builds, migrations, etc.)
  exclude: [
    '**/*.{test,spec}.{js,ts}',
    '**/dist/**',
    '**/.svelte-kit/**',
    '**/migrations/**',
    // ... (full list in file)
  ],
  
  // No minimum thresholds initially
  thresholds: { lines: 0, functions: 0, branches: 0 }
}
```

### Per-Package Vite Configurations

Each package and worker has its own vite config for builds:

**Pattern for Library Packages:**
```typescript
// vite.[package-name].config.ts
export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        /^@codex\//,           // Don't bundle shared packages
        'hono',                // Externalize frameworks
        'stripe',              // Externalize specific deps
      ],
    },
  },
  plugins: [dts()],  // Generate .d.ts files
});
```

**Pattern for Workers:**
- Same structure as library packages
- Additional configuration for worker-specific needs
- Externalize worker runtime deps (hono, better-auth, stripe)

**Apps (SvelteKit):**
- Uses `vite.config.ts` with SvelteKit plugin
- No special vite config for app itself (uses SvelteKit defaults)

---

## 7. Testing Strategy

### Test Organization

**Vitest Workspace Structure:**

Each project specifies its test environment and patterns:

1. **apps/web** - `vitest.config.ts`
   ```typescript
   test: {
     name: 'web',
     environment: 'happy-dom',     // Browser-like DOM
     include: ['src/**/*.test.{js,ts}'],  // Only .test.ts
     exclude: ['**/*.spec.ts'],    // Playwright uses .spec.ts
     setupFiles: ['./src/tests/setup.ts'],
     testTimeout: 10000,
   }
   ```

2. **packages/** - Node environment
   ```typescript
   test: {
     name: '@codex/[package-name]',
     environment: 'node',
     include: ['src/**/*.{test,spec}.{js,ts}'],
     testTimeout: 10000,
   }
   ```

3. **workers/** - Node environment (simulated with Miniflare)
   ```typescript
   test: {
     environment: 'node',
     include: ['src/**/*.{test,spec}.ts'],
     testTimeout: 60000,  // Longer timeout for worker tests
   }
   ```

### Test Levels

**1. Unit Tests** (Vitest)
- Location: `src/**/*.test.ts` or `.spec.ts`
- Focus: Individual functions, components, utilities
- Example: `packages/validation/src/user-schema.test.ts`

**2. Integration Tests** (Vitest with DB)
- Location: `src/**/*.integration.test.ts`
- Focus: Multiple components working together
- Database: Ephemeral Neon branch in CI
- Example: `workers/auth/src/index.integration.test.ts`

**3. E2E Tests** (Playwright)
- Location: `apps/web/e2e/**/*.spec.ts`
- Focus: Full user workflows in real browser
- Only in web app
- Example: Homepage tests, form submissions

### Testing Tools

**Vitest:**
- Fast unit/integration testing
- ESM support
- Snapshot testing
- Coverage reporting (v8)

**Playwright:**
- Browser automation for E2E
- Multi-browser testing (Chrome, Firefox, Safari)
- Visual regression testing capability
- Video/trace recording

**Miniflare:**
- Local Cloudflare Workers simulation
- KV namespace mocking
- R2 storage simulation
- Used in `@codex/test-utils`

### Database Testing Strategy

**Local Development:**
- Docker Compose with PostgreSQL
- `docker:up` starts local DB at `db.localtest.me:5432`

**CI Testing:**
- Neon ephemeral branches
- Created fresh for each test run
- Isolated from production
- Auto-cleanup after tests
- `DB_METHOD=NEON_BRANCH` in test workflow

**Test Database Environment Variables:**
```bash
# .env.dev (local)
DB_METHOD=LOCAL_PROXY
DATABASE_URL_LOCAL_PROXY=postgres://postgres:postgres@db.localtest.me:5432/main

# Testing workflow
DB_METHOD=NEON_BRANCH
DATABASE_URL=<ephemeral-branch-url>
```

### Running Tests

```bash
# All tests
pnpm test                  # Run once
pnpm test:watch           # Watch mode
pnpm test:coverage        # With coverage report
pnpm test:ui              # Interactive UI

# Specific scope
pnpm test:web             # Apps/web only
pnpm test:packages        # All packages
pnpm test:e2e             # Playwright E2E

# With database
DB_METHOD=NEON_BRANCH pnpm test:neon

# Coverage report
pnpm test:coverage
# Opens ./coverage/index.html
```

---

## 8. Database Setup & Migrations

### Database Stack

**Database:** Neon PostgreSQL (serverless, git-like branching)  
**ORM:** Drizzle ORM (schema-first, type-safe)  
**Migration Tool:** drizzle-kit  
**Auth Integration:** BetterAuth (with Drizzle adapter)

### Schema Definition

**Location:** `packages/database/src/schema/`

**Current Schema:**

1. **BetterAuth Tables** (`schema/auth.ts`):
   - `users` - User accounts
     - id, name, email, emailVerified, image, createdAt, updatedAt
   - `accounts` - OAuth/provider integration
     - userId, providerId, accountId, accessToken, refreshToken, etc.
   - `sessions` - Active sessions
     - userId, expiresAt, token
   - `verificationTokens` - Email verification & password reset
     - identifier (email), token, expiresAt

2. **Test Tables** (`schema/test.ts`):
   - Placeholder tables for development

### Migration Process

**1. Define/Modify Schema:**
```bash
# Edit packages/database/src/schema/auth.ts or other files
```

**2. Generate Migration:**
```bash
pnpm db:gen              # Runs drizzle-kit generate
# Creates SQL migration files in packages/database/src/migrations/
```

**3. Review Migration:**
```bash
# Check the generated .sql file for correctness
# Files like: 0001_soft_mauler.sql
```

**4. Push to Database:**

**Local Development:**
```bash
# Start local DB first
pnpm docker:up

# Push migrations
DB_METHOD=LOCAL_PROXY DATABASE_URL_LOCAL_PROXY=... pnpm db:push
```

**CI/Testing:**
```bash
# Automatic in test workflow:
# Creates ephemeral Neon branch
# Runs migrations on branch
# Tests with branch database
```

**Production:**
```bash
# Deployed via GitHub Actions on main branch merge
# deploy-production.yml runs:
# pnpm --filter @codex/database db:migrate
# With DATABASE_URL=<production-neon-url>
```

### Migration Management

**File Structure:**
```
packages/database/src/migrations/
├── 0000_clammy_dreadnoughts.sql    # First migration
├── 0001_soft_mauler.sql             # Second migration
└── meta/
    ├── 0000_snapshot.json           # Schema snapshot
    ├── 0001_snapshot.json
    └── _journal.json                # Migration log
```

**Database Connection Resolution:**

`packages/database/src/config/env.config.ts`:

```typescript
DbEnvConfig.getDbUrl() returns:
  - LOCAL_PROXY:   postgres://postgres:postgres@db.localtest.me:5432/main
  - NEON_BRANCH:   ${DATABASE_URL}  (ephemeral branch)
  - PRODUCTION:    ${DATABASE_URL}  (production database)

DbEnvConfig.applyNeonConfig(config) configures:
  - Connection pooling
  - WebSocket settings
  - TLS/SSL usage
  - Environment-specific optimizations
```

---

## 9. Environment Management

### Environment Files

**Development:** `.env.dev`  
**Production:** `.env.prod`

### Configuration Strategy

**Three Database Methods:**

1. **LOCAL_PROXY** (development default)
   ```bash
   DB_METHOD=LOCAL_PROXY
   DATABASE_URL_LOCAL_PROXY=postgres://postgres:postgres@db.localtest.me:5432/main
   
   # Start Docker:
   pnpm docker:up
   ```

2. **NEON_BRANCH** (CI testing)
   ```bash
   DB_METHOD=NEON_BRANCH
   DATABASE_URL=postgres://user:pass@ep-xxx.aws.neon.tech/neondb
   ```

3. **PRODUCTION**
   ```bash
   DB_METHOD=PRODUCTION
   DATABASE_URL=<long-lived-neon-url>
   ```

### Key Environment Variables

**Database:**
```
DB_METHOD: LOCAL_PROXY | NEON_BRANCH | PRODUCTION
DATABASE_URL: Connection string
DATABASE_URL_PROXY: Neon proxy URL
DATABASE_URL_LOCAL_PROXY: Local Docker PostgreSQL
```

**Cloudflare KV (local simulated):**
```
AUTH_SESSION_KV_ID=dev-sessions-kv
RATE_LIMIT_KV_ID=dev-rate-limit-kv
CACHE_KV_ID=dev-cache-kv
```

**Cloudflare R2 (local simulated):**
```
R2_BUCKET_MEDIA=codex-media-dev
R2_BUCKET_ASSETS=codex-assets-dev
R2_BUCKET_RESOURCES=codex-resources-dev
R2_BUCKET_PLATFORM=codex-platform-dev
```

**Authentication & Security:**
```
BETTER_AUTH_SECRET: Random 32-char hex
BETTER_AUTH_URL: http://localhost:3000 (local) or https://codex.revelations.studio (prod)
AUTH_TRUST_HOST: true
```

**External Services:**
```
STRIPE_SECRET_KEY: sk_test_... (test) or sk_live_... (prod)
STRIPE_PUBLISHABLE_KEY: pk_test_... or pk_live_...
STRIPE_WEBHOOK_SECRET_*: Multiple endpoints (payment, subscription, etc.)
RUNPOD_API_KEY: GPU processing
RESEND_API_KEY: Email service
```

**Platform:**
```
SITE_URL: http://localhost:5173 (local) or https://codex.revelations.studio (prod)
PLATFORM_NAME: Display name
PLATFORM_DOMAIN: Domain used
PLATFORM_LOG_LEVEL: debug | info | warn | error
```

### Production Secrets (CI/CD)

Secrets not in `.env.prod` are managed via GitHub Actions secrets:

```yaml
# Set via:
# GitHub Repo Settings → Secrets and variables → Actions secrets

CLOUDFLARE_API_TOKEN           # Wrangler deployments
CLOUDFLARE_ACCOUNT_ID          # Cloudflare account
CLOUDFLARE_ZONE_ID             # DNS zone
CLOUDFLARE_DNS_API_TOKEN       # DNS management
NEON_API_KEY                   # Neon branch creation
NEON_PROJECT_ID                # Neon project
NEON_PRODUCTION_URL            # Production database
DATABASE_URL                   # Passed to workers
STRIPE_SECRET_KEY              # Stripe API
STRIPE_WEBHOOK_SECRET_*        # Webhook signing keys (multiple)
```

---

## 10. Dependency Relationships

### Dependency Graph

```
apps/web
├─ @codex/database (workspace:*)
├─ @codex/validation (workspace:*)
├─ @codex/cloudflare-clients (workspace:*)
├─ @sveltejs/kit
├─ svelte
└─ [other dev dependencies]

workers/auth
├─ @codex/database (workspace:*)
├─ @codex/validation (workspace:*)
├─ @codex/observability (workspace:*)
├─ @codex/security (workspace:*)
├─ hono
├─ better-auth
├─ @neondatabase/serverless
└─ [other deps]

workers/stripe-webhook-handler
├─ @codex/database (workspace:*)
├─ @codex/validation (workspace:*)
├─ @codex/observability (workspace:*)
├─ @codex/security (workspace:*)
├─ stripe
├─ hono
└─ [other deps]

packages/database
├─ @neondatabase/serverless
├─ drizzle-orm
├─ better-auth
└─ [no workspace deps]

packages/validation
├─ zod
└─ [no workspace deps]

packages/cloudflare-clients
├─ @aws-sdk/client-s3
├─ @aws-sdk/s3-request-presigner
└─ [no workspace deps]

packages/security
├─ hono
└─ [no workspace deps]

packages/observability
└─ [no direct workspace deps]

packages/test-utils
├─ @codex/database (workspace:*)
├─ miniflare
└─ [vitest deps]
```

### Shared Dependencies (Root Level)

These are installed once at root, symlinked into workspace packages:

**Transitive through workspaces:**
- TypeScript, Vite, Vitest
- ESLint, Prettier
- Svelte, SvelteKit
- Hono, Drizzle ORM
- Zod, AWS SDK
- Cloudflare Workers types

**Usage Pattern:**
```typescript
// In workspace package package.json
// Use workspace: protocol for internal packages
"@codex/database": "workspace:*"

// Use exact versions for external packages
"zod": "^3.24.1"
```

### Import Restrictions

**ALLOWED:**
- App/Worker → Shared Package (`@codex/*`)
- Package → Other Package (if needed)
- Worker → Worker (via shared package only)

**NOT ALLOWED:**
- Shared Package → App
- Shared Package → Worker
- Worker → App
- Worker → App (except via shared package)

This ensures clean boundaries and prevents circular dependencies.

---

## 11. CI/CD Pipeline

### Workflows

**Location:** `.github/workflows/`

#### 11.1 Testing Workflow (`testing.yml`)

**Triggers:**
- Pull requests (open, synchronize, reopened)
- Pushes to any branch

**Jobs:**

1. **static-analysis** (reusable workflow)
   - ESLint
   - TypeScript checking
   - Prettier formatting check

2. **changes** (detect changed packages)
   - Uses dorny/paths-filter
   - Detects which packages changed
   - Outputs: database, validation, cloudflare-clients, test-utils, web, auth-worker, stripe-webhook-handler

3. **test** (main test job)
   - Creates Neon ephemeral branch
   - Installs dependencies
   - Runs database migrations on branch
   - Runs vitest for all projects
   - Runs Playwright E2E tests
   - Auto-cleans up Neon branch

**Environment:**
```
DB_METHOD=NEON_BRANCH
DATABASE_URL=<ephemeral-branch-url>
```

**Output:**
- Test results
- Coverage report
- Pass/fail status for PR

---

#### 11.2 Preview Deployment (`preview-deploy.yml`)

**Triggers:**
- On PR (when testing.yml succeeds)
- Creates preview environment

**Preview Environment:**
```
Domain:   *-preview-{PR}.revelations.studio
Workers:  *-preview-{PR}-production
Database: pr-{PR} (Neon branch)
```

**Deployment Steps:**
1. Verify preview DNS records exist
2. Build all workers
3. Deploy to preview workers
4. Health checks

---

#### 11.3 Production Deployment (`deploy-production.yml`)

**Triggers:**
- After testing.yml succeeds on main branch
- Only when pushing to main

**Conditions:**
```
- Previous workflow (testing.yml) passed
- This is a push (not PR merge)
- Branch is main
```

**Deployment Steps:**
1. Verify production DNS records
2. Build validation (all workers compile)
3. Test migrations on temporary Neon branch (TODO)
4. Run migrations on production database
5. Deploy stripe-webhook-handler to production
6. Deploy auth-worker to production
7. Deploy web app to production
8. Health checks for each worker
9. Slack/email notifications

**Sequential Deployment:**
Workers deployed one-at-a-time with health checks between:
```
1. stripe-webhook-handler
   ↓ (health check)
2. auth-worker
   ↓ (health check)
3. web app
```

---

#### 11.4 Static Analysis Workflow

**Checks:**
- ESLint linting
- TypeScript type checking
- Prettier formatting

**Reusable:** Yes (called from testing.yml)

---

### Secrets & Configuration

**GitHub Secrets (set in repo settings):**
```
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_ZONE_ID
CLOUDFLARE_DNS_API_TOKEN
NEON_API_KEY
NEON_PROJECT_ID
NEON_PRODUCTION_URL
DATABASE_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET_PAYMENT
STRIPE_WEBHOOK_SECRET_SUBSCRIPTION
... (more webhook secrets)
```

**GitHub Variables (public config):**
```
NEON_PROJECT_ID
(Can be viewed publicly)
```

---

## 12. Key Implementation Patterns

### 12.1 Monorepo Package Management

**Pattern: Workspace Protocol**
```json
{
  "dependencies": {
    "@codex/database": "workspace:*"
  }
}
```

Benefits:
- Always uses workspace version
- Instant updates (no npm publish needed)
- Type-safe at edit time
- Local testing before publishing

---

### 12.2 Environment Resolution

**Pattern: Factory Functions**

```typescript
// packages/database/src/config/env.config.ts
export const DbEnvConfig = {
  method: process.env.DB_METHOD,
  getDbUrl(): string {
    switch (this.method) {
      case 'LOCAL_PROXY':
        return process.env.DATABASE_URL_LOCAL_PROXY;
      case 'NEON_BRANCH':
        return process.env.DATABASE_URL;
      case 'PRODUCTION':
        return process.env.DATABASE_URL;
    }
  }
};
```

Benefits:
- Single source of configuration logic
- Easy to add new environments
- Type-safe with TypeScript

---

### 12.3 Worker Middleware Chain

**Pattern: Sequence Handler**

```typescript
// workers/auth/src/index.ts
const app = new Hono();

app.use('*', sequence(
  securityHeaders(),
  rateLimiter(),
  sessionHandler(),
  authHandler()
));
```

**Order matters:**
1. Security headers (apply to all responses)
2. Rate limiting (protect from abuse)
3. Session handling (authenticate user)
4. Business logic (auth)

---

### 12.4 Security Middleware

**Pattern: Middleware Factory**

```typescript
// packages/security/src/headers.ts
export function securityHeaders(options?: SecurityHeadersOptions) {
  return async (c: Context, next: Next) => {
    await next();
    // Apply headers to response
    c.header('X-Frame-Options', 'DENY');
    // ... more headers
  };
}
```

**Reusable:** Can be imported and used in any worker.

---

### 12.5 Type-Safe Validation

**Pattern: Zod Schemas**

```typescript
// packages/validation/src/user-schema.ts
export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

// Usage in worker
const validated = userSchema.parse(req.body);
// TS knows type of validated
```

**Benefits:**
- Runtime validation
- Type inference
- Single source of schema definition

---

### 12.6 Database Client Factory

**Pattern: Singleton Pattern**

```typescript
// packages/database/src/client.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { DbEnvConfig } from './config/env.config';

const db = drizzle(DbEnvConfig.getDbUrl());

export { db };
```

**Usage:**
```typescript
// Any worker or app
import { db } from '@codex/database';

const user = await db.query.users.findFirst();
```

---

### 12.7 Testing with Mocks

**Pattern: Mock Bindings**

```typescript
// workers/auth/src/index.test.ts
const env = {
  ENVIRONMENT: 'test',
  BETTER_AUTH_SECRET: 'test-secret',
  AUTH_SESSION_KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  },
  RATE_LIMIT_KV: { /* ... */ },
};

const res = await app.fetch(req, env);
expect(res.status).toBe(200);
```

**Benefits:**
- No real external services needed
- Fast tests
- Deterministic

---

### 12.8 Feature-Based Organization

**Pattern: By Domain**

```
apps/web/src/lib/features/
├── auth/                    # Auth-related components
│   ├── components/
│   ├── stores/
│   └── utils/
├── shared/                  # Shared across features
│   ├── components/          # UI components
│   └── utils/
└── [other features]/
```

**Benefits:**
- Easy to locate related code
- Clear ownership
- Easier to extract features later

---

## Summary: How Everything Connects

```
GitHub Push/PR
    ↓
Testing Workflow (CI)
    ├─ Create Neon ephemeral branch
    ├─ Run migrations
    ├─ Run vitest for all packages
    └─ Run Playwright E2E
         ↓
         If PR: Preview Deployment
         └─ Deploy to *-preview-{PR}
         
         If main: Wait for manual approval/merge
                  ↓
                  Production Deployment
                  ├─ Verify DNS
                  ├─ Run migrations (production DB)
                  ├─ Deploy stripe-webhook-handler
                  ├─ Deploy auth-worker
                  └─ Deploy web app
```

**Data Flow:**
```
Web App (SvelteKit)
    ↓
Auth Worker (BetterAuth + Sessions)
    ↓
Stripe Webhook Handler (Event Processing)
    ↓
PostgreSQL Database (Neon)
    ├─ R2 (Object Storage) via Cloudflare Clients
    └─ KV (Key-Value Cache) via Cloudflare Clients
```

**Code Organization:**
```
Shared Libraries (@codex/*)
    ├─ database: Schema + ORM + Client
    ├─ validation: Zod schemas
    ├─ security: Middleware & auth
    ├─ observability: Logging
    └─ cloudflare-clients: R2 & KV

Apps & Workers (consume shared libraries)
    ├─ web: UI + routing
    ├─ auth: Authentication
    └─ stripe-webhook: Payment events
```

