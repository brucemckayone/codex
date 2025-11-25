# GitHub Workflows

This directory contains GitHub Actions workflows for the Codex platform.

## Active Workflows

### Testing & CI

**[testing.yml](./workflows/testing.yml)** - Main test workflow
- Runs on all pushes and PRs
- Creates ephemeral Neon database branches
- Runs static analysis (types, lint, format)
- Runs unit tests on changed packages
- Runs E2E tests (when web app changes)
- Uploads DATABASE_URL artifact for preview deployment

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

**Primary documentation is in:** [`design/infrastructure/`](../design/infrastructure/)

**Start here:** [design/infrastructure/CI-CD-GUIDE.md](../design/infrastructure/CI-CD-GUIDE.md)

### Archived Documentation

Old documentation has been moved to [`archive/`](./archive/) for reference.
These files may be outdated - always refer to current docs in `design/infrastructure/`.

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

For detailed information about the CI/CD pipeline:
→ [design/infrastructure/CI-CD-GUIDE.md](../design/infrastructure/CI-CD-GUIDE.md)

For troubleshooting:
→ [design/infrastructure/CI-CD-GUIDE.md#troubleshooting](../design/infrastructure/CI-CD-GUIDE.md#troubleshooting)

For rollback procedures:
→ [design/infrastructure/CI-CD-GUIDE.md#rollback-procedures](../design/infrastructure/CI-CD-GUIDE.md#rollback-procedures)
