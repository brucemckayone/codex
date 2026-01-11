# Infrastructure Documentation

**Codex Platform - Cloudflare Workers + Neon Postgres**

Last Updated: 2025-11-02

---

## Start Here

**[CICD.md](CICD.md)** - Complete CI/CD guide with visual diagrams

Everything you need to understand, deploy, and troubleshoot the infrastructure.

---

## Visual Diagrams

Understanding the system visually (see [d2/README.md](d2/README.md) for sources).

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
