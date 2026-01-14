# CI/CD - Complete Guide

**Cloudflare Workers + Neon Postgres + GitHub Actions**

Everything you need to understand, deploy, and troubleshoot the CI/CD pipeline.

Last Updated: 2025-11-02

---

## Visual Diagrams

For a visual overview of the CI/CD system, see these diagrams:

### CI/CD Pipeline

Complete workflow from push to production:

```d2
# CI/CD Pipeline Architecture
# Codex Platform - Cloudflare Workers + Neon Postgres

direction: right

# Trigger Events
trigger: {
  label: "Trigger Events"
  push: "Push to Branch" {
    shape: circle
    style.fill: "#E8F5E9"
  }
  pr: "Pull Request" {
    shape: circle
    style.fill: "#E3F2FD"
  }
  merge: "Merge to Main" {
    shape: circle
    style.fill: "#FFF3E0"
  }
}

# Testing Workflow
testing: {
  label: "Testing Workflow\n(testing.yml)"
  style.fill: "#BBDEFB"
  style.stroke: "#1976D2"

  setup: "Setup\n- Checkout code\n- Setup pnpm\n- Install deps"

  db: "Database\n- Create ephemeral\n  Neon branch\n- Run migrations"

  analysis: "Static Analysis\n- TypeScript check\n- ESLint\n- Prettier"

  tests: "Tests\n- Unit tests\n- Integration tests\n- E2E tests (web)"

  artifact: "Artifact\n- Upload DATABASE_URL\n- Save for deployment"

  cleanup: "Cleanup\n- Delete ephemeral\n  branch"

  setup -> db -> analysis -> tests -> artifact -> cleanup
}

# Preview Deployment
preview: {
  label: "Preview Deployment\n(preview-deploy.yml)"
  style.fill: "#C5E1A5"
  style.stroke: "#689F38"

  trigger: "Trigger\n- Wait for testing\n- PR only"

  dns: "DNS Setup\n- Create CNAME:\n  *-preview-{PR}.revelations.studio"

  deploy: "Deploy Workers\n- codex-web-preview-{PR}\n- auth-worker-preview-{PR}\n- ecom-api-preview-{PR}"

  health: "Health Checks\n- Wait 30s (SSL)\n- Check each worker\n- Exponential backoff"

  comment: "PR Comment\n- Post preview URLs\n- Show status"

  trigger -> dns -> deploy -> health -> comment
}

# Production Deployment
production: {
  label: "Production Deployment\n(deploy-production.yml)"
  style.fill: "#FFCCBC"
  style.stroke: "#E64A19"

  trigger: "Trigger\n- Wait for testing\n- main branch only"

  validate: "Validate\n- Verify DNS records\n- Build all workers\n- Fail fast"

  migrate: "Migrate DB\n- production branch\n- Drizzle migrations"

  deploy: "Sequential Deploy\n1. Web worker\n2. Auth worker\n3. Stripe worker"

  health: "Health Checks\n- Wait 30s per worker\n- Check endpoints\n- Exponential backoff"

  success: "Success\n- Deployment complete\n- Monitor logs"

  trigger -> validate -> migrate -> deploy -> health -> success
}

# Neon Database Strategy
neon: {
  label: "Neon Database Strategy"
  style.fill: "#E1BEE7"
  style.stroke: "#8E24AA"

  prod: "production\n(main branch)" {
    shape: cylinder
    style.fill: "#BA68C8"
  }

  ephemeral: "Ephemeral Branches\n(testing)" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  pr: "PR Branches\n(preview)" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  prod -> ephemeral: "Create from\nproduction"
  prod -> pr: "Create from\nproduction"
  ephemeral -> cleanup: "Auto-delete\nafter tests"
  pr -> cleanup: "Delete on\nPR close"

  cleanup: "Cleanup" {
    shape: circle
    style.fill: "#F8BBD0"
  }
}

# Environments
environments: {
  label: "Environments"

  local: "Local\n- wrangler dev\n- localhost:*\n- Manual DB setup" {
    style.fill: "#F5F5F5"
  }

  preview: "Preview\n- *-preview-{PR}\n- *.revelations.studio\n- pr-{PR} DB branch" {
    style.fill: "#E8F5E9"
  }

  prod: "Production\n- *-production\n- *.revelations.studio\n- production DB branch" {
    style.fill: "#FFEBEE"
  }

  local -> preview: "PR opened"
  preview -> prod: "PR merged"
}

# Flow connections
trigger.push -> testing.setup: "On every push"
trigger.pr -> testing.setup: "On PR open/update"
testing.artifact -> preview.trigger: "Testing passed\n(PR only)"
trigger.merge -> testing.setup: "On merge to main"
testing.artifact -> production.trigger: "Testing passed\n(main only)"

# Database connections
testing.db -> neon.ephemeral: "Creates"
preview.deploy -> neon.pr: "Uses pr-{PR}"
production.deploy -> neon.prod: "Uses production"

# Notes
notes: {
  label: "Key Concepts"
  style.fill: "#FFF9C4"
  style.stroke: "#F9A825"

  concept1: "• Ephemeral branches created from production (not from other PRs)"
  concept2: "• DNS records auto-created via Cloudflare API"
  concept3: "• Health checks wait 30s for SSL provisioning"
  concept4: "• Workers deployed sequentially with verification"
  concept5: "• All apps are Workers (including SvelteKit)"
}
```

### Environment Management

Local, Preview, Production flow:

```d2
# Environment Management
# Local → Preview → Production

direction: right

# Local Development
local: {
  label: "Local Development"
  style.fill: "#F5F5F5"
  style.stroke: "#9E9E9E"

  dev: "Developer Machine" {
    shape: rectangle
  }

  wrangler: "wrangler dev\n- codex-web:5173\n- auth-worker:8787\n- stripe-webhook:8788" {
    style.fill: "#E0E0E0"
  }

  db: "Database Options\n1. Local Neon branch\n2. Ephemeral branch\n3. Proxy to preview" {
    shape: cylinder
    style.fill: "#BDBDBD"
  }

  dev -> wrangler: "pnpm dev"
  wrangler -> db: "DATABASE_URL"
}

# Preview Environment
preview: {
  label: "Preview Environment\n(Per PR)"
  style.fill: "#E8F5E9"
  style.stroke: "#4CAF50"

  pr: "Pull Request #{PR}" {
    shape: rectangle
    style.fill: "#C8E6C9"
  }

  workers: "Cloudflare Workers\n- codex-web-preview-{PR}\n- auth-worker-preview-{PR}\n- ecom-api-preview-{PR}" {
    style.fill: "#A5D6A7"
  }

  dns: "Custom Domains\n- codex-preview-{PR}.revelations.studio\n- auth-preview-{PR}.revelations.studio\n- api-preview-{PR}.revelations.studio" {
    style.fill: "#81C784"
  }

  db: "Neon Database\npr-{PR} branch" {
    shape: cylinder
    style.fill: "#66BB6A"
  }

  secrets: "Cloudflare Secrets\n- DATABASE_URL (pr-{PR})\n- BETTER_AUTH_SECRET (generated)\n- STRIPE_SECRET_KEY (test mode)" {
    style.fill: "#4CAF50"
  }

  pr -> workers: "Deploy on\nPR open/update"
  workers -> dns: "Custom domains\nvia Cloudflare API"
  workers -> db: "Isolated DB\nper PR"
  workers -> secrets: "Environment\nspecific"
}

# Production Environment
production: {
  label: "Production Environment"
  style.fill: "#FFEBEE"
  style.stroke: "#F44336"

  merge: "Merge to main" {
    shape: rectangle
    style.fill: "#FFCDD2"
  }

  workers: "Cloudflare Workers\n- codex-web-production\n- auth-worker-production\n- ecom-api-production" {
    style.fill: "#EF9A9A"
  }

  dns: "Custom Domains\n- codex.revelations.studio\n- auth.revelations.studio\n- api.revelations.studio" {
    style.fill: "#E57373"
  }

  db: "Neon Database\nproduction branch" {
    shape: cylinder
    style.fill: "#EF5350"
  }

  secrets: "Cloudflare Secrets\n- DATABASE_URL (production)\n- BETTER_AUTH_SECRET (prod key)\n- STRIPE_SECRET_KEY (live mode)" {
    style.fill: "#F44336"
  }

  merge -> workers: "Deploy on\nmerge to main"
  workers -> dns: "Production domains\nverified"
  workers -> db: "Production DB\nwith migrations"
  workers -> secrets: "Production\nsecrets"
}

# Database Branching Strategy
neon: {
  label: "Neon Database Branching"
  style.fill: "#E1BEE7"
  style.stroke: "#9C27B0"

  prod_branch: "production\n(main branch)" {
    shape: cylinder
    style.fill: "#BA68C8"
  }

  ephemeral: "Ephemeral Branches\npush-{branch}-{sha}" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  pr_branch: "PR Branches\npr-{number}" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  local_branch: "Development Branches\ndev-{name}" {
    shape: cylinder
    style.fill: "#E1BEE7"
  }

  prod_branch -> ephemeral: "Create for\nCI testing"
  prod_branch -> pr_branch: "Create for\npreview"
  prod_branch -> local_branch: "Create for\nlocal dev"

  ephemeral -> cleanup: "Auto-delete\nafter tests"
  pr_branch -> cleanup: "Delete on\nPR close"
  local_branch -> cleanup: "Manual cleanup"

  cleanup: "Auto-cleanup\n(serverless)" {
    shape: circle
    style.fill: "#F8BBD0"
  }
}

# Flow
local.wrangler -> preview.pr: "git push\nopen PR"
preview.workers -> production.merge: "PR approved\nmerge to main"

# Database connections
local.db -> neon.local_branch: "Optional:\nUse dev branch"
preview.db -> neon.pr_branch: "Isolated\nper PR"
production.db -> neon.prod_branch: "Production\ndata"

# Notes
notes: {
  label: "Key Points"
  style.fill: "#FFF9C4"
  style.stroke: "#F9A825"

  note1: "• Each environment is completely isolated"
  note2: "• Database branches created from production (not from each other)"
  note3: "• DNS records auto-managed via Cloudflare API"
  note4: "• Secrets are environment-specific"
  note5: "• Preview environments auto-cleanup on PR close"
  note6: "• Production uses custom domains with SSL"
}
```

### Testing Strategy

Test types, CI flow, database testing:

```d2
# Testing Strategy
# Codex Platform - Vitest + Playwright + Neon Ephemeral Branches

direction: down

# Test Types
tests: {
  label: "Test Types"
  style.fill: "#E3F2FD"
  style.stroke: "#1976D2"

  unit: "Unit Tests\n- Business logic\n- Pure functions\n- No database\n- Fast (ms)" {
    style.fill: "#BBDEFB"
  }

  integration: "Integration Tests\n- Database operations\n- API endpoints\n- Worker logic\n- Medium (seconds)" {
    style.fill: "#90CAF9"
  }

  e2e: "E2E Tests\n- Full user flows\n- Browser automation\n- Cross-worker\n- Slow (minutes)" {
    style.fill: "#64B5F6"
  }
}

# Local Testing
local: {
  label: "Local Testing"
  style.fill: "#F5F5F5"
  style.stroke: "#9E9E9E"

  dev: "Developer" {
    shape: person
  }

  commands: "Commands\n- pnpm test (unit)\n- pnpm test:integration\n- pnpm test:e2e" {
    style.fill: "#E0E0E0"
  }

  vitest: "Vitest\n- Watch mode\n- Fast feedback\n- Coverage reports" {
    style.fill: "#BDBDBD"
  }

  playwright: "Playwright\n- Headless browser\n- UI mode available\n- Visual debugging" {
    style.fill: "#9E9E9E"
  }

  dev -> commands: "Run tests"
  commands -> vitest: "Unit &\nIntegration"
  commands -> playwright: "E2E tests"
}

# CI Testing Flow
ci: {
  label: "CI Testing Flow\n(testing.yml)"
  style.fill: "#C8E6C9"
  style.stroke: "#4CAF50"

  trigger: "Trigger\n- Push to any branch\n- PR open/update" {
    shape: circle
    style.fill: "#A5D6A7"
  }

  setup: "Setup\n1. Checkout code\n2. Install pnpm\n3. Install dependencies\n4. Build packages" {
    style.fill: "#81C784"
  }

  neon: "Create Neon Branch\n- Branch: push-{branch}-{sha}\n- Parent: production\n- Ephemeral: true" {
    style.fill: "#66BB6A"
  }

  migrate: "Run Migrations\n- drizzle-kit push\n- On ephemeral branch\n- Fresh schema" {
    style.fill: "#4CAF50"
  }

  static: "Static Analysis\n- TypeScript (tsc)\n- ESLint\n- Prettier" {
    style.fill: "#388E3C"
  }

  unit: "Unit Tests\n- Changed packages only\n- Parallel execution\n- No database needed" {
    style.fill: "#2E7D32"
  }

  integration: "Integration Tests\n- With DATABASE_URL\n- Real Neon branch\n- Isolated data" {
    style.fill: "#1B5E20"
  }

  e2e: "E2E Tests\n- If web app changed\n- Playwright tests\n- Full user flows" {
    style.fill: "#33691E"
  }

  artifact: "Upload Artifact\n- DATABASE_URL\n- For deployment\n- Preview/production" {
    style.fill: "#827717"
  }

  cleanup: "Cleanup\n- Delete Neon branch\n- Even on failure\n- Zero cost" {
    shape: circle
    style.fill: "#F57C00"
  }

  trigger -> setup -> neon -> migrate
  migrate -> static
  migrate -> unit
  migrate -> integration
  static -> artifact
  unit -> artifact
  integration -> e2e -> artifact
  artifact -> cleanup
}

# Database Testing Pattern
db_pattern: {
  label: "Database Testing Pattern"
  style.fill: "#E1BEE7"
  style.stroke: "#9C27B0"

  ephemeral: "Ephemeral Branch\npush-{branch}-{sha}" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  schema: "Schema State\n- From production\n- Apply migrations\n- Fresh data" {
    style.fill: "#BA68C8"
  }

  test: "Test Execution\n- Insert test data\n- Run queries\n- Verify results" {
    style.fill: "#AB47BC"
  }

  cleanup: "Auto-delete\n- After tests\n- Even on failure\n- No manual cleanup" {
    shape: circle
    style.fill: "#9C27B0"
  }

  ephemeral -> schema: "Migrate"
  schema -> test: "Test"
  test -> cleanup: "Delete"
}

# Test Organization
organization: {
  label: "Test Organization"
  style.fill: "#FFF9C4"
  style.stroke: "#F9A825"

  structure: "File Structure\npackages/\n  web/\n    src/\n      lib/\n        utils.test.ts ← unit\n    tests/\n      integration/ ← integration\n      e2e/ ← playwright\n  auth/\n    src/\n      lib/\n        auth.test.ts ← unit\n    tests/\n      integration/ ← integration" {
    style.fill: "#FFF59D"
  }

  naming: "Naming Convention\n- *.test.ts → unit tests\n- *.integration.test.ts → integration\n- *.spec.ts → e2e (Playwright)" {
    style.fill: "#FFF176"
  }

  config: "Configuration\n- vitest.config.ts (unit)\n- vitest.integration.config.ts\n- playwright.config.ts (e2e)" {
    style.fill: "#FFEE58"
  }
}

# Test Data Strategy
data: {
  label: "Test Data Strategy"
  style.fill: "#FFCCBC"
  style.stroke: "#FF5722"

  factories: "Factories\n- User factory\n- Subscription factory\n- Payment factory\n- Type-safe builders" {
    style.fill: "#FFAB91"
  }

  fixtures: "Fixtures\n- Playwright fixtures\n- Auth state\n- User sessions\n- Reusable contexts" {
    style.fill: "#FF8A65"
  }

  mocks: "Mocks\n- Stripe webhooks\n- Better Auth\n- External APIs\n- Vitest mocks" {
    style.fill: "#FF7043"
  }
}

# Connections
tests.unit -> local.vitest: "Run locally"
tests.integration -> local.vitest: "Run locally"
tests.e2e -> local.playwright: "Run locally"

tests.unit -> ci.unit: "Run in CI"
tests.integration -> ci.integration: "Run in CI"
tests.e2e -> ci.e2e: "Run in CI"

ci.integration -> db_pattern.ephemeral: "Uses"
ci.e2e -> db_pattern.ephemeral: "Uses"

organization.structure -> data.factories: "Import"
organization.structure -> data.fixtures: "Import"
organization.structure -> data.mocks: "Import"

# Notes
notes: {
  label: "Key Concepts"
  style.fill: "#B2DFDB"
  style.stroke: "#00897B"

  note1: "• Every push gets isolated database branch"
  note2: "• Branches created from production (not from other PRs)"
  note3: "• Tests run in parallel where possible"
  note4: "• E2E tests only run when web app changes"
  note5: "• Ephemeral branches auto-delete after tests"
  note6: "• Zero cost for testing (serverless, auto-suspend)"
}
```

### Infrastructure Plan

Complete system architecture:

```d2
# Infrastructure Architecture
# Codex Platform - Complete System Overview

direction: right

# Client Layer
client: {
  label: "Client Layer"
  style.fill: "#E3F2FD"
  style.stroke: "#1976D2"

  browser: "Web Browser\n- Modern browsers\n- Mobile responsive\n- Progressive web app" {
    shape: rectangle
    style.fill: "#BBDEFB"
  }

  domains: "Custom Domains\ncodex.revelations.studio\nauth.revelations.studio\napi.revelations.studio" {
    style.fill: "#90CAF9"
  }
}

# Cloudflare Edge
cloudflare: {
  label: "Cloudflare Edge Network"
  style.fill: "#FFF3E0"
  style.stroke: "#FF6F00"

  dns: "Cloudflare DNS\n- CNAME records\n- Proxied (CDN)\n- Auto SSL/TLS" {
    style.fill: "#FFE0B2"
  }

  workers: "Cloudflare Workers\n- Edge compute\n- Zero cold starts\n- Global distribution" {
    style.fill: "#FFCC80"
  }

  secrets: "Worker Secrets\n- DATABASE_URL\n- BETTER_AUTH_SECRET\n- STRIPE_SECRET_KEY\n- API tokens" {
    style.fill: "#FFB74D"
  }
}

# Application Layer
app: {
  label: "Application Layer"
  style.fill: "#C8E6C9"
  style.stroke: "#388E3C"

  web: "Web Worker\ncodex-web-production\n- SvelteKit app\n- Server-side rendering\n- Client hydration\n- Session management" {
    style.fill: "#A5D6A7"
  }

  auth: "Auth Worker\nauth-worker-production\n- Better Auth\n- OAuth providers\n- Session tokens\n- User management" {
    style.fill: "#81C784"
  }

  api: "API Worker\necom-api-production\n- Stripe webhooks\n- Payment processing\n- Subscription management\n- Event handling" {
    style.fill: "#66BB6A"
  }
}

# Database Layer
database: {
  label: "Database Layer"
  style.fill: "#E1BEE7"
  style.stroke: "#7B1FA2"

  neon: "Neon Postgres\n- Serverless\n- Auto-scaling\n- Branching (git-like)\n- Global replication" {
    shape: cylinder
    style.fill: "#CE93D8"
  }

  branches: "Database Branches\n- production (main)\n- pr-{number} (preview)\n- push-{branch}-{sha} (ephemeral)" {
    shape: cylinder
    style.fill: "#BA68C8"
  }

  drizzle: "Drizzle ORM\n- Type-safe queries\n- Schema migrations\n- TypeScript-first" {
    style.fill: "#AB47BC"
  }
}

# External Services
external: {
  label: "External Services"
  style.fill: "#FFCCBC"
  style.stroke: "#D84315"

  stripe: "Stripe\n- Payment processing\n- Subscription billing\n- Webhooks\n- Customer portal" {
    style.fill: "#FFAB91"
  }

  oauth: "OAuth Providers\n- Google\n- GitHub\n- Custom providers\n- Social login" {
    style.fill: "#FF8A65"
  }

  analytics: "Analytics\n- Posthog (planned)\n- Error tracking\n- Performance monitoring" {
    style.fill: "#FF7043"
  }
}

# CI/CD Pipeline
cicd: {
  label: "CI/CD Pipeline"
  style.fill: "#B2DFDB"
  style.stroke: "#00695C"

  github: "GitHub Actions\n- testing.yml\n- preview-deploy.yml\n- deploy-production.yml" {
    style.fill: "#80CBC4"
  }

  testing: "Automated Testing\n- Unit tests (Vitest)\n- Integration tests\n- E2E tests (Playwright)\n- Static analysis" {
    style.fill: "#4DB6AC"
  }

  preview: "Preview Environments\n- Per PR\n- Isolated DB\n- Custom domains\n- Auto-cleanup" {
    style.fill: "#26A69A"
  }

  production: "Production Deploy\n- On merge to main\n- Sequential deployment\n- Health checks\n- Auto-rollback info" {
    style.fill: "#00897B"
  }
}

# Developer Tools
devtools: {
  label: "Developer Tools"
  style.fill: "#F8BBD0"
  style.stroke: "#C2185B"

  wrangler: "Wrangler CLI\n- Local dev server\n- Deploy workers\n- Tail logs\n- Manage secrets" {
    style.fill: "#F48FB1"
  }

  drizzle_kit: "Drizzle Kit\n- Generate migrations\n- Push schema\n- Studio (DB UI)" {
    style.fill: "#F06292"
  }

  pnpm: "pnpm Workspace\n- Monorepo\n- Shared packages\n- Efficient caching" {
    style.fill: "#EC407A"
  }
}

# Flow: Client to Application
client.browser -> client.domains: "HTTPS request"
client.domains -> cloudflare.dns: "DNS resolution"
cloudflare.dns -> cloudflare.workers: "Route to worker"
cloudflare.workers -> app.web: "codex.*"
cloudflare.workers -> app.auth: "auth.*"
cloudflare.workers -> app.api: "api.*"

# Flow: Application to Database
app.web -> database.drizzle: "ORM queries"
app.auth -> database.drizzle: "User data"
app.api -> database.drizzle: "Subscriptions"
database.drizzle -> database.neon: "SQL"

# Flow: Application to External Services
app.auth -> external.oauth: "OAuth flow"
app.api -> external.stripe: "Payments"
app.web -> external.analytics: "Events"
external.stripe -> app.api: "Webhooks"

# Flow: CI/CD
cicd.github -> cicd.testing: "On push/PR"
cicd.testing -> database.branches: "Ephemeral branch"
cicd.testing -> cicd.preview: "On PR (tests pass)"
cicd.testing -> cicd.production: "On main (tests pass)"
cicd.preview -> cloudflare.workers: "Deploy preview"
cicd.production -> cloudflare.workers: "Deploy production"

# Flow: Development
devtools.wrangler -> app: "Local dev"
devtools.drizzle_kit -> database.drizzle: "Migrations"
devtools.pnpm -> cicd.github: "git push"

# Secrets
cloudflare.secrets -> app.web: "Environment vars"
cloudflare.secrets -> app.auth: "Environment vars"
cloudflare.secrets -> app.api: "Environment vars"

# Environment Summary
environments: {
  label: "Environments"
  style.fill: "#FFF9C4"
  style.stroke: "#F57F17"

  local: "Local Development\n• wrangler dev\n• localhost:*\n• Optional DB branch" {
    style.fill: "#FFF59D"
  }

  preview: "Preview (Per PR)\n• *-preview-{PR}\n• *.revelations.studio\n• pr-{PR} DB branch" {
    style.fill: "#FFF176"
  }

  production: "Production\n• *-production\n• *.revelations.studio\n• production DB branch" {
    style.fill: "#FFEE58"
  }

  local -> preview: "Open PR"
  preview -> production: "Merge to main"
}

# Key Concepts
concepts: {
  label: "Key Architecture Concepts"
  style.fill: "#D1C4E9"
  style.stroke: "#5E35B1"

  concept1: "• All apps are Cloudflare Workers (including SvelteKit)" {style.fill: "#B39DDB"}
  concept2: "• Neon database branches like git branches" {style.fill: "#9575CD"}
  concept3: "• Custom domains on revelations.studio" {style.fill: "#7E57C2"}
  concept4: "• Automated CI/CD via GitHub Actions" {style.fill: "#673AB7"}
  concept5: "• Preview environments per PR with auto-cleanup" {style.fill: "#5E35B1"}
  concept6: "• Sequential production deployment with health checks" {style.fill: "#512DA8"}
}
```

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

> See the [Visual Diagrams](#visual-diagrams) section at the top of this document for embedded D2 architecture diagrams.

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
