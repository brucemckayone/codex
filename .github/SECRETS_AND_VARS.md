# GitHub Secrets, Variables, and Environments

Last updated: 2025-12-12

## Architecture Overview

Secrets and variables follow an **environment-based design**:
- **Repository level**: Shared infrastructure (Cloudflare, R2, Neon API, Turbo)
- **Environment level**: Environment-specific config (Stripe keys, auth secrets, bucket names)

This ensures:
- No `_TEST` or `_PRODUCTION` suffixes in secret names
- Complete session isolation between environments
- Each environment uses its own auth secrets

---

## Repository-Level Secrets (Shared Infrastructure)

### Cloudflare (all environments use same account)
- `CLOUDFLARE_ACCOUNT_ID` - Account identifier
- `CLOUDFLARE_API_TOKEN` - Worker deployment token
- `CLOUDFLARE_DNS_API_TOKEN` - DNS management token
- `CLOUDFLARE_ZONE_ID` - DNS zone identifier

### R2 Storage (all environments use same credentials, different buckets)
- `R2_ACCESS_KEY_ID` - R2 API access key
- `R2_ACCOUNT_ID` - R2 account identifier
- `R2_SECRET_ACCESS_KEY` - R2 API secret

### Database (Neon)
- `NEON_API_KEY` - API key for branch management

### CI/CD Tools
- `TURBO_TOKEN` - Turborepo remote cache token
- `WORKER_SHARED_SECRET` - Worker-to-worker authentication
- `CLAUDE_CODE_OAUTH_TOKEN` - Claude Code integration

---

## Repository-Level Variables

- `NEON_PROJECT_ID` - Neon project (same project, different branches per env)
- `TURBO_TEAM` - Turborepo team identifier

---

## Environments

### 1. production Environment
**Purpose**: Live production deployment
**Used by**: `deploy-production.yml`

**Secrets:**
- `BETTER_AUTH_SECRET` - Auth signing key (UNIQUE to production)
- `DATABASE_URL` - Production database connection string
- `SESSION_SECRET` - Session signing key (UNIQUE to production)
- `STRIPE_SECRET_KEY` - Live mode Stripe key (sk_live_*)
- `STRIPE_WEBHOOK_SECRET_BOOKING`
- `STRIPE_WEBHOOK_SECRET_CONNECT`
- `STRIPE_WEBHOOK_SECRET_CUSTOMER`
- `STRIPE_WEBHOOK_SECRET_DISPUTE`
- `STRIPE_WEBHOOK_SECRET_PAYMENT`
- `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION`

**Variables:**
- `DB_METHOD` = `PRODUCTION`
- `NODE_ENV` = `production`
- `R2_BUCKET_ASSETS` = `codex-assets-production`
- `R2_BUCKET_MEDIA` = `codex-media-production`
- `R2_BUCKET_PLATFORM` = `codex-platform-production`
- `R2_BUCKET_RESOURCES` = `codex-resources-production`

---

### 2. preview Environment
**Purpose**: PR preview deployments
**Used by**: `preview-deploy.yml`

**Secrets:**
- `BETTER_AUTH_SECRET` - Auth signing key (UNIQUE to preview)
- `SESSION_SECRET` - Session signing key (UNIQUE to preview)
- `STRIPE_SECRET_KEY` - Test mode Stripe key (sk_test_*)
- `STRIPE_WEBHOOK_SECRET_BOOKING`
- `STRIPE_WEBHOOK_SECRET_CONNECT`
- `STRIPE_WEBHOOK_SECRET_CUSTOMER`
- `STRIPE_WEBHOOK_SECRET_DISPUTE`
- `STRIPE_WEBHOOK_SECRET_PAYMENT`
- `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION`

**Variables:**
- `DB_METHOD` = `NEON_BRANCH`
- `NODE_ENV` = `preview`
- `R2_BUCKET_ASSETS` = `codex-assets-preview`
- `R2_BUCKET_MEDIA` = `codex-media-preview`
- `R2_BUCKET_PLATFORM` = `codex-platform-preview`
- `R2_BUCKET_RESOURCES` = `codex-resources-preview`
- `STRIPE_PUBLISHABLE_KEY` = `pk_test_*`

---

### 3. test Environment
**Purpose**: CI testing jobs
**Used by**: `testing.yml`

**Secrets:**
- `BETTER_AUTH_SECRET` - Auth signing key (UNIQUE to test)
- `STRIPE_SECRET_KEY` - Test mode Stripe key (sk_test_*)
- `STRIPE_WEBHOOK_SECRET_BOOKING`
- `STRIPE_WEBHOOK_SECRET_CONNECT`
- `STRIPE_WEBHOOK_SECRET_CUSTOMER`
- `STRIPE_WEBHOOK_SECRET_DISPUTE`
- `STRIPE_WEBHOOK_SECRET_PAYMENT`
- `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION`

**Variables:**
- `DB_METHOD` = `NEON_BRANCH`
- `NODE_ENV` = `test`
- `R2_BUCKET_ASSETS` = `codex-assets-test`
- `R2_BUCKET_MEDIA` = `codex-media-test`
- `R2_BUCKET_PLATFORM` = `codex-platform-test`
- `R2_BUCKET_RESOURCES` = `codex-resources-test`
- `STRIPE_PUBLISHABLE_KEY` = `pk_test_*`

---

### 4. CI Environment
**Purpose**: Neon branch management (cleanup job)
**Used by**: `testing.yml` (cleanup-stale-branches job only)

**Variables:**
- `DB_METHOD` = `NEON_BRANCH`
- `NEON_PARENT_BRANCH_ID` - Parent branch for ephemeral branches
- `NEON_PROJECT_ID` - Project ID (can differ from repo-level)

---

## Deprecated Repository-Level Secrets (TO BE REMOVED)

Run `.github/scripts/cleanup-repo-secrets.sh` after workflows are updated:

- `STRIPE_TEST_*` (7 secrets) - Moved to test/preview environments
- `STRIPE_PRODUCTION_*` (7 secrets) - Moved to production environment
- `BETTER_AUTH_SECRET_PRODUCTION` - Moved to production environment
- `SESSION_SECRET` - Moved to each environment
- `SESSION_SECRET_PRODUCTION` - Moved to production environment
- `NEON_PRODUCTION_URL` - Use `DATABASE_URL` in production environment

---

## Setup Scripts

- `.github/scripts/setup-preview-environment.sh` - Create preview environment
- `.github/scripts/cleanup-repo-secrets.sh` - Remove deprecated secrets

---

## Security Benefits

1. **Session Isolation**: Different `BETTER_AUTH_SECRET` and `SESSION_SECRET` per environment prevents cross-environment session leakage
2. **No Hardcoded Environment Names**: Secrets use generic names, environment determines which key is used
3. **Clear Separation**: Each environment has its own R2 buckets and Stripe webhooks

---

## R2 Buckets Required

| Environment | Buckets |
|-------------|---------|
| production  | codex-assets-production, codex-media-production, codex-platform-production, codex-resources-production |
| preview     | codex-assets-preview, codex-media-preview, codex-platform-preview, codex-resources-preview |
| test        | codex-assets-test, codex-media-test, codex-platform-test, codex-resources-test |
