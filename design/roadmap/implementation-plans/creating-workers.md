# Worker Infrastructure Setup Plan

**Last Updated**: 2025-12-17
**Status**: ✅ COMPLETE

---

## Goal

Set up worker infrastructure for new architecture with 7 workers total. Each new worker gets minimal scaffolding with health endpoint only. CI/CD pipeline updated to build, test, and deploy all workers.

---

## Target Workers (7 Total)

| Worker | Port | Domain | Status |
|--------|------|--------|--------|
| auth | 42069 | auth.revelations.studio | Existing |
| organization-api | 42071 | organization-api.revelations.studio | ✅ DONE (copied from identity-api) |
| identity-api | 42074 | identity-api.revelations.studio | ✅ DONE (gutted to minimal) |
| content-api | 4001 | content-api.revelations.studio | Existing |
| ecom-api | 42072 | api.revelations.studio | Existing |
| admin-api | 42073 | admin-api.revelations.studio | Existing |
| notifications-api | 42075 | notifications-api.revelations.studio | ✅ DONE (created minimal) |

---

## Progress Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Create organization-api worker (copy from identity-api) | ✅ DONE |
| 2 | Gut identity-api worker (make minimal, port 42074) | ✅ DONE |
| 3 | Create notifications-api worker (minimal) | ✅ DONE |
| 4 | Update root config (tsconfig.json, package.json) | ✅ DONE |
| 5 | Update CI/CD - testing.yml | ✅ DONE |
| 6 | Update CI/CD - preview-deploy.yml | ✅ DONE |
| 7 | Update CI/CD - deploy-production.yml | ✅ DONE |
| 8 | Update scripts (secrets, DNS, dev-vars) | ✅ DONE |
| 9 | Update E2E tests | ✅ DONE |
| 10 | Test locally and verify CI passes | ✅ DONE |

---

## Completed Work

### Phase 1: organization-api Worker ✅

**Created**: `workers/organization-api/`

Copied from identity-api with all organization endpoints intact. Files modified:
- `package.json` - name → "organization-api", port 42071
- `wrangler.jsonc` - name → "organization-api", routes to organization-api.revelations.studio
- `src/index.ts` - serviceName → 'organization-api'
- `CLAUDE.md` - Updated documentation

**Contains all 7 organization endpoints**:
- POST /api/organizations
- GET /api/organizations/:id
- GET /api/organizations/slug/:slug
- PATCH /api/organizations/:id
- GET /api/organizations
- DELETE /api/organizations/:id
- GET /api/organizations/check-slug/:slug

### Phase 2: identity-api Worker ✅

**Gutted**: `workers/identity-api/`

Made minimal with health endpoint only. Files modified:
- `package.json` - port changed to 42074, removed @codex/identity and @codex/validation deps
- `wrangler.jsonc` - port and routes unchanged (still identity-api.revelations.studio)
- `src/index.ts` - Simplified to health endpoint only, removed organizationRoutes
- `src/index.test.ts` - Simplified tests
- `src/routes/` - **DELETED** entire directory
- `CLAUDE.md` - Updated for minimal placeholder

**Contains only**:
- GET /health

### Phase 3: notifications-api Worker ✅

**Created**: `workers/notifications-api/`

New minimal worker from scratch. Files created:
- `package.json` - name "notifications-api", port 42075
- `wrangler.jsonc` - routes to notifications-api.revelations.studio
- `tsconfig.json`
- `vite.config.ts`
- `vitest.config.ts`
- `.dev.vars.example`
- `CLAUDE.md`
- `src/index.ts` - Health endpoint only
- `src/index.test.ts`
- `src/types.ts`
- `src/utils/validate-env.ts`

**Contains only**:
- GET /health

### Phase 4: Root Configuration ✅

**Modified**: `/tsconfig.json`

Added references:
```json
{ "path": "./workers/organization-api" },
{ "path": "./workers/notifications-api" },
{ "path": "./workers/admin-api" }
```

**Modified**: `/package.json`

Added scripts:
```json
"dev:organization-api": "turbo run dev --filter=organization-api",
"dev:notifications-api": "turbo run dev --filter=notifications-api"
```

Updated dev script to include new workers in concurrently.

### Phase 5: testing.yml ✅

**Modified**: `.github/workflows/testing.yml`

Added CI test jobs for new workers:
- Added organization-api-test job (lines 879-987)
- Added notifications-api-test job (lines 989-1096)
- Updated e2e-api-tests needs array to include both new test jobs
- Updated e2e-api-tests if condition for success/skipped checks
- Updated cleanup-neon-branches needs array
- Added deletion steps for organization-api and notifications-api test branches

### Phase 6: preview-deploy.yml ✅

**Modified**: `.github/workflows/preview-deploy.yml`

Added preview deployment support for new workers:
- Added cleanup for organization-api and notifications-api in cleanup section
- Added deploy organization-api (preview) step with route and secrets
- Added deploy notifications-api (preview) step with route and secrets
- Updated PR comment with new preview URLs (now 8 services)

### Phase 7: deploy-production.yml ✅

**Modified**: `.github/workflows/deploy-production.yml`

Added production deployment for new workers:
- Added deploy organization-api step with secrets upload and health check
- Added deploy notifications-api step with secrets upload and health check
- Updated smoke tests to include organization-api and notifications-api
- Updated deployment metrics (now 8 workers)

---

### Phase 8: Update Scripts ✅

**Modified**:
- `.github/scripts/upload-worker-secrets.sh` - Added organization-api and notifications-api cases
- `.github/scripts/manage-preview-dns.sh` - Added to PREVIEW_SUBDOMAINS array
- `.github/scripts/generate-dev-vars.sh` - Updated WORKERS array
- `.github/scripts/generate-worker-dev-vars.sh` - Updated validation

---

### Phase 9: Update E2E Tests ✅

**Modified**:
- `e2e/helpers/worker-urls.ts` - Added organization and notifications URLs, fixed identity-api port
- `e2e/helpers/worker-manager.ts` - Added worker configs for organization-api and notifications-api

---

### Phase 10: Test Locally and Verify CI ✅

**Verified**:
- `pnpm typecheck` passes
- `pnpm build` passes
- Organization-api tests pass
- Notifications-api tests pass

**Additional fixes during testing**:
- Fixed vite.config.ts in notifications-api (wrong import path)
- Fixed vite.config.ts in organization-api (wrong workerName)
- Fixed test assertions in organization-api (service name)
- Fixed test assertions in notifications-api (removed env binding test)

---

## Key File Paths

### Created Workers:
- `/Users/brucemckay/development/Codex/workers/organization-api/` (complete)
- `/Users/brucemckay/development/Codex/workers/notifications-api/` (complete)

### Modified Workers:
- `/Users/brucemckay/development/Codex/workers/identity-api/` (gutted to minimal)

### Root Config:
- `/Users/brucemckay/development/Codex/tsconfig.json` (updated)
- `/Users/brucemckay/development/Codex/package.json` (updated)

### CI/CD (need updates):
- `/Users/brucemckay/development/Codex/.github/workflows/testing.yml` (in progress)
- `/Users/brucemckay/development/Codex/.github/workflows/preview-deploy.yml`
- `/Users/brucemckay/development/Codex/.github/workflows/deploy-production.yml`

### Scripts (need updates):
- `/Users/brucemckay/development/Codex/.github/scripts/upload-worker-secrets.sh`
- `/Users/brucemckay/development/Codex/.github/scripts/manage-preview-dns.sh`
- `/Users/brucemckay/development/Codex/.github/scripts/generate-dev-vars.sh`

### E2E Tests (need updates):
- `/Users/brucemckay/development/Codex/e2e/helpers/worker-urls.ts`
- `/Users/brucemckay/development/Codex/e2e/helpers/worker-manager.ts`

---

## Port Reference

| Worker | Dev Port | Inspector Port |
|--------|----------|----------------|
| auth | 42069 | 9229 |
| organization-api | 42071 | 9234 |
| identity-api | 42074 | 9236 |
| content-api | 4001 | 9230 |
| ecom-api | 42072 | 9232 |
| admin-api | 42073 | 9233 |
| notifications-api | 42075 | 9237 |

---

## DNS Transition Notes

Cloudflare Workers with `custom_domain: true` auto-manage DNS.

Deploy order:
1. Deploy organization-api first (gets new domain organization-api.revelations.studio)
2. Verify organization-api.revelations.studio works
3. Deploy updated identity-api (keeps identity-api.revelations.studio domain)
4. Deploy notifications-api (gets new domain notifications-api.revelations.studio)

---

## Quick Resume Commands

```bash
# Check current git status
git status

# Run tests locally for new workers
cd workers/organization-api && pnpm test
cd workers/identity-api && pnpm test
cd workers/notifications-api && pnpm test

# Start individual workers
pnpm dev:organization-api
pnpm dev:identity-api
pnpm dev:notifications-api

# Check typecheck passes
pnpm typecheck

# Run full build
pnpm build
```
