# Cloudflare Pages Migration Notes

## Current Issue

The Cloudflare Pages Git integration is still active and deploying on every push, but it's showing 404 errors because we've moved SvelteKit to Workers deployment.

**Preview URLs (404 errors):**
- https://b42388fa.codex-3x3.pages.dev/
- https://feature-ci-updates.codex-3x3.pages.dev/

## Root Cause

SvelteKit is now configured with `adapter-cloudflare` which outputs:
- `_worker.js` - The worker bundle
- `_app/` - Static assets

This is designed for Cloudflare Workers deployment, NOT Pages Git integration.

## Solution Options

### Option 1: Disable Pages Git Integration (Recommended)

**Why:** Our CI/CD architecture uses Workers for better control:
- ✅ Custom DATABASE_URL per preview
- ✅ Test before deploy
- ✅ Unified preview environments
- ✅ Better cleanup automation

**How:**
1. Go to Cloudflare Dashboard → Pages → codex-3x3
2. Settings → Builds & deployments
3. Disable "Automatic deployments"
4. Or disconnect Git integration entirely

**Result:** Only our GitHub Actions workflows will deploy:
- `preview-deploy.yml` → `codex-web-preview-{PR}`
- `deploy-production.yml` → `codex-web-production`

### Option 2: Keep Pages, Configure Properly

**Why:** If you want the automatic Pages preview URLs

**How:**
1. Keep Pages Git integration enabled
2. It will automatically deploy using the `_worker.js`
3. Set environment variables in Pages settings:
   - DATABASE_URL
   - SESSION_SECRET
   - etc.

**Tradeoff:** Two deployment paths (Pages + Workers) = more complexity

## Recommendation

**Disable Pages Git integration** and rely solely on Workers deployment via GitHub Actions.

This aligns with our architecture document (.github/CI-new-plan.md) which specifically chose Workers over Pages for deployment control.

## Current Deployment URLs (Workers)

These will be created by our CI/CD workflows:

**Preview (per PR):**
- https://codex-web-preview-{PR_NUMBER}.workers.dev

**Production:**
- https://codex-web-production.workers.dev

## Next Steps

1. Disable Cloudflare Pages Git integration
2. Verify Workers deployments work in CI
3. Update DNS to point to production Worker
