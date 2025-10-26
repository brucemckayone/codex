# CI/CD Pipeline

Continuous integration and deployment strategy for Codex monorepo using GitHub Actions and Cloudflare.

![CI/CD Pipeline Diagram](assets/ci-cd-pipeline.png)

---

## Current Implementation Status

✅ **Fully Implemented & Working:**
- GitHub Actions test workflow with parallel jobs (typecheck, lint, unit-tests, integration-tests, e2e-tests)
- Act for local GitHub Actions testing (see [ACT_SETUP.md](../../.github/ACT_SETUP.md))
- ESLint, Prettier, TypeScript configuration
- Vitest with coverage reporting (thresholds disabled for clean slate)
- 5 test suites passing (database, validation, cloudflare-clients, test-utils, web)
- Coverage collection configured (thresholds set to 0% to allow placeholder code)

🚧 **Not Yet Configured:**
- Cloudflare Pages deployment (requires account setup)
- Cloudflare Workers deployment (queue-consumer disabled, workflow disabled - see `.github/workflows/deploy-workers.yml.disabled`)
- Neon Postgres production database (will use free tier)
- Staging/preview deployments
- Production deployments
- Environment variable configuration in Cloudflare
- Branch protection rules

💡 **Current Approach:**
Using only free services for CI testing. The test workflow runs successfully on GitHub Actions. Deployment workflows will be enabled when Cloudflare and Neon accounts are configured.

**Disabled Components:**
- `workers/queue-consumer` - Commented out in vitest.config.ts (Cloudflare not set up)
- `.github/workflows/deploy-workers.yml` - Renamed to `.disabled` (will enable after Cloudflare setup)

---

## Pipeline Overview

```
Git Push → GitHub Actions → Tests → Type Check → Build → Deploy
                    ↓
            [Branch Strategy]
                    ↓
    feature/* → Preview (Cloudflare Pages - FREE unlimited previews)
    develop → Staging (Cloudflare Pages - dedicated staging)
    main → Production (Cloudflare Pages + Workers)
```

**Goals:**

- Automated testing on every push
- FREE preview deployments for branches
- Staging environment for migration testing
- Zero-downtime production deployments
- Fast rollback capability
- Keep costs at zero/minimal

---

## Branch Strategy

| Branch      | Environment | Trigger    | Auto-Deploy | Cost                        |
| ----------- | ----------- | ---------- | ----------- | --------------------------- |
| `feature/*` | Preview     | Push       | Yes         | **FREE** (Cloudflare Pages) |
| `develop`   | Staging     | Push       | Yes         | **FREE** (Cloudflare Pages) |
| `main`      | Production  | Push/Merge | Yes         | Paid (actual usage)         |

**Workflow:**

```
feature/new-feature → PR to develop → develop (staging) → PR to main → main (production)
```

**Why this works:**

- Cloudflare Pages: **Unlimited preview deployments FREE**
- Each branch gets unique URL: `<branch>.<project>.pages.dev`
- Previews auto-deleted when branch deleted
- No concurrent preview cost concerns

**Branch protection rules:**

- `main`: Require PR approval, passing tests, staging validation
- `develop`: Require passing tests

---

## Cost Breakdown

| Service                | Tier             | Cost | Notes                            |
| ---------------------- | ---------------- | ---- | -------------------------------- |
| **GitHub Actions**     | Free             | $0   | 2000 min/month public repos      |
| **Cloudflare Pages**   | Free             | $0   | Unlimited deployments + previews |
| **Cloudflare Workers** | Free             | $0   | 100k requests/day free           |
| **Neon Database**      | Free             | $0   | 0.5GB storage + staging branch   |
| **Sentry**             | Free             | $0   | 5k errors/month, 1 project       |
| **Uptime Monitor**     | UptimeRobot Free | $0   | 50 monitors, 5min interval       |

**Total CI/CD cost: $0** (stays within free tiers)

**Production costs (only):**

- Cloudflare Workers: $5/month minimum (10M requests)
- Neon: $19/month Scale plan (if needed, else free)
- Stripe: Pay-as-you-go (no fixed cost)

---

## Staging Environment

### Purpose

**Critical for migration safety:**

1. Test database migrations against real-ish data
2. Verify deployment process works
3. Integration testing with external APIs
4. Performance testing under load
5. Final validation before production

### Setup

**Neon staging branch:**

```bash
# Create staging branch from production
neon branches create --name staging --parent main

# Copy schema, optionally copy data
```

**Cloudflare Pages - develop branch:**

- URL: `develop.<project>.pages.dev` or custom `staging.yourdomain.com`
- Environment variables: Staging API keys
- Database: Neon staging branch

**Migration workflow:**

```
1. Create migration locally (pnpm db:generate)
2. Test migration on local DB
3. Push to develop branch
4. Migration auto-runs on staging deploy
5. Verify in staging environment
6. If successful → merge to main
7. Migration runs on production deploy
```

---

## GitHub Actions Workflows

### 1. Test Workflow (All Branches)

**File:** `.github/workflows/test.yml`

**Trigger:** Every push, every PR

**Jobs:**
The test workflow runs a series of jobs to ensure code quality, including type checking, linting, unit tests, integration tests, and end-to-end (E2E) tests. For a detailed breakdown of the testing strategy, environments, and commands, see the [Testing Guide](./Testing.md).

**Total time: ~5 min for feature branches, ~12 min for staging/prod**

```yaml
name: Test

on:
  push:
    branches: ['**']
  pull_request:
    branches: [develop, main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm lint

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm test:unit

  integration-tests:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: codex_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - name: Run migrations
        run: pnpm --filter web db:migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/codex_test

      - name: Run integration tests
        run: pnpm test:integration
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/codex_test
          STRIPE_SECRET_KEY: sk_test_mock
          RUNPOD_API_KEY: mock
          RESEND_API_KEY: re_mock

  e2e-tests:
    runs-on: ubuntu-latest
    # Only on staging (develop) and production (main)
    if: github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main'

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: codex_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - name: Install Playwright
        run: pnpm --filter web exec playwright install --with-deps

      - name: Run migrations
        run: pnpm --filter web db:migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/codex_test

      - name: Run E2E tests
        run: pnpm test:e2e
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/codex_test
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/
```

---

### 2. Deploy Workers (Main Branch Only)

**File:** `.github/workflows/deploy-workers.yml`

**Trigger:** Push to `main`

```yaml
name: Deploy Workers

on:
  push:
    branches: [main]

jobs:
  deploy-workers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.18.3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - name: Deploy queue-consumer
        run: pnpm --filter queue-consumer deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Deploy webhook-handler
        run: pnpm --filter webhook-handler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

---

### 3. Performance Budget Check (Optional)

**File:** `.github/workflows/lighthouse.yml`

**Trigger:** PRs to main

**Enforcement level:** Warning only (doesn't block merge) or Error (blocks merge)

```yaml
name: Lighthouse CI

on:
  pull_request:
    branches: [main]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Lighthouse CI
        uses: treosh/lighthouse-ci-action@v10
        with:
          urls: |
            https://develop.codex.pages.dev/
          budgetPath: ./lighthouse-budget.json
          uploadArtifacts: true

      # Set to 'continue-on-error: true' for warnings only
      # Remove to block merge on budget violations
```

**Budget file:**

```json
// lighthouse-budget.json
{
  "performance": 90,
  "accessibility": 95,
  "best-practices": 90,
  "seo": 90,
  "first-contentful-paint": 1800,
  "largest-contentful-paint": 2500,
  "time-to-interactive": 3800,
  "total-byte-weight": 300000
}
```

**Recommendation:** Start with warnings, enforce later when stable.

---

## Cloudflare Pages Setup

### Build Configuration

**Cloudflare Dashboard → Pages → Settings:**

```yaml
Framework preset: SvelteKit
Build command: pnpm --filter web build
Build output directory: (leave empty - auto-detected by SvelteKit adapter)
Root directory: /
Node version: 20
Production branch: main
```

**Important Notes:**
- pnpm is pre-installed on Cloudflare Pages, no need for `pnpm install`
- SvelteKit adapter outputs to `.svelte-kit/cloudflare` (auto-detected)
- DO NOT specify `apps/web/build` - this is incorrect for Cloudflare adapter
- Framework preset "SvelteKit" enables automatic configuration

**Preview deployments (automatic):**

- Every branch push → `<branch>.<project>.pages.dev`
- FREE, unlimited
- Auto-deleted when branch deleted
- PR comment with preview URL

**Staging (develop branch):**

- URL: `develop.<project>.pages.dev`
- Or custom domain: `staging.yourdomain.com`
- Uses Neon staging branch
- Test migrations here before production

**Production (main branch):**

- URL: `yourdomain.com`
- Uses Neon production database
- Workers deployed separately via GitHub Actions

### Environment Variables

**Preview environment variables:**

```bash
NODE_ENV=preview
DATABASE_URL=<neon-staging-url>  # Read-only or staging branch
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
RUNPOD_API_KEY=<test-key>
RESEND_API_KEY=<key>
AUTH_SECRET=<staging-secret>
```

**Production environment variables:**

```bash
NODE_ENV=production
DATABASE_URL=<neon-production-url>
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
RUNPOD_API_KEY=<prod-key>
RESEND_API_KEY=<key>
AUTH_SECRET=<prod-secret>
```

---

## Deployment Flow

### Feature Branch → Preview (FREE)

```
1. git push origin feature/new-feature
2. GitHub Actions: Type check, lint, unit tests (~5 min)
3. Cloudflare Pages: Builds and deploys preview (FREE)
4. Preview URL: feature-new-feature.codex.pages.dev
5. QA tests on preview
6. Open PR to develop
```

### Develop → Staging

```
1. Merge PR to develop
2. GitHub Actions: Full test suite including E2E (~12 min)
3. Cloudflare Pages: Deploys to develop.codex.pages.dev
4. Database migrations run automatically (if in build command)
5. Integration testing on staging
6. Verify migrations didn't break anything
7. If successful → open PR to main
```

### Main → Production

```
Pre-merge checklist:
✓ All tests passing on develop
✓ Staging environment tested
✓ Database migrations verified on staging
✓ PR approved

1. Merge develop to main
2. GitHub Actions:
   - Full test suite
   - Deploy workers (queue-consumer, webhook-handler)
3. Cloudflare Pages:
   - Builds production bundle
   - Runs migrations (if configured)
   - Deploys to yourdomain.com
4. Post-deploy verification:
   - Health check endpoint responds
   - No error spikes in Sentry
   - Critical flow tested
```

---

## Rollback Strategy

### Cloudflare Pages (Instant)

**Via Dashboard:**

1. Pages → Deployments
2. Select previous deployment
3. Click "Rollback"
4. **Takes effect immediately (seconds)**

**Via Git:**

```bash
git revert HEAD
git push origin main
# Auto-redeploys in ~2 min
```

### Workers (Fast)

**Via Wrangler:**

```bash
wrangler deployments list
wrangler rollback <deployment-id>
```

**Via Git:**

```bash
git revert <worker-commit>
git push origin main
# Redeploys via GitHub Actions
```

### Database (Careful)

**Neon Point-in-Time Recovery:**

1. Neon Dashboard → Branches
2. Create branch from timestamp (before migration)
3. Update DATABASE_URL in Cloudflare Pages
4. Redeploy

**Manual migration rollback:**

- Write down migration SQL
- Prepare rollback SQL before deploying
- Test rollback on staging first

---

## Monitoring (Free Tier)

### Sentry (Application Errors)

**Free tier: 5,000 errors/month, 1 project**

Setup:

```typescript
// apps/web/src/hooks.server.ts
import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1, // 10% of requests
  // Free tier: Keep sample rate low
});
```

**Alert on:**

- Error rate spike (>10 errors/min)
- New error types
- Unhandled exceptions

### Cloudflare Analytics (Free, Built-in)

**Available metrics:**

- Request count
- Response times
- Error rates (4xx, 5xx)
- Geographic distribution
- Cache hit ratio

**Access:** Cloudflare Dashboard → Analytics

### UptimeRobot (Free)

**Free tier: 50 monitors, 5-minute intervals**

**Monitor:**

- `GET https://yourdomain.com/` (homepage)
- `GET https://yourdomain.com/api/health` (API health)

**Alerts:** Email on downtime

---

## GitHub Secrets

**Required (Settings → Secrets → Actions):**

| Secret                  | Purpose                              |
| ----------------------- | ------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Deploy workers                       |
| `CLOUDFLARE_ACCOUNT_ID` | Worker deployments                   |
| `STRIPE_TEST_KEY`       | E2E tests with real Stripe test mode |
| `SENTRY_DSN`            | Error tracking                       |

**NOT in GitHub (set in Cloudflare Pages environment variables):**

- Production database URL
- Production Stripe keys
- Production API keys

---

## Deployment Checklist

### Before Merging to Main

- [ ] All tests passing on develop
- [ ] Staging environment tested (develop branch)
- [ ] Database migrations tested on staging
- [ ] No breaking changes OR breaking changes documented
- [ ] Environment variables updated (if needed)
- [ ] Performance budgets met (if enforced)
- [ ] PR approved

### After Production Deploy

- [ ] Homepage loads
- [ ] Health check responds: `GET /api/health`
- [ ] Critical flow tested (login, purchase)
- [ ] No error spikes in Sentry (first 10 min)
- [ ] Workers processing jobs (check Cloudflare dashboard)

### If Issues

1. **Immediate:** Rollback via Cloudflare dashboard (~30 seconds)
2. **Investigate:** Check logs (Cloudflare, Sentry, Neon)
3. **Fix:** Hotfix branch from main
4. **Test:** Full test suite on hotfix
5. **Deploy:** Fast-track hotfix to main

---

## Cost Control

### Stay Within Free Tiers

**Cloudflare Workers:**

- Free: 100k requests/day
- Paid: $5/month for 10M requests
- **Strategy:** Monitor usage, upgrade when needed

**Neon:**

- Free: 0.5GB storage, 1 branch
- Scale: $19/month, unlimited branches
- **Strategy:** Start free, upgrade when storage exceeded

**Sentry:**

- Free: 5k errors/month
- **Strategy:** Keep error rate low via good testing, sample traces at 10%

**GitHub Actions:**

- Free: 2000 minutes/month (public repos)
- **Strategy:** ~5-12 min per push, ~300-400 builds/month fits free tier

**Total monthly cost (production):** $0-24/month depending on usage

---

## Future Enhancements

### Phase 2 (After MVP Launch)

- [ ] Automated dependency updates (Dependabot - FREE)
- [ ] Security scanning (GitHub Security - FREE)
- [ ] Load testing on staging (k6 open source - FREE)
- [ ] Visual regression testing (consider cost)

### Phase 3 (Scale)

- [ ] Blue-green deployments for workers
- [ ] Canary releases (gradual rollout)
- [ ] Automated rollback on error threshold

---

## Related Documents

- [EnvironmentManagement.md](./EnvironmentManagement.md) - Local dev setup
- [TestingStrategy.md](./TestingStrategy.md) - Testing frameworks
- **CodeStructure.md** - Project organization (TBD)

---

## Reference

- [GitHub Actions - Free tier](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [Cloudflare Pages - Pricing](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Workers - Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Sentry - Pricing](https://sentry.io/pricing/)
- [Neon - Pricing](https://neon.tech/pricing)
