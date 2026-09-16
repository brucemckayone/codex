---
name: procedure-patterns
description: >
  Deep reference for `procedure()`, `multipartProcedure()`, `binaryUploadProcedure()`,
  the 8-step execution pipeline, policy shapes, and the response envelope contract.
type: reference
---

# Procedure Patterns

`procedure()` is the single most-used abstraction in Codex workers. Every HTTP endpoint
(with documented exceptions) flows through it. This reference covers the **principles
and decisions** — for the mechanical rules, see `packages/worker-utils/CLAUDE.md`.

Reference implementation: `packages/worker-utils/src/procedure/procedure.ts:94-202`.

---

## Why procedure() Exists

Raw Hono handlers force every endpoint to repeat the same machinery: session validation,
RBAC check, rate limit, input parsing, Zod validation, service instantiation, response
shaping, error mapping, DB cleanup. Doing this by hand leads to drift — one endpoint
forgets a scoping check, another logs PII, another returns a bare array where callers
expect `{ items, pagination }`.

`procedure()` collapses all of that into a **declarative config object**. The handler
receives a fully-typed, fully-validated `ctx` and returns a plain object. The envelope,
status codes, and error handling are the framework's problem, not yours.

This is tRPC-style in spirit: the types flow from schema → handler → response without
manual plumbing.

---

## The 8-Step Pipeline

When a request hits a `procedure()` route, these steps run in order. Understanding
them is critical for debugging — most bugs are a misunderstanding of what ran *before*
the handler.

| Step | What | When It Matters |
|------|------|-----------------|
| 1. IP whitelist | If `policy.allowedIPs` set | Admin-only internal endpoints |
| 2. Rate limit | If `policy.rateLimit` set | Before anything expensive |
| 3. Auth enforcement | `policy.auth` check | Sets `ctx.user`, `ctx.session` |
| 4. Role + org check | `policy.roles`, `policy.requireOrgMembership` | Sets `ctx.organizationId`, `ctx.organizationRole` |
| 5. Service registry | Lazy, post-auth (so services know org context) | `ctx.services.*` becomes available |
| 6. Input validation | Zod parses `params`, `query`, `body` | Throws `ValidationError` on fail |
| 7. Handler execution | Your code runs | `ctx` is fully typed and populated |
| 8. Response wrap + cleanup | Envelope shaping; `waitUntil(cleanup())` for DB | Cleanup is fire-and-forget |

The cleanup step is what makes the service registry pattern work under workerd's
per-request lifecycle. See `02-service-layer.md` for details.

---

## Policy Shapes (The Auth Spectrum)

Pick `policy.auth` first — it determines what `ctx.user` looks like:

| `auth` value | `ctx.user` | Use case |
|--------------|-----------|----------|
| `'none'` | `never` | Fully public endpoints (org public info, homepage) |
| `'optional'` | `User \| null` | Endpoints that behave differently if logged in (content listings with ownership flags) |
| `'required'` | `User` | The default — any endpoint that touches user data |
| `'worker'` | `never` | HMAC-signed inter-worker calls (no end-user) |
| `'platform_owner'` | `User` | Admin-only (platform analytics, overrides) |

Compose with modifiers:

```typescript
// Creator-only CRUD
policy: { auth: 'required', roles: ['creator', 'admin'] }

// Any org member
policy: { auth: 'required', requireOrgMembership: true }

// Only org owners/admins (not members)
policy: { auth: 'required', requireOrgMembership: true, requireOrgManagement: true }
```

**Decision rule:** start with the most restrictive policy that still works. Never
loosen beyond `optional` unless the data is genuinely public.

---

## Rate Limit Presets

Rate limits are KV-backed. The preset captures the intent, not the numbers:

| Preset | Limit | When |
|--------|-------|------|
| `auth` | 5/15 min | Login, register, password reset, OTP |
| `strict` | 20/min | Payment mutations, sensitive writes |
| `streaming` | 60/min | Streaming URL generation |
| `api` | 100/min | Standard authenticated mutations |
| `web` | 300/min | Web UI read-heavy endpoints |
| `webhook` | 1000/min | Stripe/RunPod webhook endpoints |

**Decision rule:** choose by *blast radius*, not by endpoint type. A POST that
generates an email is `strict` even though it's not a payment. A GET that triggers
a DB-heavy aggregate is `api`, not `web`.

---

## The Response Envelope Contract

The envelope is one of the few things in the codebase that is truly non-negotiable —
the frontend client (`apps/web/src/lib/server/api.ts`) assumes it everywhere.

| Handler returns | HTTP | Response body |
|-----------------|------|---------------|
| Plain object/primitive | 200 or `successStatus` | `{ data: T }` |
| `new PaginatedResult(items, pagination)` | 200 | `{ items: T[], pagination: {...} }` |
| `null` + `successStatus: 204` | 204 | (empty) |
| Throw | 4xx/5xx | `{ error: { code, message, details? } }` |

**Never manually construct these shapes in a handler.** Return `result` directly
for single items, `new PaginatedResult(items, pagination)` for lists, `null` for
204s. The framework wraps.

The `PaginatedResult` check is an `instanceof` at `procedure.ts:178` — this is why
you must use the class, not a plain `{ items, pagination }` object.

### `successStatus` conventions

- `200` (default) — reads, updates
- `201` — POST creates (new resource materialised)
- `204` — DELETE (return `null` from handler)

POST endpoints that don't create a new resource (e.g., `POST /checkout/verify`)
stay on `200`.

---

## Input Validation Slots

Validation always lives in the `input` block. Three slots, all optional, all Zod:

```typescript
input: {
  params: z.object({ id: uuidSchema }),
  query: paginationQuerySchema,
  body: createContentSchema,
}
```

Each slot is validated independently. Errors include which slot failed. After
validation, `ctx.input.params`, `ctx.input.query`, `ctx.input.body` are fully typed.

**Principle:** schemas live in `@codex/validation`, not inline. Handlers reference
schemas by name. This keeps shapes testable and reusable across workers.

See `05-validation-patterns.md` for schema composition.

---

## Decision Tree: Which procedure() Variant?

```
Request body shape?
├─ JSON
│    → procedure()
│
├─ FormData with file fields
│    → multipartProcedure()
│    (See 07-file-upload-patterns.md)
│
├─ Raw binary (video/audio)
│    → binaryUploadProcedure()
│    (See 07-file-upload-patterns.md)
│
└─ Webhook signature verification needed?
     → raw Hono handler + verify-signature middleware
     (See 06-stripe-integration.md)
```

---

## Common Patterns (Starting Points)

These are templates to adapt, not scripts to follow blindly. Each real use case
needs its own judgment call on policies, validation, and status codes.

### Public GET

```typescript
app.get('/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => ctx.services.content.getFeatured(),
  })
);
```

### Authenticated create

```typescript
app.post('/',
  procedure({
    policy: { auth: 'required', roles: ['creator', 'admin'] },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx) =>
      ctx.services.content.create(ctx.input.body, ctx.user.id),
  })
);
```

### Paginated list (authenticated, scoped)

```typescript
app.get('/',
  procedure({
    policy: { auth: 'required' },
    input: { query: paginationQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.content.list(ctx.user.id, ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);
```

### Delete (204)

```typescript
app.delete('/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.content.delete(ctx.input.params.id, ctx.user.id);
      return null;
    },
  })
);
```

### Worker-to-worker (HMAC)

```typescript
app.post('/internal/trigger',
  procedure({
    policy: { auth: 'worker' },
    input: { body: triggerSchema },
    handler: async (ctx) => ctx.services.transcoding.trigger(ctx.input.body),
  })
);
```

### Org-scoped mutation

```typescript
app.patch('/organizations/:id/settings',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true, requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: updateSettingsSchema,
    },
    handler: async (ctx) =>
      ctx.services.settings.update(ctx.organizationId, ctx.input.body),
  })
);
```

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| Manually returning `c.json({ data: ... })` | Double-wraps; breaks `api.ts` unwrapping | Return plain object |
| `return { items: [...], pagination: {...} }` (plain object) | `instanceof PaginatedResult` check fails → wrapped as `{ data: { items, ... } }` | `return new PaginatedResult(items, pagination)` |
| `try/catch` around service call to "handle" errors | Swallows typed errors; user sees 500 instead of 404 | Let errors propagate — `mapErrorToResponse` handles them |
| `new ContentService({ db: createDbClient(env) })` inside handler | No cleanup; connection leak | Use `ctx.services.content` |
| `policy: { auth: 'none' }` on anything user-scoped | Data exposure | Use `optional` or `required` |
| Reading `c.req.json()` directly instead of `input.body` | Skips Zod validation | Declare `input.body` and use `ctx.input.body` |
| `successStatus: 201` on non-create (update/read) | Breaks REST semantics, confuses clients | Default `200` for mutations without creation |
| Hardcoding IDs into validation messages | Log/error noise exposes UUIDs | Use schema `.describe()` |
| Missing `input.params` on a URL with `:id` | Param undefined at runtime | Always declare params Zod schema |

---

## Exceptions to the Rule

These routes legitimately bypass `procedure()`:

1. **Stripe webhooks** (`workers/ecom-api/src/index.ts` — all `/webhooks/stripe/*` routes) — signature verification must happen on the *raw* body before parsing. See `06-stripe-integration.md`.
2. **RunPod webhooks** (`workers/media-api/src/index.ts`) — HMAC verification on raw body.
3. **BetterAuth** (`/api/auth/*` in auth worker) — the BetterAuth library handles its own request/response.
4. **dev-cdn** (`workers/dev-cdn/src/index.ts`) — local development proxy, not production.

If you're adding a new endpoint and reach for a bypass, **check twice**. The answer
is almost always `procedure()` with the right policy.

---

## Debugging procedure() Handlers

1. **Response shape wrong?** — check if you're returning a `PaginatedResult` or plain object. Check `successStatus`.
2. **`ctx.user` undefined?** — `policy.auth` is probably `'none'` or `'optional'`.
3. **`ctx.organizationId` undefined?** — set `requireOrgMembership: true` OR extract from `ctx.input.params.id`.
4. **Service not in `ctx.services`?** — check the registry at `packages/worker-utils/src/procedure/service-registry.ts`. New services must be registered there.
5. **Input fields undefined?** — Zod strip-unknown-keys is default; check your schema includes the field.
6. **Rate limited unexpectedly?** — `rateLimit` preset may be too strict for a test harness. Check KV key `ratelimit:*`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/worker-utils/src/procedure/procedure.ts` (the pipeline itself)
- `packages/worker-utils/src/procedure/types.ts` (policy/context shapes)
- `packages/worker-utils/src/procedure/service-registry.ts` (available services)
- `packages/worker-utils/CLAUDE.md` (rules)

The response envelope contract is the most stable part of the codebase — if it
changes, it's a breaking change that will touch dozens of files.
