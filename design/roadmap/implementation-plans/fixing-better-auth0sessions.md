# Session Caching Unification Plan

## Status: COMPLETE

All phases have been implemented and tested. Typecheck passes. Unit tests pass.

---

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: KV Secondary Storage Adapter | COMPLETE | Created `packages/security/src/kv-secondary-storage.ts` |
| Phase 2: Better Auth secondaryStorage | COMPLETE | Updated `workers/auth/src/auth-config.ts` |
| Phase 3: Remove session-cache.ts | COMPLETE | Deleted middleware, updated imports |
| Phase 4: AUTH_SESSION_KV bindings | COMPLETE | Added to all 6 workers' wrangler.jsonc |
| Phase 5: session-auth.ts KV support | COMPLETE | Auto-detects AUTH_SESSION_KV from context |
| Phase 6: withPolicy() KV caching | COMPLETE | Updated `security-policy.ts` with KV caching |
| Phase 7: Update shared types | COMPLETE | Added AUTH_SESSION_KV to Bindings type |
| Testing | COMPLETE | Typecheck + unit tests pass |

---

## Key Implementation Details

### Auto-detection of KV from Context

The session auth middleware now automatically detects `AUTH_SESSION_KV` from the worker context if not explicitly passed. This means workers don't need to manually pass the KV namespace - it's picked up automatically.

```typescript
// In optionalAuth/requireAuth (session-auth.ts):
const kv = config?.kv ||
  ((c.env as { AUTH_SESSION_KV?: KVNamespace })?.AUTH_SESSION_KV as KVNamespace | undefined);
```

### withPolicy() KV Caching

The `withPolicy()` middleware in `security-policy.ts` now includes KV caching for session validation. It:
1. Checks KV cache first (key: `session:{token}`)
2. Falls back to database if cache miss
3. Caches the session after database lookup
4. Uses fire-and-forget pattern for cache writes

### Files Modified

**New Files:**
- `packages/security/src/kv-secondary-storage.ts`

**Modified Files:**
- `packages/security/src/index.ts` - Export new adapter
- `packages/security/src/session-auth.ts` - Auto-detect KV from context
- `workers/auth/src/auth-config.ts` - Add secondaryStorage
- `workers/auth/src/middleware/index.ts` - Remove session-cache export
- `workers/auth/src/index.ts` - Remove session-cache middleware
- `packages/worker-utils/src/security-policy.ts` - Add KV caching
- `packages/shared-types/src/worker-types.ts` - Add AUTH_SESSION_KV binding
- `workers/admin-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/content-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/identity-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/ecom-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/organization-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/notifications-api/wrangler.jsonc` - Add AUTH_SESSION_KV
- `workers/admin-api/src/index.ts` - Removed function accessor for KV

**Deleted Files:**
- `workers/auth/src/middleware/session-cache.ts`

---

## Testing

```bash
# Typecheck passed
pnpm typecheck

# Unit tests passed
pnpm --filter @codex/security test
pnpm --filter @codex/worker-utils test
```

---

## Next Steps for E2E Testing

Run the E2E tests to verify the session caching unification resolves the connection exhaustion issue:

```bash
cd e2e
pnpm test tests/06-admin-dashboard.test.ts
pnpm test tests/07-platform-settings.test.ts
```

---

## Prompt for Next Contextless Agent

```
The session caching unification plan has been fully implemented. All phases are complete:

1. Created KV adapter for Better Auth's secondaryStorage in @codex/security
2. Configured Better Auth to use secondaryStorage for session caching
3. Removed duplicate session-cache.ts middleware from auth worker
4. Added AUTH_SESSION_KV binding to all workers' wrangler.jsonc files
5. Updated session-auth.ts to auto-detect KV from context
6. Added KV caching to withPolicy() in security-policy.ts
7. Updated shared-types with AUTH_SESSION_KV binding

Typecheck passes. Unit tests pass.

NEXT STEPS:
1. Run E2E tests to verify the fix resolves connection exhaustion:
   - cd e2e && pnpm test tests/06-admin-dashboard.test.ts
   - cd e2e && pnpm test tests/07-platform-settings.test.ts

2. If E2E tests still fail with 401 errors, check:
   - Console logs for "[withPolicy] Session found in KV cache" or "from database"
   - Ensure cache key format matches between Better Auth and session-auth.ts

3. If all tests pass, commit the changes with message:
   "feat: unify session caching with KV across all workers"
```

---

## Original Plan Reference

<details>
<summary>Click to expand original plan</summary>

### Problem Statement

E2E tests failing due to database connection exhaustion during session validation. Root cause: session auth middleware in non-auth workers (admin-api, content-api, etc.) is NOT using KV caching - every request hits the database.

### Chosen Approach: Unified KV Caching via Better Auth secondaryStorage

Principles:
1. Session validation logic specified ONCE, not duplicated
2. Single cache (AUTH_SESSION_KV) with DB as source of truth
3. KV adapter implemented in @codex/security package (reusable)
4. AUTH_SESSION_KV binding available for ALL workers

### Success Criteria

- E2E tests pass without session-related 401 errors
- No "Database query error in session authentication" errors
- Auth worker doesn't crash mid-test
- Session caching uses single KV namespace across all workers
- Session validation logic exists in ONE place (@codex/security)

</details>
