# Codex Workers

Cloudflare Workers microservices forming the API layer. All workers follow: Request → Middleware → `procedure()` → Service → Database → Response.

## Worker Registry

All ports from `@codex/constants` `SERVICE_PORTS`. Use `getServiceUrl(service, env)` — NEVER hardcode.

| Worker | Port | Purpose | Auth Model |
|---|---|---|---|
| **auth** | 42069 | BetterAuth sessions, registration, password reset, email verification | BetterAuth (exception to procedure) |
| **content-api** | 4001 | Content CRUD, media lifecycle, access/streaming, playback progress | Session auth (procedure) |
| **organization-api** | 42071 | Org CRUD, members, settings, subscription tiers, followers | Session auth + org membership |
| **ecom-api** | 42072 | Stripe checkout, webhooks, purchases, subscriptions, Connect | Session + Stripe HMAC |
| **admin-api** | 42073 | Analytics, content/customer management | Session + org management role |
| **identity-api** | 42074 | User profiles, preferences, org membership (user side) | Session auth |
| **notifications-api** | 42075 | Email templates, sending (Resend), unsubscribe | Session + worker HMAC |
| **media-api** | 4002 | Transcoding (RunPod), webhooks, status, orphan cleanup | Worker HMAC + RunPod HMAC |
| **dev-cdn** | 4100 | Local R2 proxy (development only) | None |

## Quick Navigation

| I need to... | Worker | Key Endpoints |
|---|---|---|
| Register/login users | auth | `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` |
| Validate a session | auth | `GET /api/auth/session` |
| Create/manage content | content-api | `POST /api/content`, `PATCH /api/content/:id` |
| Upload/manage media | content-api | `POST /api/media`, `POST /api/media/:id/upload-complete` |
| Browse public content | content-api | `GET /api/content/public`, `GET /api/content/public/discover` |
| Generate streaming URL | content-api | `GET /api/access/content/:id/stream` |
| Track playback | content-api | `POST /api/access/content/:id/progress` |
| Get user's library | content-api | `GET /api/access/user/library` |
| Create/manage orgs | organization-api | `POST /api/organizations`, `PATCH /api/organizations/:id` |
| Manage org settings | organization-api | `GET/PUT /api/organizations/:id/settings/*` |
| Check org slug availability | organization-api | `GET /api/organizations/check-slug/:slug` |
| Process payments | ecom-api | `POST /checkout/create`, `POST /webhooks/stripe/booking` |
| Manage subscriptions | ecom-api | `POST /subscriptions/checkout`, `POST /subscriptions/cancel` |
| Stripe Connect onboarding | ecom-api | `POST /connect/onboard` |
| View purchase history | ecom-api | `GET /purchases` |
| Admin analytics | admin-api | `GET /api/admin/analytics/revenue`, `GET /api/admin/analytics/dashboard-stats` |
| Admin content mgmt | admin-api | `POST /api/admin/content/:id/publish`, `DELETE /api/admin/content/:id` |
| Admin customer support | admin-api | `GET /api/admin/customers`, `POST /api/admin/customers/:id/grant-access/:contentId` |
| Manage email templates | notifications-api | `POST /api/templates`, `POST /api/templates/:id/preview` |
| Send an email | notifications-api | `POST /internal/send` (worker HMAC) |
| Trigger transcoding | media-api | `POST /internal/media/:id/transcode` (worker HMAC) |
| Handle transcode callback | media-api | `POST /api/transcoding/webhook` (RunPod HMAC) |

## Security Model

### Authentication Layers

| Layer | Mechanism | Used By |
|---|---|---|
| **Session auth** | Cookie → KV cache (5min) → DB fallback | Most workers via `procedure({ policy: { auth: 'required' } })` |
| **Worker-to-worker** | `workerFetch()` — HMAC-SHA256 + timestamp (±60s, max 5min) | content-api → media-api, auth → notifications-api |
| **Stripe HMAC** | `verifyStripeSignature()` on `stripe-signature` header | ecom-api webhooks |
| **RunPod HMAC** | Webhook signature verification | media-api webhook |

### Authorization

| Model | How It Works |
|---|---|
| **Creator scoping** | All content/media queries scoped by `creatorId` — enforced in service layer |
| **Org membership** | `procedure({ policy: { requireOrgMembership: true } })` |
| **Org management** | `procedure({ policy: { requireOrgManagement: true } })` — owner or admin role |
| **Role filter** | `procedure({ policy: { roles: ['creator', 'admin'] } })` |
| **Access control** | Free → granted; Paid → check purchase/membership; Private → deny |

### Rate Limiting

| Preset | Limit | Applied To |
|---|---|---|
| `auth` | 5/15min | Login, register, password reset |
| `api` | 100/min | Standard API endpoints |
| `strict` | 20/min | Checkout, sensitive mutations |
| `streaming` | 60/min | Streaming URL generation (HLS refreshes) |
| `webhook` | 1000/min | Stripe/RunPod webhooks |

### Security Headers (All Workers)

Applied automatically by `createWorker()`:
- `Content-Security-Policy` (configurable, Stripe preset available)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (production only)
- `Permissions-Policy` (disables geolocation, microphone, camera)

## Worker-to-Worker Auth Pattern

Callers use `workerFetch()` from `@codex/security`. The receiving worker uses `policy: { auth: 'worker' }` in `procedure()`.

```typescript
// Caller (e.g., content-api)
import { workerFetch } from '@codex/security';
import { getServiceUrl } from '@codex/constants';

await workerFetch(
  `${getServiceUrl('media', env)}/internal/media/${mediaId}/transcode`,
  { method: 'POST', body: JSON.stringify({ creatorId }) },
  env.WORKER_SHARED_SECRET
);

// Receiver (e.g., media-api route)
procedure({
  policy: { auth: 'worker' },
  handler: async (ctx) => { ... }
})
```

`WORKER_SHARED_SECRET` must be set in both workers' bindings. `workerFetch` adds an HMAC-SHA256 signature header; `procedure()` verifies it automatically.

## Data Flow Patterns

### Content Lifecycle
```
Create Draft → Upload Media → media-api Transcodes → Publish (requires media ready) → Stream
```

### Purchase Flow
```
User → /checkout/create (ecom-api) → Stripe → /webhooks/stripe/booking → Purchase + Access Grant → Stream
```

### Session Validation
```
Request with cookie → KV cache hit? Return cached → DB lookup → Cache result (fire-and-forget) → Return
```

## Strict Rules (All Workers)

- **MUST** use `procedure()` for ALL endpoints — exceptions: BetterAuth, Stripe webhooks, RunPod webhooks, dev-cdn
- **MUST** use `createWorker()` for worker setup — provides middleware stack and security headers
- **MUST** validate all input with Zod schemas — no unvalidated input reaches handlers
- **MUST** scope all database queries by creator/org — NEVER return data across scope boundaries
- **MUST** use `getServiceUrl()` from `@codex/constants` for all inter-worker URLs
- **MUST** run `pnpm dev` from monorepo root — NEVER `cd workers/x && pnpm dev`
- **NEVER** put business logic in route handlers — it belongs in service packages
- **NEVER** catch and swallow errors in handlers — let `procedure()` handle error mapping
- **NEVER** manually construct response envelopes — `procedure()` wraps automatically
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
- `workers/auth/CLAUDE.md` — BetterAuth worker specifics
- `workers/content-api/CLAUDE.md` — content, media, access/streaming endpoints
- `workers/ecom-api/CLAUDE.md` — Stripe checkout, webhooks, subscriptions, Connect
- `workers/admin-api/CLAUDE.md` — analytics, content/customer management
