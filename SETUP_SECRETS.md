# Secret Setup Guide

This guide walks you through configuring all required secrets for the Codex platform deployment. Complete all sections in order to ensure successful deployments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [GitHub Secrets Setup](#github-secrets-setup)
3. [Cloudflare Worker Secrets](#cloudflare-worker-secrets)
4. [KV Namespace Configuration](#kv-namespace-configuration)
5. [Verification Steps](#verification-steps)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

- [ ] GitHub repository admin access
- [ ] Cloudflare account with Workers and DNS access
- [ ] Neon database account and project
- [ ] Stripe account (for webhook secrets)
- [ ] `wrangler` CLI installed (`npm install -g wrangler`)
- [ ] `openssl` installed (for generating secrets)

---

## GitHub Secrets Setup

### Step 1: Cloudflare Secrets

#### 1.1 Create Cloudflare API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Set permissions:
   - Account > Workers Scripts > Edit
   - Account > Workers KV Storage > Edit
5. Include your account in "Account Resources"
6. Create token and copy the value

**Set in GitHub:**
```bash
gh secret set CLOUDFLARE_API_TOKEN
# Paste the token when prompted
```

#### 1.2 Create DNS API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit zone DNS" template
4. Set permissions:
   - Zone > DNS > Edit
5. Include "All zones" or specific zone
6. Create token and copy the value

**Set in GitHub:**
```bash
gh secret set CLOUDFLARE_DNS_API_TOKEN
# Paste the token when prompted
```

#### 1.3 Get Account ID and Zone ID

1. Go to your Cloudflare dashboard
2. Select your domain (revelations.studio)
3. Account ID: Right column under "API"
4. Zone ID: Right column under "API"

**Set in GitHub:**
```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
# Paste your account ID

gh secret set CLOUDFLARE_ZONE_ID
# Paste your zone ID
```

### Step 2: Neon Database Secrets

The Neon GitHub integration auto-sets `NEON_API_KEY` and `NEON_PROJECT_ID`. You only need to set the production database URL:

1. Go to your Neon console: https://console.neon.tech
2. Select your production branch
3. Copy the connection string (with `-pooler` suffix)

**Set in GitHub:**
```bash
gh secret set NEON_PRODUCTION_URL
# Paste: postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/codex?sslmode=require
```

### Step 2.5: Cloudflare R2 Storage Secrets

R2 is used for media storage (videos, images, assets). You need to create R2 buckets and generate API credentials.

#### 2.5.1 Create R2 Buckets

1. Go to https://dash.cloudflare.com
2. Navigate to R2 Object Storage in the sidebar
3. Click "Create bucket"
4. Create the following buckets:

**Production Buckets:**
- `codex-media-production` - Media files (videos, audio)
- `codex-assets-production` - Static assets
- `codex-resources-production` - User resources
- `codex-platform-production` - Platform files

**Test Bucket:**
- `codex-media-test` - Used for CI tests and preview deployments

**Note:** Test bucket is shared between CI and preview environments for cost efficiency. Data is isolated via object key prefixes.

#### 2.5.2 Generate R2 API Credentials

1. Go to https://dash.cloudflare.com → R2
2. Click "Manage R2 API Tokens"
3. Click "Create API token"
4. Set permissions:
   - Token name: "Codex R2 API Access"
   - Permissions: "Admin Read & Write" (for all buckets)
   - TTL: Never expire (or set appropriate expiration)
5. Click "Create API Token"
6. Copy the following values:
   - **Access Key ID** (looks like: 32-character hex string)
   - **Secret Access Key** (looks like: 64-character base64 string)
   - **Account ID** (shown in the R2 dashboard overview)

**IMPORTANT:** Copy the Secret Access Key immediately - it won't be shown again!

#### 2.5.3 Set R2 Secrets in GitHub

```bash
# R2 Account ID (found in R2 dashboard overview)
gh secret set R2_ACCOUNT_ID
# Paste your R2 account ID (32-character hex)

# R2 API credentials
gh secret set R2_ACCESS_KEY_ID
# Paste your access key ID

gh secret set R2_SECRET_ACCESS_KEY
# Paste your secret access key
```

#### 2.5.4 Verify R2 Configuration

Test that credentials work:

```bash
# Install wrangler if not already installed
npm install -g wrangler

# Login to Cloudflare
wrangler login

# List your R2 buckets (should show all buckets you created)
wrangler r2 bucket list

# Expected output:
# [
#   { "name": "codex-media-production", "creation_date": "..." },
#   { "name": "codex-media-test", "creation_date": "..." },
#   ...
# ]
```

### Step 3: Application Secrets (Production)

#### 3.1 Generate Session Secrets

```bash
# Generate SESSION_SECRET
openssl rand -base64 32

# Generate BETTER_AUTH_SECRET
openssl rand -base64 32
```

**Set in GitHub:**
```bash
gh secret set SESSION_SECRET_PRODUCTION
# Paste first generated secret

gh secret set BETTER_AUTH_SECRET_PRODUCTION
# Paste second generated secret
```

#### 3.2 Stripe Production Secrets

1. Go to https://dashboard.stripe.com/apikeys
2. Switch to "Live mode" (top right)
3. Copy "Secret key"

**Set in GitHub:**
```bash
gh secret set STRIPE_PRODUCTION_KEY
# Paste sk_live_xxxxx
```

#### 3.3 Stripe Production Webhook Secrets

1. Go to https://dashboard.stripe.com/webhooks
2. Click on your production endpoint
3. Click "Reveal" next to "Signing secret"
4. Repeat for each webhook endpoint (payment, subscription, connect, customer, booking, dispute)

**Set in GitHub:**
```bash
gh secret set STRIPE_PRODUCTION_PAYMENT_WEBHOOK_SECRET
# Paste whsec_xxxxx

gh secret set STRIPE_PRODUCTION_SUBSCRIPTION_WEBHOOK_SECRET
# Paste whsec_xxxxx

gh secret set STRIPE_PRODUCTION_CONNECT_WEBHOOK_SECRET
# Paste whsec_xxxxx

gh secret set STRIPE_PRODUCTION_CUSTOMER_WEBHOOK_SECRET
# Paste whsec_xxxxx

gh secret set STRIPE_PRODUCTION_BOOKING_WEBHOOK_SECRET
# Paste whsec_xxxxx

gh secret set STRIPE_PRODUCTION_DISPUTE_WEBHOOK_SECRET
# Paste whsec_xxxxx
```

### Step 4: Application Secrets (Testing)

#### 4.1 Stripe Test Secrets

1. Go to https://dashboard.stripe.com/apikeys
2. Switch to "Test mode" (top right)
3. Copy "Secret key"

**Set in GitHub:**
```bash
gh secret set STRIPE_TEST_KEY
# Paste sk_test_xxxxx
```

#### 4.2 Stripe Test Webhook Secrets

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click on your test endpoint
3. Click "Reveal" next to "Signing secret"
4. Repeat for each webhook endpoint

**Set in GitHub:**
```bash
gh secret set STRIPE_TEST_PAYMENT_WEBHOOK_SECRET
gh secret set STRIPE_TEST_SUBSCRIPTION_WEBHOOK_SECRET
gh secret set STRIPE_TEST_CONNECT_WEBHOOK_SECRET
gh secret set STRIPE_TEST_CUSTOMER_WEBHOOK_SECRET
gh secret set STRIPE_TEST_BOOKING_WEBHOOK_SECRET
gh secret set STRIPE_TEST_DISPUTE_WEBHOOK_SECRET
```

#### 4.3 Preview Deployment Secrets

```bash
# Generate secret for preview deployments
openssl rand -base64 32

gh secret set SESSION_SECRET
# Paste generated secret
```

### Step 5: Turbo Remote Caching (Optional)

If using Vercel's remote caching for Turbo:

```bash
gh secret set TURBO_TOKEN
# Get from: https://vercel.com/account/tokens

gh variable set TURBO_TEAM
# Your Vercel team slug
```

---

## Cloudflare Worker Secrets

These secrets must be set for **each worker** using the Wrangler CLI.

### Prerequisites

Login to Wrangler:
```bash
wrangler login
```

### Worker: stripe-webhook-handler

```bash
cd workers/stripe-webhook-handler

# Production environment
wrangler secret put DATABASE_URL --env production
# Paste your production database URL (with -pooler)

wrangler secret put STRIPE_SECRET_KEY --env production
# Paste sk_live_xxxxx

wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_SUBSCRIPTION --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_CONNECT --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_CUSTOMER --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_BOOKING --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_DISPUTE --env production
# Paste each whsec_xxxxx when prompted

# Staging environment (optional)
wrangler secret put DATABASE_URL --env staging
# Paste staging database URL

wrangler secret put STRIPE_SECRET_KEY --env staging
# Paste sk_test_xxxxx (use test mode for staging)

# Repeat webhook secrets for staging...
```

### Worker: auth

```bash
cd workers/auth

# Production environment
wrangler secret put DATABASE_URL --env production
# Paste your production database URL (with -pooler)

wrangler secret put SESSION_SECRET --env production
# Paste your SESSION_SECRET_PRODUCTION value

wrangler secret put BETTER_AUTH_SECRET --env production
# Paste your BETTER_AUTH_SECRET_PRODUCTION value

# Staging environment (optional)
wrangler secret put DATABASE_URL --env staging
wrangler secret put SESSION_SECRET --env staging
wrangler secret put BETTER_AUTH_SECRET --env staging
```

### Worker: content-api

```bash
cd workers/content-api

# Production environment
wrangler secret put DATABASE_URL --env production
# Paste your production database URL (with -pooler)

wrangler secret put R2_ACCOUNT_ID --env production
# Paste your R2 account ID

wrangler secret put R2_ACCESS_KEY_ID --env production
# Paste your R2 access key ID

wrangler secret put R2_SECRET_ACCESS_KEY --env production
# Paste your R2 secret access key

wrangler secret put R2_BUCKET_MEDIA --env production
# Enter: codex-media-production

# Staging environment (optional)
wrangler secret put DATABASE_URL --env staging
# Paste staging database URL

wrangler secret put R2_ACCOUNT_ID --env staging
wrangler secret put R2_ACCESS_KEY_ID --env staging
wrangler secret put R2_SECRET_ACCESS_KEY --env staging
wrangler secret put R2_BUCKET_MEDIA --env staging
# Enter: codex-media-test (same as CI for cost efficiency)
```

### Worker: identity-api

```bash
cd workers/identity-api

# Production environment
wrangler secret put DATABASE_URL --env production
# Paste your production database URL (with -pooler)

# Staging environment (optional)
wrangler secret put DATABASE_URL --env staging
# Paste staging database URL
```

### Worker: codex-web

```bash
cd apps/web

# Production environment
wrangler secret put DATABASE_URL --env production
# Paste your production database URL (with -pooler)

# Staging environment (optional)
wrangler secret put DATABASE_URL --env staging
# Paste staging database URL
```

---

## KV Namespace Configuration

Cloudflare KV namespaces are used for rate limiting and session storage. You need to create these namespaces and update the worker configuration files.

### Step 1: Create KV Namespaces

#### Production Namespaces

```bash
# Rate limiting namespace (used by all API workers)
wrangler kv:namespace create "RATE_LIMIT_KV" --env production

# Output: Created namespace with ID: abc123...
# Save this ID for step 2

# Auth session namespace (used by auth worker)
wrangler kv:namespace create "AUTH_SESSION_KV" --env production

# Output: Created namespace with ID: def456...
# Save this ID for step 2
```

#### Staging Namespaces (Optional)

```bash
wrangler kv:namespace create "RATE_LIMIT_KV" --env staging
wrangler kv:namespace create "AUTH_SESSION_KV" --env staging
```

#### Preview Namespaces

```bash
wrangler kv:namespace create "RATE_LIMIT_KV" --preview
wrangler kv:namespace create "AUTH_SESSION_KV" --preview
```

### Step 2: Update Worker Configurations

After creating namespaces, you need to update the wrangler.jsonc files with the correct IDs.

#### Update: workers/content-api/wrangler.jsonc

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "RATE_LIMIT_KV",
      "id": "PASTE_PRODUCTION_RATE_LIMIT_KV_ID_HERE",
      "preview_id": "PASTE_PREVIEW_RATE_LIMIT_KV_ID_HERE"
    }
  ],
  "env": {
    "staging": {
      "kv_namespaces": [
        {
          "binding": "RATE_LIMIT_KV",
          "id": "PASTE_STAGING_RATE_LIMIT_KV_ID_HERE"
        }
      ]
    }
  }
}
```

#### Update: workers/identity-api/wrangler.jsonc

Same as content-api above.

#### Update: workers/auth/wrangler.jsonc

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "AUTH_SESSION_KV",
      "id": "PASTE_PRODUCTION_AUTH_SESSION_KV_ID_HERE",
      "preview_id": "PASTE_PREVIEW_AUTH_SESSION_KV_ID_HERE"
    },
    {
      "binding": "RATE_LIMIT_KV",
      "id": "PASTE_PRODUCTION_RATE_LIMIT_KV_ID_HERE",
      "preview_id": "PASTE_PREVIEW_RATE_LIMIT_KV_ID_HERE"
    }
  ],
  "env": {
    "staging": {
      "kv_namespaces": [
        {
          "binding": "AUTH_SESSION_KV",
          "id": "PASTE_STAGING_AUTH_SESSION_KV_ID_HERE"
        },
        {
          "binding": "RATE_LIMIT_KV",
          "id": "PASTE_STAGING_RATE_LIMIT_KV_ID_HERE"
        }
      ]
    }
  }
}
```

### Step 3: Commit Configuration Changes

After updating all wrangler.jsonc files:

```bash
git add workers/*/wrangler.jsonc
git commit -m "chore: Update KV namespace IDs"
git push
```

---

## Verification Steps

### 1. Verify GitHub Secrets

```bash
# List all secrets (values will be hidden)
gh secret list

# Expected output should include:
# CLOUDFLARE_API_TOKEN
# CLOUDFLARE_DNS_API_TOKEN
# CLOUDFLARE_ACCOUNT_ID
# CLOUDFLARE_ZONE_ID
# NEON_PRODUCTION_URL
# SESSION_SECRET_PRODUCTION
# BETTER_AUTH_SECRET_PRODUCTION
# STRIPE_PRODUCTION_KEY
# ... (all Stripe webhook secrets)
# ... (all test secrets)
```

### 2. Verify Cloudflare Worker Secrets

```bash
# Check secrets for each worker
wrangler secret list --env production
# Run this in each worker directory
```

### 3. Verify KV Namespaces

```bash
# List all KV namespaces
wrangler kv:namespace list

# Expected output:
# [
#   { "id": "abc123...", "title": "RATE_LIMIT_KV" },
#   { "id": "def456...", "title": "AUTH_SESSION_KV" },
#   ...
# ]
```

### 4. Test Deployment to Staging

Before deploying to production, test the configuration:

```bash
# Deploy each worker to staging
cd workers/auth
wrangler deploy --env staging

cd ../content-api
wrangler deploy --env staging

cd ../identity-api
wrangler deploy --env staging

cd ../stripe-webhook-handler
wrangler deploy --env staging

cd ../../apps/web
wrangler deploy --env staging
```

### 5. Verify Health Endpoints

```bash
# Test each staging worker
curl https://auth-staging.revelations.studio/health
curl https://content-api-staging.revelations.studio/health
curl https://identity-api-staging.revelations.studio/health
curl https://api-staging.revelations.studio/health
curl https://codex-staging.revelations.studio
```

Expected response for /health endpoints:
```json
{
  "status": "healthy",
  "service": "service-name",
  "version": "1.0.0",
  "timestamp": "2025-01-18T12:00:00.000Z"
}
```

---

## Troubleshooting

### Error: "Namespace not found"

**Cause:** KV namespace ID in wrangler.jsonc doesn't exist in your account.

**Solution:**
1. Run `wrangler kv:namespace list` to see available namespaces
2. Update wrangler.jsonc with correct IDs
3. Or create missing namespaces: `wrangler kv:namespace create "NAMESPACE_NAME"`

### Error: "Secret not found: DATABASE_URL"

**Cause:** DATABASE_URL secret not set for worker.

**Solution:**
```bash
cd workers/[worker-name]
wrangler secret put DATABASE_URL --env production
```

### Error: "Invalid connection string"

**Cause:** DATABASE_URL missing required parameters or incorrect format.

**Solution:**
Ensure URL format is:
```
postgresql://user:password@host.neon.tech:5432/dbname?sslmode=require
```

For Cloudflare Workers, append `-pooler` to hostname:
```
postgresql://user:password@host.neon.tech-pooler:5432/dbname?sslmode=require
```

### Error: "Authentication failed" (Cloudflare API)

**Cause:** CLOUDFLARE_API_TOKEN has insufficient permissions or is expired.

**Solution:**
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Verify token permissions include:
   - Workers Scripts: Edit
   - Workers KV Storage: Edit
3. If expired, create new token and update GitHub secret

### Error: "Zone not found" (DNS operations)

**Cause:** CLOUDFLARE_ZONE_ID incorrect or DNS token lacks permissions.

**Solution:**
1. Verify zone ID: https://dash.cloudflare.com → Select domain → Copy Zone ID
2. Update GitHub secret: `gh secret set CLOUDFLARE_ZONE_ID`
3. Verify DNS token has "Zone DNS Edit" permission

### Preview Deployment Fails with CORS Error

**Cause:** Preview URL not included in CORS allowed origins.

**Solution:**
CORS middleware automatically reads from environment variables. Ensure your preview deployment sets:
- `WEB_APP_URL`: https://codex-preview-{PR}.revelations.studio
- `API_URL`: https://api-preview-{PR}.revelations.studio

This is handled automatically by the preview deployment workflow.

---

## Secret Rotation Procedure

To rotate secrets without downtime:

1. **Generate new secret**
   ```bash
   openssl rand -base64 32
   ```

2. **Set new secret in GitHub Actions**
   ```bash
   gh secret set SECRET_NAME_PRODUCTION
   ```

3. **Set new secret in Cloudflare Workers** (without deploying)
   ```bash
   cd workers/[worker-name]
   wrangler secret put SECRET_NAME --env production
   ```

4. **Deploy workers with new secret**
   ```bash
   wrangler deploy --env production
   ```

5. **Verify new secret works**
   Test the service to ensure everything works correctly.

6. **Remove old secret from GitHub Actions**
   Only after confirming the new secret works.

### R2 API Key Rotation

To rotate R2 credentials without downtime:

1. **Generate new R2 API token**
   - Go to https://dash.cloudflare.com → R2 → Manage R2 API Tokens
   - Create new token with same permissions
   - Copy new Access Key ID and Secret Access Key

2. **Set new secrets in GitHub**
   ```bash
   gh secret set R2_ACCESS_KEY_ID
   gh secret set R2_SECRET_ACCESS_KEY
   ```

3. **Set new secrets in Cloudflare Workers**
   ```bash
   cd workers/content-api
   wrangler secret put R2_ACCESS_KEY_ID --env production
   wrangler secret put R2_SECRET_ACCESS_KEY --env production
   ```

4. **Deploy workers with new credentials**
   - Push to main branch to trigger production deployment
   - Or manually deploy: `wrangler deploy --env production`

5. **Verify new credentials work**
   - Test content access endpoints
   - Check worker logs for R2 errors: `wrangler tail content-api-production`

6. **Revoke old R2 API token**
   - Go to R2 → Manage R2 API Tokens
   - Delete old token only after verifying new one works

**Impact of R2 Key Rotation:**
- Affects: content-api worker (presigned URL generation)
- Downtime: None if done correctly (new secrets deployed before old revoked)
- Testing: Test in staging first before production rotation

---

## Security Best Practices

1. **Never commit secrets to git**
   - Secrets should only exist in GitHub Secrets and Cloudflare Workers
   - Use `.env.example` with placeholder values for documentation

2. **Use environment-specific secrets**
   - Production secrets should differ from staging/test
   - Never use production Stripe keys in staging

3. **Rotate secrets regularly**
   - API tokens: Every 90 days
   - Session secrets: Every 180 days
   - Database passwords: Every 180 days

4. **Monitor secret usage**
   - Review Cloudflare audit logs
   - Review GitHub Actions logs
   - Set up alerts for authentication failures

5. **Principle of least privilege**
   - API tokens should have minimum required permissions
   - Separate tokens for deployment vs DNS management

---

## Checklist

Use this checklist to ensure all secrets are configured:

### GitHub Secrets

- [ ] CLOUDFLARE_API_TOKEN
- [ ] CLOUDFLARE_DNS_API_TOKEN
- [ ] CLOUDFLARE_ACCOUNT_ID
- [ ] CLOUDFLARE_ZONE_ID
- [ ] NEON_PRODUCTION_URL
- [ ] R2_ACCOUNT_ID
- [ ] R2_ACCESS_KEY_ID
- [ ] R2_SECRET_ACCESS_KEY
- [ ] SESSION_SECRET_PRODUCTION
- [ ] BETTER_AUTH_SECRET_PRODUCTION
- [ ] STRIPE_PRODUCTION_KEY
- [ ] STRIPE_PRODUCTION_PAYMENT_WEBHOOK_SECRET
- [ ] STRIPE_PRODUCTION_SUBSCRIPTION_WEBHOOK_SECRET
- [ ] STRIPE_PRODUCTION_CONNECT_WEBHOOK_SECRET
- [ ] STRIPE_PRODUCTION_CUSTOMER_WEBHOOK_SECRET
- [ ] STRIPE_PRODUCTION_BOOKING_WEBHOOK_SECRET
- [ ] STRIPE_PRODUCTION_DISPUTE_WEBHOOK_SECRET
- [ ] STRIPE_TEST_KEY
- [ ] STRIPE_TEST_PAYMENT_WEBHOOK_SECRET
- [ ] STRIPE_TEST_SUBSCRIPTION_WEBHOOK_SECRET
- [ ] STRIPE_TEST_CONNECT_WEBHOOK_SECRET
- [ ] STRIPE_TEST_CUSTOMER_WEBHOOK_SECRET
- [ ] STRIPE_TEST_BOOKING_WEBHOOK_SECRET
- [ ] STRIPE_TEST_DISPUTE_WEBHOOK_SECRET
- [ ] SESSION_SECRET

### Cloudflare Worker Secrets

- [ ] stripe-webhook-handler (production): DATABASE_URL, STRIPE_SECRET_KEY, all webhook secrets
- [ ] auth (production): DATABASE_URL, SESSION_SECRET, BETTER_AUTH_SECRET
- [ ] content-api (production): DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_MEDIA
- [ ] identity-api (production): DATABASE_URL
- [ ] codex-web (production): DATABASE_URL

### KV Namespaces

- [ ] RATE_LIMIT_KV (production) created
- [ ] AUTH_SESSION_KV (production) created
- [ ] RATE_LIMIT_KV (preview) created
- [ ] AUTH_SESSION_KV (preview) created
- [ ] All wrangler.jsonc files updated with correct IDs

### R2 Buckets

- [ ] codex-media-production bucket created
- [ ] codex-assets-production bucket created
- [ ] codex-resources-production bucket created
- [ ] codex-platform-production bucket created
- [ ] codex-media-test bucket created
- [ ] R2 API credentials generated and secrets set in GitHub
- [ ] R2 bucket bindings configured in wrangler.jsonc files

### Verification

- [ ] All GitHub secrets listed: `gh secret list`
- [ ] All worker secrets verified: `wrangler secret list --env production`
- [ ] All KV namespaces exist: `wrangler kv:namespace list`
- [ ] Staging deployment successful
- [ ] All health endpoints responding

---

## Next Steps

After completing this setup:

1. **Review DNS configuration**: See `design/infrastructure/CLOUDFLARE-SETUP.md`
2. **Test preview deployment**: Open a PR and verify preview deployment works
3. **Deploy to production**: Merge to main and monitor deployment
4. **Set up monitoring**: Configure error tracking and alerting

For questions or issues, consult:
- [CI/CD Documentation](design/infrastructure/CICD.md)
- [Environment Management](design/infrastructure/EnvironmentManagement.md)
- [Cloudflare Setup Guide](design/infrastructure/CLOUDFLARE-SETUP.md)
