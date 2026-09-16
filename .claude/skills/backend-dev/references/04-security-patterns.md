---
name: security-patterns
description: >
  Deep reference for authentication policies, rate limiting, HMAC worker-to-worker
  auth, session validation, and security headers in Codex workers.
type: reference
---

# Security Patterns

Security in Codex is layered. Every HTTP request passes through:

1. Security headers (CSP, HSTS, X-Frame, etc.)
2. Rate limiting (if configured)
3. Authentication (session cookie, HMAC signature, or none)
4. Authorization (role checks, org membership, platform ownership)
5. Input validation (Zod)
6. Handler execution

Most of this is declarative — you pick a `policy` and the framework enforces it.
This reference explains **the decision model** behind picking the right policy.

Reference implementations:
- `packages/security/CLAUDE.md` — authoritative rules
- `packages/security/src/worker-auth.ts` — HMAC signing + validation
- `packages/security/src/session-auth.ts` — two-tier session validation
- `packages/security/src/rate-limit.ts` — KV-backed rate limiting
- `packages/worker-utils/src/procedure/helpers.ts` — `enforcePolicyInline`

---

## Authentication Spectrum

Every endpoint is one of these. Pick based on *who* should be able to call it:

| `policy.auth` | Who | `ctx.user` | Use for |
|---------------|-----|-----------|---------|
| `'none'` | Anyone | `never` | Public data (homepage, org branding, public content list) |
| `'optional'` | Anyone, known if logged in | `User \| null` | Listings with personalization flags (e.g. `isPurchased`) |
| `'required'` | Logged-in user | `User` | Default. Any endpoint that reads or writes user data |
| `'worker'` | Another worker with HMAC secret | `never` | Internal inter-service calls |
| `'platform_owner'` | User with `platform_owner` role | `User` | Admin-only (analytics, overrides, moderation) |

### How session auth works (two-tier)

```
1. Client sends CODEX_SESSION cookie
2. Session worker reads cookie
3. Checks KV cache for session data (5-min TTL — SEE RULE BELOW)
4. Cache miss → DB query (authoritative) → write to KV → proceed
5. Cache hit → skip DB, proceed
6. Populate ctx.user, ctx.session
```

**Why two-tier:** Cloudflare KV is fast but eventually consistent. The DB is slow
but authoritative. The 5-minute TTL is a tradeoff: session revocations (logout on
another device) propagate within 5 minutes, but most reads are cheap.

The `requireAuth`/`optionalAuth` middleware implement this. You rarely write them
directly — `procedure({ policy: { auth: 'required' } })` uses them under the hood.

### KV TTL rule: cap at revocation-propagation SLA — NOT session-lifetime

A common mistake: `expirationTtl = session.expiresAt - now` (which is 24h at
session creation). This means a revoked / signed-out session stays valid on
cached workers for up to 24h.

**Rule:** KV TTL = min(revocation SLA, session TTL). 300 seconds (5 min) is the
Codex default. Combined with the sign-out invalidation below, this bounds worst-case
staleness to 5 minutes.

```typescript
// In cacheSessionInKV
const ttl = Math.min(300, session.expiresAt - Math.floor(Date.now() / 1000));
await kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: ttl });
```

### Sign-out KV invalidation (required)

DB deletion alone is not enough. BetterAuth's `onSignOut` (or your sign-out
handler) MUST delete the KV entry:

```typescript
// In the auth worker's sign-out hook
await env.AUTH_SESSION_KV.delete(`session:${token}`);
```

Without this, other workers that already cached the session keep treating it as
valid until the 5-minute TTL expires. With this, logout propagates immediately
to every worker that does a fresh read.

### Session cookie handling

**CODEX_SESSION** is the outward-facing cookie name. BetterAuth internally uses
`better-auth.session_token` — the API client forwards BOTH names to maintain
compatibility.

Four rules:

1. **Never URL-encode cookie values** — the value contains `{token}.{signature}`
   where token/signature are URL-safe base64. Encoding corrupts `. - _`.
2. **Cookie attributes**: `HttpOnly` always; `Secure` in production; `SameSite=Lax`
   (or `None` for cross-site flows); domain set to `.codex.lol` (or equivalent)
   for cross-subdomain session sharing.
3. **Development subdomain support**: derive cookie domain from `WEB_APP_URL`
   so dev tools work with `.lvh.me:3000` and `.{ip}.nip.io:3000` (for LAN/phone
   testing):

   ```typescript
   function getDevCookieDomain(webAppUrl: string): string | undefined {
     const host = new URL(webAppUrl).hostname;
     if (host.endsWith('.lvh.me')) return '.lvh.me';
     if (host.endsWith('.nip.io')) return `.${host.split('.').slice(-4).join('.')}`;
     return undefined; // production
   }
   ```

4. **Dual-cookie-name extraction during migrations**: when accepting tokens,
   probe multiple cookie names in order — `codex-session`, `__Secure-codex-session`,
   `better-auth.session_token`, `__Secure-better-auth.session_token`. The token
   format is `{value}.{signature}`; take `substring(0, lastDot)` as the lookup
   key.

### Proxying third-party handler responses through Hono

BetterAuth emits multiple `Set-Cookie` headers on registration (subdomain cookies
with and without the dot prefix). Returning its `Response` directly through Hono
can collapse duplicates — rebuild the Response:

```typescript
const authResponse = await auth.handler(c.req.raw);
const headers = new Headers();
authResponse.headers.forEach((v, k) => headers.append(k, v));
return new Response(authResponse.body, {
  status: authResponse.status,
  headers,
});
```

This pattern applies to anything that proxies a framework response through
Hono — BetterAuth, NextAuth, Stripe webhook routers.

---

## Authorization Modifiers

Compose these with `auth: 'required'`:

```typescript
// Role-gated
policy: { auth: 'required', roles: ['creator', 'admin'] }

// Any member of the org resolved from URL/subdomain
policy: { auth: 'required', requireOrgMembership: true }

// Only owners/admins of the org (not regular members)
policy: { auth: 'required', requireOrgMembership: true, requireOrgManagement: true }
```

### How `requireOrgMembership` resolves the org

It looks in this order:
1. URL param `:id` (if it's a UUID or slug)
2. Subdomain (if the request is at `<slug>.codex.lol`)
3. Query param `?organizationId=<uuid>`

If none resolves → 400. If resolved but user isn't a member → 403. If member →
`ctx.organizationId` and `ctx.organizationRole` populated.

### Role semantics

| Role | Permissions |
|------|-------------|
| `member` | Can read org content they have access to |
| `creator` | Can create/manage their own content within the org |
| `admin` | Can manage all content, members, settings |
| `owner` | Admin + can delete the org |
| `platform_owner` | Cross-tenant admin (separate from org roles) |

`requireOrgManagement` = `admin` OR `owner`.

---

## Rate Limit Strategy

Rate limiting in Codex is KV-backed per-IP per-route. The preset captures *intent*
(how risky is a flood?) not *numbers*.

| Preset | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `auth` | 5 | 15 min | Brute-force defense — even slow attacks hit the wall |
| `strict` | 20 | 60 s | Sensitive writes (payments, admin actions) |
| `streaming` | 60 | 60 s | Streaming URL generation — 1/s is generous |
| `api` | 100 | 60 s | Standard authenticated mutations |
| `web` | 300 | 60 s | Web UI read-heavy endpoints |
| `webhook` | 1000 | 60 s | Stripe/RunPod bursts during events |

**Decision rule:** by *blast radius* if abused, not by surface type.

- Password reset that sends an email → `auth` (both auth + abuse-heavy)
- Content listing → `web`
- Creating a purchase intent → `strict`
- RunPod webhook receiving transcoding updates → `webhook`
- Generating a signed streaming URL → `streaming`

Missing KV binding in dev falls back to in-memory counter — fine locally but don't
rely on it in prod.

### Rate-limit headers

Response includes:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

The frontend uses these to show a "too many requests" UI with a countdown.

---

## Worker-to-Worker HMAC

When one worker calls another, we can't use session cookies — there's no user.
We use HMAC-SHA256 on the request body + timestamp with a shared secret.

### Caller side (signing)

```typescript
import { workerFetch } from '@codex/security';
import { getServiceUrl } from '@codex/constants';

const body = JSON.stringify({ mediaId, creatorId });
const response = await workerFetch(
  `${getServiceUrl('media', env)}/internal/media/${mediaId}/transcode`,
  { method: 'POST', body },  // body MUST be a string
  env.WORKER_SHARED_SECRET
);
```

`workerFetch` adds two headers:
- `X-Worker-Signature: base64(HMAC-SHA256(timestamp:body, secret))`
- `X-Worker-Timestamp: <unix seconds>`

### Receiver side (validation)

```typescript
app.post('/internal/media/:id/transcode',
  procedure({
    policy: { auth: 'worker' },
    input: {
      params: z.object({ id: uuidSchema }),
      body: triggerTranscodeSchema,
    },
    handler: async (ctx) => { ... }
  })
);
```

The framework:
1. Reads `X-Worker-Signature` and `X-Worker-Timestamp`
2. Checks timestamp is within ±60s of now and max 300s old (replay defense)
3. Reads raw body (must happen before Hono's JSON parser)
4. Recomputes signature with `WORKER_SHARED_SECRET`
5. Constant-time compare

### Common mistakes

| Mistake | Symptom |
|---------|---------|
| Passing `body: undefined` to `workerFetch` | Signature over empty string, doesn't match |
| Passing `body: JSON.stringify(obj)` but receiver reads parsed body | OK — receiver's raw-body read happens before parsing |
| Clock skew > 60s between workers | Constant 401s — check container/worker time sync |
| Using a different secret per environment | Silent mismatch in prod; verify `WORKER_SHARED_SECRET` is identical across both workers |
| Calling `workerFetch` with a production URL from a staging worker | Works if secrets match — use `getServiceUrl(service, env)` to route correctly |
| Using `fetch()` directly instead of `workerFetch` | Receiver 401s — no signature headers |

### Body-ordering contract (important)

`workerAuth` reads `c.req.text()` to hash the raw body. Subsequent middleware
or handler code that calls `c.req.json()` relies on Hono's internal body cache
to re-parse the same text. This works today — but if any middleware between
`workerAuth` and the handler introduces body streaming / transformation, the
HMAC becomes unverifiable after the parse.

**Rule:** `workerAuth` (or any signature-verifying middleware) MUST run before
any JSON parser. Don't introduce request-body-transforming middleware between
signature verification and the handler. Add a code comment at the `c.req.text()`
call site documenting this contract.

### When NOT to use worker auth

Anything user-facing should go through `requireAuth`. Worker auth is for:
- Transcoding triggers (content-api → media-api)
- Email sends (any worker → notifications-api)
- Cache invalidations from webhooks
- Admin tools running as scheduled jobs

---

## Security Headers

Applied automatically by `createWorker({ enableSecurityHeaders: true })`:

| Header | Value | Reason |
|--------|-------|--------|
| `X-Frame-Options` | `DENY` | Clickjacking defense |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referer leak reduction |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (prod only) | Force HTTPS |
| `Content-Security-Policy` | Configurable; `CSP_PRESETS.stripe` for payment workers | Defense-in-depth against XSS |

CSP is worker-specific — ecom-api needs `script-src https://js.stripe.com`, static
content workers don't. Use `CSP_PRESETS.stripe` on any worker that embeds Stripe.js.

---

## PII and Logging

Never log:
- Passwords (plaintext or hashed — both have leak risk if logs go to aggregation)
- Session tokens / cookies / CSRF tokens
- Bearer tokens (Stripe keys, worker shared secrets)
- Email addresses (use `userId` instead)
- Full names (use `userId`)
- Credit card data (PCI scope)

Do log:
- `userId` (opaque UUID)
- `organizationId`
- `contentId`, `mediaId`, `purchaseId`, `subscriptionId`
- Stripe object IDs (`pi_*`, `cus_*`, `sub_*`, etc.)
- HTTP status codes
- Request IDs for tracing

See `08-observability-patterns.md` for full logging rules.

---

## IP Whitelist

For truly admin-only endpoints (e.g., internal dashboards from a known IP):

```typescript
policy: { allowedIPs: ['1.2.3.4', '5.6.7.8'] }
```

Runs *before* auth. Fails with 403 if the client IP isn't in the list.

Use sparingly — most admin endpoints should use `platform_owner` auth instead.
IP whitelist is for metrics endpoints, internal dashboards, and break-glass tools.

---

## Signature Comparison

Never compare secrets or signatures with `===`:

```typescript
// WRONG — timing attack vulnerability
if (providedSignature === expectedSignature) { ... }

// CORRECT — use the internal helper
if (constantTimeEqual(providedSignature, expectedSignature)) { ... }
```

`constantTimeEqual` is used internally by `workerAuth` and by the Stripe webhook
verification. You generally don't call it yourself — but if you ever build a new
signature-based system, use it.

---

## Policy Decision Tree

```
Is the endpoint user-facing (has session cookie)?
├─ No → policy.auth = 'worker' (HMAC)
│
└─ Yes → Does it reveal user data?
          ├─ No (branding, homepage) → auth: 'none'
          ├─ Maybe (listings with ownership flags) → auth: 'optional'
          └─ Yes → auth: 'required'
                    ├─ Admin-only? → add roles: ['admin'] or auth: 'platform_owner'
                    ├─ Org-scoped? → add requireOrgMembership: true
                    └─ Management action? → add requireOrgManagement: true

What's the abuse risk?
├─ Brute-force password → rateLimit: 'auth'
├─ Payment mutation → rateLimit: 'strict'
├─ Streaming URL → rateLimit: 'streaming'
├─ Webhook endpoint → rateLimit: 'webhook'
└─ Default mutation → rateLimit: 'api'
```

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| `policy: { auth: 'none' }` on user data | Data exposure | `auth: 'required'` |
| Missing rate limit on auth endpoints | Brute-force target | `rateLimit: 'auth'` |
| Custom HMAC validation in a handler | Probably buggy, missing replay defense | `policy: { auth: 'worker' }` |
| Manual JWT verification | We use BetterAuth sessions, not JWTs for public auth | `policy: { auth: 'required' }` |
| Raw `fetch()` between workers | No signature, receiver rejects | `workerFetch()` |
| `===` comparison of signatures | Timing attack | `constantTimeEqual()` (internal) |
| Logging the session token | Credential leak in logs | Log `userId` only |
| Trusting `ctx.input` without a Zod schema | Unvalidated input | Always define `input.body/params/query` |
| Checking role in handler instead of policy | Can be forgotten | `policy.roles` does it before handler runs |
| Missing `requireOrgMembership` but using `ctx.organizationId` | Undefined at runtime | Add `requireOrgMembership: true` |
| State-changing route without `rateLimit` preset | Abusable to churn DB/Stripe quota (especially subscription cancel/reactivate) | `strict` for payment-adjacent, `api` minimum otherwise — every mutation route needs a preset |
| Reading a per-target `*_API_URL` env var to reach another worker | Diverges from `SERVICE_PORTS` single source of truth; dev/prod URL drift | `getServiceUrl(service, env)` from `@codex/constants` — every inter-worker call |
| Hard-coded path allowlist against a third-party router (BetterAuth, NextAuth, Stripe) | The framework's paths are its contract, not yours — silent drift when it updates | Use prefix match (`path.startsWith('/api/auth/sign-')`) or drive from the framework's own route registry; verify with a smoke test that hits each |
| Wrapping a middleware that already calls `next()` in another that ALSO calls `next()` | Double handler execution (and/or 429 returned on happy path when the wrapper inverts the success check) | `return innerMw(c, next)` OR `return next()` — never both. The inner middleware owns the chain. |
| KV session TTL tied to session-lifetime (`expiresAt - now` → 24h) | Logout cannot propagate to cached workers faster than TTL | Cap at revocation SLA: `Math.min(300, ttl)`. Pair with sign-out KV delete. |
| Test/dev endpoint accepting `role` / permission fields from client input | One env mis-set promotes this to a privilege-escalation endpoint in staging/prod | Hard-code minimum role; require an escalation secret header for elevated roles. Add module-init assert that `ENVIRONMENT !== 'production'`. |
| Different `WORKER_SHARED_SECRET` per environment | Inter-worker 401s | Deploy secrets consistently across the env |

---

## Debugging Auth Failures

1. **401 on authenticated endpoint** — cookie missing or expired. Check `CODEX_SESSION` cookie in request, check auth worker logs for session validation.
2. **403 with `auth: 'required'` + role check** — user is logged in but doesn't have the role. Check `users.role`.
3. **401 on worker-to-worker** — check signature generation (body must be a string, secrets must match, timestamp within skew).
4. **Rate limit hit in test** — KV counter persists across runs. Clear KV or use fresh test IPs.
5. **`ctx.organizationId` undefined** — forgot `requireOrgMembership: true` or org didn't resolve (check URL param/subdomain/query param).
6. **CSP blocking Stripe.js** — worker missing `CSP_PRESETS.stripe`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/security/src/worker-auth.ts` (HMAC signing)
- `packages/security/src/session-auth.ts` (session validation)
- `packages/security/src/rate-limit.ts` (presets or logic)
- `packages/security/src/headers.ts` (CSP, HSTS)
- `packages/worker-utils/src/procedure/helpers.ts` (`enforcePolicyInline`)
