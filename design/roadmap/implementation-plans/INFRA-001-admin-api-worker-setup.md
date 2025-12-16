# Implementation Plan: INFRA-001 Admin-API Worker Setup

**Work Packet**: INFRA-001
**Created**: 2025-12-15
**Last Updated**: 2025-12-15
**Status**: Implemented (Pending CI/Deploy Verification)

---

## Overview

Add a new admin-api worker to the Codex platform infrastructure. This worker will serve as the 5th worker in the Codex architecture, following the established patterns from auth, content-api, identity-api, and ecom-api workers.

**Target Configuration**:
- Worker Name: admin-api
- Development Port: 42073
- Production URL: https://admin-api.revelations.studio
- Preview URL Pattern: https://admin-api-preview-{PR_NUMBER}.revelations.studio

**Key Reference Files**:
- Primary template: `workers/ecom-api/` (newest worker, most current patterns)
- All CI/CD workflows in `.github/workflows/`
- Supporting scripts in `.github/scripts/`

---

## Progress Update (2025-12-15)

### Implemented

- Worker scaffold created at `workers/admin-api/` (wrangler/vite/vitest/tsconfig + basic routes)
- CI test workflow updated to include `admin-api` change detection + `admin-api-test` job
- Preview deploy workflow updated to deploy `admin-api` preview worker, upload secrets, and include URL in PR comment
- Production deploy workflow updated to deploy `admin-api`, upload secrets, run health check, and include in smoke tests
- Preview DNS script updated to include `admin-api-preview-{PR_NUMBER}`
- Secrets + dev vars scripts updated to include `admin-api`
- E2E worker manager + URLs updated to include `admin-api`
- Workspace metadata updated (vitest workspace + lockfile entry for `workers/admin-api`)

### Still Pending (Verification)

- Run a full CI run to confirm new jobs/workflow edits behave as expected
- Validate preview and production deployments in Cloudflare (DNS, secrets, health checks)
- Optional local manual verification: `cd workers/admin-api && pnpm dev` then `curl http://localhost:42073/health`

---

## Phase 1: Worker Directory Structure

Create the complete worker directory at `workers/admin-api/` following the established ecom-api pattern.

### 1.1 wrangler.jsonc

Create `workers/admin-api/wrangler.jsonc` following the ecom-api pattern:

**Required Configuration**:
- Set `name` to `admin-api`
- Set `main` to `dist/index.js`
- Set `compatibility_date` to `2025-01-01`
- Set `compatibility_flags` with `nodejs_compat`
- Enable observability
- Configure `RATE_LIMIT_KV` namespace binding (use the same KV namespace ID as other workers: `cea7153364974737b16870df08f31083`)
- Configure default vars: `ENVIRONMENT`, `DB_METHOD`, `WEB_APP_URL`, `API_URL`

**Environment Configurations**:
- `test` environment: Name `admin-api-test`, KV namespace binding, test-specific vars
- `production` environment: Name `admin-api-production`, production vars, routes configured for `admin-api.revelations.studio` custom domain
- `staging` environment: Name `admin-api-staging`, staging vars, routes for staging subdomain

**Secrets Documentation**: Include comments documenting required secrets (DATABASE_URL at minimum for initial setup, additional secrets as admin functionality requires)

### 1.2 package.json

Create `workers/admin-api/package.json`:

**Required Fields**:
- `name`: `admin-api`
- `version`: `0.0.1`
- `private`: true
- `type`: `module`

**Scripts Section** (mirror ecom-api):
- `build`: `vite build`
- `deploy`: `pnpm build && wrangler deploy`
- `dev`: `pnpm build && wrangler dev --port 42073 --inspector-port 9233` (unique inspector port)
- `test`: `vitest run`
- `test:watch`: `vitest`
- `test:coverage`: `vitest run --coverage`
- `lint`, `format`, `typecheck`: standard commands

**Dependencies** (start with common worker dependencies):
- Workspace packages: `@codex/database`, `@codex/observability`, `@codex/security`, `@codex/service-errors`, `@codex/shared-types`, `@codex/validation`, `@codex/worker-utils`
- Runtime: `hono`, `zod`
- Build: `vite-plugin-dts`

**DevDependencies**:
- `@cloudflare/vitest-pool-workers`
- `@types/node`
- `@vitest/runner`, `@vitest/snapshot`, `@vitest/ui`
- `vitest`
- `wrangler`
- `cloudflare`

### 1.3 vitest.config.ts

Create `workers/admin-api/vitest.config.ts`:

**Configuration** (mirror ecom-api):
- Import `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`
- Configure workers pool with wrangler config path `./wrangler.jsonc` and environment `test`
- Set `globals: true`
- Include pattern: `src/**/*.{test,spec}.ts`
- Coverage configuration with v8 provider, text/json/html reporters
- Exclude patterns: node_modules, dist, config files, type definitions

### 1.4 tsconfig.json

Create `workers/admin-api/tsconfig.json`:

**Configuration**:
- Extend `../../config/tsconfig/worker.json`
- Set `rootDir` to `src`
- Include `src` directory and the cloudflare test env declaration file

### 1.5 vite.config.ts

Create `workers/admin-api/vite.config.ts`:

**Configuration**:
- Import `createWorkerConfig` from shared vite config
- Configure with `workerName: 'admin-api'`
- Add any additional externals as admin-specific dependencies are identified

### 1.6 src/ Directory Structure

Create initial source structure:

**Required Files**:
- `src/index.ts`: Main worker entry point using `createWorker()` pattern, health check endpoints, route mounting
- `src/types.ts`: Worker-specific type definitions extending HonoEnv (if needed)
- `src/index.test.ts`: Basic health check tests

**Initial Routes Directory**:
- `src/routes/`: Placeholder for admin-specific routes (can be empty initially with TODO comment)

---

## Phase 2: GitHub Actions - Testing Workflow

Update `.github/workflows/testing.yml` to include admin-api worker testing.

### 2.1 Change Detection

Add admin-api to the `changes` job outputs:

**New Output**:
- Add `admin-api: ${{ steps.filter.outputs.admin-api }}` to job outputs

**New Filter**:
- Add path filter for `workers/admin-api/**` in the dorny/paths-filter configuration

### 2.2 Admin-API Test Job

Create new `admin-api-test` job following the ecom-api-test pattern:

**Job Configuration**:
- Name: `Admin API Tests`
- Needs: `[changes, test]`
- Conditional execution when admin-api, worker-utils, database, or security packages change
- Environment: test
- Output branch_id for cleanup

**Steps** (mirror ecom-api-test structure):
1. Checkout
2. Generate Neon branch name: `ci-admin-api-tests`
3. Create Neon branch
4. Install pnpm and Node.js 20
5. Install dependencies with frozen lockfile
6. Cache Turborepo (use unique key pattern `turbo-admin-api-test-...`)
7. Generate and apply migrations
8. Build dependencies
9. Generate worker dev vars (requires script update - see Phase 6)
10. Run tests with appropriate env vars
11. Upload test results artifact
12. Fail step if tests failed

### 2.3 E2E Test Dependencies

Update the `e2e-api-tests` job:

**Needs Array**:
- Add `admin-api-test` to the needs list

**Conditional Logic**:
- Add admin-api-test result check to the if condition

### 2.4 Cleanup Job

Update `cleanup-neon-branches` job:

**Needs Array**:
- Add `admin-api-test` to needs

**New Cleanup Step**:
- Add step to delete admin-api test branch following existing pattern

---

## Phase 3: GitHub Actions - Preview Deployment

Update `.github/workflows/preview-deploy.yml` to deploy admin-api to preview environments.

### 3.1 Worker Deletion (Cleanup Job)

Update the `cleanup-preview` job:

**Worker Deletion Command**:
- Add `wrangler delete --name admin-api-preview-${{ env.PR_NUMBER }} || true` to the delete worker deployments step

### 3.2 Deploy Admin-API Step

Add deployment step in the `deploy-preview` job after identity-api deployment:

**Deployment Step**:
- Name: `Deploy admin-api (preview)`
- Use cloudflare/wrangler-action@v3
- Working directory: `workers/admin-api`
- Command: deploy with name `admin-api-preview-${{ env.PR_NUMBER }}`, vars for ENVIRONMENT:preview, DB_METHOD:NEON_BRANCH, WEB_APP_URL, API_URL, route pattern

### 3.3 Secrets Upload

Add secrets upload step for admin-api:

**Step** (after deploy):
- Name: `Upload admin-api secrets`
- Use wrangler secret bulk command
- Include DATABASE_URL at minimum
- Follow existing JSON format pattern with echo and pipe to wrangler

### 3.4 Set Admin API URL Step

Add step to set and output the admin API URL:

**Step**:
- Name: `Set Admin API URL`
- Set output with URL pattern: `https://admin-api-preview-${PR_NUMBER}.revelations.studio`
- Export to GITHUB_ENV

### 3.5 PR Comment Updates

Update the final status comment JavaScript:

**Body Update**:
- Add Admin API URL to the preview URLs list in the success branch

---

## Phase 4: GitHub Actions - Production Deployment

Update `.github/workflows/deploy-production.yml` to deploy admin-api to production.

### 4.1 Deploy Admin-API Step

Add deployment step after identity-api deployment:

**Step Structure**:
- Name: `Deploy admin-api`
- Use cloudflare/wrangler-action@v3
- Working directory: `workers/admin-api`
- Command: `deploy --env production`

### 4.2 Upload Secrets Step

Add secrets upload step:

**Step**:
- Name: `Upload admin-api secrets`
- Run upload-worker-secrets.sh script with `production admin-api` arguments
- Include required environment variables (DATABASE_URL, plus any admin-specific secrets)

### 4.3 Health Check Step

Add health check step after secrets upload:

**Step Structure**:
- Name: `Health check - Admin API worker`
- Timeout: 5 minutes
- URL: `https://admin-api.revelations.studio/health`
- Follow existing pattern with SSL wait, retry loop, exponential backoff

### 4.4 Smoke Tests

Update comprehensive smoke tests step:

**Test Addition**:
- Add test for admin-api at `admin-api.revelations.studio/health`
- Update count references from "5 services" to "6 services"

### 4.5 Deployment Notification

Update success notification:

**Echo Statements**:
- Add admin-api URL and health status
- Update worker count in step summary

---

## Phase 5: DNS Management Scripts

Update DNS management scripts to include admin-api subdomains.

### 5.1 Preview DNS Script

Update `.github/scripts/manage-preview-dns.sh`:

**PREVIEW_SUBDOMAINS Array**:
- Add `"admin-api-preview-${PR_NUMBER}"` to the array

This array currently includes: codex-preview, api-preview, content-api-preview, identity-api-preview, auth-preview. Admin-api-preview must be added.

### 5.2 Production DNS Script

Review `.github/scripts/manage-production-dns.sh`:

**Important Note**: The production DNS script documents that workers with `custom_domain: true` in wrangler.jsonc should NOT be listed in PRODUCTION_DOMAINS. Wrangler handles their DNS automatically.

**Action Required**:
- Ensure admin-api wrangler.jsonc uses `custom_domain: true` pattern in production routes (like other API workers)
- No change needed to this script if using custom_domain pattern
- If not using custom_domain pattern, add entry to PRODUCTION_DOMAINS associative array

---

## Phase 6: Secrets Script

Update `.github/scripts/upload-worker-secrets.sh` to handle admin-api.

### 6.1 Worker Case Statement

Add admin-api case to the switch statement:

**New Case**:
- admin-api) Build secrets JSON with DATABASE_URL and R2 bucket vars. Add admin-specific secrets as functionality requires.

**Initial Secrets** (minimum):
- DATABASE_URL
- R2 bucket vars (if admin needs storage access)

**Future Secrets** (as admin features are added):
- Any admin-specific secrets (e.g., admin auth tokens, external service keys)

### 6.2 Usage Documentation

Update the script header comments:

**Workers List**:
- Add `admin-api` to the available workers list in usage comments

---

## Phase 7: Generate Dev Vars Scripts

Update the generate-dev-vars scripts to support admin-api.

### 7.1 Single Worker Script

Update `.github/scripts/generate-worker-dev-vars.sh`:

**Case Validation**:
- Add `admin-api` to the valid worker names in the case statement

**Worker-Specific Variables** (if needed):
- Add admin-api case to add any admin-specific env vars
- Initially may need no extra vars beyond base vars

### 7.2 All Workers Script

Update `.github/scripts/generate-dev-vars.sh`:

**WORKERS Array**:
- Add `"admin-api"` to the array

**Worker-Specific Case** (if needed):
- Add admin-api case if it requires extra vars beyond base vars

---

## Phase 8: E2E Test Infrastructure

Update E2E test helpers to include admin-api.

### 8.1 Worker Manager

Update `e2e/helpers/worker-manager.ts`:

**WORKERS Array**:
- Add new WorkerConfig entry for admin-api:
  - name: `admin-api`
  - port: `42073`
  - cwd: resolved path to `workers/admin-api`
  - healthUrl: `http://localhost:42073/health`

### 8.2 Worker URLs

Update `e2e/helpers/worker-urls.ts`:

**WORKER_URLS Object**:
- Add entry: `admin: process.env.ADMIN_URL || 'http://localhost:42073'`

---

## Phase 9: Turborepo Configuration

Verify `turbo.json` handles admin-api correctly.

### 9.1 Verification

The current turbo.json uses task-based configuration without explicit package filtering. This means:
- `build` task will automatically include admin-api when added to workspace
- `test` task will automatically include admin-api
- Environment variable passthrough already configured for common vars

**Action**:
- Verify admin-api is recognized as workspace member via pnpm-workspace.yaml
- pnpm-workspace.yaml includes `workers/*` which will automatically include admin-api
- No changes needed to turbo.json

### 9.2 Workspace Verification

Confirm pnpm-workspace.yaml pattern includes new worker:
- Current pattern `workers/*` will match `workers/admin-api`
- No changes needed

---

## Deployment Order

The implementation should follow this sequence:

1. **Phase 1**: Create worker directory structure (all local files)
2. **Phase 8**: Update E2E infrastructure (local changes, enables local testing)
3. **Phase 6-7**: Update secrets and dev vars scripts (enables CI testing)
4. **Phase 2**: Update testing workflow (enables CI test job)
5. **Phase 5**: Update DNS scripts (required for preview/prod deployments)
6. **Phase 3**: Update preview deployment workflow
7. **Phase 4**: Update production deployment workflow
8. **Phase 9**: Verify turborepo (should work automatically)

---

## Definition of Done

**Worker Structure**:
- [x] `workers/admin-api/` directory created with all required files
- [x] Worker builds successfully: `pnpm --filter admin-api build`
- [ ] Worker starts locally: `cd workers/admin-api && pnpm dev`
- [ ] Health check responds: `curl http://localhost:42073/health`
- [x] Tests pass: `pnpm --filter admin-api test`

**CI/CD Integration**:
- [ ] Testing workflow runs admin-api-test job on changes
- [ ] Preview deployment creates admin-api preview worker
- [ ] Production deployment creates admin-api production worker
- [ ] All health checks pass in CI

**Infrastructure**:
- [ ] DNS records created for preview deployments
- [ ] Secrets uploaded correctly for all environments
- [ ] E2E tests can start and communicate with admin-api

---

## Unresolved Questions

1. What initial admin functionality should the worker expose? (Empty routes acceptable for infrastructure setup)

2. Will admin-api need R2 storage access? (Affects secrets configuration)

3. Will admin-api need Stripe access? (Affects secrets and dependencies)

4. Should admin-api have a separate authentication mechanism from other workers? (Affects security package integration)

5. What rate limiting preset should admin endpoints use? (Affects wrangler.jsonc and route configuration)

6. Will admin-api need worker-to-worker auth (workerAuth from security package) to call other workers?

7. Should admin-api run on a separate Neon database branch for isolation, or share the main database?
