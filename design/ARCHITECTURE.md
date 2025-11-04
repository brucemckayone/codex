# Codex Architecture Deep Dive

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Internet / Users                                  │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
         ┌──────────▼──────────┐  ┌────▼─────────┐  ┌───▼──────────────┐
         │  Web App (SvelteKit)│  │ Auth Worker  │  │ Webhook Handler  │
         │   (SPA)             │  │ (BetterAuth) │  │ (Stripe)         │
         │                     │  │              │  │                  │
         │ - Login/Signup      │  │ - Sessions   │  │ - Payment events │
         │ - Dashboard         │  │ - JWT tokens │  │ - Subscriptions  │
         │ - Profile mgmt      │  │ - OAuth      │  │ - Disputes       │
         └─────────┬───────────┘  └────┬─────────┘  └──────┬───────────┘
                   │                   │                    │
                   └───────────────────┼────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │      Cloudflare Global       │                              │
        │      Network                 │                              │
        │                              │                              │
        │  ┌─────────────────────────┐ │  ┌─────────────────────────┐ │
        │  │  R2 (Object Storage)    │ │  │  KV (Edge Cache)        │ │
        │  │  - User files           │ │  │  - Session cache        │ │
        │  │  - Uploads              │ │  │  - Rate limit counters  │ │
        │  │  - Static assets        │ │  │  - Temporary data       │ │
        │  └─────────────────────────┘ │  └─────────────────────────┘ │
        │                              │                              │
        └──────────────────────────────┼──────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │    Neon Database             │                              │
        │    (PostgreSQL Serverless)   │                              │
        │                              │                              │
        │  ┌──────────────────────────────────────────────────────┐   │
        │  │  Production Postgres                                │   │
        │  │  - users, sessions, verification_tokens             │   │
        │  │  - better_auth schema                               │   │
        │  │  - Custom business data                             │   │
        │  └──────────────────────────────────────────────────────┘   │
        │                                                              │
        └──────────────────────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │    External Services         │                              │
        │                              │                              │
        │  ┌─────────────────────────┐ │  ┌─────────────────────────┐ │
        │  │  Stripe API             │ │  │  Email Service          │ │
        │  │  - Payments             │ │  │  - Verification emails  │ │
        │  │  - Subscriptions        │ │  │  - Password resets      │ │
        │  │  - Disputes             │ │  │  - Notifications        │ │
        │  └─────────────────────────┘ │  └─────────────────────────┘ │
        │                              │                              │
        └──────────────────────────────┴──────────────────────────────┘
```

## Data Flow

### Authentication Flow

```
User → Web App → Auth Worker → BetterAuth → Neon DB
         ↓
       KV Cache (session)
       ↓
       Issues JWT
       ↓
       Web App stores in cookie
       ↓
       Future requests include JWT
       ↓
       Auth Worker validates
```

### Request Handling Middleware Stack

```
HTTP Request from User
         ↓
    ┌────────────────────────────────┐
    │ Security Headers Middleware    │
    │ - CORS, CSP, X-Frame-Options  │
    └────────────┬───────────────────┘
                 ↓
    ┌────────────────────────────────┐
    │ Rate Limiting Middleware       │
    │ - Check KV for request count   │
    │ - Increment counter            │
    │ - Check against limits         │
    └────────────┬───────────────────┘
                 ↓
    ┌────────────────────────────────┐
    │ Session Handler Middleware     │
    │ - Parse session cookie         │
    │ - Check KV cache               │
    │ - Validate JWT                 │
    └────────────┬───────────────────┘
                 ↓
    ┌────────────────────────────────┐
    │ BetterAuth Handler             │
    │ - Route to appropriate auth    │
    │ - Handle login/signup/etc      │
    │ - Query database               │
    └────────────┬───────────────────┘
                 ↓
           HTTP Response
```

## Code Sharing Architecture

### Import Hierarchy

```
Level 0 (Independent)
└─ External packages (hono, zod, drizzle, etc)

Level 1 (Foundation)
└─ @codex/validation        (Zod schemas - no dependencies on other @codex/*)
   @codex/observability     (Logging)

Level 2 (Services)
├─ @codex/security         (Depends on Level 1)
├─ @codex/cloudflare-clients
└─ @codex/test-utils

Level 3 (Core)
└─ @codex/database         (Uses @codex/validation)

Level 4 (Consumers)
├─ apps/web                (Uses all packages)
├─ workers/auth            (Uses @codex/database, @codex/security, etc)
└─ workers/stripe-webhook  (Uses selected packages)
```

**Key Rule:** Never import "downward" in this hierarchy
- ✅ apps/web can import @codex/database
- ❌ @codex/database cannot import from apps/web

### Workspace Resolution

```typescript
// When you write:
import { db } from '@codex/database';

// pnpm resolves as:
1. Look in package.json exports
2. Find: { ".": "./src/index.ts" }
3. Resolve: packages/database/src/index.ts
4. Load directly (no build needed during development)

// At build time (production):
1. src files get bundled
2. Shared packages are externalized in workers
3. Copied for web app via bundler
```

## Deployment Architecture

### Development → Production Pipeline

```
Developer pushes code
         ↓
    ┌────────────────┐
    │ GitHub Actions │
    └────────┬───────┘
             ↓
    ┌────────────────────┐
    │ 1. Run Tests       │
    │    - Unit tests    │
    │    - Integration   │
    │    - E2E (optional)│
    └────────┬───────────┘
             ↓
    ┌────────────────────┐
    │ 2. Type Check      │
    │    - tsc --noEmit  │
    │    - ESLint        │
    └────────┬───────────┘
             ↓
    ┌────────────────────┐
    │ 3. Build All       │
    │    - Packages      │
    │    - Workers       │
    │    - Web app       │
    └────────┬───────────┘
             ↓
    ┌────────────────────────────────┐
    │ 4. Deploy                      │
    │    - Workers → Cloudflare      │
    │    - Web → Vercel/Netlify      │
    │    - Migrations → Neon         │
    └────────┬───────────────────────┘
             ↓
    Production Codex
```

## Environment Configurations

### Local Development

```
Your Machine
    ↓
┌─────────────────────────────┐
│ .env.dev                    │
│ - DATABASE_URL=localhost    │
│ - CLOUDFLARE=local_token    │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│ Docker Compose              │
│ - PostgreSQL (port 5432)    │
│ - Adminer (port 8080)       │
└──────────┬──────────────────┘
           ↓
Your tests run against local DB
```

### CI/CD Environment

```
GitHub Actions
    ↓
┌────────────────────────────┐
│ GitHub Secrets (encrypted) │
│ - DATABASE_URL             │
│ - CLOUDFLARE_TOKEN         │
│ - STRIPE_KEY               │
└──────────┬─────────────────┘
           ↓
┌────────────────────────────┐
│ Neon Ephemeral Branch      │
│ - Auto-created per test    │
│ - Auto-deleted after       │
│ - Full PostgreSQL          │
└──────────┬─────────────────┘
           ↓
Tests run against real DB, cleanup automatic
```

### Production Environment

```
Deployed System
    ↓
┌──────────────────────────────┐
│ Cloudflare Secrets KV        │
│ (encrypted at rest)          │
│ - DATABASE_URL (prod)        │
│ - API_KEYS                   │
│ - SECRETS                    │
└──────────┬───────────────────┘
           ↓
┌──────────────────────────────┐
│ Neon Production Database     │
│ - Single PostgreSQL instance │
│ - Backups enabled            │
│ - Scaling enabled            │
│ - IP allow-listing           │
└──────────┬───────────────────┘
           ↓
Workers and Web app use production secrets
```

## Testing Pyramid

```
                    ┌──────────────┐
                    │   E2E Tests  │
                    │  (Slow, UI)  │
                    └──────────────┘
                    5-10% of tests
                         │
          ┌──────────────────────────────┐
          │   Integration Tests          │
          │ (DB + Services, Medium)      │
          └──────────────────────────────┘
          20-30% of tests
                    │
       ┌────────────────────────────────────────┐
       │        Unit Tests                      │
       │  (Fast, mocked, 70-80%)               │
       │  - Security functions                 │
       │  - Validation schemas                 │
       │  - Middleware logic                   │
       │  - Utility functions                  │
       └────────────────────────────────────────┘
       60-80% of tests

Time:     Fast → Medium → Slow
Cost:     Low  → Medium → High
Isolation: High → Medium → Low
```

## Worker Deployment Model

### Current Approach (Direct Fetch Testing)

```
Source Code (src/index.ts)
         ↓
Hono app instance
         ↓
Test calls: app.fetch(req, env)
         ↓
Mock environment: { KV, Secrets, etc }
         ↓
Response
```

**Pros:** Fast, no build required, easy to test
**Cons:** Doesn't test actual bundling

### Production Approach (Wrangler Deploy)

```
Source Code
    ↓
Vite Build
    ↓
Bundled JavaScript (dist/index.js)
    ↓
Wrangler Deploy to Cloudflare
    ↓
Cloudflare Edge Nodes
    ↓
Responds to user requests
```

### Integration Testing (Optional Future)

```
Built Worker (dist/index.js)
    ↓
Wrangler Dev Mode
    ↓
Local server (localhost:8787)
    ↓
Test with real HTTP requests
    ↓
Full simulation of production
```

## Security Architecture

### Authentication & Sessions

```
User Credentials
    ↓
Auth Worker (BetterAuth)
    ↓
Validate against Neon DB
    ↓
Generate JWT Token
    ↓
Store Session in KV (short TTL)
    ↓
Return to Client (cookie)
    ↓
Future requests validate JWT
```

### Rate Limiting

```
Incoming Request
    ↓
Identify client (IP, user ID)
    ↓
Check KV counter
    ↓
Increment counter
    ↓
Set TTL
    ↓
Compare against preset limits
    ↓
ALLOW or REJECT (429)
```

### Data Protection

```
Secrets (API keys, secrets)
    ├─ Development: .env.dev (local only)
    ├─ CI/CD: GitHub Secrets (encrypted)
    └─ Production: Cloudflare KV (encrypted)

Sensitive Logs
    └─ Observability package redacts:
       - API keys
       - Passwords
       - Personal information
       - Credit card numbers
```

## Scaling Considerations

### Current Architecture

```
┌─────────────────────────────┐
│   Global Users              │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│ Cloudflare Global Network   │
│ (Anycast routing)           │
└──────────────┬──────────────┘
               │
      ┌────────┴────────┐
      │                 │
   Workers           Web App
(serverless edge)  (Vercel/Netlify)
      │                 │
      └────────┬────────┘
               │
┌──────────────▼──────────────┐
│  Neon Database              │
│  (Auto-scaling)             │
│  - Read replicas (optional) │
│  - Connection pooling       │
└─────────────────────────────┘
```

### Performance Optimization

```
Layer 1: Edge (Cloudflare Workers)
└─ KV Cache → Instant response for sessions

Layer 2: Network (Cloudflare CDN)
└─ Static assets → Cached globally

Layer 3: Database (Neon)
└─ Connection pooling → Fewer total connections
└─ Caching → Query result caching

Layer 4: Application
└─ Lazy loading → Only load needed features
└─ Code splitting → Smaller bundles
```

## Technology Stack Rationale

| Component | Choice | Why |
|-----------|--------|-----|
| Frontend | SvelteKit | Reactive, lightweight, full-stack |
| Workers | Cloudflare | Global, serverless, low latency |
| Database | Neon | Postgres serverless, auto-scaling |
| Storage | R2 | S3-compatible, Cloudflare integrated |
| Cache | KV | Fast edge cache, Cloudflare integrated |
| Auth | BetterAuth | Open source, self-hosted, flexible |
| Validation | Zod | TypeScript-first, runtime validation |
| ORM | Drizzle | Lightweight, type-safe, fast |
| Testing | Vitest | Fast, Vite-native, ESM-first |
| Bundler | Vite | ESM-first, super fast, SvelteKit native |

## Dependency Graph

```
@codex/validation (independent)
    ↓
@codex/security (uses validation)
    ↓
@codex/database (uses validation)
    ├─ Drizzle ORM
    ├─ Neon Serverless Driver
    └─ PostgreSQL
    ↓
@codex/cloudflare-clients
    ├─ @aws-sdk/s3
    └─ Cloudflare SDK
    ↓
@codex/test-utils
    ├─ Miniflare
    └─ Vitest
    ↓
Consumers:
    ├─ apps/web (SvelteKit)
    ├─ workers/auth (Hono)
    └─ workers/stripe-webhook (Hono)
```

## Branching & CI/CD Flow

```
Feature Branch
    ↓
    ├─ Run tests (pnpm test)
    ├─ Run type check
    ├─ Run linting
    └─ Run build
    ↓
Pull Request → Code Review
    ↓
Main Branch (all checks pass)
    ↓
    ├─ Deploy to Preview (Vercel)
    ├─ Deploy to Staging
    └─ Run E2E tests
    ↓
Production Release Tag
    ↓
    ├─ Deploy Workers (Cloudflare)
    ├─ Deploy Web App
    ├─ Run Migrations
    └─ Health checks
```

---

## Key Architectural Decisions

1. **Feature-based organization** - Code grouped by domain, easier to understand and modify
2. **Shared packages via pnpm** - No build step during development, instant changes
3. **Workers at the edge** - Low latency for auth and webhooks
4. **PostgreSQL serverless** - Scales automatically, pay per use
5. **Type safety everywhere** - TypeScript + Zod for both compile and runtime
6. **Testing pyramid** - Majority unit tests, some integration, few E2E
7. **Environment abstraction** - Same code runs in dev, CI, and production
8. **Zero-config tooling** - Everything via npm scripts, no manual setup

---

**Next:** Read [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) for detailed instructions, or [QUICK_START.md](./QUICK_START.md) for immediate commands.
