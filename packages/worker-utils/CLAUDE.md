# @codex/worker-utils

Hono worker factory, `procedure()` handler, and middleware stack.

## API

- **`createWorker(config)`**: Creates Hono app with full middleware stack (Tracking → Logging → CORS → Security Headers → Auth)
- **`procedure(config)`**: tRPC-style handler that unifies policy enforcement, input validation, error handling, and response envelopes
- **`PaginatedResult`**: Marker class — procedure checks `instanceof` to emit list envelope
- **Middleware**: `createAuthMiddleware`, `createCorsMiddleware`, `createRequestTrackingMiddleware`
- **Health**: `createHealthCheckHandler` (DB/KV/R2 checks)

## procedure() — Full Reference

### Configuration

```ts
app.post('/path',
  procedure({
    policy: {
      auth: 'required' | 'none' | 'optional' | 'worker' | 'platform_owner',
      roles: ['creator', 'admin'],         // Role check (requires auth: 'required')
      requireOrgMembership: true,           // Org membership check
      requireOrgManagement: false,          // Org management permission check
      rateLimit: 'api' | 'auth' | 'strict' | 'streaming' | 'webhook' | 'web',
      allowedIPs: ['1.2.3.4'],             // IP whitelist
    },
    input: {
      params: z.object({ id: uuidSchema }),  // URL params
      query: z.object({ page: z.number() }), // Query string
      body: createContentSchema,             // Request body
    },
    successStatus: 200 | 201 | 204,  // Default: 200. Use 201 for POST create, 204 for DELETE
    handler: async (ctx) => {
      // Full typed context — see ctx fields below
      return { ... };  // Wrapped as { data: T }
    }
  })
);
```

### Handler Context (`ctx`)

| Field | Available When | Description |
|---|---|---|
| `ctx.user` | `auth: 'required'` / `'platform_owner'` | Authenticated user (guaranteed non-null) |
| `ctx.user` | `auth: 'optional'` | May be null |
| `ctx.session` | `auth: 'required'` | Session data |
| `ctx.input` | Always (if `input` configured) | Validated input: `{ params, query, body }` |
| `ctx.requestId` | Always | Unique request ID for correlation |
| `ctx.clientIP` | Always | Client IP address |
| `ctx.userAgent` | Always | User agent string |
| `ctx.organizationId` | `requireOrgMembership: true` | Resolved org ID |
| `ctx.organizationRole` | `requireOrgMembership: true` | User's role in org |
| `ctx.env` | Always | Cloudflare Worker bindings |
| `ctx.executionCtx` | Always | Execution context (`waitUntil()`) |
| `ctx.obs` | Always | `ObservabilityClient` for logging |
| `ctx.services` | Always | Lazy-loaded service registry |

### Execution Flow

1. **IP Whitelist** (if configured) — blocks non-allowed IPs
2. **Rate Limiting** (if configured) — checks KV-backed rate limits
3. **Auth** — validates session (none/optional/required/worker/platform_owner)
4. **Role Check** (if configured) — checks user roles
5. **Org Membership** (if configured) — resolves org from URL/subdomain/query, checks membership
6. **Service Registry** — creates lazy-loaded services with org context
7. **Input Validation** — parses params/query/body with Zod schemas → `ValidationError` on failure
8. **Handler Execution** — runs handler with fully typed `ctx`
9. **Response Envelope** — wraps return value (see below)
10. **Error Handling** — catches any error, calls `mapErrorToResponse()`
11. **Cleanup** — service cleanup via `waitUntil()` (fire-and-forget)

### Organization Resolution

When `requireOrgMembership: true`, org ID is resolved from (in order):
1. URL params (`:id` or `:slug`)
2. Subdomain extraction (from Host header)
3. Query parameter `organizationId` (for SSR server-to-worker calls)

## API Response Envelope

Every `procedure()` response follows one of these shapes — NEVER deviate:

| Type | HTTP Status | Response Shape | Handler Returns |
|---|---|---|---|
| **Single item** | 200 or 201 | `{ "data": T }` | Plain object |
| **List** | 200 | `{ "items": T[], "pagination": {...} }` | `new PaginatedResult(items, pagination)` |
| **Error** | 4xx/5xx | `{ "error": { "code", "message", "details?" } }` | (thrown error) |
| **No content** | 204 | Empty body | `null` |

**Rules:**
- `data` wraps single-item payloads — handlers return plain objects, procedure adds the wrapper
- List handlers MUST return `new PaginatedResult(items, pagination)` — procedure checks `instanceof` to emit `{ items, pagination }` at top level
- Pagination is NEVER nested inside `data`
- Error envelope is produced by `mapErrorToResponse()` from `@codex/service-errors`
- No framework internals in responses

**Exceptions (not using procedure):**
- Auth worker (`/api/auth/*`) — BetterAuth owns the response contract
- Stripe webhooks — return `{ received: true }` per Stripe's contract
- RunPod webhook — return `{ received: true }` per RunPod's contract
- dev-cdn — CDN/S3 proxy, binary responses

## Common Patterns

### Pattern 1: Public Endpoint (No Auth)
```ts
app.get('/api/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => {
      return await ctx.services.content.getFeatured();
    },
  })
);
```

### Pattern 2: Authenticated GET with Params
```ts
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      return await ctx.services.content.getById(
        ctx.input.params.id,
        ctx.user.id  // Scoped to authenticated user
      );
    },
  })
);
```

### Pattern 3: Create (201)
```ts
app.post('/api/content',
  procedure({
    policy: { auth: 'required' },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);
```

### Pattern 4: Delete (204)
```ts
app.delete('/api/content/:id',
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

### Pattern 5: Paginated List
```ts
app.get('/api/content',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.content.list(ctx.user.id, ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);
```

### Pattern 6: Org-Scoped with Membership
```ts
app.get('/api/org/content',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: { query: contentQuerySchema },
    handler: async (ctx) => {
      // ctx.organizationId is guaranteed to be resolved
      const result = await ctx.services.content.listByOrg(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);
```

### Pattern 7: Worker-to-Worker (HMAC)
```ts
app.post('/api/transcode',
  procedure({
    policy: { auth: 'worker' },  // HMAC-SHA256 validation
    input: { body: transcodeRequestSchema },
    handler: async (ctx) => {
      return await ctx.services.transcoding.start(ctx.input.body);
    },
  })
);
```

### Status Code Reference

| Method | Use Case | `successStatus` |
|---|---|---|
| GET | Fetch data | 200 (default) |
| POST | Create resource | **201** |
| PATCH | Update resource | 200 (default) |
| DELETE | Remove resource | **204** |
| POST | Execute action (publish, etc.) | 200 (default) |

## Strict Rules

- **MUST** use `procedure()` for ALL API endpoints — the only exceptions are BetterAuth, Stripe webhooks, RunPod webhooks, and dev-cdn
- **MUST** set `successStatus: 201` for POST create endpoints
- **MUST** set `successStatus: 204` for DELETE endpoints and return `null`
- **MUST** return `new PaginatedResult(items, pagination)` from list handlers — NEVER return raw arrays
- **MUST** pass user ID to service methods for scoping — NEVER rely on procedure to scope DB queries
- **MUST** use `policy: { auth: 'required' }` for any endpoint accessing user data
- **MUST** use `policy: { auth: 'worker' }` for worker-to-worker endpoints
- **NEVER** catch errors in handlers — let them propagate to procedure's `mapErrorToResponse()`
- **NEVER** manually construct `{ data: T }` or `{ items: T[] }` in handlers — procedure does this
- **NEVER** return HTTP responses directly from handlers (`c.json(...)`) — return plain objects

## Integration

- **Depends on**: `@codex/security`, `@codex/service-errors`, `@codex/shared-types`, `@codex/observability`
- **Used by**: All workers (auth, content-api, organization-api, ecom-api, admin-api, identity-api, notifications-api, media-api)

## Reference Files

- `packages/worker-utils/src/procedure/procedure.ts` — procedure implementation
- `packages/worker-utils/src/procedure/helpers.ts` — `enforcePolicyInline`, `validateInput`
- `packages/worker-utils/src/procedure/paginated-result.ts` — PaginatedResult class
- `packages/worker-utils/src/procedure/service-registry.ts` — lazy service factory
- `workers/content-api/src/routes/content.ts` — reference implementation
