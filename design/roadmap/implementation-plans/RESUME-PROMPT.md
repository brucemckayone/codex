# 🚀 Clean Context Resume Prompt

**Copy this entire prompt to start a fresh AI conversation and continue the Codex middleware consolidation work.**

---

# Context: Codex Middleware Consolidation Project

I'm resuming work on the Codex platform's middleware consolidation and R2 media lifecycle improvements. This is a large TypeScript/Cloudflare Workers monorepo. I need you to help me understand the current state and plan next steps.

## Current Status (As of 2025-12-26)

### ✅ What's Complete (Phase 1 & 2)

**Phase 1: Middleware Consolidation (100% DONE)**
- Created unified auth middleware pattern (auth-middleware.ts)
- Refactored withPolicy() to be lightweight (delegates to middleware)
- Updated all 6 workers to use createWorker() factory
- Standardized service injection patterns
- Consolidated environment validation
- ALL TESTS PASSING (141+ tests across worker-utils and workers)

**Phase 2: R2 Media Lifecycle Bug Fix (100% DONE)**
- Added database CHECK constraint: status_ready_requires_keys
  - Enforces: status='ready' REQUIRES hlsMasterPlaylistKey, thumbnailKey, durationSeconds
  - Migration file: packages/database/src/migrations/0015_condemned_marauders.sql
- Fixed ContentAccessService to check media.status='ready' before streaming
- Removed r2Key fallback (uses hlsMasterPlaylistKey exclusively)
- Added MediaNotReadyForStreamingError (HTTP 422)
- Updated ALL test fixtures to comply with constraints
  - Fixed test-utils factory (auto-populates required fields)
  - Fixed @codex/admin tests (31 failures → 41 passing)
  - Fixed @codex/content tests (7 failures → 128 passing)
- ALL 27 TEST SUITES PASSING (498+ tests total)

### 📍 Where We Are Now

**Code State:**
- ✅ All code changes committed and working
- ✅ Migration applied to local database
- ✅ All typechecks passing (37/37 packages)
- ✅ Full test suite passing (27/27 tasks)
- ✅ No breaking changes - system fully functional

**Files Changed (Reference):**
```
Phase 1 (Middleware):
- packages/worker-utils/src/auth-middleware.ts (new)
- packages/worker-utils/src/body-parsing-middleware.ts (new)
- packages/worker-utils/src/admin-service-middleware.ts (new)
- packages/worker-utils/src/security-policy.ts (refactored)
- packages/worker-utils/src/worker-factory.ts (updated)
- workers/*/src/index.ts (all 6 workers migrated)
- Deleted: workers/*/src/utils/validate-env.ts (5 files)

Phase 2 (R2 Lifecycle):
- packages/database/src/schema/content.ts (CHECK constraint added)
- packages/database/src/migrations/0015_condemned_marauders.sql (new)
- packages/access/src/services/ContentAccessService.ts (status check added)
- packages/access/src/errors.ts (MediaNotReadyForStreamingError added)
- packages/test-utils/src/factories.ts (auto-populate ready fields)
- packages/content/src/__tests__/*.test.ts (use markAsReady())
- packages/admin/src/__tests__/*.test.ts (use factory with status='ready')
```

### 🎯 Next Steps (Options)

**Option A: Deploy Current Changes (RECOMMENDED)**
- Phase 1 & 2 complete and tested
- Ready for staging deployment
- All tests green, no regressions

**Option B: Phase 2.3 - Integration Tests (OPTIONAL)**
- Add explicit tests for media lifecycle states
- Test CHECK constraint violations
- Add schema-constraints.test.ts
- REASON TO DEFER: Greenfield project, existing tests cover the logic

**Option C: Phase 3 - Organizational Cleanup (DEFERRED)**
- Rename @codex/identity → @codex/organization
- Document test-utils pattern
- Clean up organization-api routes
- REASON TO DEFER: No functional impact, purely cosmetic

## Your Task

1. **First, understand the codebase:**
   - Read `/Users/brucemckay/development/Codex/CLAUDE.md` (project overview)
   - Read `design/roadmap/implementation-plans/MIDDLEWARE-CONSOLIDATION-PROGRESS.md` (detailed progress)
   - Explore the packages structure (12 packages + 6 workers)

2. **Verify current state:**
   ```bash
   pnpm test                    # Should show 27/27 tasks successful
   pnpm typecheck               # Should show 37/37 packages passing
   git status                   # Check for uncommitted changes
   ```

3. **Recommend next actions based on:**
   - User's goals (deploy? more features? cleanup?)
   - Risk assessment (is staging deployment safe?)
   - Priority (functional vs organizational work)

## Important Context About This Codebase

**Architecture:**
- Monorepo with 12 packages (foundation, service, utility layers)
- 6 Cloudflare Workers (auth, content-api, identity-api, ecom-api, organization-api, admin-api)
- PostgreSQL database via Neon (serverless)
- R2 for media storage
- Drizzle ORM for type-safe queries

**Key Patterns:**
- All services extend BaseService (from @codex/service-errors)
- All workers use createWorker() factory (from @codex/worker-utils)
- Multi-tenant: scoped by creatorId and/or organizationId
- Soft deletes: deletedAt timestamp (not physical deletion)
- Media lifecycle: uploading → uploaded → transcoding → ready/failed

**Testing Strategy:**
- Integration tests use real database (Neon ephemeral branches in CI)
- test-utils package provides factories and helpers
- All tests must respect CHECK constraints and scoping

**Critical Files to Understand:**
- `packages/database/src/schema/content.ts` - Media lifecycle constraints
- `packages/access/src/services/ContentAccessService.ts` - Streaming logic
- `packages/worker-utils/src/worker-factory.ts` - Worker middleware
- `packages/test-utils/src/factories.ts` - Test data generation

## Questions to Ask Me

1. Do you want to deploy Phase 1 & 2 changes to staging?
2. Should we add Phase 2.3 integration tests or defer?
3. Should we tackle Phase 3 organizational cleanup or skip it?
4. Are there other priorities or bugs you want addressed?
5. Do you need help understanding any specific part of the codebase?

## How to Explore the Codebase Effectively

**For architecture understanding:**
```bash
# Read the master index
cat /Users/brucemckay/development/Codex/CLAUDE.md

# Check package structure
ls packages/*/CLAUDE.md

# See worker implementations
ls workers/*/CLAUDE.md
```

**For specific domain understanding:**
```bash
# Content & media lifecycle
cat packages/content/CLAUDE.md

# Access control & streaming
cat packages/access/CLAUDE.md

# Middleware & worker patterns
cat packages/worker-utils/CLAUDE.md

# Database schema & migrations
cat packages/database/CLAUDE.md
```

**For finding specific code:**
```bash
# Search for patterns
rg "CHECK constraint" packages/

# Find test files
fd "test.ts$" packages/

# Locate middleware
fd "middleware" packages/worker-utils/
```

**I'm ready to help - what would you like to focus on?**
