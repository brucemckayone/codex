# DNS Routing and Inter-Worker Communication Plan

## Multi-Tenant Architecture Overview

**Current Tenant**: Codex (first tenant, used for development)
**Future State**: Multi-tenant SaaS with subdomain per tenant

### Architecture Design
- Each tenant gets their own subdomain: `{tenant}.revelations.studio`
- Shared API endpoint: `api.revelations.studio` (serves all tenants)
- Shared Auth endpoint: `auth.revelations.studio` (serves all tenants)
- Main domain: `revelations.studio` (landing page/marketing site)

### Current Tenant: Codex
- **Web App**: `codex.revelations.studio`
- **API**: `api.revelations.studio` (shared)
- **Auth**: `auth.revelations.studio` (shared)

## Current State (PROBLEM)

### Worker Deployments
Workers currently deploy to Cloudflare's default `*.workers.dev` subdomain:

- **Web App (Production)**: `https://codex-web-production.workers.dev`
- **Web App (Preview)**: `https://codex-web-preview-{PR_NUMBER}.workers.dev`
- **Stripe Webhook Handler (Production)**: `https://stripe-webhook-handler-production.workers.dev`
- **Stripe Webhook Handler (Preview)**: `https://stripe-webhook-handler-preview-{PR_NUMBER}.workers.dev`
- **Auth Worker (Production)**: `https://auth-worker-production.workers.dev`
- **Auth Worker (Preview)**: `https://auth-worker-preview-{PR_NUMBER}.workers.dev`

### Stripe Webhook Configuration
Stripe webhooks are configured to send events to:
- **Test Mode (all 6 endpoints)**: `https://api.revelations.studio/webhooks/stripe/*`
- **Production Mode (all 6 endpoints)**: `https://api.revelations.studio/webhooks/stripe/*`

### The Problem
There's a **complete mismatch** between:
1. Where Stripe is sending webhooks: `api.revelations.studio`
2. Where workers are actually deployed: `*.workers.dev`

**Result**: Stripe webhooks are hitting a non-existent domain and failing.

## Required State (SOLUTION)

### Custom Domain Routing via revelations.studio

#### Production Environment
- `https://codex.revelations.studio` → codex-web-production (Codex tenant)
- `https://api.revelations.studio` → stripe-webhook-handler-production (shared API)
- `https://auth.revelations.studio` → auth-worker-production (shared auth)
- `https://revelations.studio` → marketing site (future, TBD)

#### Preview Environments (per PR)
- `https://codex-preview-{PR_NUMBER}.revelations.studio` → codex-web-preview-{PR_NUMBER}
- `https://api-preview-{PR_NUMBER}.revelations.studio` → stripe-webhook-handler-preview-{PR_NUMBER}
- `https://auth-preview-{PR_NUMBER}.revelations.studio` → auth-worker-preview-{PR_NUMBER}

#### Future Tenants (multi-tenant expansion)
- `https://{tenant-slug}.revelations.studio` → Same codex-web worker (tenant identified by hostname)
- `https://api.revelations.studio` → Same shared API (tenant context from requests)
- `https://auth.revelations.studio` → Same shared auth (tenant context from requests)

## Multi-Tenant Architecture Strategy

### Option A: Single Worker with Hostname Routing (RECOMMENDED)
**How it works**: One web worker handles all tenant subdomains. The worker inspects the hostname to determine which tenant's data to serve.

```typescript
// In codex-web worker
app.use('*', async (c, next) => {
  const hostname = new URL(c.req.url).hostname; // e.g., "codex.revelations.studio"
  const tenantSlug = hostname.split('.')[0]; // "codex"

  // Load tenant config from database
  const tenant = await db.tenants.findBySlug(tenantSlug);
  c.set('tenant', tenant);

  await next();
});
```

**Pros**:
- Single codebase for all tenants
- Easy to add new tenants (just DNS record + database entry)
- Shared infrastructure and scaling
- Simpler deployment process

**Cons**:
- All tenants share the same worker instance
- Need careful tenant isolation in code
- Potential security risks if tenant isolation is broken

### Option B: Separate Worker Per Tenant
**How it works**: Deploy a separate worker for each tenant.

**Pros**:
- Complete isolation between tenants
- Can customize code per tenant if needed

**Cons**:
- More complex deployment
- Harder to manage at scale
- More expensive (more workers to maintain)

**Recommendation**: Use **Option A** for scalable multi-tenant SaaS.

## Implementation Steps

### Step 1: DNS Records (Automatic via Wrangler)

**Good News**: DNS records are **automatically created by Cloudflare** when you deploy workers with `custom_domain = true` in the routes configuration!

When you run `wrangler deploy`, Cloudflare will:
1. Automatically create the necessary DNS records
2. Issue SSL/TLS certificates
3. Configure routing to your workers

**No manual DNS configuration required!** The wrangler.toml files are already configured with `custom_domain = true`, so DNS will be set up automatically on first deployment.

### Step 2: Wrangler Configuration (Already Complete ✅)

The wrangler.toml files have already been configured with custom domain routes and `custom_domain = true`.

#### apps/web/wrangler.toml
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

# Production environment
[env.production]
name = "codex-web-production"
vars = {
  ENVIRONMENT = "production",
  AUTH_WORKER_URL = "https://auth.revelations.studio",
  API_URL = "https://api.revelations.studio"
}
routes = [
  { pattern = "codex.revelations.studio/*", custom_domain = true },
  # Future: wildcard for all tenants
  # { pattern = "*.revelations.studio/*", custom_domain = true }
]

# Staging environment
[env.staging]
name = "codex-web-staging"
vars = {
  ENVIRONMENT = "staging",
  AUTH_WORKER_URL = "https://auth-staging.revelations.studio",
  API_URL = "https://api-staging.revelations.studio"
}
```

#### workers/stripe-webhook-handler/wrangler.toml
```toml
name = "stripe-webhook-handler"
main = "dist/index.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true

# Production environment
[env.production]
name = "stripe-webhook-handler-production"
vars = {
  ENVIRONMENT = "production",
  WEB_APP_URL = "https://codex.revelations.studio",
  AUTH_WORKER_URL = "https://auth.revelations.studio"
}
routes = [
  { pattern = "api.revelations.studio/*", custom_domain = true }
]

# Staging environment
[env.staging]
name = "stripe-webhook-handler-staging"
vars = {
  ENVIRONMENT = "staging",
  WEB_APP_URL = "https://codex-staging.revelations.studio",
  AUTH_WORKER_URL = "https://auth-staging.revelations.studio"
}
```

#### workers/auth/wrangler.toml
```toml
name = "auth-worker"
main = "dist/index.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true

# Production environment
[env.production]
name = "auth-worker-production"
vars = {
  ENVIRONMENT = "production",
  WEB_APP_URL = "https://codex.revelations.studio",
  API_URL = "https://api.revelations.studio"
}
routes = [
  { pattern = "auth.revelations.studio/*", custom_domain = true }
]

# Staging environment
[env.staging]
name = "auth-worker-staging"
vars = {
  ENVIRONMENT = "staging",
  WEB_APP_URL = "https://codex-staging.revelations.studio",
  API_URL = "https://api-staging.revelations.studio"
}
```

### Step 3: Update CI/CD Workflows for Preview Environments

Modify workflows to use custom domain routes for preview deployments.

#### In preview-deploy.yml

Add route flags to each worker deployment:

```yaml
# Web app deployment
- name: Deploy web app (preview)
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: apps/web
    command: >
      deploy
      --name codex-web-preview-${{ env.PR_NUMBER }}
      --var ENVIRONMENT:preview
      --var AUTH_WORKER_URL:https://auth-preview-${{ env.PR_NUMBER }}.revelations.studio
      --var API_URL:https://api-preview-${{ env.PR_NUMBER }}.revelations.studio
      --route "codex-preview-${{ env.PR_NUMBER }}.revelations.studio/*"

# Stripe webhook handler deployment
- name: Deploy stripe-webhook-handler (preview)
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: workers/stripe-webhook-handler
    command: >
      deploy
      --name stripe-webhook-handler-preview-${{ env.PR_NUMBER }}
      --var ENVIRONMENT:preview
      --var WEB_APP_URL:https://codex-preview-${{ env.PR_NUMBER }}.revelations.studio
      --var AUTH_WORKER_URL:https://auth-preview-${{ env.PR_NUMBER }}.revelations.studio
      --route "api-preview-${{ env.PR_NUMBER }}.revelations.studio/*"

# Auth worker deployment
- name: Deploy auth worker (preview)
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: workers/auth
    command: >
      deploy
      --name auth-worker-preview-${{ env.PR_NUMBER }}
      --var ENVIRONMENT:preview
      --var WEB_APP_URL:https://codex-preview-${{ env.PR_NUMBER }}.revelations.studio
      --var API_URL:https://api-preview-${{ env.PR_NUMBER }}.revelations.studio
      --route "auth-preview-${{ env.PR_NUMBER }}.revelations.studio/*"
```

#### In deploy-production.yml

Routes are configured in wrangler.toml, but we need to pass environment variables:

```yaml
- name: Deploy web app (production)
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: apps/web
    command: deploy --env production
  env:
    DATABASE_URL: ${{ secrets.NEON_PRODUCTION_URL }}
    SESSION_SECRET: ${{ secrets.SESSION_SECRET_PRODUCTION }}
    PUBLIC_APP_URL: https://codex.revelations.studio
```

### Step 4: Inter-Worker Communication Environment Variables

Each worker needs to know how to call other workers.

#### Environment Variables by Worker

**codex-web** needs:
- `AUTH_WORKER_URL` - Where to send auth requests
- `API_URL` - Where to send API requests (stripe webhook handler)

**stripe-webhook-handler** needs:
- `WEB_APP_URL` - Where the web app is hosted (for redirects, etc.)
- `AUTH_WORKER_URL` - Where to verify auth tokens

**auth-worker** needs:
- `WEB_APP_URL` - Where to redirect after auth
- `API_URL` - Where API is hosted

These are already included in the wrangler.toml configs above.

### Step 5: Implement Tenant Resolution in Web Worker

Add middleware to detect tenant from hostname:

```typescript
// apps/web/src/hooks.server.ts or similar
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Extract tenant from hostname
  const hostname = event.request.headers.get('host') || '';
  const subdomain = hostname.split('.')[0];

  // For now, only "codex" tenant exists
  // Future: query database for tenant by subdomain
  const tenantSlug = subdomain === 'codex-preview-*' || subdomain.startsWith('codex')
    ? 'codex'
    : subdomain;

  // Store tenant context in locals
  event.locals.tenant = {
    slug: tenantSlug,
    // Add more tenant data from DB
  };

  return resolve(event);
};
```

### Step 6: Add Health Check Endpoints

Add `/health` endpoints to all workers for monitoring:

```typescript
// In each worker
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    worker: 'codex-web', // or 'stripe-webhook-handler', 'auth-worker'
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString()
  });
});
```

## Verification Steps

After implementation, verify each component:

### 1. DNS Propagation
```bash
# Check DNS resolution
dig codex.revelations.studio
dig api.revelations.studio
dig auth.revelations.studio
dig codex-preview-123.revelations.studio
```

### 2. Worker Routes (Production)
```bash
curl https://codex.revelations.studio
curl https://api.revelations.studio/health
curl https://auth.revelations.studio/health
```

### 3. Worker Routes (Preview - after PR deployment)
```bash
curl https://codex-preview-123.revelations.studio
curl https://api-preview-123.revelations.studio/health
curl https://auth-preview-123.revelations.studio/health
```

### 4. Stripe Webhooks
```bash
# Use Stripe CLI to send test events to production
stripe trigger payment_intent.succeeded

# Check worker logs
pnpm wrangler tail stripe-webhook-handler-production
```

### 5. Inter-Worker Communication
- Test web app → auth worker (login flow)
- Test web app → API (Stripe operations)
- Test webhook → auth (verify signatures)
- Check observability logs for cross-worker traces

## Migration Strategy

### Phase 1: DNS Configuration (Automatic ✅)
**No manual action required!**
DNS records will be automatically created by Cloudflare when you deploy with wrangler.

### Phase 2: Update Configuration Files
1. Update all three wrangler.toml files with routes and environment variables
2. Commit changes to feature branch
3. Do NOT merge yet

### Phase 3: Test Deployment
1. Deploy to production manually first (safe testing):
   ```bash
   cd apps/web
   pnpm wrangler deploy --env production

   cd ../../workers/stripe-webhook-handler
   pnpm wrangler deploy --env production

   cd ../auth
   pnpm wrangler deploy --env production
   ```
2. Verify all routes work (use curl commands from Verification Steps)
3. Check Cloudflare Dashboard → Workers → Routes to see routes are active

### Phase 4: Update Workflows
1. Update preview-deploy.yml with route flags
2. Update deploy-production.yml to use new URLs
3. Commit and push

### Phase 5: Test Preview Deployment
1. Create test PR
2. Verify preview workers deploy with custom domains
3. Test inter-worker communication in preview environment
4. Verify Stripe test webhooks work

### Phase 6: Merge and Monitor
1. Merge PR
2. Monitor production deployment
3. Check Stripe production webhooks are being received
4. Monitor observability dashboards

## Multi-Tenant Future Considerations

### Adding New Tenants (Future)

When ready to add more tenants:

1. **Database**: Add tenant to `tenants` table with `slug`, `domain`, etc.
2. **DNS**: Wildcard `*.revelations.studio` already handles this
3. **Worker Routes**: Update web worker to use wildcard:
   ```toml
   routes = [
     { pattern = "*.revelations.studio/*", custom_domain = true }
   ]
   ```
4. **Tenant Isolation**: Ensure all DB queries are scoped to tenant
5. **Test**: Access `{new-tenant}.revelations.studio`

### Tenant-Specific Customization

Options for tenant-specific features:

1. **Database-driven**: Store tenant preferences in DB, load at runtime
2. **Feature Flags**: Use feature flags per tenant
3. **Custom Components**: Conditionally render based on tenant
4. **Theming**: CSS variables per tenant

### Staging Environment

For staging, use a separate subdomain pattern:
- `codex-staging.revelations.studio`
- `api-staging.revelations.studio`
- `auth-staging.revelations.studio`

## Security Considerations

1. **Tenant Isolation**: Ensure all database queries include tenant filter
2. **SSL/TLS**: Cloudflare automatically provisions SSL for custom domains
3. **CORS**: Configure CORS to allow cross-origin requests between workers
4. **Worker-to-Worker Auth**: Implement shared secret or service tokens
5. **Rate Limiting**: Add Cloudflare rate limiting rules per subdomain
6. **Subdomain Takeover**: Ensure unused subdomains don't point to workers

## Cost Implications

- **Custom Domains**: Free on Cloudflare Workers (up to 100 routes per zone)
- **DNS Queries**: Free on Cloudflare
- **SSL Certificates**: Free (Cloudflare Universal SSL)
- **Wildcard DNS**: Free on Cloudflare

## Rollback Plan

If issues occur:

1. **Immediate**: Remove custom domain routes from wrangler.toml, redeploy
2. **Stripe**: Update webhook URLs to workers.dev temporarily
3. **DNS**: Keep DNS records (they don't hurt), just remove routes
4. **Workers**: Will continue to work on *.workers.dev URLs as fallback

## Next Actions Required

### User Actions
- [ ] ✅ DNS records (automatic via wrangler deploy - no action needed)

### Development Actions
- [ ] Update wrangler.toml files with routes (apps/web, stripe-webhook-handler, auth)
- [ ] Add health check endpoints to all workers
- [ ] Test manual deployment to production
- [ ] Update preview-deploy.yml with route flags
- [ ] Update deploy-production.yml URLs
- [ ] Add tenant resolution middleware to web worker
- [ ] Create test PR to verify preview deployments
- [ ] Monitor production Stripe webhooks after deployment
