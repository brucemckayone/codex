# Codex Platform

Serverless content streaming on Cloudflare Workers.
**Structure**: Workers (API) → Service Layer (Logic) → Foundation (Infra) → External (Neon, R2, KV, Stripe).

# IMPORTANT WHEN WORKING WITH BEADS TASK MANAGEMENT
!!!IMPORTANT!!! when working with beads you must ensure that you have a full understanding of how the tasks fit into the codebase as a whole when making changes ensure that we are working to the established patterns and using the existing packages here required. Ensure that we are following the correct statemanagement patterns etc.

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

## Common Developer Tasks

### Adding a New API Endpoint
1. Define Zod schema → `packages/validation/src/[domain].ts`
2. Add service method → `packages/[service]/src/services/*.service.ts` (extend BaseService)
3. Create worker route → `workers/[worker]/src/routes/*.ts` (use procedure())
4. **Always:** Scope by creatorId/orgId, validate input, use transactions for multi-step

### Implementing Content/Media Features
- Content lifecycle → `@codex/content` ContentService
- Media upload/transcode → `@codex/content` MediaItemService
- Streaming URLs → `@codex/access` ContentAccessService (signed R2 URLs)
- **Reference:** `/packages/content/src/services/content-service.ts:1-100`

### Handling Authentication/Authorization
- Session validation → Use `procedure({ policy: { auth: 'required' } })`
- Role checks → `policy: { roles: ['creator', 'admin'] }`
- Worker-to-worker → `policy: { auth: 'worker' }` (HMAC)
- **Reference:** `/packages/worker-utils/src/procedure/procedure.ts:1-80`

### Working with Database
- Simple queries → `dbHttp` (workers)
- Transactions → `dbWs` (tests/dev), wrap multi-step in `db.transaction()`
- Scoping → **ALWAYS** use `scopedNotDeleted(table, creatorId)` or `withCreatorScope()`
- **Reference:** `/packages/database/CLAUDE.md`, `/packages/content/src/services/content-service.ts`

### Testing
- Unit tests → `@codex/test-utils` factories, `setupTestDatabase()`
- Integration tests → Use `withNeonTestBranch()` (CI), dbWs for transactions
- Mocking → Factories in `@codex/test-utils/src/factories.ts`
- **Reference:** `/packages/organization/src/services/__tests__/organization-service.test.ts`

### Handling SVG/Media
- SVG uploads → Validate with `@codex/validation` `sanitizeSvgContent()` (XSS prevention)
- Image processing → `@codex/image-processing` ImageProcessingService
- R2 uploads → `@codex/cloudflare-clients` R2Service
- **Reference:** `/packages/validation/src/primitives.ts:sanitizeSvgContent`

## Development
- **Commands**: `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm db:migrate`.
- **Dev**: `cd workers/auth && pnpm dev`.
- **Key Patterns**:
  - **Transact**: `db.transaction()`.
  - **Scope**: Filter by `creatorId`/`orgId`.
  - **Soft Delete**: `deletedAt`.
  - **Errors**: Throw typed errors; Worker maps to HTTP.
  - **Env**: Shared bindings in `shared-types`.

