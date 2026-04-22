# Fix 4: Trusted Internal Caller Pattern

> **Parent:** [Auth Performance Investigation](../auth-performance-investigation.md)
> **Priority:** HIGH — eliminates redundant session validation across all workers
> **Impact:** Eliminates 3-4 redundant session validations per page load (~600ms saved)
> **Effort:** Large (design + security review + implementation = 1-2 weeks)

---

## Problem

SvelteKit validates the session in `hooks.server.ts`, then each downstream worker call **re-validates the same session independently**. For an authenticated org page load:

| Validation Point | Cost | Necessary? |
|---|---|---|
| SvelteKit hooks → auth worker | ~150ms | YES (authoritative) |
| Worker 1 (org-api) KV/DB | ~10-200ms | NO — already validated |
| Worker 2 (ecom-api) KV/DB | ~10-200ms | NO — already validated |
| Worker 3 (content-api/access) KV/DB | ~10-200ms | NO — already validated |

The session was validated **once**. Workers 1-3 are redundant.

---

## Design: HMAC-Based Trusted Caller

Reuse the existing `workerAuth` pattern (`@codex/security`) for SvelteKit → worker calls.

### Current Flow

```
SvelteKit hooks.server.ts
  └── api.auth.getSession() → validates cookie, returns { user, session }
  └── locals.user = user

SvelteKit server load
  └── createServerApi(platform, cookies)
        └── api.org.isFollowing(orgId)
              └── HTTP request with Cookie: codex-session=XXX
                    └── Worker procedure() → KV/DB session validation (REDUNDANT)
```

### Proposed Flow

```
SvelteKit hooks.server.ts
  └── api.auth.getSession() → validates cookie, returns { user, session }
  └── locals.user = user
  └── locals.userId = user.id

SvelteKit server load
  └── createTrustedApi(platform, locals.user)
        └── api.org.isFollowing(orgId)
              └── HTTP request with:
                    X-Worker-Signature: HMAC(timestamp:body, WORKER_SHARED_SECRET)
                    X-Worker-Timestamp: 1234567890
                    Body includes: { ...originalBody, _trustedUserId: user.id, _trustedUserRole: user.role }
                    └── Worker procedure() → HMAC validation ONLY (no KV/DB session check)
                          └── ctx.user = { id, role } extracted from SIGNED body
```

> **SECURITY NOTE:** The user identity MUST be included in the HMAC-signed body, NOT
> as separate headers. `workerFetch` computes `HMAC-SHA256(timestamp:body, secret)` —
> headers are NOT covered by the signature. Putting userId in an unsigned header would
> allow header tampering. By embedding it in the body, HMAC guarantees integrity.

### New Auth Policy: `auth: 'trusted'`

```typescript
// In procedure policy, add a new auth mode
procedure({
  policy: {
    auth: 'trusted',  // NEW: accepts either session cookie OR HMAC + trusted headers
  },
  handler: async (ctx) => {
    // ctx.user is set regardless of auth method
    // ctx.session may be null for trusted calls (no session object)
  },
})
```

**How `'trusted'` works:**
1. Check for `X-Worker-Signature` header → if present, validate HMAC + extract user from `X-Trusted-User-*` headers
2. If no HMAC headers → fall back to normal session validation (cookie → KV → DB)
3. This means the same endpoint works for both SvelteKit internal calls AND direct browser calls

---

## Implementation

### Step 1: Create `createTrustedApi()` Factory

```typescript
// apps/web/src/lib/server/api.ts — NEW function

import { workerFetch } from '@codex/security';
import { getServiceUrl } from '@codex/constants';

export function createTrustedApi(
  platform: App.Platform | undefined,
  user: { id: string; role: string } | null
) {
  const secret = platform?.env?.WORKER_SHARED_SECRET;

  // If no user or no secret, fall back to cookie-based API
  if (!user || !secret) {
    return null; // Caller should fall back to createServerApi
  }

  return {
    async request<T>(worker: string, path: string, options?: RequestInit): Promise<T> {
      const url = getServiceUrl(worker, platform?.env);

      // CRITICAL: User identity goes IN the signed body, NOT as headers.
      // workerFetch HMAC only covers timestamp:body — headers are unsigned.
      const originalBody = options?.body ? JSON.parse(options.body as string) : {};
      const trustedBody = JSON.stringify({
        ...originalBody,
        _trustedUserId: user.id,
        _trustedUserRole: user.role,
      });

      const response = await workerFetch(
        `${url}${path}`,
        {
          ...options,
          method: options?.method ?? 'POST', // Must be POST/PUT for body
          body: trustedBody,
          headers: {
            ...options?.headers,
            'Content-Type': 'application/json',
          },
        },
        secret
      );

      if (!response.ok) throw new ApiError(response.status, await response.text());
      if (response.status === 204) return null as T;
      return response.json();
    },
    // ... namespace methods (org, content, etc.)
  };
}
```

> **Note on GET requests:** `workerFetch` requires a string body for HMAC signing.
> For GET-like queries, convert to POST with body instead of query params, or encode
> the query params as body: `body: JSON.stringify({ orgId, _trustedUserId: user.id })`.
> The worker endpoint can accept both patterns.
```

### Step 2: Add `'trusted'` Policy to `procedure()`

```typescript
// packages/worker-utils/src/procedure/helpers.ts — in enforcePolicyInline

if (mergedPolicy.auth === 'trusted') {
  // Try HMAC first (trusted internal caller)
  const signature = c.req.header('X-Worker-Signature');
  if (signature) {
    // Validate HMAC — this covers timestamp + body (including embedded userId)
    const isValid = await validateWorkerSignature(c, env.WORKER_SHARED_SECRET);
    if (isValid) {
      // Extract user from SIGNED BODY (not headers — headers are unsigned!)
      const body = await c.req.json();
      const userId = body._trustedUserId;
      const userRole = body._trustedUserRole;
      if (userId) {
        c.set('user', { id: userId, role: userRole || 'user' });
        c.set('session', null);
        // Strip trusted fields from body so handler sees clean input
        delete body._trustedUserId;
        delete body._trustedUserRole;
        return; // Skip session validation entirely
      }
    }
  }

  // Fall back to normal session validation (cookie → KV → DB)
  // Same as auth: 'required'
  const sessionMiddleware = createSessionMiddleware({ required: true });
  // ...existing session validation logic...
}
```

### Step 3: Migrate Routes to `auth: 'trusted'`

Gradually migrate routes that are called from SvelteKit server loads:

```typescript
// Phase 1: Routes called from org layout/page server loads
// These are the highest-impact routes

// org-api: isFollowing
procedure({ policy: { auth: 'trusted' }, ... })

// ecom-api: getCurrent (subscription)
procedure({ policy: { auth: 'trusted' }, ... })

// content-api: getUserLibrary
procedure({ policy: { auth: 'trusted' }, ... })
```

### Step 4: Update SvelteKit Server Loads

```typescript
// _org/[slug]/+layout.server.ts
const trustedApi = createTrustedApi(platform, locals.user);
const api = createServerApi(platform, cookies); // fallback for public endpoints

// Use trustedApi for auth'd calls (no session re-validation)
const isFollowing = trustedApi
  ? trustedApi.org.isFollowing(typedOrg.id).catch(() => false)
  : api.org.isFollowing(typedOrg.id).then(r => r.following).catch(() => false);
```

---

## Security Considerations

### What Could Go Wrong?

| Risk | Mitigation |
|---|---|
| HMAC secret compromised | Same risk as existing worker-to-worker auth — rotate `WORKER_SHARED_SECRET` |
| Body tampering (userId) | HMAC signs `timestamp:body` — any body modification invalidates the signature |
| Replay attack | Existing timestamp validation (±60s, 5min max) prevents replay |
| SvelteKit compromise | If SvelteKit is compromised, attacker already has cookie access — trusted caller adds no new attack surface |
| ~~Header spoofing~~ | ~~RESOLVED: userId is in the signed body, not unsigned headers~~ |

### What This Does NOT Do

- Does NOT bypass rate limiting (still enforced per-IP)
- Does NOT bypass org membership checks (still queries membership, but cached now via Fix 2)
- Does NOT bypass role checks (role is forwarded, not elevated)
- Does NOT work for direct browser → worker calls (no HMAC headers = falls back to cookie auth)

### Security Review Checklist

- [ ] HMAC covers body + headers + timestamp (already implemented in `workerAuth`)
- [ ] `X-Trusted-User-Id` cannot be injected by external callers (HMAC must validate first)
- [ ] Trusted calls set `ctx.session = null` — handlers that need session data must handle this
- [ ] Rate limiting still applies to trusted calls
- [ ] Org membership check still runs (but now cached via Fix 2)

---

## Rollout Strategy

1. **Phase 1:** Add `auth: 'trusted'` policy type (backward compatible — `'required'` still works)
2. **Phase 2:** Create `createTrustedApi()` factory in SvelteKit
3. **Phase 3:** Migrate 3 highest-impact routes (isFollowing, getCurrent, getUserLibrary)
4. **Phase 4:** Measure impact, then migrate remaining auth'd routes used in server loads

---

## Files to Modify

| File | Change |
|---|---|
| `packages/worker-utils/src/procedure/helpers.ts` | Add `'trusted'` auth policy handling |
| `packages/worker-utils/src/procedure/types.ts` | Add `'trusted'` to auth policy type |
| `packages/shared-types/src/types.ts` | Add `'trusted'` to `AuthPolicy` type if shared |
| `apps/web/src/lib/server/api.ts` | Add `createTrustedApi()` factory |
| `apps/web/src/routes/_org/[slug]/+layout.server.ts` | Use `createTrustedApi` for auth'd calls |
| `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` | Use `createTrustedApi` for getUserLibrary |
| Worker route files (3 initially) | Change `auth: 'required'` → `auth: 'trusted'` |

---

## Risks

- **Medium:** `ctx.session = null` for trusted calls — some handlers may assume session exists. Audit all handlers before migration.
- **Low:** HMAC computation adds ~1ms per call (negligible vs 200ms saved)
- **Low:** If `WORKER_SHARED_SECRET` isn't set in dev, falls back to cookie auth (graceful)
