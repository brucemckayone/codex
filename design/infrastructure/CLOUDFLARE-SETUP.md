# Cloudflare Setup Guide

**For Cloudflare Workers Deployment**

Last Updated: 2025-11-02

---

## Overview

This project uses **Cloudflare Workers** (NOT Cloudflare Pages) for all applications:
- SvelteKit web app → Compiled to Worker
- Auth worker → Cloudflare Worker
- Stripe webhook handler → Cloudflare Worker

**Everything is deployed as Workers with custom domains.**

---

## Prerequisites

```bash
# Install Wrangler CLI
npm install -g wrangler

# Or use pnpm (recommended)
pnpm add -g wrangler

# Verify installation
wrangler --version
```

---

## Authentication

```bash
# Login to Cloudflare
wrangler login

# Verify account
wrangler whoami

# Get your Account ID (save this)
ACCOUNT_ID=$(wrangler whoami --json | jq -r ".account.id")
echo "Account ID: $ACCOUNT_ID"
```

---

## Workers Configuration

All workers are configured via `wrangler.jsonc` files:

### Web App (`apps/web/wrangler.jsonc`)

```toml
name = "codex-web"
main = ".svelte-kit/cloudflare/_worker.js"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[assets]
binding = "ASSETS"
directory = ".svelte-kit/cloudflare"

[observability]
enabled = true

# Production
[env.production]
name = "codex-web-production"

[env.production.vars]
ENVIRONMENT = "production"
AUTH_WORKER_URL = "https://auth.revelations.studio"
API_URL = "https://api.revelations.studio"

[[env.production.routes]]
pattern = "codex.revelations.studio"
custom_domain = true
```

### Auth Worker (`workers/auth/wrangler.jsonc`)

```toml
name = "auth-worker"
main = "dist/index.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true

[env.production]
name = "auth-worker-production"

[env.production.vars]
ENVIRONMENT = "production"
WEB_APP_URL = "https://codex.revelations.studio"
API_URL = "https://api.revelations.studio"

[[env.production.routes]]
pattern = "auth.revelations.studio/*"
custom_domain = true
```

### Stripe Webhook Handler (`workers/stripe-webhook-handler/wrangler.jsonc`)

```toml
name = "stripe-webhook-handler"
main = "dist/index.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true

[env.production]
name = "stripe-webhook-handler-production"

[env.production.vars]
ENVIRONMENT = "production"
WEB_APP_URL = "https://codex.revelations.studio"
AUTH_WORKER_URL = "https://auth.revelations.studio"

[[env.production.routes]]
pattern = "api.revelations.studio/*"
custom_domain = true
```

---

## Custom Domains Setup

### 1. DNS Records

DNS records are managed automatically by CI/CD pipeline.

**Script:** `.github/scripts/manage-production-dns.sh`

**Creates:**
- `codex.revelations.studio` → CNAME → `revelations.studio` (proxied)
- `auth.revelations.studio` → CNAME → `revelations.studio` (proxied)
- `api.revelations.studio` → CNAME → `revelations.studio` (proxied)

**Manual verification:**
```bash
.github/scripts/manage-production-dns.sh verify \
  $CLOUDFLARE_DNS_API_TOKEN \
  $CLOUDFLARE_ZONE_ID
```

### 2. SSL Certificates

SSL certificates are automatically provisioned by Cloudflare (30-90 seconds on first deployment).

No manual configuration needed.

---

## Secrets Management

### Required Secrets

**Production:**
```bash
# Database
wrangler secret put DATABASE_URL --env production
# Paste: postgresql://neondb_owner:***@***-pooler.us-east-2.aws.neon.tech/neondb

# Auth
wrangler secret put SESSION_SECRET --env production
wrangler secret put SESSION_SECRET_PRODUCTION --env production
wrangler secret put BETTER_AUTH_SECRET --env production

# Stripe
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_SUBSCRIPTION --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_CONNECT --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_CUSTOMER --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_BOOKING --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_DISPUTE --env production
```

**Generate random secrets:**
```bash
openssl rand -base64 32
```

### List Secrets

```bash
wrangler secret list --env production
```

---

## Deployment

### Via CI/CD (Recommended)

```bash
# Push to main → Automatic production deployment
git push origin main

# Open PR → Automatic preview deployment
git checkout -b feature/my-changes
git push origin feature/my-changes
# Open PR on GitHub
```

### Manual Deployment

```bash
# Build SvelteKit
cd apps/web
pnpm build

# Deploy to production
wrangler deploy --env production

# Deploy workers
cd ../../workers/auth
wrangler deploy --env production

cd ../stripe-webhook-handler
wrangler deploy --env production
```

---

## Verification

### Check Deployments

```bash
# List recent deployments
wrangler deployments list --name codex-web-production
wrangler deployments list --name auth-worker-production
wrangler deployments list --name stripe-webhook-handler-production

# View worker logs
wrangler tail codex-web-production
wrangler tail auth-worker-production
wrangler tail stripe-webhook-handler-production
```

### Health Checks

```bash
# Web app
curl https://codex.revelations.studio

# Auth worker
curl https://auth.revelations.studio/health

# API worker
curl https://api.revelations.studio/health
```

---

## Troubleshooting

### Custom domain not working

**Check DNS:**
```bash
dig +short codex.revelations.studio
# Should return Cloudflare IP addresses
```

**Check route configuration:**
```bash
wrangler deployments list --name codex-web-production
# Look for "Custom Domains" section
```

### SSL certificate provisioning

**Wait time:** 30-90 seconds on first deployment

**Check status:**
```bash
curl -v https://codex.revelations.studio 2>&1 | grep "SSL"
```

### Secrets not working

**Verify secret is set:**
```bash
wrangler secret list --env production | grep DATABASE_URL
```

**Update secret:**
```bash
wrangler secret put DATABASE_URL --env production
```

---

## NOT USED in This Project

The following Cloudflare features are **NOT** used:

❌ **Cloudflare Pages** - We use Workers, not Pages
❌ **R2 Buckets** - Not currently configured
❌ **KV Namespaces** - Not currently configured
❌ **Queues** - Not currently configured
❌ **D1 Database** - We use Neon Postgres

**Why Workers instead of Pages?**
- More control over routing
- Better for API-heavy applications
- Unified deployment model (everything is a Worker)
- Custom domains work more reliably

---

## Summary

**Current Setup:**
- ✅ All apps deployed as Cloudflare Workers
- ✅ Custom domains configured via `wrangler.jsonc`
- ✅ DNS managed automatically by CI/CD
- ✅ SSL certificates auto-provisioned
- ✅ Secrets managed via `wrangler secret`
- ✅ Automatic deployments via GitHub Actions

**For deployment details, see:**
- [CI-CD-GUIDE.md](./CI-CD-GUIDE.md) - Complete CI/CD reference
- [ProductionDeployment.md](./ProductionDeployment.md) - Production deployment deep dive

---

**Last Updated:** 2025-11-02
**Maintained By:** DevOps Team
