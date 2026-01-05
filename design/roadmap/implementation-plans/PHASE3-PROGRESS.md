# Phase 3: Organizational Cleanup - Progress Report

**Status**: In Progress (Task 1 ✅ Complete, Task 2 ⏸️ Paused)
**Last Updated**: 2025-12-29 12:52 PST
**Plan File**: `~/.claude/plans/cozy-tickling-pudding.md`

---

## ✅ Task 1: @codex/identity → @codex/organization Rename (COMPLETE)

### What Was Done

**Directory & Package Rename:**
- ✅ Renamed `packages/identity/` → `packages/organization/`
- ✅ Updated `packages/organization/package.json` name to `@codex/organization`
- ✅ Updated build scripts to use `vite.config.organization.ts`
- ✅ Updated test scripts to use `vitest.config.organization.ts`
- ✅ Renamed config files accordingly

**TypeScript Configuration:**
- ✅ Updated root `tsconfig.json` path aliases (lines 58-59)
- ✅ Updated root `tsconfig.json` workspace reference (line 13)
- ✅ Updated `vitest.config.organization.ts` packageName

**Dependencies Updated:**
- ✅ `packages/content/package.json`
- ✅ `packages/worker-utils/package.json`
- ✅ `workers/organization-api/package.json`
- ✅ `e2e/package.json`

**Source Code Imports Updated:**
- ✅ `packages/content/src/types.ts` (line 15)
- ✅ `packages/content/src/__tests__/integration.test.ts` (line 19)
- ✅ `packages/worker-utils/src/service-middleware.ts` (lines 24-25)
- ✅ `workers/organization-api/src/routes/organizations.ts` (lines 24, 28)

**Documentation Updated:**
- ✅ `packages/organization/CLAUDE.md` (title, description, all examples)

**Workspace Regenerated:**
- ✅ Ran `pnpm install` to update lockfile and symlinks

### Verification Results

**TypeScript:**
```bash
pnpm typecheck
# ✅ Tasks: 37 successful, 37 total
```

**Tests:**
```bash
pnpm test
# ✅ Tasks: 27 successful, 27 total
# ✅ Test Files: 498+ tests passing across all suites
```

**Package Build:**
```bash
pnpm --filter @codex/organization build
# ✅ Built successfully in 1.23s
```

**No Remaining References:**
```bash
grep -r "@codex/identity" packages/ workers/ --exclude-dir=node_modules
# ✅ No results (clean)
```

---

## ⏸️ Task 2: Organization-API Refactoring (PAUSED - Design Decision)

### Current Situation

We started Task 2 by refactoring `workers/organization-api/src/routes/settings.ts` to remove custom middleware and create the PlatformSettingsFacade inline. However, this created **inconsistency** with the rest of the codebase.

### The Inconsistency

**organizations.ts** (uses middleware - CONSISTENT):
```typescript
import { withOrganizationService } from '@codex/worker-utils';

app.use('/*', withOrganizationService());

function getService(c: Context<HonoEnv>): OrganizationServiceType {
  const service = c.get('organizationService');
  if (!service) throw new InternalServiceError(...);
  return service;
}

app.post('/', withPolicy(...), createAuthenticatedHandler({
  handler: async (c, ctx) => {
    const service = getService(c);
    // Use service...
  }
}));
```

**settings.ts** (AFTER initial refactor - INCONSISTENT):
```typescript
// No middleware!
// Created inline with manual cleanup

function createFacade(env, orgId) {
  const { db, cleanup } = createPerRequestDbClient(env);
  const facade = new PlatformSettingsFacade({ db, ... });
  return { facade, cleanup };
}

app.get('/', withPolicy(...), createAuthenticatedHandler({
  handler: async (c, ctx) => {
    const { facade, cleanup } = createFacade(ctx.env, orgId);
    try {
      // Use facade...
    } finally {
      await cleanup();
    }
  }
}));
```

### Decision Made

**Keep ALL service injection consistent via middleware pattern.**

All workers should follow the same pattern:
1. Service middleware in `@codex/worker-utils/src/service-middleware.ts`
2. Applied via `app.use('/*', withServiceName())`
3. Retrieved via helper function `getService(c)`
4. Automatic cleanup handled by middleware

### What Needs to Happen (Corrected Approach)

Instead of removing the middleware, we should **standardize it**:

1. ✅ **Keep** `workers/organization-api/src/middleware/settings-facade.ts` logic
2. 🔄 **Move** it to `packages/worker-utils/src/service-middleware.ts` as `withPlatformSettingsFacade()`
3. 🔄 **Export** from `packages/worker-utils/src/index.ts`
4. 🔄 **Revert** `workers/organization-api/src/routes/settings.ts` to use middleware
5. 🔄 **Delete** the worker-specific middleware file after migration
6. ✅ **Verify** typecheck and tests

### Files Changed (Task 2 - IN PROGRESS)

**Modified:**
- 🔄 `workers/organization-api/src/routes/settings.ts` (NEEDS REVERT to middleware pattern)

**To Be Modified:**
- ⏳ `packages/worker-utils/src/service-middleware.ts` (add withPlatformSettingsFacade)
- ⏳ `packages/worker-utils/src/index.ts` (export middleware)
- ⏳ `workers/organization-api/src/routes/settings.ts` (revert to use middleware)

**To Be Deleted:**
- ⏳ `workers/organization-api/src/middleware/settings-facade.ts` (after moving to worker-utils)
- ⏳ `workers/organization-api/src/middleware/` (directory if empty)

---

## 📋 Next Steps (Resume Instructions)

### For Continuing This Session:

1. **Move the middleware:**
   ```bash
   # Read the source
   cat workers/organization-api/src/middleware/settings-facade.ts

   # Read the destination
   cat packages/worker-utils/src/service-middleware.ts
   ```

2. **Add `withPlatformSettingsFacade()` to service-middleware.ts:**
   - Copy the logic from settings-facade.ts
   - Follow the same pattern as `withOrganizationService()`
   - Include module augmentation for `settingsFacade` in Variables

3. **Export from worker-utils:**
   ```typescript
   // packages/worker-utils/src/index.ts
   export { withPlatformSettingsFacade } from './service-middleware';
   ```

4. **Revert settings.ts:**
   - Add back: `import { withSettingsFacade } from '@codex/worker-utils';`
   - Add back: `app.use('*', withSettingsFacade());`
   - Add back: `getSettingsFacade(c)` helper
   - Remove: `createFacade()` helper
   - Remove: try/finally blocks from all handlers

5. **Clean up:**
   ```bash
   rm workers/organization-api/src/middleware/settings-facade.ts
   rmdir workers/organization-api/src/middleware
   ```

6. **Verify:**
   ```bash
   pnpm typecheck
   pnpm test
   ```

### For New Session (Zero Context):

Copy the "RESUME FROM HERE" section at the top of `~/.claude/plans/cozy-tickling-pudding.md` and paste it into your conversation. It contains all context needed to continue.

---

## 🎯 Success Criteria

### Task 1 (✅ DONE):
- [x] Package name is @codex/organization
- [x] Directory is packages/organization
- [x] All imports use @codex/organization
- [x] tsconfig.json path aliases updated
- [x] pnpm-lock.yaml regenerated
- [x] No references to @codex/identity in source code
- [x] All tests pass (27/27 suites)
- [x] All typechecks pass (37/37 packages)

### Task 2 (⏸️ IN PROGRESS):
- [ ] PlatformSettingsFacade middleware in @codex/worker-utils
- [ ] settings.ts uses middleware (matches organizations.ts pattern)
- [ ] No worker-specific middleware files
- [ ] All organization-api tests pass
- [ ] All typechecks pass
- [ ] Consistent service injection pattern across all workers

---

## 📊 Overall Progress

**Phase 3 Completion: 50%**
- ✅ Task 1: @codex/identity rename - **100% complete**
- ⏸️ Task 2: Organization-api refactoring - **30% complete** (paused for design decision)

**Remaining Work:**
- Move settings-facade middleware to worker-utils (~15 min)
- Revert settings.ts to use middleware (~10 min)
- Verify and test (~10 min)

**Estimated Time to Complete:** 35 minutes

---

**Document Version**: 1.0
**Author**: Claude (Sonnet 4.5)
**Plan Reference**: `~/.claude/plans/cozy-tickling-pudding.md`
