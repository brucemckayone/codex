# Environment Management

**Cloudflare Workers + Neon Postgres**

Last Updated: 2025-11-02

---

## Environments

| Environment | Database | Workers | URLs |
|-------------|----------|---------|------|
| **Local** | Local (to be configured) | Wrangler dev | `localhost:*` |
| **Preview** | Neon `pr-{number}` branch | `*-preview-{PR}` | `*-preview-{PR}.revelations.studio` |
| **Production** | Neon `production` branch | `*-production` | `*.revelations.studio` |

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 10.18.3+
- Wrangler CLI

### Setup

```bash
# Clone and install
git clone <repo-url>
cd Codex
pnpm install

# Configure environment
cp .env.example .env.dev
# Edit .env.dev with your credentials

# Start development
pnpm dev
```

### Environment Variables

Create `.env.dev`:

```bash
# Database (local or Neon branch)
DATABASE_URL=postgresql://neondb_owner:***@***-pooler.us-east-2.aws.neon.tech/neondb

# Auth
SESSION_SECRET=<random_32_chars>
BETTER_AUTH_SECRET=<random_32_chars>

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_***
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_***
STRIPE_WEBHOOK_SECRET_SUBSCRIPTION=whsec_test_***
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_test_***
STRIPE_WEBHOOK_SECRET_CUSTOMER=whsec_test_***
STRIPE_WEBHOOK_SECRET_BOOKING=whsec_test_***
STRIPE_WEBHOOK_SECRET_DISPUTE=whsec_test_***
```

**Generate secrets:**
```bash
openssl rand -base64 32
```

### Running Locally

```bash
# Start all services
pnpm dev

# Or specific apps
pnpm --filter web dev          # SvelteKit
pnpm --filter auth dev          # Auth worker
pnpm --filter stripe-webhook-handler dev  # API worker
```

---

## Preview Environment (Per PR)

### How It Works

1. Open a pull request
2. Test workflow creates `pr-{number}` Neon branch
3. Preview workflow deploys workers with custom domains
4. PR comment posted with URLs

### Preview URLs

For PR #8:
- **Web:** `https://codex-preview-8.revelations.studio`
- **API:** `https://api-preview-8.revelations.studio`
- **Auth:** `https://auth-preview-8.revelations.studio`

### Preview Environment Details

- **Database:** Neon branch `pr-{number}` (inherits from production)
- **Workers:** `codex-web-preview-{PR}`, `auth-worker-preview-{PR}`, `stripe-webhook-handler-preview-{PR}`
- **DNS:** Automatically created via Cloudflare API
- **Secrets:** Test mode credentials (Stripe test keys, etc.)
- **Lifetime:** Deleted when PR closes

### Testing Preview

```bash
# Check web app
curl https://codex-preview-8.revelations.studio

# Check API
curl https://api-preview-8.revelations.studio/health

# Check auth
curl https://auth-preview-8.revelations.studio/health
```

---

## Production Environment

### Deployment

Production deploys automatically when PR is merged to `main`:

1. Tests pass on `main` branch
2. Production deployment workflow triggers
3. DNS verified/created
4. Builds validated
5. Migrations applied
6. Workers deployed with health checks

### Production URLs

- **Web:** `https://codex.revelations.studio`
- **API:** `https://api.revelations.studio`
- **Auth:** `https://auth.revelations.studio`

### Production Environment Details

- **Database:** Neon `production` branch
- **Workers:** `codex-web-production`, `auth-worker-production`, `stripe-webhook-handler-production`
- **DNS:** Custom domains managed automatically
- **Secrets:** Production credentials (set via Wrangler CLI)
- **Monitoring:** Cloudflare observability enabled

### Accessing Production

```bash
# View worker logs
wrangler tail codex-web-production
wrangler tail auth-worker-production
wrangler tail stripe-webhook-handler-production

# Check health
curl https://codex.revelations.studio
curl https://api.revelations.studio/health
curl https://auth.revelations.studio/health
```

---

## Database Management

### Neon Branch Strategy

**For Testing:**
- PR events: `pr-{number}` (created from production)
- Push events: `push-{branch}-{sha}` (created from production)
- E2E tests: `pr-{number}-e2e` (separate branch)

**For Production:**
- Main branch: `production`

### Migrations

**Local:**
```bash
# Generate migration
pnpm --filter @codex/database db:gen:drizzle

# Apply migration
pnpm --filter @codex/database db:migrate

# Open Drizzle Studio
pnpm --filter @codex/database db:studio
```

**Preview (automatic):**
- Migrations applied to ephemeral branch during tests
- No manual intervention needed

**Production (automatic):**
- Migrations applied during production deployment
- Runs after build validation, before worker deployment

---

## Secrets Management

### GitHub Secrets

Configure in: `Settings → Secrets and variables → Actions → Secrets`

**Cloudflare:**
- `CLOUDFLARE_API_TOKEN` - Worker deployment
- `CLOUDFLARE_DNS_API_TOKEN` - DNS management
- `CLOUDFLARE_ACCOUNT_ID` - Account ID
- `CLOUDFLARE_ZONE_ID` - Zone ID for revelations.studio

**Neon:**
- `NEON_API_KEY` - Branch management
- `NEON_PRODUCTION_URL` - Production database URL

**Application:**
- `SESSION_SECRET_PRODUCTION`
- `BETTER_AUTH_SECRET_PRODUCTION`
- `STRIPE_PRODUCTION_KEY`
- `STRIPE_PRODUCTION_*_WEBHOOK_SECRET`

### Cloudflare Secrets

Set via Wrangler CLI:

```bash
# Production
wrangler secret put DATABASE_URL --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put STRIPE_SECRET_KEY --env production

# List secrets
wrangler secret list --env production
```

---

## Common Commands

### Development
```bash
pnpm dev                              # Start all
pnpm --filter web dev                 # Web app only
pnpm --filter auth dev                # Auth worker only
pnpm --filter stripe-webhook-handler dev  # API worker only
```

### Testing
```bash
pnpm test                             # Unit & integration tests
pnpm test:e2e                         # E2E tests
pnpm test:watch                       # Watch mode
```

### Database
```bash
pnpm --filter @codex/database db:gen:drizzle  # Generate migration
pnpm --filter @codex/database db:migrate      # Apply migration
pnpm --filter @codex/database db:studio       # Open studio
```

### Deployment
```bash
# Push to deploy (via CI/CD)
git push origin main                  # Production
# Open PR                              # Preview

# Manual deployment
wrangler deploy --env production      # Deploy worker manually
```

---

## Environment Variables Summary

### Local (.env.dev)
- `DATABASE_URL` - Local or Neon dev branch
- `SESSION_SECRET` - Random string
- `BETTER_AUTH_SECRET` - Random string
- `STRIPE_SECRET_KEY` - Test key (sk_test_***)
- `STRIPE_WEBHOOK_SECRET_*` - Test webhook secrets

### Preview (set by CI/CD)
- `DATABASE_URL` - Ephemeral Neon branch
- `SESSION_SECRET` - Test secret
- `STRIPE_SECRET_KEY` - Test key
- `STRIPE_WEBHOOK_SECRET_*` - Test webhook secrets

### Production (set via Wrangler)
- `DATABASE_URL` - Production Neon branch (pooler URL)
- `SESSION_SECRET` - Production secret
- `BETTER_AUTH_SECRET` - Production secret
- `STRIPE_SECRET_KEY` - Live key (sk_live_***)
- `STRIPE_WEBHOOK_SECRET_*` - Live webhook secrets

---

## Troubleshooting

### Local development issues

**Database connection fails:**
```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

**Worker not starting:**
```bash
# Check wrangler is installed
wrangler --version

# Check for errors
pnpm --filter <worker> dev --verbose
```

### Preview deployment issues

**Artifact not found:**
- Wait for test workflow to complete
- Check test workflow logs
- Ensure artifact retention is set (7 days)

**DNS not resolving:**
- Check CLOUDFLARE_ZONE_ID is set
- Verify DNS records in Cloudflare dashboard
- Wait 1-2 minutes for propagation

### Production issues

See [CI-CD-GUIDE.md#troubleshooting](./CI-CD-GUIDE.md#troubleshooting)

---

## Summary

**Environment Isolation:**
- ✅ Each PR gets unique database branch
- ✅ Each PR gets unique workers
- ✅ Each PR gets unique DNS records
- ✅ Production is completely isolated

**Automatic Management:**
- ✅ Neon branches created/deleted automatically
- ✅ Workers deployed/deleted automatically
- ✅ DNS records created/deleted automatically
- ✅ Migrations applied automatically

**For More Information:**
- [CI-CD-GUIDE.md](./CI-CD-GUIDE.md) - Complete CI/CD reference
- [CLOUDFLARE-SETUP.md](./CLOUDFLARE-SETUP.md) - Cloudflare configuration
- [Database-Integration-Tests.md](./Database-Integration-Tests.md) - Database testing

---

**Last Updated:** 2025-11-02
**Maintained By:** DevOps Team
