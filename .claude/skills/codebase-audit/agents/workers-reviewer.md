# Workers & API Routes Reviewer

## Domain
All Cloudflare Workers in `workers/*/src/` — route handlers, middleware, webhook handlers, worker factory configuration.

## File Patterns
- `workers/*/src/index.ts`
- `workers/*/src/routes/**/*.ts`
- `workers/*/src/handlers/**/*.ts`
- `workers/*/src/middleware/**/*.ts`
- `workers/*/src/utils/**/*.ts`
- `workers/*/src/types.ts`
- `workers/*/wrangler.jsonc`

## Checklist

### Route Handler Compliance
- [CRITICAL] All handlers use `procedure()` — no raw `c.req.json()` outside test endpoints
- [CRITICAL] All handlers use `ctx.services.*` from service registry — no ad-hoc `createDbClient()`
- [CRITICAL] Correct HTTP status: 201 for POST create, 204 for DELETE, 200 for GET/PATCH
- [CRITICAL] Lists return `new PaginatedResult(items, pagination)`
- [WARN] `successStatus` explicitly set where non-default
- [WARN] Input validation via `input: { body: schema, params: schema, query: schema }`

### Auth Policy
- [CRITICAL] All state-changing endpoints have `policy: { auth: 'required' }`
- [CRITICAL] Public endpoints explicitly marked `auth: 'none'` with `rateLimit: 'api'`
- [CRITICAL] Admin endpoints use correct auth model (verify docs match code)
- [WARN] Worker-to-worker endpoints use `auth: 'worker'`
- [WARN] Role-based endpoints specify `roles: [...]`

### Rate Limiting
- [CRITICAL] Auth endpoints use `rateLimit: 'auth'` (5/15min)
- [WARN] `rateLimit: 'auth'` NOT used on non-auth endpoints (too restrictive)
- [WARN] Delete/mutation endpoints use `rateLimit: 'strict'` (20/min)
- [INFO] JSDoc rate limit descriptions match actual presets

### Webhook Handlers
- [CRITICAL] All Stripe webhooks verified with `verifyStripeSignature()`
- [CRITICAL] Transient errors propagate (500 → Stripe retries)
- [CRITICAL] Permanent errors return 200 (acknowledged)
- [CRITICAL] No catch-all that swallows transient failures
- [WARN] Idempotency keys on financial operations (transfers)
- [WARN] DB operations + external API calls wrapped in transaction where needed

### Worker Configuration
- [WARN] `createWorker()` flags explicitly set (not relying on defaults)
- [WARN] Environment validation lists required vs optional vars correctly
- [WARN] Health check includes `standardDatabaseCheck` where applicable
- [INFO] Staging wrangler config has all KV namespace bindings

### Cross-Cutting
- [CRITICAL] No hardcoded localhost URLs — use `getServiceUrl()` from `@codex/constants`
- [WARN] No PII in log messages (emails, tokens, passwords)
- [WARN] No duplicate endpoints across workers
- [INFO] Consistent route file organisation (routes extracted from index.ts)

## Output Requirements
- Review ALL 9 workers (auth, content-api, organization-api, ecom-api, admin-api, identity-api, notifications-api, media-api, dev-cdn)
- Report findings per-worker with file:line references
- Include cross-cutting concerns section
- Include cross-reference section noting overlaps with security and services reports
