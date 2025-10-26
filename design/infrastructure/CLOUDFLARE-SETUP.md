# Cloudflare Setup Checklist - Phase 1 MVP (IaC Approach)

**Status**: Ready for Implementation
**Last Updated**: 2025-10-26
**Document Version**: 2.0 - CLI-First

This document provides step-by-step instructions for setting up Cloudflare resources using **Wrangler CLI** (Infrastructure as Code). UI instructions included as fallback only.

---

## Overview

You will create via CLI:
- **4 R2 Buckets** (media, resources, assets, platform)
- **1 KV Namespace** (for sessions, rate limiting, and caching)
- **Environment variables** (via Cloudflare Pages API)
- **No Queues** (disabled for Phase 1 MVP - cost optimization)

**Estimated Setup Time**: 15-20 minutes (CLI approach is faster)
**Total Monthly Cost**: ~$0.30 (within free tier for MVP)

---

## Prerequisites

✅ **Already Complete:**
- Cloudflare Pages deployed (confirmed working)
- GitHub repository connected
- SvelteKit adapter configured

✅ **You Will Need:**
- Cloudflare account with API token access
- `wrangler` CLI installed: `npm install -g wrangler` or `pnpm add -g wrangler`
- `curl` command available (for API calls)
- Text editor to save configuration values

---

# QUICK START (Copy-Paste Commands)

If you're impatient, run these in order:

```bash
# 1. Authenticate with Cloudflare
wrangler login

# 2. Create all 4 R2 buckets
wrangler r2 bucket create codex-media-production
wrangler r2 bucket create codex-resources-production
wrangler r2 bucket create codex-assets-production
wrangler r2 bucket create codex-platform-production

# 3. Create KV namespace
wrangler kv:namespace create CODEX_KV

# 4. Get your Account ID
ACCOUNT_ID=$(wrangler whoami --json | jq -r ".account.id")
echo "Your Account ID: $ACCOUNT_ID"

# 5. Create R2 API Token (see instructions below for full details)
# Then set environment variables in Cloudflare Pages

# 6. All done! Verify below.
```

---

# PHASE 1: Authentication & Account Setup

## Step 1.1: Install Wrangler CLI

```bash
# Using npm
npm install -g wrangler

# OR using pnpm (recommended)
pnpm add -g wrangler

# Verify installation
wrangler --version
```

---

## Step 1.2: Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser to authorize Cloudflare CLI access. Follow the prompts and you'll be authenticated.

✅ **Authenticated**

---

## Step 1.3: Get Your Cloudflare Account ID

```bash
# Get account info as JSON
wrangler whoami --json

# Extract just the account ID
ACCOUNT_ID=$(wrangler whoami --json | jq -r ".account.id")
echo "Account ID: $ACCOUNT_ID"

# Save this value - you'll need it later
```

**Expected output**:
```json
{
  "account": {
    "id": "abc123def456ghi789",
    "name": "your-email@example.com"
  }
}
```

Save the `id` value for later use.

✅ **Account ID obtained**

---

# PHASE 2: Create R2 Buckets (CLI)

All buckets created with one command each.

## Step 2.1: Create `codex-media-production` Bucket

```bash
wrangler r2 bucket create codex-media-production
```

**Expected output**:
```
✓ Successfully created bucket: codex-media-production
```

✅ **Bucket created**

---

## Step 2.2: Create `codex-resources-production` Bucket

```bash
wrangler r2 bucket create codex-resources-production
```

✅ **Bucket created**

---

## Step 2.3: Create `codex-assets-production` Bucket

```bash
wrangler r2 bucket create codex-assets-production
```

✅ **Bucket created**

---

## Step 2.4: Create `codex-platform-production` Bucket

```bash
wrangler r2 bucket create codex-platform-production
```

✅ **Bucket created**

---

## Step 2.5: Verify All Buckets Created

```bash
wrangler r2 bucket list
```

**Expected output**:
```
codex-assets-production
codex-media-production
codex-platform-production
codex-resources-production
```

If all 4 appear, proceed to Step 3. If any are missing, create them above.

✅ **All buckets verified**

---

# PHASE 3: Configure CORS for Upload Support

CORS must be configured on each bucket that accepts direct uploads.

## Step 3.1: Create CORS Configuration File

Create file: `cors-config.json`

```json
[
  {
    "AllowedOrigins": ["https://codex.example.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

**Replace `https://codex.example.com`** with your actual domain:
- For Cloudflare Pages: `https://codex-abc123.pages.dev`
- For custom domain: `https://yourdomain.com`

---

## Step 3.2: Apply CORS to All Buckets (Using API)

Since Wrangler doesn't have a CORS command yet, use Cloudflare API:

```bash
# Set these variables
ACCOUNT_ID="your-account-id-from-step-1.3"
API_TOKEN="your-api-token-from-step-5"
CORS_FILE="cors-config.json"

# Apply CORS to each bucket
for BUCKET in codex-media-production codex-resources-production codex-assets-production codex-platform-production; do
  curl -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/$BUCKET/cors" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @$CORS_FILE
done
```

**Or apply manually via UI** (if curl is annoying):

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **R2** → Click each bucket → **Settings** → **CORS configuration** → **Edit**
3. Paste the JSON from `cors-config.json`
4. Click **Save**

✅ **CORS configured for all buckets**

---

# PHASE 4: Create KV Namespace (CLI)

```bash
wrangler kv:namespace create CODEX_KV
```

**Expected output**:
```
✓ Successfully created namespace CODEX_KV
[[kv_namespaces]]
binding = "CODEX_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
preview_id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

**Save these values** - you'll need the `id` in Step 5.

✅ **KV namespace created**

---

## Step 4.2: Get KV Namespace ID (If Needed)

If you need to retrieve the namespace ID later:

```bash
# List all KV namespaces (as JSON for easy parsing)
wrangler kv:namespace list --json

# Extract just the production namespace ID
wrangler kv:namespace list --json | jq -r '.[] | select(.title == "CODEX_KV") | .id'
```

✅ **KV Namespace ID obtained**

---

# PHASE 5: Generate R2 API Token (CLI + Manual)

R2 API tokens must be created via UI or Cloudflare API (not Wrangler). Here's the quickest way:

## Step 5.1: Create Token via Cloudflare API

```bash
# Use your existing API token (create one via UI first if needed)
# Or use this to create a new one programmatically:

API_TOKEN_NAME="codex-r2-api-token"
ACCOUNT_ID="your-account-id-from-step-1.3"

# Create S3-compatible API token
curl -X POST https://api.cloudflare.com/client/v4/user/tokens \
  -H "Authorization: Bearer YOUR_GLOBAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ 
    "name": "'$API_TOKEN_NAME'",
    "ttl": 31536000,
    "policies": [
      {
        "effect": "allow",
        "resources": {
          "com.cloudflare.api/account/r2/*": "*"
        },
        "permissions": [
          "com.cloudflare.api.account.r2.bucket.list",
          "com.cloudflare.api.account.r2.bucket.read",
          "com.cloudflare.api.account.r2.bucket.write"
        ]
      }
    ]
  }'
```

---

## Step 5.2: Create Token via UI (Easier)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **My Profile** (top right) → **API Tokens**
3. **Create Token**
4. Use template: **"Edit Cloudflare R2"** → **Use template**
5. Leave defaults selected:
   - Account Resources: Include All Accounts
   - TTL: 1 year (or your preference)
6. Click **Create Token**
7. Copy the token value (you'll see it once)

✅ **API Token created**

---

## Step 5.3: Create S3 API Token (For R2 Direct Access)

This is what you use in your app code:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **R2** (left sidebar) → **Settings** → **API tokens** → **Create API token**
3. Select: **S3 API token**
4. Give it a name: `codex-r2-s3-token`
5. TTL: 1 year
6. Click **Create API token**
7. You'll see:
   ```
   Access Key ID: xxxxxxxxxxxxx
   Secret Access Key: xxxxxxxxxxxxx
   Endpoint: https://[account-id].r2.cloudflarestorage.com
   ```

**Copy all three values** and save them securely.

✅ **S3 API Token created**

---

# PHASE 6: Set Environment Variables in Cloudflare Pages (CLI)

Use Cloudflare API to set environment variables programmatically:

## Step 6.1: Create Environment Variables Script

Create file: `setup-env-vars.sh`

```bash
#!/bin/bash

# Configuration
ACCOUNT_ID="your-account-id"
PROJECT_NAME="codex"
CLOUDFLARE_API_TOKEN="your-api-token-from-step-5.1"

# R2 Configuration
R2_ACCOUNT_ID="your-r2-account-id"
R2_ACCESS_KEY_ID="your-access-key-from-step-5.3"
R2_SECRET_ACCESS_KEY="your-secret-key-from-step-5.3"

# Auth Configuration
AUTH_SECRET=$(openssl rand -hex 32)
echo "Generated AUTH_SECRET: $AUTH_SECRET"

# Find your Pages domain
PAGES_DOMAIN="codex-abc123.pages.dev"  # Replace with your actual domain
AUTH_URL="https://$PAGES_DOMAIN"

# Get DATABASE_URL from Neon (see Phase 7)
DATABASE_URL="postgresql://user:password@host/database"

# Set production environment variables
echo "Setting production environment variables..."
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments/rollback" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ 
    "environment": "production",
    "variables": {
      "R2_ACCOUNT_ID": "'$R2_ACCOUNT_ID'",
      "R2_ACCESS_KEY_ID": "'$R2_ACCESS_KEY_ID'",
      "R2_SECRET_ACCESS_KEY": "'$R2_SECRET_ACCESS_KEY'",
      "R2_BUCKET_MEDIA": "codex-media-production",
      "R2_BUCKET_RESOURCES": "codex-resources-production",
      "R2_BUCKET_ASSETS": "codex-assets-production",
      "R2_BUCKET_PLATFORM": "codex-platform-production",
      "DATABASE_URL": "'$DATABASE_URL'",
      "AUTH_SECRET": "'$AUTH_SECRET'",
      "AUTH_URL": "'$AUTH_URL'"
    }
  }'

# Set preview environment variables
echo "Setting preview environment variables..."
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments/rollback" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ 
    "environment": "preview",
    "variables": {
      "R2_ACCOUNT_ID": "'$R2_ACCOUNT_ID'",
      "R2_ACCESS_KEY_ID": "'$R2_ACCESS_KEY_ID'",
      "R2_SECRET_ACCESS_KEY": "'$R2_SECRET_ACCESS_KEY'",
      "R2_BUCKET_MEDIA": "codex-media-production",
      "R2_BUCKET_RESOURCES": "codex-resources-production",
      "R2_BUCKET_ASSETS": "codex-assets-production",
      "R2_BUCKET_PLATFORM": "codex-platform-production",
      "DATABASE_URL": "'$DATABASE_URL'",
      "AUTH_SECRET": "'$AUTH_SECRET'",
      "AUTH_URL": "'$AUTH_URL'"
    }
  }'

echo "✅ Environment variables set!"
```

---

## Step 6.2: Run the Script

```bash
# Update values in setup-env-vars.sh first!
chmod +x setup-env-vars.sh
./setup-env-vars.sh
```

---

## Step 6.3: Or Set Manually via UI

If the API approach is wonky, use UI:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Pages** → **codex** → **Settings** → **Environment variables**
3. Click **Production** tab
4. Add these variables:

```
R2_ACCOUNT_ID = <from-step-5.3>
R2_ACCESS_KEY_ID = <from-step-5.3>
R2_SECRET_ACCESS_KEY = <from-step-5.3>
R2_BUCKET_MEDIA = codex-media-production
R2_BUCKET_RESOURCES = codex-resources-production
R2_BUCKET_ASSETS = codex-assets-production
R2_BUCKET_PLATFORM = codex-platform-production
DATABASE_URL = <from-neon-step-7>
AUTH_SECRET = <run: openssl rand -hex 32>
AUTH_URL = https://<your-pages-domain>.pages.dev
```

5. Click **Preview** tab and add same variables

✅ **Environment variables set**

---

# PHASE 7: Configure Neon Postgres Database

Neon doesn't have CLI yet, so this is UI only.

## Step 7.1: Create Neon Account

1. Go to [Neon Console](https://console.neon.tech/)
2. **Sign up** with email or GitHub
3. Create project: **codex-production**

---

## Step 7.2: Get Production Connection String

1. In Neon console, go to **Connection string**
2. Copy the string:
```
postgresql://user:password@host/database
```

---

## Step 7.3: Create Staging Branch (Optional)

1. Click **Branches** (left sidebar)
2. **Create branch** → Name: `staging`
3. Copy staging connection string

---

## Step 7.4: Update Cloudflare Pages Environment Variables

Update `DATABASE_URL` in both Production and Preview environments with your Neon connection string.

✅ **Database configured**

---

# PHASE 8: Test Configuration (CLI)

## Step 8.1: Test R2 Upload (CLI)

```bash
# Upload a test file
echo "test content" > test.txt

# Using AWS CLI (S3-compatible)
aws s3 cp test.txt \
  s3://codex-media-production/test-upload.txt \
  --endpoint-url https://$ACCOUNT_ID.r2.cloudflarestorage.com \
  --access-key $R2_ACCESS_KEY_ID \
  --secret-key $R2_SECRET_ACCESS_KEY

# Or using Wrangler directly (if you have R2 bindings)
wrangler r2 object put test.txt --bucket codex-media-production

# Clean up
rm test.txt
```

✅ **R2 upload working**

---

## Step 8.2: Test KV (CLI)

```bash
# Write a test key
wrangler kv:key put --namespace-id CODEX_KV test-key test-value

# Read it back
wrangler kv:key get test-key --namespace-id CODEX_KV

# Delete it
wrangler kv:key delete test-key --namespace-id CODEX_KV
```

✅ **KV working**

---

## Step 8.3: Test Pages Deployment

```bash
# Check deployment status
curl -s https://codex-abc123.pages.dev | head -20

# Should see HTML from your SvelteKit app
```

✅ **Pages deployment working**

---

# PHASE 9: Create Infrastructure as Code Files

These files go in your repo for future automation.

## Step 9.1: Create `scripts/setup-cloudflare.sh`

This script documents and can re-run all infrastructure setup:

```bash
#!/bin/bash
set -e

echo "🚀 Codex Cloudflare Setup Script"
echo "=================================="

# Check prerequisites
if ! command -v wrangler &> /dev/null; then
  echo "❌ wrangler not found. Install with: npm install -g wrangler"
  exit 1
fi

# Authenticate
echo "1️⃣  Authenticating with Cloudflare..."
wrangler login

# Get account ID
ACCOUNT_ID=$(wrangler whoami --json | jq -r ".account.id")
echo "✅ Account ID: $ACCOUNT_ID"

# Create buckets
echo "2️⃣  Creating R2 buckets..."
for BUCKET in codex-media-production codex-resources-production codex-assets-production codex-platform-production; do
  wrangler r2 bucket create $BUCKET || echo "⚠️  Bucket $BUCKET may already exist"
done
echo "✅ R2 buckets created"

# Verify buckets
echo "3️⃣  Verifying buckets..."
wrangler r2 bucket list

# Create KV namespace
echo "4️⃣  Creating KV namespace..."
wrangler kv:namespace create CODEX_KV || echo "⚠️  Namespace may already exist"
echo "✅ KV namespace created"

# Instructions for manual steps
echo ""
echo "❓ Manual steps remaining:"
echo ""
echo "1. Create R2 API token:"
echo "   - Dashboard → R2 → Settings → API tokens → Create API token (S3)"
echo "   - Save: Access Key ID, Secret Access Key"
echo ""
echo "2. Set environment variables in Cloudflare Pages:"
echo "   - Dashboard → Pages → codex → Settings → Environment variables"
echo "   - Production & Preview tabs"
echo "   - Add R2 credentials, AUTH_SECRET, AUTH_URL, DATABASE_URL"
echo ""
echo "3. Create Neon Postgres database:"
echo "   - console.neon.tech → Create project → Get connection string"
echo ""
echo "4. Test:"
echo "   - wrangler r2 object put test.txt --bucket codex-media-production"
echo "   - wrangler kv:key put --namespace-id CODEX_KV test-key test-value"
echo ""
echo "✅ Infrastructure setup complete!"
```

---

## Step 9.2: Create `scripts/verify-cloudflare.sh`

Script to verify all resources exist:

```bash
#!/bin/bash

echo "🔍 Verifying Cloudflare Infrastructure"
echo "======================================