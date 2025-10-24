# CI/CD Setup Guide

Complete setup instructions for implementing the full CI/CD pipeline.

## Prerequisites

- [x] GitHub repository created
- [x] Act configured for local testing
- [x] TypeScript added to project
- [x] Test workflows split into parallel jobs

## Phase 1: Core CI/CD Pipeline

### 1. Create Develop Branch

```bash
# Create and push develop branch from main
git checkout -b develop
git push -u origin develop
```

### 2. Set Up Cloudflare Pages

**Go to:** [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → Create Project

**Configuration:**

```yaml
Project name: codex (or your choice)
Build command: pnpm install && pnpm --filter web build
Build output directory: apps/web/build
Root directory: /
Node version: 20
Production branch: main
```

**Preview Branches:**

- ✅ Enable "Automatic preview deployments" for all branches
- Every branch push gets: `<branch-name>.codex.pages.dev`
- FREE and unlimited

**Branch Configuration:**

- `main` → Production: `yourdomain.com` (or `codex.pages.dev`)
- `develop` → Staging: `develop.codex.pages.dev`
- `feature/*` → Preview: `feature-xyz.codex.pages.dev`

### 3. Configure Environment Variables in Cloudflare Pages

**Preview Environment (all non-production branches):**

```bash
NODE_ENV=preview
DATABASE_URL=<neon-staging-connection-string>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
AUTH_SECRET=<generate-random-32-char-string>
```

**Production Environment (main branch):**

```bash
NODE_ENV=production
DATABASE_URL=<neon-production-connection-string>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
AUTH_SECRET=<generate-different-random-32-char-string>
```

### 4. Set Up GitHub Secrets

**Go to:** GitHub Repository → Settings → Secrets and variables → Actions

**Add these secrets:**

```
CLOUDFLARE_API_TOKEN - Get from Cloudflare Dashboard → My Profile → API Tokens
CLOUDFLARE_ACCOUNT_ID - Get from Cloudflare Dashboard → Workers & Pages → Account ID
STRIPE_TEST_KEY - From Stripe Dashboard (test mode)
CODECOV_TOKEN - From codecov.io (optional)
```

**To create Cloudflare API Token:**

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token
2. Use template: "Edit Cloudflare Workers"
3. Add permissions: Account → Cloudflare Pages → Edit
4. Copy token and add to GitHub Secrets

### 5. Configure Branch Protection Rules

**Go to:** GitHub Repository → Settings → Branches → Add rule

**For `main` branch:**

```
Branch name pattern: main
✅ Require a pull request before merging
  ✅ Require approvals: 1
✅ Require status checks to pass before merging
  ✅ Require branches to be up to date before merging
  Add required checks:
    - typecheck
    - lint
    - unit-tests
    - integration-tests
    - e2e-tests
✅ Do not allow bypassing the above settings
```

**For `develop` branch:**

```
Branch name pattern: develop
✅ Require status checks to pass before merging
  Add required checks:
    - typecheck
    - lint
    - unit-tests
    - integration-tests
```

### 6. Set Up Neon Database (Staging Branch)

**Go to:** [Neon Console](https://console.neon.tech/) → Your Project → Branches

```bash
# Create staging branch
neon branches create --name staging --parent main

# Get connection string for staging
neon connection-string staging
```

Use this connection string in Cloudflare Pages Preview environment variables.

## Phase 2: Testing the Pipeline

### Test Feature Branch Flow

```bash
# Create feature branch
git checkout -b feature/test-pipeline
git push -u origin feature/test-pipeline
```

**Expected:**

1. GitHub Actions runs: typecheck, lint, unit-tests in parallel (~3-5 min)
2. Cloudflare Pages builds and deploys preview
3. You get preview URL: `feature-test-pipeline.codex.pages.dev`

### Test Staging Flow

```bash
# Merge to develop
git checkout develop
git merge feature/test-pipeline
git push origin develop
```

**Expected:**

1. GitHub Actions runs: All jobs including E2E tests (~8-12 min)
2. Cloudflare Pages deploys to: `develop.codex.pages.dev`
3. Test on staging URL

### Test Production Flow

```bash
# Create PR from develop to main
# After approval and all checks pass, merge

git checkout main
git merge develop
git push origin main
```

**Expected:**

1. GitHub Actions runs: Full test suite
2. GitHub Actions deploys: Cloudflare Workers
3. Cloudflare Pages deploys to: Production domain
4. Verify deployment works

## Phase 3: Monitoring Setup (Optional)

### Set Up Sentry (Error Tracking)

1. Create free account at [sentry.io](https://sentry.io)
2. Create new project (SvelteKit)
3. Get DSN
4. Add to Cloudflare Pages environment variables: `SENTRY_DSN`
5. Install in project:
   ```bash
   pnpm add @sentry/sveltekit
   ```
6. Configure in `apps/web/src/hooks.server.ts`

### Set Up UptimeRobot (Uptime Monitoring)

1. Create free account at [uptimerobot.com](https://uptimerobot.com)
2. Add monitor for: `https://yourdomain.com/api/health`
3. Set check interval: 5 minutes
4. Add email alert

## Workflow Summary

### Day-to-Day Development

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Develop and test locally
pnpm docker:test:up
pnpm act:test  # Test locally with act

# 3. Push to get preview
git push -u origin feature/new-feature
# Preview: feature-new-feature.codex.pages.dev

# 4. Create PR to develop
gh pr create --base develop

# 5. After approval, merge to develop
# Staging: develop.codex.pages.dev

# 6. Test on staging, then PR to main
gh pr create --base main

# 7. After approval, merge to main
# Production: yourdomain.com
```

### Branch Strategy

```
feature/xyz → develop (staging) → main (production)
     ↓             ↓                    ↓
  Preview      Staging            Production
  (FREE)       (FREE)             (Paid usage)
```

### CI/CD Execution Times

- **Feature branches:** ~3-5 min (typecheck, lint, unit tests)
- **Develop/Main:** ~8-12 min (includes E2E tests)

### Cost Breakdown

- **CI/CD:** $0 (all free tiers)
- **Preview deployments:** $0 (Cloudflare Pages free)
- **Staging:** $0 (Cloudflare Pages free)
- **Production:** ~$5-24/month (Cloudflare Workers + potential Neon upgrade)

## Troubleshooting

### GitHub Actions Failing

```bash
# Test locally first
pnpm act:test

# Check secrets are set
GitHub → Settings → Secrets → Actions

# Check logs
GitHub → Actions → Failed workflow → View logs
```

### Cloudflare Pages Not Building

```bash
# Check build logs
Cloudflare Dashboard → Pages → Project → Deployments → View logs

# Common issues:
- Wrong build command
- Wrong output directory
- Missing environment variables
- Node version mismatch
```

### Workers Not Deploying

```bash
# Check secrets
CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set

# Test locally
cd workers/queue-consumer
pnpm wrangler deploy --dry-run

# Check wrangler.toml configuration
```

## Next Steps

After pipeline is working:

- [ ] Fix TypeScript errors caught by CI
- [ ] Add Sentry for error tracking
- [ ] Set up UptimeRobot for monitoring
- [ ] Configure custom domain for production
- [ ] Document deployment procedures for team

## Resources

- [CI/CD Pipeline Design](../design/infrastructure/CI-CD-Pipeline.md)
- [Testing Strategy](../design/infrastructure/Testing.md)
- [Act Setup](./ACT_SETUP.md)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [GitHub Actions Docs](https://docs.github.com/actions)
