# GitHub Workflows

This directory contains GitHub Actions workflows for the Codex platform.

## Active Workflows

### Testing & CI

**[testing.yml](./workflows/testing.yml)** - Main test workflow
- Runs on all pushes and PRs
- Each test job runs its own Postgres 17 + local Neon proxy service containers
  (`DB_METHOD=LOCAL_PROXY`, the local-dev path); no Neon branches
- Applies migrations to a Neon copy of `production` only when migrations or
  schema change (`migration-check`)
- Runs static analysis (types, lint, format)
- Runs unit tests on changed packages
- Runs E2E tests (when web app changes)

### Preview Deployments

**[preview-deploy.yml](./workflows/preview-deploy.yml)** - Preview environment deployment
- Triggers after testing workflow completes (on PRs)
- Creates DNS records for custom domains
- Deploys workers with unique names per PR
- Comments on PR with preview URLs
- Cleans up resources when PR closes

### Production Deployments

**[deploy-production.yml](./workflows/deploy-production.yml)** - Production deployment
- Triggers after testing workflow completes (on main branch)
- Verifies/creates production DNS records
- Validates all builds before migrations
- Applies database migrations
- Deploys workers with health checks
- Creates GitHub issue on failure with rollback instructions

### Static Analysis

**[static_analysis.yml](./workflows/static_analysis.yml)** - Code quality checks
- Can be called by other workflows
- Runs typecheck, lint, format check

## Scripts

**[manage-preview-dns.sh](./scripts/manage-preview-dns.sh)**
- Creates/deletes DNS records for preview deployments
- Used by preview-deploy workflow

**[manage-production-dns.sh](./scripts/manage-production-dns.sh)**
- Verifies/creates DNS records for production custom domains
- Used by deploy-production workflow

## Documentation

- The workflow files in [`workflows/`](./workflows/) are the source of truth for what CI runs.
- [`docs/architecture/rules.md`](../docs/architecture/rules.md) lists every CI static gate and the rule it holds. It is generated from the G0 registry, so it can't drift.
- [`docs/deployment/production-go-live.md`](../docs/deployment/production-go-live.md) covers production deploys.

## Quick Reference

### Deploy to Preview
```bash
git checkout -b feature/my-changes
git push origin feature/my-changes
# Open PR → Preview deploys automatically
```

### Deploy to Production
```bash
# Merge PR → Production deploys automatically
```

### Check Deployment Status
```bash
gh run list --limit 10
gh run view <run-id> --log
```

### Rollback Production
```bash
wrangler rollback --name codex-web-production
wrangler rollback --name ecom-api-production
wrangler rollback --name auth-worker-production
```

## Support

For the pipeline, read the workflow files. For production deploys and rollback, see [`docs/deployment/production-go-live.md`](../docs/deployment/production-go-live.md) and the Rollback commands above.
