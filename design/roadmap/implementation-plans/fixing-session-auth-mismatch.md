# Session Authentication Mismatch Fix

## Status: IN PROGRESS

## Problem Summary

E2E tests fail with 401 errors on non-auth workers (content-api, organization-api, identity-api, etc.) despite the auth worker successfully validating sessions (returning 200).

**Symptoms:**
- `[DEBUG] Session response status: 200` (auth worker validates session correctly)
- `401 UNAUTHORIZED` on subsequent requests to content-api, organization-api, etc.
- All tests that require authentication after login fail

**Root Cause:**
Cookie name mismatch between Better Auth and `withPolicy()` middleware:

1. Better Auth uses cookie format: `${prefix}.${cookie_name}` with default prefix "better-auth"
2. Our auth-config.ts sets `cookieName: 'codex-session'` but this results in `better-auth.codex-session` NOT `codex-session`
3. Actually, Better Auth appears to use `better-auth.session_token` regardless of our cookieName setting
4. The `withPolicy()` middleware in security-policy.ts tries to match these cookie names but may have token format issues

**Key Files:**
- `workers/auth/src/auth-config.ts` - Better Auth configuration
- `packages/worker-utils/src/security-policy.ts` - withPolicy() session validation
- `packages/security/src/session-auth.ts` - optionalAuth/requireAuth middleware
- `e2e/helpers/cookies.ts` - E2E test cookie extraction

---

## Investigation Completed

### 1. Cookie Naming (Better Auth Docs)
From Better Auth documentation:
- Cookies follow format `${prefix}.${cookie_name}`
- Default prefix is "better-auth"
- Cookie names: `session_token`, `session_data`
- To change prefix, use `advanced.cookiePrefix`
- To customize cookie names, use `advanced.cookies`

### 2. Current Configuration (auth-config.ts)
```typescript
session: {
  cookieName: 'codex-session',  // May not work as expected
  storeSessionInDatabase: true,
  cookieCache: {
    enabled: true,
    maxAge: 60 * 5,
  },
}
```

### 3. E2E Cookie Extraction (e2e/helpers/cookies.ts)
The E2E tests extract `better-auth.session_token` cookie, confirming Better Auth uses its default cookie naming.

### 4. withPolicy() Cookie Matching (security-policy.ts)
Lines 489-498 try these patterns in order:
1. `codex-session=([^;]+)`
2. `__Secure-codex-session=([^;]+)`
3. `better-auth\.session_token=([^;]+)`
4. `__Secure-better-auth\.session_token=([^;]+)`

So `withPolicy()` SHOULD find `better-auth.session_token`. The issue is likely in token format/database lookup.

### 5. Token Format Issue
- Cookie value is signed: `{token}.{signature}`
- withPolicy() splits on `.` to get token part
- Database stores... what exactly? Need to verify.

---

## Debug Logging Added

Added detailed logging to security-policy.ts to trace:
1. Full cookie header value
2. Extracted raw token
3. Split token vs full token
4. Database query results

---

## Fix Options

### Option A: Fix Token Lookup (Recommended)
Ensure `withPolicy()` queries database with the correct token format that Better Auth stores.

**Steps:**
1. Run test with debug logging to see actual token values
2. Compare cookie token with database session.token value
3. Fix the split/lookup logic to match

### Option B: Use Consistent Cookie Naming
Configure Better Auth to use `codex-session` properly.

**Steps:**
1. Update auth-config.ts to use `advanced.cookiePrefix: ''` and `advanced.cookies.session_token.name: 'codex-session'`
2. Update E2E cookie extraction to match
3. Update withPolicy() cookie matching to prioritize `codex-session`

### Option C: Proxy All Session Validation Through Auth Worker
Have non-auth workers call auth worker's `/api/auth/get-session` endpoint.

**Downside:** Adds latency to every authenticated request.

---

## Implementation Plan

### Phase 1: Debug & Understand (Current)
- [x] Added debug logging to withPolicy()
- [ ] Run E2E test and capture worker logs
- [ ] Compare cookie token value with database session.token
- [ ] Identify exact mismatch

### Phase 2: Fix Token Lookup
- [ ] If token format differs, update split logic in withPolicy()
- [ ] If database stores different value, update query

### Phase 3: Verify
- [ ] Run E2E tests for content-creation
- [ ] Run full E2E test suite
- [ ] Ensure all 401 errors resolved

---

## Continuation Prompt

```
I'm debugging the session authentication mismatch between Better Auth and withPolicy().

Current status:
- Auth worker validates sessions correctly (returns 200)
- Non-auth workers (content-api, organization-api) return 401 UNAUTHORIZED
- E2E tests extract `better-auth.session_token` cookie
- withPolicy() tries to match this cookie and query the database

Debug logging has been added to packages/worker-utils/src/security-policy.ts.

NEXT STEPS:
1. Build the worker-utils package: `pnpm --filter @codex/worker-utils build`
2. Run E2E test and capture content-api worker logs:
   ```bash
   cd /Users/brucemckay/development/Codex/e2e
   pnpm test tests/02-content-creation.test.ts 2>&1 | tee test-output.log
   ```
   Then check the content-api worker terminal for [withPolicy] debug logs.

3. Compare the token in the cookie with what's stored in the sessions.token column

4. Fix the token matching logic based on findings

Key files to review:
- packages/worker-utils/src/security-policy.ts (lines 486-590)
- workers/auth/src/auth-config.ts
- e2e/helpers/cookies.ts

The fix is likely one of:
- Better Auth stores the FULL signed token, not just the base token
- The token needs to be looked up differently
- Cookie prefix configuration needs to be updated in Better Auth
```

---

## Related Documents
- `fixing-better-auth0sessions.md` - Previous session caching unification (complete)
- Better Auth Cookies Documentation: https://www.better-auth.com/docs/concepts/cookies
