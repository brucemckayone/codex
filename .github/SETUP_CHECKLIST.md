# Setup Checklist - First Time Deployment

Complete this checklist before your first deployment.

> **Note**: After completing setup, the CI/CD pipeline will automatically deploy to custom domains on revelations.studio. See [DNS_ROUTING_PLAN.md](DNS_ROUTING_PLAN.md) for architecture details.

## ✅ Prerequisites

### Accounts
- [ ] GitHub account with repo access
- [ ] Cloudflare account (free tier is fine)
- [ ] Neon account (free tier is fine)

### CLI Tools Installed
- [ ] Node.js 20+ installed
- [ ] pnpm installed (`npm install -g pnpm`)
- [ ] wrangler installed (`npm install -g wrangler`)
- [ ] GitHub CLI installed (optional: `brew install gh`)

---

## 1️⃣ Cloudflare Setup

### API Token
- [ ] Go to https://dash.cloudflare.com/profile/api-tokens
- [ ] Click "Create Token"
- [ ] Use "Edit Cloudflare Workers" template
- [ ] Copy the token (you won't see it again!)
- [ ] Save it somewhere secure

### Account ID
- [ ] Go to https://dash.cloudflare.com/
- [ ] Copy your Account ID from the sidebar
- [ ] Save it for next step

---

## 2️⃣ Neon Setup

### Production Database
- [ ] Go to https://console.neon.tech
- [ ] Click "Create Project"
- [ ] Name it "codex-production"
- [ ] Choose region closest to your users
- [ ] Copy the connection string
- [ ] Save it securely

### GitHub Integration
- [ ] In Neon: Settings → Integrations
- [ ] Click "Add" next to GitHub
- [ ] Authorize Neon
- [ ] Select your repository
- [ ] Confirm integration is active

---


## 3️⃣ GitHub Secrets Setup

### Navigate to Secrets
Go to: `Your Repo → Settings → Secrets and variables → Actions → Secrets`

### Add These Secrets

#### Cloudflare (REQUIRED)
- [ ] `CLOUDFLARE_API_TOKEN` - Your API token from step 1
- [ ] `CLOUDFLARE_ACCOUNT_ID` - Your account ID from step 1

#### Neon (REQUIRED)
- [ ] `NEON_PRODUCTION_URL` - Production connection string from step 2
- [ ] `NEON_API_KEY` - Should be auto-set by GitHub integration (verify it exists)

#### Stripe (REQUIRED for production)
- [ ] `STRIPE_PRODUCTION_KEY` - Stripe secret key (starts with sk_live_)
- [ ] `STRIPE_PRODUCTION_PAYMENT_WEBHOOK_SECRET` - Payment webhook secret
- [ ] `STRIPE_PRODUCTION_SUBSCRIPTION_WEBHOOK_SECRET` - Subscription webhook secret
- [ ] `STRIPE_PRODUCTION_CONNECT_WEBHOOK_SECRET` - Connect webhook secret
- [ ] `STRIPE_PRODUCTION_CUSTOMER_WEBHOOK_SECRET` - Customer webhook secret
- [ ] `STRIPE_PRODUCTION_BOOKING_WEBHOOK_SECRET` - Booking webhook secret
- [ ] `STRIPE_PRODUCTION_DISPUTE_WEBHOOK_SECRET` - Dispute webhook secret

#### Stripe Test (REQUIRED for previews)
- [ ] `STRIPE_TEST_KEY` - Stripe test key (starts with sk_test_)
- [ ] `STRIPE_TEST_PAYMENT_WEBHOOK_SECRET` - Payment webhook secret
- [ ] `STRIPE_TEST_SUBSCRIPTION_WEBHOOK_SECRET` - Subscription webhook secret
- [ ] `STRIPE_TEST_CONNECT_WEBHOOK_SECRET` - Connect webhook secret
- [ ] `STRIPE_TEST_CUSTOMER_WEBHOOK_SECRET` - Customer webhook secret
- [ ] `STRIPE_TEST_BOOKING_WEBHOOK_SECRET` - Booking webhook secret
- [ ] `STRIPE_TEST_DISPUTE_WEBHOOK_SECRET` - Dispute webhook secret

#### Session & Auth (REQUIRED)
- [ ] `SESSION_SECRET` - For preview environments (generate random)
- [ ] `SESSION_SECRET_PRODUCTION` - For production (generate random)
- [ ] `BETTER_AUTH_SECRET_PRODUCTION` - For production (generate random)

### Generate Random Secrets

Run this command to generate secrets:
```bash
openssl rand -base64 32
```

## 4️⃣ GitHub Variables Setup

### Navigate to Variables
Go to: `Your Repo → Settings → Secrets and variables → Actions → Variables`

### Add These Variables
- [ ] `NEON_PROJECT_ID` - Should be auto-set by GitHub integration (verify it exists)

---

## 5️⃣ Local Setup

### Clone and Install
```bash
# Clone the repo (if not already)
git clone <your-repo-url>
cd Codex

# Install dependencies
pnpm install

# Start local development
pnpm docker:up
pnpm dev
```

### Verify Local Works
- [ ] `pnpm docker:up` starts successfully
- [ ] `pnpm dev` starts without errors
- [ ] Can access app at http://localhost:5173
- [ ] Database connection works

---

## 6️⃣ Test Preview Deployment

### Create Test PR
```bash
# Create a test branch
git checkout -b test/ci-setup

# Make a small change
echo "# Test" >> TEST.md
git add TEST.md
git commit -m "test: CI/CD setup verification"

# Push and create PR
git push -u origin test/ci-setup
gh pr create --title "Test: CI/CD Setup" --body "Testing CI/CD pipeline"
```

### Verify Workflows Run
- [ ] "PR and Push CI" workflow starts
- [ ] Tests pass successfully
- [ ] Neon branch is created
- [ ] "Preview Deployment" workflow starts
- [ ] Workers deploy successfully
- [ ] PR comment appears with preview URLs

### Test Preview Environment
- [ ] Click preview URL in PR comment
- [ ] App loads successfully
- [ ] Check worker logs: `wrangler tail codex-web-preview-<number>`

### Cleanup Test PR
- [ ] Close the test PR
- [ ] Verify cleanup workflow runs
- [ ] Verify Neon branch is deleted
- [ ] Verify workers are removed

---

## 7️⃣ Test Production Deployment

### Merge Test PR
```bash
# If test PR worked, merge it
gh pr merge test/ci-setup --squash
```

### Verify Production Deployment
- [ ] "PR and Push CI" workflow runs on main
- [ ] Tests pass successfully
- [ ] "Production Deployment" workflow starts
- [ ] Migrations run successfully
- [ ] Workers deploy to production
- [ ] Deployment completes successfully

### Test Production
- [ ] Visit production URL (check workflow logs for URL)
- [ ] App loads successfully
- [ ] Check logs: `wrangler tail codex-web-production`

---

## 8️⃣ Optional: Custom Domains

### Add Custom Domain (Optional)
```bash
# Via wrangler
wrangler domains add codex.yourdomain.com --env production

# Or via Cloudflare Dashboard:
# Workers → codex-web-production → Triggers → Add Custom Domain
```

- [ ] Custom domain added
- [ ] DNS configured
- [ ] SSL certificate provisioned
- [ ] App accessible at custom domain

---

## 9️⃣ Optional: Staging Environment

### Create Staging (Optional)
```bash
# Create staging Neon branch
neonctl branches create --name staging --parent main

# Get staging connection string
neonctl connection-string staging

# Set staging secrets
wrangler secret put DATABASE_URL --env staging
# ... add other secrets

# Deploy to staging
cd workers/stripe-webhook-handler && wrangler deploy --env staging
cd ../../workers/auth && wrangler deploy --env staging
cd ../../apps/web && wrangler deploy --env staging
```

- [ ] Staging Neon branch created
- [ ] Staging secrets configured
- [ ] Staging workers deployed
- [ ] Staging accessible

---

## 🎉 Completion Checklist

### You're Ready When:
- [ ] Preview deployments work on PRs
- [ ] Production deployments work on main
- [ ] All secrets are configured
- [ ] Workers are accessible
- [ ] Database migrations run successfully
- [ ] Logs are accessible
- [ ] Team has access to necessary tools

### Next Steps:
- [ ] Read [DEPLOYMENT_GUIDE.md](.github/DEPLOYMENT_GUIDE.md) for detailed procedures
- [ ] Bookmark [RUNBOOK.md](.github/RUNBOOK.md) for quick reference
- [ ] Set up monitoring (see observability package)
- [ ] Configure alerting for deployment failures
- [ ] Train team on deployment process

---

## 🆘 Troubleshooting Setup

### Common Issues

**"NEON_API_KEY not found"**
- Check GitHub integration is active in Neon
- Manually set: Go to Neon → Account → API Keys → Create

**"CLOUDFLARE_API_TOKEN invalid"**
- Regenerate token in Cloudflare Dashboard
- Ensure "Edit Cloudflare Workers" permissions
- Update in GitHub Secrets

**"Artifact not found" in preview deploy**
- This is normal for first deployment
- Workflow will retry automatically
- Check testing workflow completed successfully

**Workers deploy but show 404**
- Check wrangler.toml has correct main path
- Verify build step completed
- Check dist/index.js exists after build

---

## 📞 Need Help?

1. Check [DEPLOYMENT_GUIDE.md](.github/DEPLOYMENT_GUIDE.md) troubleshooting section
2. Review GitHub Actions logs: `gh run list`
3. Check Cloudflare dashboard for worker status
4. Check Neon dashboard for database status
5. Review worker logs: `wrangler tail <worker-name>`

---

**Estimated Setup Time**: 30-45 minutes
**Difficulty**: Intermediate
**Last Updated**: 2025-01-30
