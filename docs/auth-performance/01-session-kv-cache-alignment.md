# Fix 1: Session KV Cache Alignment

> **Parent:** [Auth Performance Investigation](../auth-performance-investigation.md)
> **Priority:** CRITICAL — this is the root cause multiplier for all auth latency
> **Impact:** -200ms per auth call × 4-5 calls per page = -800-1000ms total
> **Effort:** Medium (2-4 hours investigation + fix)

---

## Problem

The session KV cache (`AUTH_SESSION_KV`) appears to have a near-zero hit rate for cross-worker validation. Every authenticated worker call falls through to Neon DB (~200ms each). With 4-5 authenticated calls per org page load, that's 800-1000ms in redundant DB queries.

### Root Cause: Token Key Mismatch

**BetterAuth** writes sessions to KV via `createKVSecondaryStorage`:
- `packages/security/src/kv-secondary-storage.ts:106-112`
- The adapter is passive — it stores whatever key BetterAuth provides
- BetterAuth's internal key format is opaque to us

**Worker auth middleware** reads sessions from KV:
- `packages/worker-utils/src/auth-middleware.ts:72-92`
- Extracts cookie token, URL-decodes it, splits on `.` (line 233)
- Tries two key formats: `session:{splitToken}` and `{splitToken}` (line 78)
- Writes back using: `session:{splitToken}` (line 108)

**The mismatch:** If BetterAuth's internal key differs from `session:{splitToken}`, the cache that BetterAuth warms is invisible to workers. Workers then create their OWN cache entries with a different key, which BetterAuth never reads. Two ships passing in the night.

### Evidence

```typescript
// auth-middleware.ts:230-233 — Worker token extraction
const fullToken = decodeURIComponent(rawToken);
const splitToken = fullToken.split('.')[0] || fullToken;

// auth-middleware.ts:78 — Worker KV read keys
const keys = [`session:${sessionToken}`, sessionToken];

// auth-middleware.ts:108 — Worker KV write key
await kv.put(`session:${sessionToken}`, JSON.stringify(data), { ... });

// kv-secondary-storage.ts:106-109 — BetterAuth KV write
async set(key: string, value: string, ttl?: number): Promise<void> {
  await kv.put(key, value, { expirationTtl: ttl });
  // key is whatever BetterAuth passes — format unknown
}
```

---

## Investigation Steps

### Step 1: Audit BetterAuth's Key Format

Add temporary logging to `createKVSecondaryStorage` to see what BetterAuth actually writes:

```typescript
// packages/security/src/kv-secondary-storage.ts — TEMPORARY diagnostic
async set(key: string, value: string, ttl?: number): Promise<void> {
  console.log('[KV-DIAG] BetterAuth SET key:', key, 'ttl:', ttl);
  // ...existing code...
}

async get(key: string): Promise<unknown> {
  console.log('[KV-DIAG] BetterAuth GET key:', key);
  // ...existing code...
}
```

Login with test credentials, then check logs. Expected output reveals:
- Whether BetterAuth uses `session:{token}` or just `{token}` or some other format
- Whether the token in the key matches what appears in the cookie

### Step 2: Compare Token Values

Add temporary logging to the auth middleware:

```typescript
// packages/worker-utils/src/auth-middleware.ts:228-240 — TEMPORARY diagnostic
const fullToken = decodeURIComponent(rawToken);
const splitToken = fullToken.split('.')[0] || fullToken;
console.log('[KV-DIAG] Worker READ fullToken:', fullToken.slice(0, 16) + '...');
console.log('[KV-DIAG] Worker READ splitToken:', splitToken.slice(0, 16) + '...');
console.log('[KV-DIAG] Worker trying keys:', [`session:${splitToken}`, splitToken]);
```

### Step 3: Cross-reference

If BetterAuth writes key `X` and the worker reads key `Y`, that's the permanent miss.

---

## Fix Design

Once the key format is known, there are two approaches:

### Option A: Align Worker to BetterAuth's Format (Preferred)

If BetterAuth uses the full token (no split):

```typescript
// auth-middleware.ts:228-233 — REMOVE the split logic
const sessionToken = decodeURIComponent(rawToken);
// Remove: const splitToken = fullToken.split('.')[0] || fullToken;

// auth-middleware.ts:78 — Use only the format BetterAuth uses
const keys = [`session:${sessionToken}`, sessionToken];
```

### Option B: Normalize Both to Same Format

If the formats truly differ, add a wrapper in `createKVSecondaryStorage` that normalizes keys:

```typescript
export function createKVSecondaryStorage(kv: KVNamespace): SecondaryStorage {
  return {
    async set(key: string, value: string, ttl?: number): Promise<void> {
      // Write with BOTH key formats so workers can find it
      const normalizedKey = `session:${extractToken(key)}`;
      await kv.put(normalizedKey, value, ttl ? { expirationTtl: ttl } : {});
    },
    // ...
  };
}
```

### Option C: Dual-Write (Belt and Suspenders)

Write to both key formats on cache miss (worker side already does this). Add a similar dual-write in BetterAuth's adapter.

---

## Validation

After the fix:

1. Login with test credentials
2. Visit an org page (e.g., `of-blood-and-bones.lvh.me:3000/`)
3. Check worker logs for `[SessionMiddleware] User authenticated from cache`
4. Should see cache hits on the SECOND request (first request warms cache)
5. Measure with curl:

```bash
# Before: expect 200ms+ per auth call
# After: expect 10-20ms per auth call (KV hit)
curl -s -o /dev/null -w "Total: %{time_total}s\n" \
  -b "codex-session=$SESSION" \
  http://of-blood-and-bones.lvh.me:3000/
```

---

## Files to Modify

| File | Change |
|---|---|
| `packages/security/src/kv-secondary-storage.ts` | Add diagnostic logging (temporary), possibly normalize key format |
| `packages/worker-utils/src/auth-middleware.ts:228-233` | Fix token extraction to match BetterAuth's format |
| `packages/worker-utils/src/auth-middleware.ts:72-92` | Update `getSessionFromCache` key format |
| `packages/worker-utils/src/auth-middleware.ts:97-117` | Update `cacheSessionInKV` key format |

---

## Risks

- **Low:** Changing key format may orphan existing KV entries — they expire naturally via TTL (24h max)
- **Medium:** If BetterAuth's key format changes across versions, we'd need to update our alignment
- **Mitigation:** The worker middleware already tries multiple key formats (line 78), which provides backward compatibility during rollout
