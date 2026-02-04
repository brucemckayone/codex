# Codex Platform

Serverless content streaming on Cloudflare Workers.
**Structure**: Workers (API) → Service Layer (Logic) → Foundation (Infra) → External (Neon, R2, KV, Stripe).

## Navigation
| Task | Path |
|---|---|
| **Structure** | [packages/CLAUDE.md](packages/CLAUDE.md), [workers/CLAUDE.md](workers/CLAUDE.md) |
| **New Endpoint** | [workers/CLAUDE.md](workers/CLAUDE.md) |
| **New Service** | [packages/CLAUDE.md](packages/CLAUDE.md) |
| **DB/Schema** | [packages/database/CLAUDE.md](packages/database/CLAUDE.md) |
| **Validation** | [packages/validation/CLAUDE.md](packages/validation/CLAUDE.md) |
| **Security** | [packages/security/CLAUDE.md](packages/security/CLAUDE.md) |
| **Errors** | [packages/service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) |

## Workers (Cloudflare)
1. **Auth** (42069): BetterAuth, Session (PG+KV), Rate Limit. `POST /register`, `/login`, `GET /session`.
2. **Content-API** (4001): CRUD, Media, Access, Streaming (R2). `POST /content`, `/media`, `GET /stream/:id`.
3. **Identity-API** (42071): Placeholder. `GET /health`.
4. **Ecom-API** (42072): Stripe Checkout/Webhooks. `POST /checkout/create`, `/webhooks/stripe`.
5. **Admin-API** (42073): Analytics, Content/Customer Mgmt.
6. **Notifications-API** (42074): Email (Resend).
7. **Organization-API** (42075): Org CRUD, Members.
8. **Media-API** (42076): Transcoding (RunPod), HLS.

## Packages
### Foundation
- **@codex/database**: Drizzle ORM, Neon. `dbHttp` (prod), `dbWs` (test). Schema & Queries.
- **@codex/shared-types**: Contracts, HonoEnv, API Responses (`SingleItemResponse`, `ErrorResponse`).
- **@codex/service-errors**: `BaseService`, Error classes (404, 403, etc.), `mapErrorToResponse`.
- **@codex/security**: Auth middleware, Rate Limit (KV), Headers, Worker Auth (HMAC).
- **@codex/validation**: Zod schemas.

### Services
- **@codex/content**: Content/Media lifecycle.
- **@codex/organization**: Org mgmt.
- **@codex/access**: Access control, Signed URLs, Playback.
- **@codex/purchase**: Stripe integration, Purchases.
- **@codex/notifications**: Emails.
- **@codex/admin**: Admin services.
- **@codex/transcoding**: Transcoding pipeline.

### Utilities
- **@codex/worker-utils**: Worker factory, `procedure()` handler, Middleware.
- **@codex/cloudflare-clients**: R2, KV.
- **@codex/observability**: Logging.
- **@codex/test-utils**: DB setup, Seeders.
- **@codex/platform-settings**: Settings/Flags.

## Development
- **Commands**: `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm db:migrate`.
- **Dev**: `cd workers/auth && pnpm dev`.
- **Key Patterns**:
  - **Transact**: `db.transaction()`.
  - **Scope**: Filter by `creatorId`/`orgId`.
  - **Soft Delete**: `deletedAt`.
  - **Errors**: Throw typed errors; Worker maps to HTTP.
  - **Env**: Shared bindings in `shared-types`.