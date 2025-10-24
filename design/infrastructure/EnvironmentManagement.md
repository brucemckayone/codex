# Environment Management Guide

Development environment setup for Codex monorepo with Cloudflare + Neon architecture.

![Environment Management Diagram](assets/environment-management.png)

## Environments

| Environment    | Hosting                  | Database                            | Workers            |
| -------------- | ------------------------ | ----------------------------------- | ------------------ |
| **Local**      | localhost:5173           | Postgres (Docker) + Neon HTTP proxy | Miniflare          |
| **Staging**    | Cloudflare Pages preview | Neon staging branch                 | Cloudflare Workers |
| **Production** | Cloudflare Pages         | Neon production                     | Cloudflare Workers |

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- pnpm 10.18.3+
- Docker Desktop
- VS Code (recommended)

### Initial Setup

```bash
# Clone and install
git clone <repo-url>
cd Codex
pnpm install

# Start infrastructure
docker-compose up -d

# Run migrations
pnpm --filter web db:migrate

# Start development
pnpm dev
```

### Docker Compose Stack

`docker-compose.yml` runs:

1. **Postgres 17**: Standard Postgres on port 5432
2. **Neon HTTP Proxy**: Translates HTTP requests to Postgres, mimics Neon's serverless driver

```yaml
services:
  postgres:
    image: postgres:17
    command: '-d 1'
    ports: ['5432:5432']
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: main
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']

  neon-proxy:
    image: ghcr.io/timowilhelm/local-neon-http-proxy:main
    environment:
      PG_CONNECTION_STRING: postgres://postgres:postgres@postgres:5432/main
    ports: ['4444:4444']
    depends_on:
      postgres:
        condition: service_healthy
```

**Why Neon HTTP proxy?**

- Exact API parity with production Neon
- Test serverless driver behavior locally
- No Neon dev branch costs

### Environment Variables

`.env.dev`:

```bash
# Database (via Neon HTTP proxy)
PG_CONNECTION_STRING=http://localhost:4444

# Cloudflare (simulated by Miniflare)
SESSIONS_KV_ID=dev-sessions-kv
BUCKET_NAME=codex-media-dev
TASK_QUEUE_NAME=video-processing-queue
NOTIFICATIONS_QUEUE_NAME=notifications-queue

# RunPod (test endpoint or local - see below)
RUNPOD_API_KEY=your-test-api-key
RUNPOD_ENDPOINT_ID=your-test-endpoint-id
RUNPOD_LOCAL=true  # Set true for local RunPod testing

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx

# BetterAuth
AUTH_SECRET=<32+ char random string>
AUTH_URL=http://localhost:5173

# Resend
RESEND_API_KEY=re_xxxxx
```

### Running Locally

```bash
# Start everything
pnpm dev

# Runs:
# - SvelteKit on :5173 (HMR enabled)
# - Queue consumer worker with Miniflare
# - Webhook handler worker with Miniflare
```

**Miniflare simulates:**

- KV (sessions, cache)
- R2 (media storage)
- Queues (video processing jobs)
- Workers runtime

State persists to `workers/*/.wrangler/state/` across restarts.

### RunPod Local Testing

RunPod supports local testing via CLI. This lets you test GPU workloads without paying per-second costs.

**Install RunPod CLI:**

```bash
pip install runpod
```

**Test handler locally:**

```bash
cd workers/runpod-handler  # If you have a dedicated RunPod handler

# Test with local input
runpodctl test --input '{"videoKey": "test.mp4", "contentId": "123"}'

# Simulate production environment
runpodctl test --env BUCKET_NAME=codex-media-dev --input '{...}'
```

**Mock RunPod in SvelteKit:**

```bash
# Set in .env.dev
RUNPOD_LOCAL=true

# Your code checks this flag:
if (env.RUNPOD_LOCAL) {
  return mockVideoProcessing(videoKey);
} else {
  return await runpod.submit(jobData);
}
```

**References:**

- [RunPod Local Testing Docs](https://docs.runpod.io/serverless/development/local-testing)
- [RunPod CLI Reference](https://docs.runpod.io/cli/overview)

**Stripe webhooks:**

```bash
# Install CLI
brew install stripe/stripe-cli/stripe

# Forward to local
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

---

## Monorepo Structure

```
Codex/
├── apps/
│   └── web/                    # SvelteKit (frontend + API routes)
├── workers/
│   ├── queue-consumer/         # Cloudflare Worker (queue consumer)
│   └── webhook-handler/        # Cloudflare Worker (RunPod webhooks)
├── packages/
│   ├── shared-types/           # TypeScript types
│   └── env-config/             # Zod schemas for env validation
├── infrastructure/
│   └── docker-compose.dev.yml  # Postgres + Neon proxy
├── .env.dev                    # Dev environment variables
├── .env.prod                   # Prod env template
└── pnpm-workspace.yaml
```

---

## VS Code Setup

**Extensions (`.vscode/extensions.json`):**

```json
{
  "recommendations": [
    "svelte.svelte-vscode",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "drizzle-team.drizzle-vscode",
    "cloudflare.vscode-cloudflare-workers"
  ]
}
```

**Debug config (`.vscode/launch.json`):**

```json
{
  "configurations": [
    {
      "name": "SvelteKit",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "web", "dev"]
    }
  ]
}
```

---

## TypeScript Code Sharing

**Path mappings (`tsconfig.json`):**

```json
{
  "compilerOptions": {
    "paths": {
      "@codex/shared-types": ["./packages/shared-types/src"],
      "@codex/env-config": ["./packages/env-config/src"]
    }
  }
}
```

**Usage:**

```typescript
// In SvelteKit or Workers
import type { Content, VideoProcessingJob } from '@codex/shared-types';
import { envSchema } from '@codex/env-config';

const env = envSchema.parse(process.env);
```

---

## Deployment

**Staging (Cloudflare Pages Preview):**

```bash
git push origin develop
# Auto-deploys to *.pages.dev preview URL
```

**Production:**

```bash
git push origin main
# Auto-deploys to production domain
```

**Workers:**

```bash
pnpm --filter queue-consumer deploy
pnpm --filter webhook-handler deploy
```

**Environment Variables:**
Set in Cloudflare Dashboard → Pages → Settings → Environment Variables

---

## Database Migrations

**Local:**

```bash
# Generate from schema changes
pnpm --filter web db:generate

# Apply
pnpm --filter web db:migrate

# GUI
pnpm --filter web db:studio
```

**Production:**

```bash
# Option 1: Auto-run during build
# Add to package.json: "build": "vite build && pnpm db:migrate"

# Option 2: Manual before deploy
export DATABASE_URL=<prod-url>
pnpm db:migrate
```

**Rollback:**
Use Neon Point-in-Time Recovery via dashboard.

---

## Common Commands

```bash
# Development
docker-compose -f infrastructure/docker-compose.dev.yml up -d  # Start DB
pnpm dev                                                       # Start all
pnpm dev:web                                                   # SvelteKit only
pnpm dev:workers                                               # Workers only

# Database
pnpm db:migrate          # Run migrations
pnpm db:studio           # Open GUI
docker-compose down -v   # Reset DB

# Build/Deploy
pnpm build               # Build all
pnpm typecheck           # Check types
pnpm test                # Run tests

# Workers
wrangler queues send video-processing-queue --body '{...}'  # Test queue
wrangler tail --env dev                                     # View logs
```

---

## Secrets

Generate:

```bash
openssl rand -hex 32  # AUTH_SECRET
```

Storage:

- Local: `.env.dev` (gitignored)
- Staging/Prod: Cloudflare Pages environment variables

Never commit secrets to git.

---

## Reference

**Ports:**

- SvelteKit: 5173
- Postgres: 5432
- Neon proxy: 4444

**Docs:**

- [RunPod Local Testing](https://docs.runpod.io/serverless/development/local-testing)
- [Miniflare](https://miniflare.dev/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Drizzle ORM](https://orm.drizzle.team/)
