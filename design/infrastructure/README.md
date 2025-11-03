# Infrastructure Documentation

**Codex Platform - Cloudflare Workers + Neon Postgres**

Last Updated: 2025-11-02

---

## Start Here

**[CICD.md](CICD.md)** - Complete CI/CD guide with visual diagrams

Everything you need to understand, deploy, and troubleshoot the infrastructure.

---

## Visual Diagrams

Understanding the system visually (see [d2/README.md](d2/README.md) for sources):

- **[CI/CD Pipeline](d2/assets/ci-cd-pipeline.png)** - Complete workflow from push to production
- **[Environment Management](d2/assets/environment-management.png)** - Local, Preview, Production flow
- **[Testing Strategy](d2/assets/testing-strategy.png)** - Test types, CI flow, database testing
- **[Infrastructure Plan](d2/assets/infraplan.png)** - Complete system architecture
- **[Deployment Architecture](d2/assets/deployment-architecture.png)** - Detailed deployment architecture

---

## Documentation Index

### Operational Docs

- **[CICD.md](CICD.md)** - **START HERE** - Complete CI/CD pipeline guide
- **[SECURITY.md](SECURITY.md)** - **CRITICAL** - Security plan, threat model, and hardening guide
- **[Testing.md](Testing.md)** - Testing guide (Vitest, Playwright, Neon ephemeral branches)
- **[EnvironmentManagement.md](EnvironmentManagement.md)** - Local/Preview/Production environments
- **[CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md)** - Cloudflare Workers configuration
- **[Database-Integration-Tests.md](Database-Integration-Tests.md)** - Database testing strategies
- **[CodeStructure.md](CodeStructure.md)** - Monorepo architecture and package organization

### Design Docs (Future Features)

- **[KV-Namespaces.md](KV-Namespaces.md)** - KV namespace design (not currently implemented)
- **[R2BucketStructure.md](R2BucketStructure.md)** - R2 storage design (not currently implemented)

### D2 Diagrams

- **[d2/README.md](d2/README.md)** - How to edit and regenerate infrastructure diagrams

---

## Quick Navigation

### I want to...

**Deploy code:**
- Open a PR → auto-deploys to preview
- Merge to main → auto-deploys to production
- See [CICD.md#quick-start](CICD.md#quick-start)

**Understand the system:**
- Look at [visual diagrams](#visual-diagrams) above
- Read [CICD.md](CICD.md) for comprehensive guide

**Troubleshoot:**
- Check [CICD.md#troubleshooting](CICD.md#troubleshooting)

**Configure secrets:**
- See [CICD.md#secrets--configuration](CICD.md#secrets--configuration)

**Secure the system:**
- Read [SECURITY.md](SECURITY.md) for threat model and remediation plan

**Run tests:**
- See [Testing.md](Testing.md)

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                        │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Web Worker  │  │ Auth Worker │  │ API Worker  │     │
│  │ (SvelteKit) │  │ (Better Auth│  │ (Stripe)    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
└─────────┼────────────────┼────────────────┼─────────────┘
          │                │                │
          └────────────────┴────────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  Neon Postgres │
                  │  (Serverless)  │
                  └────────────────┘
```

### Stack

- **Runtime:** Cloudflare Workers (all apps, including SvelteKit)
- **Database:** Neon Postgres (serverless, git-like branching)
- **ORM:** Drizzle (type-safe migrations from TypeScript schema)
- **Auth:** Better Auth (Drizzle adapter)
- **Payments:** Stripe (webhooks)
- **CI/CD:** GitHub Actions (3 workflows: testing, preview, production)
- **Domains:** Custom domains on `revelations.studio`

### Environments

| Environment | Database | Workers | URLs |
|-------------|----------|---------|------|
| **Production** | `production` | `*-production` | `*.revelations.studio` |
| **Preview** | `pr-{number}` | `*-preview-{PR}` | `*-preview-{PR}.revelations.studio` |
| **Local** | Manual/proxy | `wrangler dev` | `localhost:*` |

---

## Key Concepts

### Ephemeral Neon Branches

Every push gets an isolated database branch:
- Created from production (not from other PRs)
- Migrations tested in isolation
- Auto-deleted after tests
- Zero cost (serverless, auto-suspend)

### Preview Deployments

Every PR gets a full preview environment:
- Unique workers: `*-preview-{PR}`
- Unique DNS: `*-preview-{PR}.revelations.studio`
- Isolated database: `pr-{PR}`
- Auto-cleanup on PR close

### Production Deployments

Merge to `main` triggers automatic production deployment:
1. Build validation (fail fast)
2. Database migrations (production branch)
3. Sequential worker deployment
4. Health checks for each worker

---

## Maintenance

### Updating Documentation

When infrastructure changes:

1. Update workflow YAML first (`.github/workflows/*.yml`)
2. Test changes (open PR, verify it works)
3. Update [CICD.md](CICD.md) to reflect new behavior
4. Update D2 diagrams if architecture changed (see [d2/README.md](d2/README.md))
5. Keep it DRY - avoid duplicating information

### Updating Diagrams

See [d2/README.md](d2/README.md) for how to edit and regenerate visual diagrams.

---

## Archive

Superseded documentation moved to `.github/archive/` for reference.

**Note:** Archived docs may be outdated. Always refer to current documentation.
