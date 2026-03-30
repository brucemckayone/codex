# Codex Workers

Cloudflare Workers microservices forming the API layer. All workers follow: Request → Middleware → procedure() → Service → Database → Response.

## Worker Registry

All ports from `@codex/constants` `SERVICE_PORTS`. Use `getServiceUrl(service, env)` — NEVER hardcode.

| Worker | Port | Purpose | Auth Model |
|---|---|---|---|
| **auth** | 42069 | BetterAuth sessions, registration, password reset | BetterAuth (exception to procedure) |
| **content-api** | 4001 | Content CRUD, media, access/streaming, playback | Session auth (procedure) |
| **organization-api** | 42071 | Org CRUD, members, settings, branding | Session auth + org membership |
| **ecom-api** | 42072 | Stripe checkout, webhooks, purchases | Session + Stripe HMAC |
| **admin-api** | 42073 | Analytics, content/customer management | Session + platform_owner role |
| **identity-api** | 42074 | User profiles, platform settings | Session auth |
| **notifications-api** | 42075 | Email templates, sending | Session auth |
| **media-api** | 4002 | Transcoding (RunPod), webhooks, HLS | Worker HMAC + RunPod HMAC |
| **dev-cdn** | 4100 | Local R2 proxy (development only) | None |

## Quick Navigation

| I need to... | Worker | Key Endpoints |
|---|---|---|
| Register/login users | auth | `POST /api/auth/email/register`, `POST /api/auth/email/login` |
| Validate a session | auth | `GET /api/auth/session` |
| Create/manage content | content-api | `POST /api/content`, `PATCH /api/content/:id` |
| Upload/manage media | content-api | `POST /api/media`, `POST /api/media/:id/upload-complete` |
| Generate streaming URL | content-api | `GET /api/access/streaming-url/:contentId` |
| Track playback | content-api | `POST /api/access/playback-progress/:contentId` |
| Get user's library | content-api | `GET /api/access/library` |
| Create/manage orgs | organization-api | `POST /api/organizations`, `PATCH /api/organizations/:id` |
| Manage org settings | organization-api | `GET/PUT /organizations/:id/settings/*` |
| Check slug availability | organization-api | `GET /api/organizations/check-slug/:slug` |
| Process payments | ecom-api | `POST /checkout/create`, `POST /webhooks/stripe/booking` |
| View purchase history | ecom-api | `GET /purchases` |
| View analytics | admin-api | `GET /analytics/revenue`, `GET /analytics/customers` |
| Admin content mgmt | admin-api | `POST /content/:id/publish` (override) |
| Manage email templates | notifications-api | `POST /templates/global`, `POST /templates/:id/preview` |
| Trigger transcoding | media-api | `POST /internal/media/:id/transcode` (worker HMAC) |
| Handle transcode callback | media-api | `POST /transcoding/webhook` (RunPod HMAC) |

## Security Model

### Authentication Layers

| Layer | Mechanism | Used By |
|---|---|---|
| **Session auth** | Cookie → KV cache (5min) → DB fallback | Most workers via `procedure({ policy: { auth: 'required' } })` |
| **Worker-to-worker** | HMAC-SHA256 + timestamp (±60s, 5min max age) | media-api (from content-api) |
| **Stripe HMAC** | `stripe-signature` header verification | ecom-api webhooks |
| **RunPod HMAC** | Webhook signature verification | media-api webhook |
| **Platform owner** | Session + `platform_owner` role check | admin-api |

### Authorization

| Model | How It Works |
|---|---|
| **Creator scoping** | All content/media queries scoped by `creatorId` — enforced in service layer |
| **Org membership** | `procedure({ policy: { requireOrgMembership: true } })` — resolves org from URL/subdomain |
| **Platform owner** | `procedure({ policy: { auth: 'platform_owner' } })` — admin-api only |
| **Access control** | Free → granted, Paid → check purchase/membership, Private → deny |

### Rate Limiting

| Preset | Limit | Applied To |
|---|---|---|
| `auth` | 5/15min | Login, register, password reset |
| `api` | 100/min | Standard API endpoints |
| `strict` | 20/min | Sensitive operations |
| `streaming` | 60/min | Streaming URL generation |
| `webhook` | 1000/min | Stripe/RunPod webhooks |

### Input Validation

- ALL POST/PATCH bodies validated with Zod schemas via `procedure({ input: { body: schema } })`
- Returns 400 on schema validation failure
- Returns 422 on business logic violation

### Security Headers (All Workers)

Applied automatically by `createWorker()`:
- `Content-Security-Policy` (configurable, Stripe preset available)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (production only)
- `Permissions-Policy` (disables geolocation, microphone, camera)

## Data Flow Patterns

### Content Lifecycle
```
Create Draft → Upload Media → Media-API Transcodes → Publish (requires media ready) → Stream
```

### Purchase Flow
```
User → Checkout (ecom-api) → Stripe Payment → Webhook (ecom-api) → Purchase + Access Grant → Stream
```

### Session Validation
```
Request with cookie → KV cache hit? Return cached → DB lookup → Cache result → Return
```

## Strict Rules (All Workers)

- **MUST** use `procedure()` for ALL endpoints — exceptions: BetterAuth, Stripe webhooks, RunPod webhooks, dev-cdn
- **MUST** use `createWorker()` for worker setup — provides middleware stack and security headers
- **MUST** validate all input with Zod schemas — no unvalidated input reaches handlers
- **MUST** scope all database queries by creator/org — NEVER return data across scope boundaries
- **MUST** use `getServiceUrl()` from `@codex/constants` for all inter-worker URLs
- **MUST** run `pnpm dev` from monorepo root to start all workers — NEVER `cd workers/x && pnpm dev`
- **NEVER** put business logic in route handlers — it belongs in service packages
- **NEVER** catch and swallow errors in handlers — let procedure() handle error mapping
- **NEVER** manually construct response envelopes — procedure() wraps `{ data: T }` and `{ items, pagination }` automatically
- **NEVER** expose internal details (stack traces, SQL, DB URLs) in API responses

## Adding a New Worker Endpoint

1. Define Zod schema in `@codex/validation` (`packages/validation/src/schemas/`)
2. Add service method in the appropriate service package (extend `BaseService`)
3. Create route in `workers/{worker}/src/routes/{domain}.ts`
4. Use `procedure()` with appropriate policy, input, and handler
5. Return plain object (single) or `new PaginatedResult(items, pagination)` (list)

See `packages/worker-utils/CLAUDE.md` for complete `procedure()` reference.

## Reference Files

- `packages/worker-utils/CLAUDE.md` — procedure() patterns, response envelope, ctx fields
- `packages/security/CLAUDE.md` — auth middleware, rate limiting, HMAC details
- `packages/service-errors/CLAUDE.md` — error classes and mapping
