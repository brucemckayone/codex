# Deployment Guide

Complete guide for deploying the Codex platform to Cloudflare Workers and Neon Postgres.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Preview Deployments](#preview-deployments)
- [Production Deployments](#production-deployments)
- [Secrets Management](#secrets-management)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)

---

## Architecture Overview

### Deployment Flow

```
Pull Request → Tests (Neon Branch) → Preview Deploy → Review → Merge
                                                                  ↓
Main Branch → Tests (Neon Branch) → Production Deploy → Live
```

### Stack Components

- **SvelteKit App**: Deployed as Cloudflare Worker (`codex-web`)
- **Workers**: `stripe-webhook-handler`, `auth-worker`
- **Database**: Neon Postgres with ephemeral branching
- **Observability**: Custom logging (extensible to Axiom, Baselime)

---

## Prerequisites

### Required Accounts

1. **GitHub** - Repository and Actions
2. **Cloudflare** - Workers deployment
3. **Neon** - Postgres database

### Required CLI Tools

```bash
# Install pnpm (package manager)
npm install -g pnpm

# Install wrangler (Cloudflare CLI)
npm install -g wrangler

# Install neonctl (Neon CLI) - optional
npm install -g neonctl
```

---

## Initial Setup

### 1. Cloudflare Setup

#### Create API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Add permissions:
   - Account > Workers Scripts > Edit
   - Account > Workers KV Storage > Edit (if using KV)
5. Save the token

#### Get Account ID

1. Go to [Workers Dashboard](https://dash.cloudflare.com/)
2. Copy your Account ID from the right sidebar

### 2. Neon Setup

#### Create Production Database

```bash
# Using Neon Console (recommended)
1. Go to https://console.neon.tech
2. Create new project: "codex-production"
3. Note the connection string
```

#### Setup GitHub Integration

1. Go to Project Settings → Integrations
2. Click "Add" next to GitHub
3. Select your repository
4. This automatically sets `NEON_API_KEY` and `NEON_PROJECT_ID`

### 3. GitHub Secrets Configuration

#### Navigate to Repository Settings

`Settings → Secrets and variables → Actions → Secrets`

#### Add Cloudflare Secrets

| Secret Name | Value | Usage |
|-------------|-------|-------|
| `CLOUDFLARE_API_TOKEN` | Your API token | All deployments |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID | All deployments |

#### Add Neon Secrets

| Secret Name | Value | Usage |
|-------------|-------|-------|
| `NEON_API_KEY` | Auto-set by integration | Branch management |
| `NEON_PRODUCTION_URL` | Production connection string | Production deploys |

#### Add Application Secrets

| Secret Name | Value | Usage |
|-------------|-------|-------|
| `STRIPE_PRODUCTION_KEY` | Stripe secret key | Production webhooks |
| `STRIPE_PRODUCTION_WEBHOOK_SECRET` | Stripe webhook secret | Webhook verification |
| `STRIPE_TEST_KEY` | Stripe test key | Preview/staging |
| `STRIPE_TEST_WEBHOOK_SECRET` | Test webhook secret | Preview/staging |
| `SESSION_SECRET` | Random string (32+ chars) | Preview sessions |
| `SESSION_SECRET_PRODUCTION` | Random string (32+ chars) | Production sessions |
| `BETTER_AUTH_SECRET_PRODUCTION` | Random string (32+ chars) | Production auth |

#### Generate Random Secrets

```bash
# macOS/Linux
openssl rand -base64 32

# Or Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

#### Add GitHub Variables

`Settings → Secrets and variables → Actions → Variables`

| Variable Name | Value | Usage |
|---------------|-------|-------|
| `NEON_PROJECT_ID` | Auto-set by integration | Branch management |

---

## Preview Deployments

### How It Works

1. **Open a Pull Request**
2. **Testing workflow runs**: Creates Neon branch `pr-{number}`, runs tests
3. **Preview deployment workflow runs**: Deploys all workers to preview environment
4. **PR Comment**: Bot comments with preview URLs
5. **Close PR**: Resources automatically cleaned up

### Preview URLs

- **Web App**: `https://codex-web-preview-{PR_NUMBER}.workers.dev`
- **Stripe Webhook**: `https://stripe-webhook-handler-preview-{PR_NUMBER}.workers.dev`
- **Auth Worker**: `https://auth-worker-preview-{PR_NUMBER}.workers.dev`

### Testing Preview Environment

```bash
# 1. Open PR and wait for deployment
# 2. Check PR comment for URLs
# 3. Test the web app
curl https://codex-web-preview-123.workers.dev

# 4. Test webhook (if applicable)
curl -X POST https://stripe-webhook-handler-preview-123.workers.dev/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Manual Preview Cleanup

If automatic cleanup fails:

```bash
# Delete Neon branch
neonctl branches delete pr-{PR_NUMBER}

# Delete worker deployments
wrangler delete --name codex-web-preview-{PR_NUMBER}
wrangler delete --name stripe-webhook-handler-preview-{PR_NUMBER}
wrangler delete --name auth-worker-preview-{PR_NUMBER}
```

---

## Production Deployments

### Automatic Deployment

Production deploys automatically when:
1. PR is merged to `main`
2. Tests pass successfully
3. No manual intervention needed

### Deployment Steps

The production workflow:

1. **Runs migrations** on production database
2. **Deploys stripe-webhook-handler** to production
3. **Deploys auth-worker** to production
4. **Builds SvelteKit app** with production config
5. **Deploys SvelteKit** to production

### Production URLs

- **Web App**: `https://codex-web-production.workers.dev`
- **Stripe Webhook**: `https://stripe-webhook-handler-production.workers.dev`
- **Auth Worker**: `https://auth-worker-production.workers.dev`

### Custom Domains

To add custom domains:

```bash
# Add route to worker
wrangler routes add codex.yourdomain.com/api/webhooks \
  --service stripe-webhook-handler-production

# Or via Cloudflare Dashboard:
# Workers → codex-web-production → Triggers → Add Custom Domain
```

---

## Secrets Management

### Setting Secrets via Wrangler

```bash
# Production secrets
wrangler secret put DATABASE_URL --env production
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET --env production

# Staging secrets (if needed)
wrangler secret put DATABASE_URL --env staging
wrangler secret put STRIPE_SECRET_KEY --env staging
```

### Rotating Secrets

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# 2. Update in GitHub Secrets (for CI/CD)
# Go to Settings → Secrets → Update value

# 3. Update in Cloudflare (for production workers)
echo $NEW_SECRET | wrangler secret put SESSION_SECRET --env production

# 4. Redeploy workers (automatic on next push to main)
```

### Viewing Secrets

```bash
# List secret names (values are never shown)
wrangler secret list --env production
```

---

## Troubleshooting

### Common Issues

#### 1. "Artifact not found" in preview-deploy workflow

**Cause**: Preview workflow runs before test workflow completes

**Solution**: Workflow is configured to wait for test completion. If this fails:
- Check that testing workflow ran successfully
- Verify artifact retention (set to 1 day)
- Check workflow_run trigger in preview-deploy.yml

#### 2. "DATABASE_URL is empty" in deployment

**Cause**: Secret not set or artifact not uploaded correctly

**Solution**:
```bash
# Verify secret is set in GitHub
gh secret list

# Check artifact upload in testing workflow logs
# Look for "Upload Neon connection artifact" step
```

#### 3. "Worker deployment failed" - 401 Unauthorized

**Cause**: Invalid or missing Cloudflare API token

**Solution**:
```bash
# Verify secrets are set correctly
# Regenerate Cloudflare API token if needed
# Update CLOUDFLARE_API_TOKEN in GitHub Secrets
```

#### 4. Migration fails in production

**Cause**: Schema conflict or syntax error

**Solution**:
```bash
# Test migrations on a Neon branch first
neonctl branches create --name migration-test
export DATABASE_URL="<branch-connection-string>"
pnpm --filter @codex/database db:migrate

# If successful, merge to main
# If failed, fix schema and retry
```

#### 5. "Multiple roles found" Neon error

**Cause**: Not specifying username in create-branch action

**Solution**: Already fixed in testing.yml with `username: neondb_owner`

### Viewing Logs

#### GitHub Actions Logs

```bash
# View logs via GitHub CLI
gh run list
gh run view <run-id> --log

# Or via web UI
# Actions → Select workflow → View logs
```

#### Cloudflare Worker Logs

```bash
# Tail logs in real-time
wrangler tail stripe-webhook-handler-production

# Or via Dashboard
# Workers → Select worker → Logs
```

#### Neon Database Logs

```bash
# View query logs (requires Neon Pro)
# Dashboard → Project → Monitoring → Query Logs
```

---

## Rollback Procedures

### Rollback Worker Deployment

```bash
# 1. List recent deployments
wrangler deployments list --name codex-web-production

# 2. Rollback to previous version
wrangler rollback --name codex-web-production

# Or specific deployment ID
wrangler rollback --name codex-web-production --deployment-id <id>
```

### Rollback Database Migrations

#### Option 1: Neon Branch Restore (Fast, Zero Downtime)

```bash
# 1. Create restore branch from history
neonctl branches create --name restore-$(date +%s) \
  --parent main \
  --timestamp "2025-01-30 10:00:00"

# 2. Test the restore branch
export DATABASE_URL="<restore-branch-url>"
# Test your application

# 3. If confirmed working, set as primary
neonctl branches set-primary restore-<timestamp>
```

#### Option 2: Manual Migration Rollback (Risky)

```bash
# 1. Create rollback migration
cd packages/database
npx drizzle-kit generate --name rollback-<issue>

# 2. Manually edit the SQL to reverse changes
# Edit src/migrations/<latest>.sql

# 3. Apply rollback migration
pnpm db:migrate
```

### Emergency Rollback (Full Stack)

```bash
# 1. Rollback all workers to previous deployment
wrangler rollback --name codex-web-production
wrangler rollback --name stripe-webhook-handler-production
wrangler rollback --name auth-worker-production

# 2. Restore database from branch
neonctl branches create --name emergency-restore \
  --parent main \
  --timestamp "1 hour ago"

neonctl branches set-primary emergency-restore

# 3. Update DATABASE_URL secret to use restored branch
wrangler secret put DATABASE_URL --env production
# Enter the emergency-restore branch URL
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check worker health
curl https://codex-web-production.workers.dev/api/health

# Check database connectivity
curl https://auth-worker-production.workers.dev/health
```

### Cost Monitoring

**Free Tier Limits**:
- Cloudflare Workers: 100,000 requests/day
- Neon Free Tier: 300 compute hours/month
- GitHub Actions: 2,000 minutes/month

**Monitoring**:
- Cloudflare Dashboard → Workers → Analytics
- Neon Dashboard → Project → Monitoring
- GitHub → Settings → Billing

### Performance Monitoring

```bash
# View worker performance metrics
wrangler tail stripe-webhook-handler-production --format=json

# Analyze request duration
# Look for "Request processed" logs with duration metadata
```

---

## Next Steps

1. **Custom Domains**: Add your own domain to workers
2. **Staging Environment**: Create persistent staging environment
3. **Advanced Monitoring**: Integrate Axiom or Baselime
4. **Alerting**: Set up notifications for deployment failures
5. **Load Testing**: Test workers under realistic load

---

## Support & Resources

- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **Neon Docs**: https://neon.tech/docs/
- **SvelteKit Adapter**: https://svelte.dev/docs/kit/adapter-cloudflare
- **Internal Docs**: See [CI_CD_IMPLEMENTATION_SUMMARY.md](.github/CI_CD_IMPLEMENTATION_SUMMARY.md)

---

**Last Updated**: 2025-01-30
**Version**: 1.0.0
**Maintained By**: Development Team