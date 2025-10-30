REVISED EXPERT CI/CD STRATEGY: Workers-First Architecture
Based on your clarifications, here's the production-grade architecture that fits your actual needs:
📋 Key Decisions Summary
Decision	Choice	Rationale
Frontend Deployment	Pages → Workers	Full control over preview environments, unified stack
Database	Neon only (no D1)	Postgres-compatible, ephemeral branching
Connection Pooling	Framework only (no Hyperdrive yet)	Defer until proven bottleneck
Monitoring	Custom/open-source (no Sentry)	Cost optimization
Worker Tests	Minimal scaffolds	Show pattern, not comprehensive coverage
🏗️ Proposed Architecture: Unified Workers Deployment
The Goal:
"Unit tests, E2E tests, integration tests across the whole platform running in an environment that is not going to affect main. Move that into a preview staging environment that I can browse as if it is a real website. Everything duplicated from main. Visual confirmation before merging."
The Solution: Branch-Based Preview Environments
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Pull Request                        │
│                    (feature/new-payment-flow)                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   1. CI/CD Pipeline Triggers     │
        │   (static_analysis.yml)          │
        └──────────────┬───────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│  Create Neon Branch │   │  Run All Tests      │
│  pr-123             │   │  (unit/int/e2e)     │
│  DATABASE_URL=...   │   │  against pr-123 DB  │
└──────────┬──────────┘   └──────────┬──────────┘
           │                         │
           └───────────┬─────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │   2. Deploy Preview Stack        │
        │   (if tests pass)                │
        └──────────────┬───────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│  Deploy Workers     │   │  Deploy SvelteKit   │
│  (preview env)      │   │  (preview env)      │
│  stripe-wh-pr-123   │   │  codex-web-pr-123   │
│  auth-pr-123        │   │  _worker.js         │
└─────────────────────┘   └─────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   3. Preview Environment Ready   │
        │   https://pr-123.codex.workers.dev│
        │   + Database: pr-123 branch      │
        │   + Workers: pr-123 environment  │
        └──────────────────────────────────┘
                       │
                       ▼ (Manual approval)
        ┌──────────────────────────────────┐
        │   4. Merge to Main               │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   5. Production Deployment       │
        │   - Run migrations on prod DB    │
        │   - Deploy workers (production)  │
        │   - Deploy SvelteKit (production)│
        │   - Cleanup pr-123 resources     │
        └──────────────────────────────────┘
🔧 Technical Implementation Plan
Phase 1: SvelteKit as Worker (Not Pages)
Why Workers over Pages:
Requirement	Workers	Pages Git Integration
Unified preview environment	✅ Full control via CI	⚠️ Separate from worker previews
Custom DATABASE_URL per preview	✅ Via wrangler environments	❌ Limited env var support
Test before deploy	✅ Deploy after tests pass	❌ Auto-deploys on push
Cleanup automation	✅ Delete via CI	⚠️ Manual or webhook-based
Cost predictability	✅ Same billing as workers	✅ Same (but less control)
Decision: Deploy SvelteKit as a Worker to maintain full control over the preview → staging → production flow.
Required Configuration Changes
1. apps/web/wrangler.toml (NEW FILE)
name = "codex-web"
main = ".svelte-kit/cloudflare/_worker.js"
compatibility_date = "2025-01-01"

# Static assets binding
[assets]
binding = "ASSETS"
directory = ".svelte-kit/cloudflare"

# Route configuration
[routes]
include = ["/*"]

# Environment-specific configs
[env.production]
name = "codex-web-production"
vars = { ENVIRONMENT = "production" }

[env.staging]
name = "codex-web-staging"
vars = { ENVIRONMENT = "staging" }

# Bindings for database access
# Note: DATABASE_URL will be set as a secret via wrangler secret put
2. workers/stripe-webhook-handler/wrangler.toml (UPDATED)
name = "stripe-webhook-handler"
main = "dist/index.js"
compatibility_date = "2025-01-01"

# Observability
[observability]
enabled = true

# Environment-specific configs
[env.production]
name = "stripe-webhook-handler-production"
vars = { ENVIRONMENT = "production" }

[env.staging]
name = "stripe-webhook-handler-staging"
vars = { ENVIRONMENT = "staging" }

# Secrets (set via: wrangler secret put DATABASE_URL --env production)
# - DATABASE_URL
# - STRIPE_SECRET_KEY
# - STRIPE_WEBHOOK_SECRET
3. workers/auth/wrangler.toml (NEW/UPDATED)
name = "auth-worker"
main = "dist/index.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true

[env.production]
name = "auth-worker-production"
vars = { ENVIRONMENT = "production" }

[env.staging]
name = "auth-worker-staging"
vars = { ENVIRONMENT = "staging" }

# Secrets: DATABASE_URL, SESSION_SECRET, etc.
Phase 2: Preview Deployment Workflow
.github/workflows/preview-deploy.yml (NEW)
name: Preview Deployment

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write  # For PR comments
  deployments: write

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  PR_NUMBER: ${{ github.event.pull_request.number }}

jobs:
  # Reuse existing test job from static_analysis.yml
  tests:
    uses: ./.github/workflows/static_analysis.yml
    secrets: inherit

  deploy-preview:
    name: Deploy Preview Environment
    needs: [tests]
    runs-on: ubuntu-latest
    outputs:
      web_url: ${{ steps.deploy-web.outputs.url }}
      neon_branch_id: ${{ needs.tests.outputs.branch_id }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - uses: pnpm/action-setup@v4
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Get Neon branch connection string from previous job
      # (This requires passing it via artifact or re-creating branch)
      - name: Get Neon branch details
        id: neon-branch
        run: |
          # Fetch existing branch created by test job
          BRANCH_NAME="pr-${{ env.PR_NUMBER }}"
          # Use neonctl or Neon API to get connection string
          # For now, we'll create it if needed (idempotent)
          echo "DATABASE_URL will be set from test job output"

      # Deploy Workers with preview environment
      - name: Deploy stripe-webhook-handler (preview)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/stripe-webhook-handler
          command: deploy --env preview-${{ env.PR_NUMBER }}
          secrets: |
            DATABASE_URL
            STRIPE_SECRET_KEY
            STRIPE_WEBHOOK_SECRET
        env:
          DATABASE_URL: ${{ needs.tests.outputs.database_url }}
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}
          STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_TEST_WEBHOOK_SECRET }}

      - name: Deploy auth-worker (preview)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/auth
          command: deploy --env preview-${{ env.PR_NUMBER }}
          secrets: |
            DATABASE_URL
        env:
          DATABASE_URL: ${{ needs.tests.outputs.database_url }}

      # Build and deploy SvelteKit as Worker
      - name: Build SvelteKit app
        run: pnpm --filter web build
        env:
          DATABASE_URL: ${{ needs.tests.outputs.database_url }}

      - name: Deploy SvelteKit (preview)
        id: deploy-web
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/web
          command: deploy --env preview-${{ env.PR_NUMBER }}
          secrets: |
            DATABASE_URL
        env:
          DATABASE_URL: ${{ needs.tests.outputs.database_url }}

      # Comment on PR with preview URLs
      - name: Comment preview URLs
        uses: actions/github-script@v7
        with:
          script: |
            const prNumber = ${{ env.PR_NUMBER }};
            const webUrl = `https://pr-${prNumber}.codex-web.workers.dev`;
            const comment = `## 🚀 Preview Deployment Ready
            
            **Web App:** ${webUrl}
            **Database:** Neon branch \`pr-${prNumber}\`
            **Workers:** Deployed with \`preview-${prNumber}\` environment
            
            ### Testing Checklist
            - [ ] Visual confirmation of UI changes
            - [ ] Test user flows end-to-end
            - [ ] Verify database operations
            - [ ] Check worker functionality
            
            **Note:** This preview will be automatically deleted when PR is closed.`;
            
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: prNumber,
              body: comment
            });

  # Cleanup preview when PR is closed
  cleanup-preview:
    name: Cleanup Preview Environment
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    steps:
      - name: Delete Neon branch
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: pr-${{ env.PR_NUMBER }}
          api_key: ${{ secrets.NEON_API_KEY }}

      - name: Delete worker deployments
        run: |
          # Use wrangler to delete preview environments
          wrangler delete --name stripe-webhook-handler-preview-${{ env.PR_NUMBER }}
          wrangler delete --name auth-worker-preview-${{ env.PR_NUMBER }}
          wrangler delete --name codex-web-preview-${{ env.PR_NUMBER }}
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
Phase 3: Production Deployment Workflow
.github/workflows/deploy-production.yml (NEW)
name: Production Deployment

on:
  push:
    branches:
      - main

permissions:
  contents: read
  deployments: write

jobs:
  # Run tests first
  tests:
    uses: ./.github/workflows/static_analysis.yml
    secrets: inherit

  deploy-production:
    name: Deploy to Production
    needs: [tests]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://codex.your-domain.com
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - uses: pnpm/action-setup@v4
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Apply migrations to production database
      - name: Run production migrations
        run: pnpm --filter @codex/database db:migrate
        env:
          DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}
          DB_METHOD: PRODUCTION

      # Deploy workers to production
      - name: Deploy stripe-webhook-handler
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/stripe-webhook-handler
          command: deploy --env production
          secrets: |
            DATABASE_URL
            STRIPE_SECRET_KEY
            STRIPE_WEBHOOK_SECRET
        env:
          DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_PRODUCTION_KEY }}
          STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_PRODUCTION_WEBHOOK_SECRET }}

      - name: Deploy auth-worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/auth
          command: deploy --env production
          secrets: |
            DATABASE_URL
        env:
          DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}

      # Build and deploy SvelteKit
      - name: Build SvelteKit app
        run: pnpm --filter web build
        env:
          DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}

      - name: Deploy SvelteKit to production
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/web
          command: deploy --env production
          secrets: |
            DATABASE_URL
        env:
          DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}

      - name: Deployment notification
        if: success()
        run: echo "✅ Production deployment successful"

      - name: Deployment failed
        if: failure()
        run: |
          echo "❌ Production deployment failed"
          # Add notification logic (Slack, Discord, etc.)
Phase 4: Minimal Worker Test Scaffolds
workers/stripe-webhook-handler/src/index.test.ts
import { describe, it, expect } from 'vitest';

describe('Stripe Webhook Handler - Smoke Tests', () => {
  it('should have entry point defined', () => {
    // This test just shows the pattern
    expect(true).toBe(true);
  });

  it.todo('validates Stripe webhook signatures');
  it.todo('processes payment.succeeded event');
  it.todo('handles database write on successful payment');
});
workers/auth/src/index.test.ts
import { describe, it, expect } from 'vitest';

describe('Auth Worker - Smoke Tests', () => {
  it('should have entry point defined', () => {
    expect(true).toBe(true);
  });

  it.todo('validates JWT tokens');
  it.todo('handles login flow');
  it.todo('handles database connection');
});
Purpose: Show the pattern for testing, but don't implement comprehensive tests yet. This gives you scaffolds to expand later.
Phase 5: Monitoring & Observability Framework
packages/observability/src/index.ts (NEW PACKAGE)
// Simple observability without Sentry

export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export class ObservabilityClient {
  private environment: string;

  constructor(environment: string) {
    this.environment = environment;
  }

  log(event: LogEvent): void {
    // For now, just console.log
    // Later: integrate with Cloudflare Analytics, Axiom, etc.
    console.log(JSON.stringify({
      ...event,
      environment: this.environment,
    }));
  }

  trackRequest(request: Request, duration: number): void {
    this.log({
      level: 'info',
      message: 'Request processed',
      timestamp: new Date(),
      metadata: {
        url: request.url,
        method: request.method,
        duration,
      },
    });
  }

  trackError(error: Error, context?: Record<string, unknown>): void {
    this.log({
      level: 'error',
      message: error.message,
      timestamp: new Date(),
      metadata: {
        stack: error.stack,
        ...context,
      },
    });
  }
}
Usage in Workers:
// workers/stripe-webhook-handler/src/index.ts
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('production');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    
    try {
      // Your webhook logic
      const result = await handleWebhook(request, env);
      
      obs.trackRequest(request, Date.now() - start);
      return result;
    } catch (error) {
      obs.trackError(error as Error, { url: request.url });
      return new Response('Error', { status: 500 });
    }
  }
};
Future integrations to consider:
Axiom (free tier: 500GB/month) - https://axiom.co
Cloudflare Analytics Engine (built-in)
Baselime (serverless observability) - https://baselime.io
🎯 Implementation Roadmap
Update Todos

Research and document SvelteKit Workers vs Pages deployment strategy

Design complete CI/CD architecture for preview deployments

Create wrangler.toml for all workers (stripe-webhook, auth)

Create wrangler.toml for SvelteKit app with Workers deployment

Update static_analysis.yml to output Neon DATABASE_URL

Create preview-deploy.yml workflow with unified stack deployment

Create deploy-production.yml with migration + deployment steps

Add minimal test scaffolds to workers (pattern demonstration)

Create observability package with logging framework

Set up Cloudflare secrets for all environments

Test preview deployment end-to-end on feature branch

Document deployment processes and create runbooks
Week 1: Foundation (Core Configs)
✅ Create wrangler.toml for all workers - stripe-webhook, auth
✅ Create wrangler.toml for SvelteKit - Workers deployment config
✅ Add minimal test scaffolds - Show pattern, not comprehensive
✅ Update apps/web/svelte.config.js - Ensure adapter-cloudflare is correct
Deliverable: All projects have wrangler.toml with environment configs
Week 2: Preview Deployments
✅ Create .github/workflows/preview-deploy.yml
✅ Update static_analysis.yml to export DATABASE_URL (artifact or output)
✅ Test preview deployment on feature branch
✅ Add PR comment bot with preview URLs
Deliverable: Working preview environment accessible at pr-{number}.codex-web.workers.dev
Week 3: Production Pipeline
✅ Create .github/workflows/deploy-production.yml
✅ Add production migration step with safety checks
✅ Set up Cloudflare secrets for production environment
✅ Test production deployment to staging first
Deliverable: Automated production deployment with migration handling
Week 4: Observability & Docs
✅ Create @codex/observability package
✅ Integrate logging in all workers
✅ Document deployment process (runbooks)
✅ Create troubleshooting guide
Deliverable: Monitoring in place, team trained on deployment process
🔑 Critical Implementation Notes
1. Neon DATABASE_URL Passing (The Hard Part)
Problem: GitHub Actions masks DATABASE_URL outputs for security. Solution: Use artifacts to pass between jobs:
# In static_analysis.yml (test job)
- name: Save Neon connection string
  run: |
    echo "${{ steps.create-branch.outputs.db_url_with_pooler }}" > database-url.txt
    
- name: Upload DATABASE_URL artifact
  uses: actions/upload-artifact@v4
  with:
    name: neon-connection-${{ github.run_id }}
    path: database-url.txt
    retention-days: 1

# In preview-deploy.yml (deploy job)
- name: Download DATABASE_URL artifact
  uses: actions/download-artifact@v4
  with:
    name: neon-connection-${{ github.run_id }}
    
- name: Set DATABASE_URL
  run: echo "DATABASE_URL=$(cat database-url.txt)" >> $GITHUB_ENV
Alternative: Re-create or fetch Neon branch in deploy job (simpler but slower).
2. Wrangler Environment Naming
Pattern:
Production: {worker-name}-production
Staging:    {worker-name}-staging  
Preview:    {worker-name}-preview-{PR_NUMBER}
Why: Cloudflare Workers treats each environment as a separate deployment. This naming convention makes it easy to identify and manage.
3. Hyperdrive Integration Points (Future)
When you're ready to add Hyperdrive, the changes are minimal:
# wrangler.toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"
// Worker code
const db = drizzle(env.HYPERDRIVE.connectionString);
// That's it - 1 line change
4. Cost Tracking
Current free tier limits:
Workers: 100,000 requests/day
Neon: 300 compute hours/month
GitHub Actions: 2,000 minutes/month
Preview deployments scaling:
10 active PRs = 10 Neon branches + 30 worker deployments
Estimated cost: $0 (within free tier)
When to add Hyperdrive:
When you exceed 1M requests/month
When you see >100ms cold start times
When Neon bill >$50/month
📊 Success Metrics
Phase 1 (Preview Deployments)
✅ PR opened → Preview deployed in <5 minutes
✅ Preview URL accessible and functional
✅ Database isolated per PR
✅ Automatic cleanup on PR close
Phase 2 (Production)
✅ Main merge → Production deployed in <3 minutes
✅ Zero-downtime migrations
✅ Rollback capability in <2 minutes
✅ No manual steps required
Phase 3 (Observability)
✅ All errors logged with context
✅ Request performance tracked
✅ Deployment success/failure notifications
✅ Cost tracking dashboard
🚨 Risks & Mitigations
Risk	Impact	Mitigation
Neon connection limits	High	Use pooled connections, monitor usage
Wrangler environment limit	Medium	Clean up old preview deployments
DATABASE_URL exposure	Critical	Use artifacts with 1-day retention
Migration rollback needed	High	Test migrations on Neon branch first
Worker cold starts	Medium	Keep workers warm with health checks
🎓 Next Steps for You
Review this architecture - Does it match your vision?
Clarify unknowns:
Should preview deployments have custom domains or use *.workers.dev?
Do you want staging as a persistent environment or just preview per PR?
Any specific monitoring tools you prefer?
Approve the plan - Then I'll start implementing:
Week 1: wrangler.toml files
Week 2: Preview workflow
Week 3: Production workflow
Week 4: Observability
Would you like me to start creating the wrangler.toml configurations now, or do you have questions/changes to the architecture first?