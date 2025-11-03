# Codex Monorepo: Quick Reference Guide

## TL;DR - What You Need to Know

**Codex** is a full-stack serverless SaaS platform built with:
- **Frontend:** SvelteKit (web app running on Cloudflare Workers)
- **Backend:** Cloudflare Workers (auth + webhook processing)
- **Database:** Neon PostgreSQL (serverless with git-like branching)
- **Monorepo:** pnpm workspaces (6 shared packages + 2 workers + 1 app)

---

## Architecture at a Glance

```
User Browser
    ↓
SvelteKit Web App (apps/web)
    ↓
[Auth Worker] [Stripe Webhook Handler]
    ↓
PostgreSQL Database (Neon)
    ↓
[R2 Storage] [KV Cache]
```

**Shared Libraries:**
- `@codex/database` - Schema + ORM + Client (Drizzle)
- `@codex/validation` - Zod schemas
- `@codex/security` - Middleware (headers, rate limiting)
- `@codex/observability` - Logging client
- `@codex/cloudflare-clients` - R2 & KV clients
- `@codex/test-utils` - Testing utilities

---

## Key Commands

```bash
# Development
pnpm dev              # Start web app + all workers
pnpm docker:up        # Start local PostgreSQL

# Testing
pnpm test             # Run vitest (all packages)
pnpm test:watch       # Watch mode
pnpm test:e2e         # Playwright E2E tests
pnpm test:coverage    # Coverage report

# Code Quality
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # TypeScript check

# Database
pnpm db:gen           # Generate migrations (Drizzle)
pnpm db:push          # Apply migrations to local DB

# Building
pnpm build            # Build packages + workers
```

---

## Package Structure

### Apps (1)
- **web** - SvelteKit frontend app
  - User-facing interface
  - Auth integration
  - Deploys to Cloudflare Pages

### Workers (2)
- **auth** - BetterAuth worker
  - Email/password authentication
  - Session management with KV caching
  - Rate limiting on login

- **stripe-webhook-handler** - Payment webhooks
  - Receives Stripe events
  - Processes payments
  - 6 separate endpoints

### Packages (6)
- **database** - Drizzle ORM + schema
- **validation** - Zod schemas
- **cloudflare-clients** - R2/KV clients
- **security** - Middleware utilities
- **observability** - Logging
- **test-utils** - Testing helpers

---

## Environments

| Environment | Database | Workers | Domain |
|---|---|---|---|
| **Local** | Docker PostgreSQL | `wrangler dev` | `localhost:*` |
| **Testing** | Neon ephemeral branch | N/A | N/A |
| **Preview** | `pr-{PR}` branch | `*-preview-{PR}` | `*-preview-{PR}.revelations.studio` |
| **Production** | `production` | `*-production` | `*.revelations.studio` |

---

## File Locations to Know

**Configuration Files:**
```
pnpm-workspace.yaml         # Workspace definition
vitest.config.ts            # Test configuration
tsconfig.json               # TypeScript config
eslint.config.js            # Linting config
.env.dev                    # Development env vars
.env.prod                   # Production env vars
```

**Source Code:**
```
apps/web/src/               # SvelteKit app
workers/auth/src/           # Auth worker
workers/stripe-webhook-handler/src/  # Webhook worker
packages/*/src/             # Shared libraries
```

**Tests:**
```
**/*.test.ts                # Unit tests (Vitest)
**/*.integration.test.ts    # Integration tests
apps/web/e2e/               # E2E tests (Playwright)
```

**Deployment:**
```
.github/workflows/          # CI/CD pipelines
workers/*/wrangler.toml    # Worker configuration
```

---

## Database Concepts

### Three Connection Methods

**LOCAL_PROXY** (development)
- Local Docker PostgreSQL
- Fast, no cloud costs
- Command: `pnpm docker:up`

**NEON_BRANCH** (testing)
- Ephemeral Neon branch per test
- Isolated, automatic cleanup
- Used in CI via testing.yml

**PRODUCTION** (live)
- Long-lived Neon database
- Same schema as test/local

### Database Workflow

1. **Edit Schema:**
   ```bash
   # Edit packages/database/src/schema/auth.ts
   ```

2. **Generate Migration:**
   ```bash
   pnpm db:gen
   # Creates SQL migration file
   ```

3. **Apply Locally:**
   ```bash
   pnpm docker:up
   pnpm db:push
   ```

4. **CI Testing:**
   - Automatic with ephemeral branch
   - Must pass before merge

5. **Production:**
   - Deployed via GitHub Actions
   - After testing workflow passes

---

## How Code Flows

### Adding a Feature

1. Create branch and make changes
2. Push to GitHub
3. Tests run automatically (testing.yml):
   - Create ephemeral DB branch
   - Run migrations on it
   - Run all vitest tests
   - Run Playwright E2E
4. If PR passes and merged to main:
   - Production deployment runs
   - Migrations applied to prod
   - Workers deployed sequentially
   - Health checks verify each

---

## Testing Strategy

**Unit Tests** (Vitest)
- Fast, isolated, local
- Location: `src/**/*.test.ts`
- Environment: Node or happy-dom

**Integration Tests** (Vitest + DB)
- Test with real database
- Location: `src/**/*.integration.test.ts`
- Environment: Node (CI: ephemeral Neon)

**E2E Tests** (Playwright)
- Full user workflows
- Location: `apps/web/e2e/**/*.spec.ts`
- Environment: Real browser

---

## Dependency Management

### Workspace Dependencies
Internal packages use `workspace:*` protocol:
```json
{
  "dependencies": {
    "@codex/database": "workspace:*"
  }
}
```

**Always uses latest workspace version locally.**

### External Dependencies
Normal semver, installed once at root, symlinked to packages.

### Import Rules
✅ **Allowed:**
- App → Package
- Worker → Package
- Package → Package

❌ **Not Allowed:**
- Package → App
- Package → Worker
- App → Worker
- Worker → App

---

## Common Tasks

### Set Up Local Development
```bash
git clone ...
pnpm install
pnpm docker:up
pnpm dev
```

Open `http://localhost:5173` in browser.

### Add a New Shared Library
```bash
mkdir packages/my-feature
cd packages/my-feature
npm init -y  # or copy from existing package.json
# Add to pnpm-workspace.yaml (should auto-detect)
# Add to vitest.config.ts projects
# Add to tsconfig.json paths
```

### Deploy to Production
```bash
git push origin feature-branch
# Creates PR → tests run
# Review and merge to main
# Production deployment runs automatically
```

### View Test Coverage
```bash
pnpm test:coverage
open coverage/index.html
```

### Check TypeScript
```bash
pnpm typecheck
```

### Format Code
```bash
pnpm format         # Auto-fix formatting
pnpm format:check   # Check without fixing
```

---

## Security Features

**In @codex/security package:**
- Security headers middleware (CSP, X-Frame-Options, etc.)
- KV-based rate limiting (auth endpoint: 5 requests/minute)
- Worker-to-worker authentication signatures

**In @codex/observability:**
- Automatic sensitive data redaction (emails, tokens)
- Environment-aware logging (stricter in production)
- Request timing and error tracking

**In workers:**
- Stripe webhook signature verification
- CORS configuration
- Rate limiting presets (auth, webhook, api)

---

## Troubleshooting

### Tests failing locally but passing in CI?
- Check if using local DB: `pnpm docker:up`
- Check environment variables in `.env.dev`
- Try `pnpm test:neon` for CI-like conditions

### Build failing?
- Run `pnpm typecheck` to find TypeScript errors
- Run `pnpm lint` to check ESLint
- Check worker build: `pnpm build:workers`

### Database migrations not working?
- Ensure DB_METHOD is correct in environment
- For local: `pnpm docker:up` starts PostgreSQL
- For CI: Neon ephemeral branch auto-created
- For prod: Set NEON_PRODUCTION_URL secret

### Deploy stuck?
- Check GitHub Actions logs: https://github.com/[user]/[repo]/actions
- Verify secrets are set in Settings → Secrets
- Ensure DNS records exist (for custom domains)

---

## Resources

**Documentation:**
- Full analysis: `CODEBASE_ANALYSIS.md` (this file)
- Infrastructure: `design/infrastructure/README.md`
- CI/CD: `design/infrastructure/CICD.md`
- Security: `design/infrastructure/SECURITY.md`
- Testing: `design/infrastructure/Testing.md`

**Key Files:**
- Monorepo config: `pnpm-workspace.yaml`
- Test config: `vitest.config.ts`
- Environment: `.env.dev` / `.env.prod`
- Workflows: `.github/workflows/`

**External Docs:**
- SvelteKit: https://kit.svelte.dev
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Neon: https://neon.tech/docs
- Drizzle: https://orm.drizzle.team
- BetterAuth: https://www.better-auth.com
- Stripe: https://stripe.com/docs

