# @codex/worker-utils

Hono worker factory, `procedure()` handler, and shared middleware stack. This is the most-used package in the platform — every API worker builds on it.

## Key Exports

- **`createWorker(config)`** — Creates Hono app with full middleware stack (request tracking → logging → CORS → security headers → auth)
- **`procedure(config)`** — tRPC-style handler: policy enforcement, input validation, service injection, error handling, response envelope
- **`multipartProcedure(config)`** — Extension of `procedure()` for file upload endpoints (FormData + file validation)
- **`binaryUploadProcedure(config)`** — For raw binary uploads (non-FormData)
- **`PaginatedResult`** — Marker class; `procedure()` checks `instanceof` to emit list envelope
- **`createServiceRegistry(env, obs?, orgId?)`** — Lazy-loaded service factory (called internally by `procedure()`)
- **`sendEmailToWorker(params)`** — Worker-to-worker email trigger helper
- **`createHealthCheckHandler(options)`** — Standard health endpoint (DB/KV/R2 checks)
- **`sequence(...middleware)`** — Compose middleware in order

## procedure() — Full Reference

```ts
app.post('/path',
  procedure({
    policy: {
      auth: 'required' | 'none' | 'optional' | 'worker' | 'platform_owner',
      roles: ['creator', 'admin'],          // requires auth: 'required'
      requireOrgMembership: true,            // resolves ctx.organizationId + ctx.organizationRole
      requireOrgManagement: false,           // checks management permission
      rateLimit: 'api' | 'auth' | 'strict' | 'streaming' | 'webhook' | 'web',
      allowedIPs: ['1.2.3.4'],
    },
    input: {
      params: z.object({ id: uuidSchema }), // URL params
      query: z.object({ page: z.number() }),
      body: createContentSchema,
    },
    successStatus: 200 | 201 | 204,         // default 200; use 201 for POST create, 204 for DELETE
    handler: async (ctx) => { ... },
  })
);
```

### Handler Context (`ctx`)

| Field | Type / Availability |
|---|---|
| `ctx.user` | User (auth required/platform_owner) or User\|null (optional) |
| `ctx.session` | Session (auth required only) |
| `ctx.input` | `{ params, query, body }` — all validated |
| `ctx.organizationId` | String (requireOrgMembership only) |
| `ctx.organizationRole` | String (requireOrgMembership only) |
| `ctx.services` | Lazy `ServiceRegistry` — all services available |
| `ctx.env` | Cloudflare `Bindings` |
| `ctx.executionCtx` | `ExecutionContext` (`waitUntil`) |
| `ctx.obs` | `ObservabilityClient` |
| `ctx.requestId` / `ctx.clientIP` / `ctx.userAgent` | Always available |

### Execution Order

1. IP whitelist (if `allowedIPs`)
2. Rate limiting (if `rateLimit`)
3. Auth enforcement
4. Role check (if `roles`)
5. Org membership (if `requireOrgMembership`) — resolves from URL param, subdomain, or `organizationId` query param
6. Service registry creation (lazy)
7. Input validation (Zod) → `ValidationError` on failure
8. Handler execution
9. Response envelope (see below)
10. Error handling via `mapErrorToResponse()`
11. DB cleanup via `ctx.executionCtx.waitUntil(cleanup())`

## Response Envelope

| Handler returns | HTTP | Response body |
|---|---|---|
| Plain object | 200/201 | `{ data: T }` |
| `new PaginatedResult(items, pagination)` | 200 | `{ items: T[], pagination: { page, limit, total, totalPages } }` |
| `null` + `successStatus: 204` | 204 | empty |
| Thrown error | 4xx/5xx | `{ error: { code, message, details? } }` |

NEVER manually construct `{ data: T }` or `{ items: [] }` in handlers. NEVER return `c.json(...)` from handlers.

## multipartProcedure() — File Uploads

```ts
app.post('/api/orgs/:id/logo',
  multipartProcedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    files: {
      logo: {
        required: true,
        maxSize: 5 * 1024 * 1024,           // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml'],
      },
    },
    handler: async (ctx) => {
      const file = ctx.files.logo;  // ValidatedFile: { name, type, size, buffer }
      return await ctx.services.settings.uploadLogo(file);
    },
  })
);
```

File errors: `MissingFileError`, `FileTooLargeError`, `InvalidFileTypeError` — all extend `ValidationError`.

## Service Registry

`ctx.services` provides lazy getters for every service. Access a service by name — it instantiates on first access.

Available services: `content`, `media`, `access`, `imageProcessing` (alias: `images`), `organization`, `settings`, `purchase`, `subscription`, `tier`, `connect`, `transcoding`, `adminAnalytics`, `adminContent`, `adminCustomer`, `templates`, `notifications`, `preferences`, `identity`

### Adding a New Service

1. Add the service class import to `packages/worker-utils/src/procedure/service-registry.ts`
2. Add a private `_serviceName` variable (undefined)
3. Add a lazy getter to the `registry` object following the existing pattern
4. Add the type to `ServiceRegistry` in `packages/worker-utils/src/procedure/types.ts`

```ts
// In service-registry.ts registry object:
get myService() {
  if (!_myService) {
    _myService = new MyService({
      db: getSharedDb(),
      environment: getEnvironment(),
    });
  }
  return _myService;
},
```

## Common Patterns

```ts
// Public endpoint
procedure({ policy: { auth: 'none' }, handler: async (ctx) => { ... } })

// Authenticated GET with params
procedure({
  policy: { auth: 'required' },
  input: { params: z.object({ id: uuidSchema }) },
  handler: async (ctx) => ctx.services.content.getById(ctx.input.params.id, ctx.user.id),
})

// POST create (201)
procedure({
  policy: { auth: 'required' },
  input: { body: createContentSchema },
  successStatus: 201,
  handler: async (ctx) => ctx.services.content.create(ctx.input.body, ctx.user.id),
})

// DELETE (204)
procedure({
  policy: { auth: 'required' },
  input: { params: z.object({ id: uuidSchema }) },
  successStatus: 204,
  handler: async (ctx) => { await ctx.services.content.delete(ctx.input.params.id, ctx.user.id); return null; },
})

// Paginated list
procedure({
  policy: { auth: 'required' },
  input: { query: querySchema },
  handler: async (ctx) => {
    const result = await ctx.services.content.list(ctx.user.id, ctx.input.query);
    return new PaginatedResult(result.items, result.pagination);
  },
})

// Worker-to-worker (HMAC)
procedure({ policy: { auth: 'worker' }, ... })
```

## Strict Rules

- **MUST** use `procedure()` for ALL endpoints — exceptions: BetterAuth (`/api/auth/*`), Stripe webhooks, RunPod webhooks, dev-cdn
- **MUST** set `successStatus: 201` for POST create, `successStatus: 204` for DELETE
- **MUST** return `new PaginatedResult(items, pagination)` from list handlers
- **MUST** pass `ctx.user.id` to service methods — procedure does NOT scope DB queries automatically
- **NEVER** catch errors in handlers — let them propagate to `mapErrorToResponse()`
- **NEVER** return raw HTTP responses from handlers

## Exceptions (bypass procedure())

Stripe webhooks and RunPod webhooks use raw Hono handlers + `waitUntil(cleanup())` because they need HMAC-SHA256 validation before any parsing. They manage their own DB lifecycle with `createPerRequestDbClient` + `waitUntil(cleanup())`.

## Bundler Regression: Don't Extract Inline Config

**DO NOT** extract inline expressions inside `betterAuth({...})` config or `procedure()` policy chains into helper functions that get called from the production config — even when the extracted helper is semantically identical to the inline form.

**Why:** Cloudflare Workers in this monorepo bundle via `vite build`. Vite/Rollup output reordering can move the helper call's emission in a way that subtly changes runtime module-load semantics. The compiled `workers/*/dist/index.js` ends up with the worker's `/health` returning 503 on boot. The source looks fine. Typecheck passes. Unit tests pass. Only CI E2E Debug catches it via the `/health` 503.

Two incidents on PR #209 (2026-05-17):
- `workers/auth/src/auth-config.ts` — extracting `trustedOrigins: [env.WEB_APP_URL, ...]` into `getTrustedOrigins(env)` broke `/health` in auth-worker for 3 CI runs. Reverting to inline restored boot.
- `packages/worker-utils/src/procedure/helpers.ts` — adding a body-fallback branch inside `resolveOrganizationId` (semantically additive) broke `/health` in identity-api.

**Safe approach:**
- Keep `betterAuth({...})` config object literal-y. Inline expressions over helper calls.
- Keep `procedure()` policy chains literal/inline at the call site.
- If you need an exported helper for test coverage, keep the helper exported but **only call it from tests**. The production config path stays inline.
- If you must add a new branch to `resolveOrganizationId` / `enforcePolicyInline`, extract the new logic into a **separate file** (e.g. `body-org-resolver.ts`) and load it via a dynamic `await import('./body-org-resolver')`. That's the same pattern as `extractOrganizationFromSubdomain` in `procedure/org-helpers.ts` — proven to dodge the reorder.

**Detection signal:** if you make a worker-utils or auth-config refactor and CI's `E2E Debug Tests` job fails with `/health` 503 (no error in worker stdout, fresh Neon branch is fine), revert the call site to inline and probe A/B. Memory: `feedback_vite_helper_call_bundler_order`.

## Reference Files

- `packages/worker-utils/src/procedure/procedure.ts` — procedure implementation
- `packages/worker-utils/src/procedure/service-registry.ts` — lazy service factory (add new services here)
- `packages/worker-utils/src/procedure/types.ts` — ServiceRegistry type
- `packages/worker-utils/src/procedure/multipart-procedure.ts` — file upload variant
- `packages/worker-utils/src/worker-factory.ts` — createWorker
- `workers/content-api/src/routes/content.ts` — reference implementation
