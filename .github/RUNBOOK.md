# Deployment Runbook - Quick Reference

Quick commands and procedures for common deployment tasks.

## 🚀 Quick Commands

### Local Development

```bash
# Start development environment
pnpm docker:up
pnpm dev

# Run tests
pnpm test
pnpm test:e2e

# Build all packages
pnpm build
```

### Preview Deployments

```bash
# Preview deployments happen automatically on PR open
# To manually trigger:
gh workflow run preview-deploy.yml

# Check preview status
gh run list --workflow=preview-deploy.yml

# View logs
gh run view <run-id> --log
```

### Production Deployments

```bash
# Production deploys automatically on merge to main
# To manually trigger (emergency only):
gh workflow run deploy-production.yml

# Check production deployment status
gh run list --workflow=deploy-production.yml
```

### Secrets Management

```bash
# Set secret in Cloudflare
wrangler secret put <SECRET_NAME> --env production

# Set secret in GitHub
gh secret set <SECRET_NAME>

# List secrets
wrangler secret list --env production
gh secret list
```

## 🔥 Emergency Procedures

### Rollback Everything

```bash
# 1. Rollback workers (takes ~30 seconds)
wrangler rollback --name codex-web-production
wrangler rollback --name stripe-webhook-handler-production
wrangler rollback --name auth-worker-production

# 2. Restore database (takes ~1 minute)
neonctl branches create --name emergency-restore \
  --parent main --timestamp "1 hour ago"

neonctl branches set-primary emergency-restore
```

### Fix Broken Preview Deployment

```bash
# 1. Cancel running workflow
gh run cancel <run-id>

# 2. Clean up resources
neonctl branches delete pr-<number>
wrangler delete --name codex-web-preview-<number>

# 3. Close and reopen PR to trigger fresh deployment
```

### Fix Failed Production Deployment

```bash
# 1. Check what failed
gh run view <run-id> --log

# 2. If migration failed:
# - Fix migration file
# - Push fix to main
# - Workflow will retry automatically

# 3. If worker deployment failed:
# - Check secrets are set correctly
# - Retry deployment: gh workflow run deploy-production.yml
```

## 📊 Health Checks

```bash
# Check all services
curl https://codex-web-production.workers.dev/
curl https://stripe-webhook-handler-production.workers.dev/
curl https://auth-worker-production.workers.dev/

# Check database
psql $NEON_PRODUCTION_URL -c "SELECT 1"
```

## 🔍 Debugging

### View Worker Logs

```bash
# Real-time logs
wrangler tail codex-web-production --format=pretty

# Filter for errors only
wrangler tail codex-web-production --format=json | jq 'select(.level=="error")'
```

### View GitHub Actions Logs

```bash
# List recent runs
gh run list --limit 10

# View specific run
gh run view <run-id>

# Download logs
gh run download <run-id>
```

### Check Neon Branch Status

```bash
# List all branches
neonctl branches list

# Show branch details
neonctl branches get pr-<number>

# Delete old branches
neonctl branches delete pr-<number>
```

## 🛠️ Common Tasks

### Add New Worker

1. Create worker in `workers/<name>/`
2. Add `wrangler.toml` with environments
3. Update `preview-deploy.yml` to deploy it
4. Update `deploy-production.yml` to deploy it
5. Push to PR to test

### Update Database Schema

1. Edit schema in `packages/database/src/schema/`
2. Generate migration: `pnpm --filter @codex/database db:gen:drizzle`
3. Test locally: `pnpm --filter @codex/database db:migrate`
4. Push to PR - CI will test on ephemeral branch
5. Merge to main - production migration runs automatically

### Rotate Secrets

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# 2. Update in GitHub
echo $NEW_SECRET | gh secret set SESSION_SECRET_PRODUCTION

# 3. Update in Cloudflare
echo $NEW_SECRET | wrangler secret put SESSION_SECRET --env production

# 4. Redeploy (happens automatically on next push)
```

### Create Staging Environment

```bash
# 1. Create Neon staging database
neonctl branches create --name staging --parent main

# 2. Set secrets for staging
wrangler secret put DATABASE_URL --env staging

# 3. Deploy to staging
wrangler deploy --env staging

# 4. Test staging
curl https://codex-web-staging.workers.dev/
```

## 📞 Who to Contact

- **Deployment Issues**: Check GitHub Actions logs first
- **Database Issues**: Check Neon dashboard
- **Worker Issues**: Check Cloudflare dashboard
- **Secrets Issues**: Verify in both GitHub and Cloudflare

## 📚 Related Docs

- [Full Deployment Guide](.github/DEPLOYMENT_GUIDE.md)
- [CI/CD Implementation Summary](.github/CI_CD_IMPLEMENTATION_SUMMARY.md)
- [Architecture Plan](.github/CI-new-plan.md)
