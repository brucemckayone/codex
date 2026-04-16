# Notifications-API Worker (port 42075)

Email template management (CRUD across three scopes) and sending via Resend. Includes unsubscribe token handling and a worker-to-worker send endpoint used by all other workers.

## Endpoints

### Template Routes (`/api/templates/*`)

#### Global Templates (platform_owner only)

| Method | Path | Auth | Input | Success |
|---|---|---|---|---|
| GET | `/api/templates/global` | `platform_owner` | query: pagination | 200 `{ items, pagination }` |
| POST | `/api/templates/global` | `platform_owner` | body: `createGlobalTemplateSchema` | 201 `{ data: Template }` |
| GET | `/api/templates/global/:id` | `platform_owner` | params: `id` | 200 `{ data: Template }` |
| PATCH | `/api/templates/global/:id` | `platform_owner` | body: `updateTemplateSchema` | 200 `{ data: Template }` |
| DELETE | `/api/templates/global/:id` | `platform_owner` | params: `id` | 204 |

#### Organization Templates

| Method | Path | Auth | Input | Success |
|---|---|---|---|---|
| GET | `/api/templates/organizations/:orgId` | `required`, `requireOrgMembership` | query: pagination | 200 `{ items, pagination }` |
| POST | `/api/templates/organizations/:orgId` | `required`, `requireOrgMembership`, `requireOrgManagement` | body: `createOrgTemplateSchema` | 201 `{ data: Template }` |
| PATCH | `/api/templates/organizations/:orgId/:id` | `required`, `requireOrgMembership`, `requireOrgManagement` | body: `updateTemplateSchema` | 200 |
| DELETE | `/api/templates/organizations/:orgId/:id` | `required`, `requireOrgMembership`, `requireOrgManagement` | params | 204 |

#### Creator Templates

| Method | Path | Auth | Input | Success |
|---|---|---|---|---|
| GET | `/api/templates/creator` | `required`, role: `creator` | query: pagination | 200 `{ items, pagination }` |
| POST | `/api/templates/creator` | `required`, role: `creator` | body: `createCreatorTemplateSchema` | 201 `{ data: Template }` |
| PATCH | `/api/templates/creator/:id` | `required`, role: `creator` | body: `updateTemplateSchema` | 200 |
| DELETE | `/api/templates/creator/:id` | `required`, role: `creator` | params: `id` | 204 |

#### Preview & Test Send

| Method | Path | Auth | Input | Success |
|---|---|---|---|---|
| POST | `/api/templates/:id/preview` | `required`, `rateLimit: 'strict'` | body: `previewTemplateSchema` | 200 `{ data: { html, ... } }` |
| POST | `/api/templates/:id/test-send` | `required`, `rateLimit: 'strict'` | body: `testSendTemplateSchema` | 200 `{ data: { sent } }` |

### Internal Routes (`/internal/*`)

| Method | Path | Auth | Input | Notes |
|---|---|---|---|---|
| POST | `/internal/send` | `worker` (HMAC) | body: `internalSendEmailSchema` | Central send endpoint; all workers call this to deliver emails |

### Unsubscribe Routes (`/unsubscribe/*`) — public, no auth

| Method | Path | Notes |
|---|---|---|
| GET | `/unsubscribe/:token` | Validate HMAC-signed token; returns `{ valid, category }` |
| POST | `/unsubscribe/:token` | Process unsubscribe; upserts `notificationPreferences` row |

> **Note**: The `preferences.ts` route file exists but is not currently mounted in `index.ts`. Notification preferences are managed via identity-api (`GET/PUT /api/user/notification-preferences`).

## Template Resolution (when sending)

When `/internal/send` is called, `NotificationsService` resolves templates in priority order:
1. **Creator** scope — template owned by the content creator
2. **Organization** scope — template owned by the org
3. **Global** scope — platform-wide fallback

First match wins.

## Email Providers

| Environment | Provider | Config |
|---|---|---|
| Production | **Resend** | `RESEND_API_KEY` required |
| Development | **Console** (or MailHog) | Logs to terminal; `MAILHOG_URL` optional |
| Test | **InMemory** | Captures for assertions |

`USE_MOCK_EMAIL=true` forces console/mock provider regardless of environment.

## Bindings / Env

| Binding | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon DB connection |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `AUTH_SESSION_KV` | Yes | Session auth (KV check on startup) |
| `WORKER_SHARED_SECRET` | Yes | HMAC for `/internal/send`; also used for unsubscribe token signing |
| `RESEND_API_KEY` | No | Required in production for email delivery |
| `FROM_EMAIL` | No | Sender address |
| `FROM_NAME` | No | Sender display name |
| `USE_MOCK_EMAIL` | No | Force mock provider (dev/test override) |
| `MAILHOG_URL` | No | Local MailHog SMTP endpoint |
| `ENVIRONMENT` | No | `development` / `production` |

## Key Packages

| Package | Why |
|---|---|
| `@codex/notifications` | `TemplateService` — template CRUD; `NotificationsService` — resolution + sending; `verifyUnsubscribeToken` |
| `@codex/validation` | All template schemas; `internalSendEmailSchema`; `updateNotificationPreferencesSchema` |
| `@codex/worker-utils` | `procedure()`, `PaginatedResult`, `sendEmailToWorker` (used by other workers) |

## Auth Patterns

- **`platform_owner`** — global template CRUD (most restrictive)
- **`required` + `requireOrgManagement`** — org template write operations (owner/admin role in org)
- **`required` + `requireOrgMembership`** — org template read (any org member)
- **`required` + `roles: ['creator']`** — creator template CRUD
- **`worker` HMAC** — `/internal/send` (called by other workers)
- **No auth** — unsubscribe endpoints (token-based verification)

## Gotchas

- **Unsubscribe routes bypass `procedure()`** — token verification is HMAC-based, not session-based. Raw Hono handlers with `createDbClient` directly.
- **`/internal/send` is the only email-sending entry point** — other workers should call it via `sendEmailToWorker()` from `@codex/worker-utils`, not hit the notifications-api directly with raw HTTP.
- **Cron trigger**: `wrangler.toml` configures `crons = ["0 9 * * 1"]` (Monday 09:00 UTC) for weekly digest. The `scheduled()` handler is stubbed with a TODO — not yet implemented.
- **`preferences.ts`** is an unmounted file — do not confuse it as an active route. Notification preferences live in identity-api.

## Reference Files

- `workers/notifications-api/src/routes/templates.ts` — template CRUD
- `workers/notifications-api/src/routes/preview.ts` — preview and test-send
- `workers/notifications-api/src/routes/internal.ts` — worker-to-worker send
- `workers/notifications-api/src/routes/unsubscribe.ts` — CAN-SPAM/GDPR unsubscribe
