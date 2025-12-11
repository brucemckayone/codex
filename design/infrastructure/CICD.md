# CI/CD - Complete Guide

**Cloudflare Workers + Neon Postgres + GitHub Actions**

Everything you need to understand, deploy, and troubleshoot the CI/CD pipeline.

Last Updated: 2025-11-02

---

## Visual Diagrams

For a visual overview of the CI/CD system, see these diagrams:

- **[CI/CD Pipeline](d2/assets/ci-cd-pipeline.png)** - Complete workflow from push to production
- **[Environment Management](d2/assets/environment-management.png)** - Local, Preview, Production flow
- **[Testing Strategy](d2/assets/testing-strategy.png)** - Test types, CI flow, database testing
- **[Infrastructure Plan](d2/assets/infraplan.png)** - Complete system architecture

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Workflows](#workflows)
4. [Environments](#environments)
5. [Database Strategy](#database-strategy)
6. [Secrets & Configuration](#secrets--configuration)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)
10. [Operations](#operations)

---

## Quick Start

### Deploy Your Code

```bash
# Preview deployment (automatic)
git checkout -b feature/my-changes
git push origin feature/my-changes
# Open PR → Preview deploys automatically to *-preview-{PR}.revelations.studio

# Production deployment (automatic)
# Merge PR → Production deploys automatically to *.revelations.studio
```

### First-Time Setup (DevOps)

```bash
# 1. Configure GitHub Secrets (see Secrets section below)

# 2. Verify DNS records
.github/scripts/manage-production-dns.sh verify \
  $CLOUDFLARE_DNS_API_TOKEN $CLOUDFLARE_ZONE_ID

# 3. Test with a PR

# Done!
```

---

## Architecture

![CI/CD Architecture](assets/cicd-workflow.png)

### Stack

```
┌─────────────────────────────────────┐
│   Cloudflare Edge Network          │
│                                     │
│  ┌──────────┐ ┌──────────┐ ┌─────┐│
│  │Web Worker│ │Auth Worker│ │ API ││
│  │(SvelteKit│ │(Better    │ │     ││
│  │ compiled)│ │ Auth)     │ │     ││
│  └────┬─────┘ └────┬─────┘ └──┬──┘│
└───────┼────────────┼───────────┼───┘
        │            │           │
        └────────────┴───────────┘
                     │
              ┌──────▼──────┐
              │Neon Postgres│
              │ (Serverless)│
              └─────────────┘
```

**Components:**
- **Runtime:** Cloudflare Workers (everything is a Worker)
- **Framework:** SvelteKit (compiled to Worker with adapter-cloudflare)
- **Database:** Neon Postgres (serverless, git-like branching)
- **ORM:** Drizzle (type-safe migrations from TypeScript schema)
- **Auth:** Better Auth (Drizzle adapter)
- **CI/CD:** GitHub Actions (3 workflows)

**NOT USED:**
- ❌ Cloudflare Pages
- ❌ R2 Buckets (not yet configured)
- ❌ KV Namespaces (not yet configured)
- ❌ Queues (not yet configured)

---

## Workflows

### Overview

```
┌──────────────┐
│ Push/PR      │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────┐
│ Testing Workflow                    │
│ • Static analysis (types/lint)      │
│ • Create ephemeral Neon branch      │
│ • Run migrations                    │
│ • Run unit/integration tests        │
│ • Run E2E tests                     │
│ • Cleanup ephemeral branch          │
│ • Upload artifact (DATABASE_URL)    │
└──────┬────────┬─────────────────────┘
       │        │
       │        ▼ (if PR)
       │    ┌─────────────────────────┐
       │    │ Preview Deployment      │
       │    │ • Download artifact     │
       │    │ • Create DNS records    │
       │    │ • Deploy workers        │
       │    │ • Comment on PR         │
       │    └─────────────────────────┘
       │
       ▼ (if main)
   ┌─────────────────────────────────┐
   │ Production Deployment           │
   │ • Verify DNS records            │
   │ • Validate builds               │
   │ • Run migrations                │
   │ • Deploy workers + health check │
   └─────────────────────────────────┘
```

### 1. Testing Workflow

**File:** `.github/workflows/testing.yml`

**Triggers:**
- Every push to any branch
- Every pull request

**Steps:**
1. **Static Analysis** (parallel)
   - Type checking (`pnpm typecheck`)
   - Linting (`pnpm lint`)
   - Format checking (`pnpm format:check`)

2. **Create Ephemeral Database**
   - PR: `pr-{number}` (e.g., `pr-8`)
   - Push: `push-{branch}-{sha}` (e.g., `push-feature-auth-a1b2c3d4`)
   - Parent: Always `production` branch (not other PRs)
   - Uses `neondatabase/create-branch-action@v5`

3. **Database Setup**
   - Generate migrations: `pnpm db:gen:drizzle`
   - Apply migrations: `pnpm db:migrate`
   - Uses pooled connection for performance

4. **Run Tests**
   - Unit tests (affected packages only via path filtering)
   - E2E tests (separate branch `pr-{number}-e2e` if web changed)
   - Both run in parallel

5. **Cleanup & Artifact**
   - Delete ephemeral branches
   - Upload `DATABASE_URL` artifact (retention: 7 days)

**Key Features:**
- ✅ Path filtering (only test changed packages)
- ✅ Parallel execution (unit + E2E)
- ✅ Automatic cleanup (`if: always()`)
- ✅ Concurrency control (cancel old runs for same PR)

---

### 2. Preview Deployment Workflow

**File:** `.github/workflows/preview-deploy.yml`

**Triggers:**
- After testing workflow completes successfully (on PR)
- PR close (for cleanup)
- Manual (`workflow_dispatch`)

**Deploy Steps:**
1. **Download Artifact**
   - Get `DATABASE_URL` from testing workflow
   - Validate artifact contents
   - Fail fast if missing

2. **Create DNS Records**
   - Script: `.github/scripts/manage-preview-dns.sh`
   - Creates CNAME records:
     - `codex-preview-{PR}.revelations.studio`
     - `auth-preview-{PR}.revelations.studio`
     - `api-preview-{PR}.revelations.studio`
   - All proxied through Cloudflare
   - Verifies DNS propagation (polling, not fixed sleep)

3. **Deploy Workers**
   - `ecom-api-preview-{PR}` → `api-preview-{PR}.revelations.studio`
   - `auth-worker-preview-{PR}` → `auth-preview-{PR}.revelations.studio`
   - `codex-web-preview-{PR}` → `codex-preview-{PR}.revelations.studio`
   - Uses test credentials (Stripe test keys)

4. **Comment on PR**
   - Posts preview URLs
   - Includes testing checklist
   - Shows worker names and database branch

**Cleanup Steps (on PR close):**
1. Delete Neon branch
2. Delete worker deployments (`wrangler delete`)
3. Delete DNS records (via script)
4. Comment confirmation

**Key Features:**
- ✅ Unique resources per PR (no conflicts)
- ✅ Custom domains (not `workers.dev`)
- ✅ Automatic cleanup on PR close
- ✅ Fail fast if artifact missing

---

### 3. Production Deployment Workflow

**File:** `.github/workflows/deploy-production.yml`

**Triggers:**
- After testing workflow completes successfully (on push to main)

**Critical Fix:**
```yaml
if: |
  github.event.workflow_run.conclusion == 'success' &&
  github.event.workflow_run.event == 'push' &&
  github.event.workflow_run.head_branch == 'main'  # ← Correct for workflow_run
```

**Steps:**

1. **Verify DNS Records**
   - Script: `.github/scripts/manage-production-dns.sh verify`
   - Auto-creates if missing
   - Verifies: `codex`, `auth`, `api` subdomains

2. **Build Validation (Fail Fast)**
   ```bash
   pnpm --filter ecom-api build
   pnpm --filter auth build
   pnpm --filter web build
   ```
   - Runs BEFORE migrations
   - Prevents orphaned database schema

3. **Database Migrations**
   ```bash
   pnpm --filter @codex/database db:migrate
   ```
   - Uses `DATABASE_URL=${{ secrets.NEON_PRODUCTION_URL }}`
   - Drizzle transactions (automatic)
   - Point-in-time recovery available (30 min)

4. **Deploy Workers (Sequential)**

   **a) ecom-api**
   ```bash
   wrangler deploy --env production
   ```
   - Health check: `https://api.revelations.studio/health`
   - Wait: 30s (SSL provisioning)
   - Retry: 10 attempts, exponential backoff (5s, 10s, 20s, 40s...)
   - Timeout: 5 min

   **b) auth-worker**
   - Health check: `https://auth.revelations.studio/health`
   - Wait: 15s (SSL already provisioned for zone)
   - Same retry logic

   **c) codex-web (SvelteKit)**
   - Health check: `https://codex.revelations.studio`
   - Wait: 15s
   - Same retry logic

5. **Success/Failure**
   - Success: Deployment notification
   - Failure: Creates GitHub issue with rollback instructions

**Key Features:**
- ✅ Build validation before migrations
- ✅ Sequential deployment (easier debugging)
- ✅ Health checks with exponential backoff
- ✅ SSL-aware (30-90s provisioning time)
- ✅ Automatic rollback instructions on failure

---

## Environments

| Environment | Database | Workers | URLs | Secrets |
|-------------|----------|---------|------|---------|
| **Local** | Manual setup | `wrangler dev` | `localhost:*` | `.env.dev` |
| **Preview** | `pr-{number}` | `*-preview-{PR}` | `*-preview-{PR}.revelations.studio` | Test keys |
| **Production** | `production` | `*-production` | `*.revelations.studio` | Production keys |

### Local Development

```bash
# Setup
pnpm install
cp .env.example .env.dev
# Edit .env.dev with your credentials

# Run
pnpm dev

# Test
pnpm test
pnpm test:e2e
```

**Environment Variables (.env.dev):**
```bash
DATABASE_URL=postgresql://user:pass@host-pooler.neon.tech/db
SESSION_SECRET=<random_32_chars>
BETTER_AUTH_SECRET=<random_32_chars>
STRIPE_SECRET_KEY=sk_test_***
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_***
# ... other Stripe webhook secrets
```

### Preview Environment

**Per PR:**
- **Database:** Neon branch `pr-{number}` (inherits from production)
- **Workers:** Unique names `*-preview-{PR}`
- **DNS:** `*-preview-{PR}.revelations.studio`
- **Lifetime:** Deleted when PR closes

**Multiple PRs:**
- ✅ Fully isolated (separate DB, workers, DNS)
- ✅ No conflicts
- ✅ Can have 10+ PRs open simultaneously

### Production Environment

**Deployment:**
- Automatic on merge to `main`
- DNS verified/created automatically
- Migrations applied after build validation
- Workers deployed with health checks

**Monitoring:**
```bash
# Real-time logs
wrangler tail codex-web-production
wrangler tail auth-worker-production
wrangler tail ecom-api-production

# Health checks
curl https://codex.revelations.studio
curl https://auth.revelations.studio/health
curl https://api.revelations.studio/health
```

---

## Database Strategy

### Neon Branching

```
production (main branch)
  ├─ pr-7 (ephemeral, deleted after tests)
  ├─ pr-8 (ephemeral)
  │   └─ pr-8-e2e (separate E2E branch)
  └─ push-feature-auth-a1b2c3d4 (ephemeral)
```

**Why separate E2E branch?**
- Unit tests and E2E tests run in parallel
- Prevents database state conflicts
- Better isolation

**Branch Lifecycle:**
1. Created from `production` (always, never from other PRs)
2. Migrations applied
3. Tests run
4. Branch deleted (happens in cleanup job)

### Migrations

**Development:**
```bash
# 1. Update schema
vim packages/database/src/schema/users.ts

# 2. Generate migration
pnpm --filter @codex/database db:gen:drizzle

# 3. Review SQL
cat packages/database/drizzle/0001_*.sql

# 4. Apply locally
pnpm --filter @codex/database db:migrate

# 5. Push to PR
git add packages/database/drizzle/
git commit -m "feat: Add user email verification"
git push
```

**CI/CD:**
- Testing: Migrations applied to ephemeral branch automatically
- Production: Migrations applied after build validation

**Rollback:**
- Use Neon point-in-time recovery (30 min window)
- Or create restore branch from timestamp

---

## Secrets & Configuration

### GitHub Secrets

**Navigate to:** `Settings → Secrets and variables → Actions → Secrets`

**Cloudflare:**
```bash
CLOUDFLARE_API_TOKEN          # Worker deployment
CLOUDFLARE_DNS_API_TOKEN      # DNS management (separate token)
CLOUDFLARE_ACCOUNT_ID         # Account ID
CLOUDFLARE_ZONE_ID            # Zone ID for revelations.studio
```

**Neon:**
```bash
NEON_API_KEY                  # Branch management (auto-set by integration)
NEON_PRODUCTION_URL           # Production DB URL (with -pooler)
```

**Application (Production):**
```bash
SESSION_SECRET_PRODUCTION
BETTER_AUTH_SECRET_PRODUCTION
STRIPE_PRODUCTION_KEY
STRIPE_PRODUCTION_PAYMENT_WEBHOOK_SECRET
STRIPE_PRODUCTION_SUBSCRIPTION_WEBHOOK_SECRET
STRIPE_PRODUCTION_CONNECT_WEBHOOK_SECRET
STRIPE_PRODUCTION_CUSTOMER_WEBHOOK_SECRET
STRIPE_PRODUCTION_BOOKING_WEBHOOK_SECRET
STRIPE_PRODUCTION_DISPUTE_WEBHOOK_SECRET
```

**Application (Testing):**
```bash
STRIPE_TEST_KEY
STRIPE_TEST_PAYMENT_WEBHOOK_SECRET
STRIPE_TEST_SUBSCRIPTION_WEBHOOK_SECRET
# ... other test secrets
SESSION_SECRET                # For preview deployments
```

**Generate secrets:**
```bash
openssl rand -base64 32
```

### GitHub Variables

**Navigate to:** `Settings → Secrets and variables → Actions → Variables`

```bash
NEON_PROJECT_ID              # Auto-set by Neon integration
```

### Cloudflare Secrets

**Set via Wrangler CLI:**

```bash
# Production
wrangler secret put DATABASE_URL --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT --env production
# ... other secrets

# List secrets
wrangler secret list --env production

# Delete secret
wrangler secret delete SECRET_NAME --env production
```

**Note:** Secrets set via `wrangler secret` are encrypted and stored in Cloudflare. They are NOT the same as environment variables.

### DNS API Token

**Create separate token for DNS management:**

1. Cloudflare Dashboard → API Tokens → Create Token
2. Use "Edit DNS" template
3. Permissions: Zone > DNS > Edit
4. Zone Resources: Include > Specific zone > revelations.studio
5. Save as `CLOUDFLARE_DNS_API_TOKEN`

**Why separate?** Principle of least privilege. DNS token can't deploy workers, worker token can't modify DNS.

---

## Testing

### Test Stack

- **Unit/Integration:** Vitest
- **E2E:** Playwright
- **Database:** Neon ephemeral branches

### Running Tests

```bash
# All unit/integration tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# E2E tests
pnpm test:e2e

# E2E with UI
pnpm test:e2e:ui

# Specific package
pnpm --filter @codex/database test
```

### Test Organization

```
packages/database/
├── src/
│   ├── client.ts
│   └── client.test.ts      ← Unit tests

apps/web/
├── src/lib/features/auth/
│   ├── LoginForm.svelte
│   └── LoginForm.test.ts   ← Component tests
└── e2e/
    └── auth/
        └── login.spec.ts   ← E2E tests
```

### Database Testing

**In CI:**
- Fresh ephemeral branch for each run
- Clean state guaranteed
- Migrations applied automatically

**Locally:**
- Use transactions for test isolation
- Or reset DB between test suites

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { db } from '../client';
import { users } from '../schema';

describe('Users', () => {
  it('should create and retrieve user', async () => {
    await db.insert(users).values({
      email: 'test@example.com',
      name: 'Test User'
    });

    const result = await db.select().from(users)
      .where(eq(users.email, 'test@example.com'));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test User');
  });
});
```

---

## Deployment

### Custom Domains

**Production:**
- `codex.revelations.studio` → codex-web-production
- `auth.revelations.studio` → auth-worker-production
- `api.revelations.studio` → ecom-api-production

**Preview:**
- `codex-preview-{PR}.revelations.studio` → codex-web-preview-{PR}
- `auth-preview-{PR}.revelations.studio` → auth-worker-preview-{PR}
- `api-preview-{PR}.revelations.studio` → ecom-api-preview-{PR}

**DNS Management:**
- Production: `.github/scripts/manage-production-dns.sh`
- Preview: `.github/scripts/manage-preview-dns.sh`

**DNS Records:**
```
Type: CNAME
Name: codex (or codex-preview-8)
Content: revelations.studio
Proxied: Yes (orange cloud)
TTL: Auto
```

**Why CNAME to apex?**
- Cloudflare Workers custom domains work by intercepting at the edge
- DNS just routes traffic to Cloudflare proxy
- Worker route configuration (in `wrangler.jsonc`) handles the rest

### SSL Certificates

- **Provisioning:** Automatic via Cloudflare Universal SSL
- **Time:** 30-90 seconds on first deployment
- **Renewal:** Automatic
- **No manual configuration needed**

### Health Checks

**Why exponential backoff?**
- SSL provisioning: 30-90s (unpredictable)
- Edge propagation: 10-15s
- Prevents false negatives

**Configuration:**
- First worker: 30s wait + 10 retries
- Subsequent workers: 15s wait + 10 retries
- Backoff: 5s, 10s, 20s, 40s, 80s...
- Timeout: 5 min per worker

---

## Troubleshooting

### Health check fails with HTTP 000

**Cause:** SSL certificate still provisioning

**Solution:** Wait 1-2 minutes. Health checks already have 30s wait + exponential backoff.

**Check:**
```bash
curl -v https://codex.revelations.studio 2>&1 | grep "SSL"
```

---

### "Artifact not found" in preview deployment

**Cause:** Preview workflow runs before test workflow completes OR artifact expired (retention: 7 days)

**Check:**
```bash
gh run list --workflow=testing.yml --limit 5
gh run view <run-id>
```

**Solution:** Workflow uses `workflow_run` trigger to wait. If fails, close and reopen PR.

---

### Worker deployment fails - 401 Unauthorized

**Cause:** Invalid or missing Cloudflare API token

**Solution:**
1. Regenerate token: Cloudflare Dashboard → API Tokens
2. Update `CLOUDFLARE_API_TOKEN` in GitHub Secrets
3. Ensure token has "Edit Workers" permission

---

### Migration fails in production

**Cause:** Schema conflict or syntax error

**Test safely:**
```bash
# Create temporary branch
neonctl branches create --name migration-test --parent production

# Get connection string
TEMP_URL=$(neonctl connection-string migration-test --pooled)

# Test migration
DATABASE_URL=$TEMP_URL pnpm --filter @codex/database db:migrate

# If successful, merge PR
# If failed, fix schema and regenerate migration
```

---

### DNS records not created for preview

**Cause:** `CLOUDFLARE_ZONE_ID` or `CLOUDFLARE_DNS_API_TOKEN` not set

**Check:**
```bash
gh secret list | grep CLOUDFLARE
```

**Solution:**
1. Get Zone ID: Cloudflare Dashboard → revelations.studio → Overview → Zone ID
2. Create DNS API token (see Secrets section)
3. Set both in GitHub Secrets

---

### Tests pass locally but fail in CI

**Common causes:**
- Environment variables (CI uses ephemeral Neon branch)
- Database state (CI starts fresh)
- Timing issues (CI may be slower)

**Fix:**
- Use proper `async/await`
- Don't rely on execution order
- Reset DB state between tests
- Check `DATABASE_URL` is passed correctly in workflow

---

## Operations

### Check Deployment Status

```bash
# List recent runs
gh run list --limit 10

# View specific run
gh run view <run-id> --log

# Watch in real-time
gh run watch
```

### View Worker Logs

```bash
# Real-time logs
wrangler tail codex-web-production --format=pretty

# Errors only
wrangler tail codex-web-production --format=json | jq 'select(.level=="error")'

# Specific time range
wrangler tail codex-web-production --since 1h
```

### Manage Neon Branches

```bash
# List all branches
neonctl branches list

# Show branch details
neonctl branches get pr-8

# Delete old branch
neonctl branches delete pr-8

# Create manual branch
neonctl branches create --name dev-branch --parent production
```

### Rollback Deployment

**Worker-Only Rollback (Fast, Safe):**
```bash
# List recent deployments
wrangler deployments list --name codex-web-production

# Rollback to previous
wrangler rollback --name codex-web-production
wrangler rollback --name auth-worker-production
wrangler rollback --name ecom-api-production

# Verify
curl https://codex.revelations.studio
```

**Database + Worker Rollback (Nuclear Option):**
```bash
# Create restore branch from 30 min ago
neonctl branches create \
  --name emergency-restore-$(date +%s) \
  --parent production \
  --timestamp "30 minutes ago"

# Get restore URL
RESTORE_URL=$(neonctl connection-string emergency-restore-* --pooled)

# Update workers
echo $RESTORE_URL | wrangler secret put DATABASE_URL --env production

# Redeploy workers
cd workers/ecom-api && wrangler deploy --env production
cd ../auth && wrangler deploy --env production
cd ../../apps/web && wrangler deploy --env production
```

**⚠️ WARNING:** Database rollback loses last 30 minutes of data. Only use in emergencies.

**Decision Tree:**
```
Issue in production?
 │
 ├─ Code bug/runtime error? → Worker rollback ✓
 │
 ├─ Migration broke workers?
 │  ├─ Migration backward-compatible? → Worker rollback ✓
 │  └─ Migration breaking? → Database + worker rollback ⚠️
 │
 └─ Data corruption? → Database + worker rollback ⚠️
```

### Rotate Secrets

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# 2. Update in GitHub (for CI/CD)
echo $NEW_SECRET | gh secret set SESSION_SECRET_PRODUCTION

# 3. Update in Cloudflare (for production workers)
echo $NEW_SECRET | wrangler secret put SESSION_SECRET --env production

# 4. Redeploy (automatic on next push to main)
```

### Common Commands

```bash
# Development
pnpm dev                              # Start all
pnpm test                             # Run tests
pnpm typecheck                        # Type check

# Database
pnpm --filter @codex/database db:gen:drizzle  # Generate migration
pnpm --filter @codex/database db:migrate      # Apply migration
pnpm --filter @codex/database db:studio       # Open Drizzle Studio

# Deployment (via CI/CD)
git push origin main                  # Production
# Open PR                              # Preview

# Manual deployment
wrangler deploy --env production      # Deploy worker manually

# Monitoring
gh run list                           # Recent workflow runs
wrangler tail <worker> --env production  # Worker logs
neonctl branches list                 # Neon branches
```

---

## Summary

**Your CI/CD pipeline is production-ready:**

✅ **Automated Testing** - Ephemeral Neon branches for every PR/push
✅ **Preview Deployments** - Isolated environment per PR with custom domains
✅ **Production Deployments** - Fully automated with safety checks
✅ **Database Safety** - Migrations tested before production, PITR available
✅ **Worker Safety** - Build validation, health checks, easy rollback
✅ **Zero Downtime** - Sequential deployment with health verification
✅ **Cost Effective** - Free tier friendly, auto-cleanup

**Key Differentiators:**
- Everything is a Cloudflare Worker (unified deployment)
- Git-like database branching (Neon)
- Custom domains everywhere (not `workers.dev`)
- Intelligent health checks (SSL-aware, exponential backoff)
- Automatic cleanup (DNS, workers, database branches)

**Deploy with confidence:** Just push your code and open a PR. Everything else is automatic.

---

**Maintained By:** DevOps Team
**Last Updated:** 2025-11-02
**Version:** 1.0
