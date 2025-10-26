# Cloudflare Setup Checklist - Phase 1 MVP

**Status**: Ready for Implementation
**Last Updated**: 2025-10-26
**Document Version**: 1.0

This document provides step-by-step instructions for setting up Cloudflare resources for Codex deployment. Follow these instructions in order.

---

## Overview

You will create:
- **4 R2 Buckets** (media, resources, assets, platform)
- **1 KV Namespace** (for sessions, rate limiting, and caching)
- **No Queues** (disabled for Phase 1 MVP - cost optimization)

**Estimated Setup Time**: 20-30 minutes
**Total Monthly Cost**: ~$0.30 (within free tier for MVP)

---

## Prerequisites

✅ **Already Complete:**
- Cloudflare Pages deployed (confirmed working)
- GitHub repository connected
- SvelteKit adapter configured

✅ **You Will Need:**
- Cloudflare Dashboard access
- R2 API credentials (to be generated)
- Text editor to save configuration values

---

# PHASE 1: Create R2 Buckets

## Step 1.1: Create `codex-media-production` Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2** in the left sidebar
3. Click **Create bucket**
4. **Bucket name**: `codex-media-production`
5. **Region**: Choose closest to your users (or leave default)
6. Click **Create bucket**

✅ **Bucket created** - Stores original and transcoded media files

---

## Step 1.2: Create `codex-resources-production` Bucket

1. In R2 dashboard, click **Create bucket** again
2. **Bucket name**: `codex-resources-production`
3. **Region**: Same as Step 1.1 (consistency)
4. Click **Create bucket**

✅ **Bucket created** - Stores PDFs, workbooks, downloadable files

---

## Step 1.3: Create `codex-assets-production` Bucket

1. In R2 dashboard, click **Create bucket** again
2. **Bucket name**: `codex-assets-production`
3. **Region**: Same as previous buckets
4. Click **Create bucket**

✅ **Bucket created** - Stores thumbnails, logos, branding images

---

## Step 1.4: Create `codex-platform-production` Bucket

1. In R2 dashboard, click **Create bucket** again
2. **Bucket name**: `codex-platform-production`
3. **Region**: Same as previous buckets
4. Click **Create bucket**

✅ **Bucket created** - Stores platform-wide assets (email logos, legal docs)

---

## Step 1.5: Verify All Buckets Created

In R2 dashboard, you should now see:
```
✓ codex-media-production
✓ codex-resources-production
✓ codex-assets-production
✓ codex-platform-production
```

If all 4 appear, proceed to Step 2. If any are missing, go back and create them.

---

# PHASE 2: Configure CORS for Upload Support

Each bucket that accepts direct uploads needs CORS enabled. Follow these steps for each bucket.

## Step 2.1: Configure CORS for `codex-media-production`

1. Click on **codex-media-production** bucket
2. Go to **Settings** tab
3. Scroll to **CORS configuration**
4. Click **Edit**
5. Enter the following JSON:

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

6. Replace `https://codex.example.com` with your actual domain (e.g., `https://mysite.pages.dev` for now)
7. Click **Save**

✅ **CORS enabled** - Allows direct browser uploads to R2

---

## Step 2.2: Configure CORS for `codex-resources-production`

1. Click on **codex-resources-production** bucket
2. Go to **Settings** tab
3. Scroll to **CORS configuration**
4. Click **Edit**
5. Enter the same JSON as Step 2.1:

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

6. Replace domain with your actual domain
7. Click **Save**

✅ **CORS enabled**

---

## Step 2.3: Configure CORS for `codex-assets-production`

1. Click on **codex-assets-production** bucket
2. Go to **Settings** tab
3. Scroll to **CORS configuration**
4. Click **Edit**
5. Enter the same JSON as Steps 2.1-2.2
6. Click **Save**

✅ **CORS enabled**

---

## Step 2.4: Configure CORS for `codex-platform-production`

1. Click on **codex-platform-production** bucket
2. Go to **Settings** tab
3. Scroll to **CORS configuration**
4. Click **Edit**
5. Enter the same JSON
6. Click **Save**

✅ **CORS enabled** - All buckets now support uploads

---

# PHASE 3: Generate R2 API Credentials

You need API credentials to access R2 from your SvelteKit application.

## Step 3.1: Create R2 API Token

1. In Cloudflare Dashboard, go to **My Profile** (top right corner)
2. Click **API Tokens**
3. Click **Create Token**
4. Under **API token templates**, find **"Edit Cloudflare R2"**
5. Click **Use template**

---

## Step 3.2: Configure Token Permissions

On the token creation page:

**Permissions:**
- R2 → All buckets → `read`
- R2 → All buckets → `write`
- R2 → All buckets → `list`

(Should be pre-selected if you used the template)

**Account Resources:**
- Select **Include All accounts** OR select your specific account

**TTL (Time to Live):**
- Set to **1 year** (or your preference for production)

---

## Step 3.3: Get Access Key ID

1. Scroll down to **API Token Details**
2. You'll see options for:
   - **Access Key ID**
   - **Secret Access Key**

3. Click **Create S3 API Token** button
4. On the next page, you'll see:
   ```
   Access Key ID: xxxxxxxxxxxxxxx
   Secret Access Key: xxxxxxxxxxxxxxx
   Endpoint: https://[account-id].r2.cloudflarestorage.com
   ```

5. **Copy and save** these three values in a secure location (password manager, .env file, etc.)

✅ **Credentials generated**

---

## Step 3.4: Find Your Cloudflare Account ID

1. Go back to Dashboard home
2. Look for **Account ID** on the right sidebar (usually bottom right)
3. Click to copy it
4. Save this value - you'll need it soon

✅ **Account ID saved**

---

# PHASE 4: Create KV Namespace

KV is used for session caching, rate limiting, and general application cache. Start with one unified namespace.

## Step 4.1: Create KV Namespace

1. In Cloudflare Dashboard, navigate to **Workers & Pages** → **KV** (left sidebar)
2. Click **Create a namespace**
3. **Namespace name**: `CODEX_KV`
4. Click **Create**

✅ **KV namespace created**

---

## Step 4.2: Get KV Namespace ID

1. In KV dashboard, find `CODEX_KV` in the list
2. Click on it
3. Look for **Namespace ID** in the details
4. Copy and save this value

✅ **KV Namespace ID saved**

---

# PHASE 5: Set Environment Variables in Cloudflare Pages

Now you'll configure environment variables so your SvelteKit app can access R2 and KV.

## Step 5.1: Navigate to Pages Settings

1. Go to **Cloudflare Dashboard**
2. Click **Pages** (left sidebar)
3. Click your project: **codex**
4. Click **Settings** (top tabs)
5. Click **Environment variables** (left sidebar)

---

## Step 5.2: Add Production Environment Variables

Click **Production** tab and add these variables:

```
R2_ACCOUNT_ID = <your-account-id-from-step-3.4>
R2_ACCESS_KEY_ID = <access-key-id-from-step-3.3>
R2_SECRET_ACCESS_KEY = <secret-access-key-from-step-3.3>
R2_BUCKET_MEDIA = codex-media-production
R2_BUCKET_RESOURCES = codex-resources-production
R2_BUCKET_ASSETS = codex-assets-production
R2_BUCKET_PLATFORM = codex-platform-production

DATABASE_URL = <leave-empty-for-now>
AUTH_SECRET = <generate-below>
AUTH_URL = https://<your-pages-domain>.pages.dev
```

### Generate AUTH_SECRET

Run this in your terminal:

```bash
openssl rand -hex 32
```

Copy the output (a long hexadecimal string) and paste it as `AUTH_SECRET` value.

### For DATABASE_URL

Leave this empty for now - you'll configure Neon Postgres in a separate step.

### For AUTH_URL

Find your Pages domain:
1. Go to **Cloudflare Pages** → **codex** → **Deployments**
2. Look for the live deployment URL (e.g., `https://codex-abc123.pages.dev`)
3. Use that as AUTH_URL

---

## Step 5.3: Add Preview Environment Variables

Click **Preview** tab and add these:

```
R2_ACCOUNT_ID = <same-as-production>
R2_ACCESS_KEY_ID = <same-as-production>
R2_SECRET_ACCESS_KEY = <same-as-production>
R2_BUCKET_MEDIA = codex-media-production
R2_BUCKET_RESOURCES = codex-resources-production
R2_BUCKET_ASSETS = codex-assets-production
R2_BUCKET_PLATFORM = codex-platform-production

DATABASE_URL = <leave-empty-for-now>
AUTH_SECRET = <same-as-production>
AUTH_URL = https://<your-pages-domain>.pages.dev
```

(Same values as production for MVP)

✅ **Environment variables configured**

---

# PHASE 6: Configure Neon Postgres Database

You need a production database for your application.

## Step 6.1: Create Neon Account

1. Go to [Neon Console](https://console.neon.tech/)
2. Click **Sign up**
3. Create account with email/GitHub
4. Create your first project: **codex-production**

---

## Step 6.2: Create Production Database

1. In Neon console, you'll see your default database
2. Leave it as **postgres** (or rename to **codex**)
3. Note the connection string shown:

```
postgresql://user:password@host/database
```

Copy this entire string.

---

## Step 6.3: Create Staging Database (Optional)

1. In Neon console, click **Branches**
2. Click **Create branch**
3. **Name**: `staging`
4. **Parent**: `main`
5. Click **Create**
6. Note the staging connection string

---

## Step 6.4: Add Database URL to Cloudflare Pages

1. Go back to **Cloudflare Dashboard** → **Pages** → **codex** → **Settings** → **Environment variables**
2. Click **Production**
3. Update `DATABASE_URL` with your Neon connection string from Step 6.2
4. Click **Preview**
5. Update `DATABASE_URL` with your staging branch connection string (or use production for now)
6. Click **Save**

✅ **Database configured**

---

# PHASE 7: Run Migrations (Future - Not Now)

**This step is for future implementation when you have database schema.**

For now, skip this. When you're ready to deploy features that use the database, you'll run:

```bash
# After setting up database schema
pnpm --filter web db:migrate
```

---

# PHASE 8: Test Your Configuration

## Step 8.1: Verify Pages Deployment

1. Go to **Cloudflare Dashboard** → **Pages** → **codex**
2. Click **Deployments**
3. Click the live deployment
4. You should see your SvelteKit app loading
5. No errors in the browser console

✅ **Pages working**

---

## Step 8.2: Verify R2 Access (Via Dashboard)

1. Go to **R2** → **codex-media-production**
2. Click **Upload** button
3. Upload any test file (image, PDF, etc.)
4. You should see it appear in the bucket

✅ **R2 buckets accessible**

---

## Step 8.3: Verify KV Namespace (Via Dashboard)

1. Go to **Workers & Pages** → **KV**
2. Click **CODEX_KV**
3. Click **Add key**
4. **Key**: `test-key`
5. **Value**: `test-value`
6. Click **Save**
7. You should see it in the list

✅ **KV namespace working**

---

# PHASE 9: (Optional) Set Up Custom Domain for R2

If you want to use a custom domain for R2 (e.g., `r2.yourdomain.com`), follow this. Otherwise, skip to Phase 10.

## Step 9.1: Create Custom Domain

1. Go to **R2**
2. Click **Settings** (left sidebar)
3. Click **Custom domains**
4. Click **Connect domain**
5. Enter your domain (e.g., `r2.codex.example.com`)
6. Follow CNAME setup instructions

**Note**: This requires you own the domain already. For `pages.dev` domain, skip this step.

---

# PHASE 10: Summary & Next Steps

## ✅ What You've Completed

1. ✅ Created 4 R2 buckets
2. ✅ Configured CORS for uploads
3. ✅ Generated R2 API credentials
4. ✅ Created KV namespace
5. ✅ Set environment variables in Cloudflare Pages
6. ✅ Created Neon Postgres database
7. ✅ Verified basic connectivity

## 📋 Saved Configuration Values

Keep these safe (password manager recommended):

```
R2_ACCOUNT_ID: _______________
R2_ACCESS_KEY_ID: _______________
R2_SECRET_ACCESS_KEY: _______________
KV_NAMESPACE_ID: _______________
AUTH_SECRET: _______________

R2 Buckets:
- codex-media-production
- codex-resources-production
- codex-assets-production
- codex-platform-production

Neon Production DATABASE_URL: _______________
Neon Staging DATABASE_URL: _______________

Cloudflare Pages Domain: _______________
```

---

## 🚀 Next Steps (NOT IN THIS CHECKLIST)

These will be handled separately:

1. **Commit & push** the updated R2BucketStructure.md to main
2. **Implement R2 client** code in `packages/cloudflare-clients/src/r2/`
3. **Implement KV client** code in `packages/cloudflare-clients/src/kv/`
4. **Create SvelteKit API routes** for media/resource uploads
5. **Add database schema** and run migrations
6. **Implement authentication** with BetterAuth

---

## ❓ Troubleshooting

### R2 Bucket Already Exists

If you get an error that bucket name is taken:
- Bucket names must be globally unique across Cloudflare
- Try: `codex-media-production-yourname`

### CORS Configuration Not Working

- Verify domain in CORS rule matches your actual domain
- After changing CORS, wait 5 minutes for propagation
- Test with curl: `curl -X OPTIONS https://bucket.r2.example.com/`

### Environment Variables Not Appearing

- Refresh Cloudflare Dashboard (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)
- Check that you saved variables in correct environment (Production/Preview)
- Redeploy Pages to pick up new environment variables

### Neon Connection String Format

Common format errors:
```
❌ WRONG: postgresql://localhost/codex
✅ RIGHT: postgresql://user:password@host/database
```

---

## 📞 Support Resources

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Neon PostgreSQL Documentation](https://neon.tech/docs/)

---

**Checklist Version**: 1.0
**Last Updated**: 2025-10-26
**Status**: Ready to Execute
