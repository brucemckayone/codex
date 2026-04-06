# Codex Platform

Serverless content streaming platform on Cloudflare Workers.

**Architecture**: Workers (API) → Service Layer (Logic) → Foundation (Infra) → External (Neon, R2, KV, Stripe).

## IMPORTANT: Task Management (Beads)

When working with beads, you MUST have a full understanding of how tasks fit into the codebase as a whole. When making changes, ensure you are working to the established patterns and using the existing packages as required. Ensure you are following the correct state management patterns, security patterns, and error handling patterns documented in this file and the relevant sub-CLAUDE.md files.

---

## Navigation

| I need to... | Read this |
|---|---|
| Understand project structure | [packages/CLAUDE.md](packages/CLAUDE.md), [workers/CLAUDE.md](workers/CLAUDE.md) |
| Work on the web app | [apps/web/CLAUDE.md](apps/web/CLAUDE.md) — SvelteKit, SSR, TanStack DB, routing |
| Add a new API endpoint | [workers/CLAUDE.md](workers/CLAUDE.md), [packages/worker-utils/CLAUDE.md](packages/worker-utils/CLAUDE.md) |
| Add a new service | [packages/CLAUDE.md](packages/CLAUDE.md), [packages/service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) |
| Work with database/schema | [packages/database/CLAUDE.md](packages/database/CLAUDE.md) |
| Add input validation | [packages/validation/CLAUDE.md](packages/validation/CLAUDE.md) |
| Understand security/auth | [packages/security/CLAUDE.md](packages/security/CLAUDE.md) |
| Handle errors correctly | [packages/service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) |
| Work with R2/KV | [packages/cloudflare-clients/CLAUDE.md](packages/cloudflare-clients/CLAUDE.md) |
| Work with caching/versions | [packages/cache/CLAUDE.md](packages/cache/CLAUDE.md) (if exists), [apps/web/CLAUDE.md](apps/web/CLAUDE.md) |

---

## Workers (Cloudflare)

All ports are defined in `@codex/constants` `SERVICE_PORTS` — use `getServiceUrl(service, env)` to resolve URLs. NEVER hardcode port numbers.

| # | Worker | Port | Purpose | Key Endpoints |
|---|---|---|---|---|
| 1 | **auth** | 42069 | BetterAuth, sessions (PG+KV cache), rate limiting | `POST /register`, `/login`, `GET /session` |
| 2 | **content-api** | 4001 | Content CRUD, media registration, access control, streaming | `POST /content`, `GET /stream/:id` |
| 3 | **organization-api** | 42071 | Org CRUD, membership, settings | `POST /organizations`, `GET /organizations/:slug` |
| 4 | **ecom-api** | 42072 | Stripe checkout, webhooks, purchase history | `POST /checkout/create`, `POST /webhooks/stripe` |
| 5 | **admin-api** | 42073 | Analytics, content/customer management (platform_owner) | `GET /analytics/revenue`, `POST /content/publish-override` |
| 6 | **identity-api** | 42074 | User profiles, platform settings (branding, contact, features) | `GET /settings/branding`, `PUT /settings/features` |
| 7 | **notifications-api** | 42075 | Email templates, sending (Resend) | `POST /templates`, `POST /send` |
| 8 | **media-api** | 4002 | Transcoding pipeline (RunPod), webhooks, HLS | `POST /transcode`, `POST /webhook` |
| 9 | **dev-cdn** | 4100 | Local development CDN proxy (Miniflare R2) | `GET /:key` |

> **Note**: Content-API and Access share port 4001 — access control is co-deployed with the content worker because signed URL generation needs direct R2 access.

---

## Packages (21 total)

### Foundation (core infrastructure, no business logic)
| Package | Purpose | Key Exports |
|---|---|---|
| **@codex/database** | Drizzle ORM, Neon | `dbHttp`, `dbWs`, `schema`, query helpers |
| **@codex/shared-types** | TypeScript contracts | `HonoEnv`, `SingleItemResponse`, `ErrorResponse` |
| **@codex/service-errors** | Error handling | `BaseService`, `*Error` classes, `mapErrorToResponse` |
| **@codex/security** | Auth & protection | `requireAuth`, `rateLimit`, `workerAuth`, `securityHeaders` |
| **@codex/validation** | Zod schemas | `*Schema`, `sanitizeSvgContent` |
| **@codex/constants** | Shared constants | `SERVICE_PORTS`, `getServiceUrl`, `isDev`, `getCookieConfig` |

### Services (business logic)
| Package | Purpose | Key Exports |
|---|---|---|
| **@codex/content** | Content/media lifecycle | `ContentService`, `MediaItemService` |
| **@codex/organization** | Org CRUD, membership | `OrganizationService` |
| **@codex/identity** | User identity | `IdentityService` |
| **@codex/access** | Access control, streaming | `ContentAccessService` |
| **@codex/purchase** | Stripe, purchases | `PurchaseService` |
| **@codex/notifications** | Email, templates | `NotificationsService`, `TemplateService` |
| **@codex/admin** | Admin analytics/mgmt | `AnalyticsService` |
| **@codex/transcoding** | RunPod transcoding | `TranscodingService` |

### Utilities
| Package | Purpose | Key Exports |
|---|---|---|
| **@codex/worker-utils** | Worker factory, procedure handler | `createWorker`, `procedure`, `PaginatedResult` |
| **@codex/cloudflare-clients** | R2 and KV clients | `R2Service`, `R2SigningClient` |
| **@codex/cache** | Version-based cache | `VersionedCache`, `CacheType` |
| **@codex/observability** | Structured logging | `ObservabilityClient` |
| **@codex/image-processing** | Image resize/convert | `ImageProcessingService` |
| **@codex/platform-settings** | Settings facade | `PlatformSettingsFacade` |
| **@codex/test-utils** | Test infrastructure | `setupTestDatabase`, factories |

---

## Strict Rules (All Code)

These rules are MANDATORY. Every agent working anywhere in this codebase MUST follow them.

### Security

- **MUST** scope every database query with `scopedNotDeleted(table, creatorId)` or `withCreatorScope()` — unscoped queries are a data exposure vulnerability
- **MUST** use `procedure({ policy: { auth: 'required' } })` for any endpoint that accesses user data
- **MUST** validate all input with Zod schemas via `procedure({ input: { body: schema } })` — no unvalidated input reaches handlers
- **MUST** use `policy: { auth: 'worker' }` with HMAC-SHA256 for worker-to-worker calls
- **MUST** use rate limiting on all auth endpoints (`rateLimit: 'auth'` = 5 req/15min)
- **NEVER** expose internal error details (stack traces, SQL, DB URLs) in API responses — `mapErrorToResponse()` handles this
- **NEVER** log PII (passwords, tokens, emails) — use `@codex/observability` redaction

### Error Handling

- **MUST** throw typed `ServiceError` subclasses (`NotFoundError`, `ForbiddenError`, etc.) — NEVER throw raw strings or generic `Error`
- **MUST** let errors propagate to `procedure()` which calls `mapErrorToResponse()` — NEVER catch-and-swallow in route handlers
- **MUST** use `handleError()` in services to re-throw known errors and wrap unknown ones
- **MUST** roll back transactions automatically by throwing inside `db.transaction()` — NEVER catch inside transactions unless you want partial commit

### Data Integrity

- **MUST** use soft deletes (`deletedAt` column) — NEVER hard-delete rows
- **MUST** use `db.transaction()` for multi-step operations (e.g., create content + assign media)
- **MUST** use `withPagination()` helper for list queries — returns `{ limit, offset }` from page/limit params
- **MUST** return `new PaginatedResult(items, pagination)` from list handlers — procedure() wraps in `{ items, pagination }` envelope

### API Response Envelope

All `procedure()` endpoints follow this envelope — NEVER deviate:

| Type | HTTP Status | Response Shape |
|---|---|---|
| **Single item** | 200 (GET/PATCH) or 201 (POST create) | `{ data: T }` — handler returns plain object, procedure wraps |
| **List** | 200 | `{ items: T[], pagination: { page, limit, total, totalPages } }` — handler returns `PaginatedResult` |
| **Error** | 4xx/5xx | `{ error: { code, message, details? } }` — from `mapErrorToResponse()` |
| **No content** | 204 | Empty body — handler returns `null` |

### Ports & URLs

- **MUST** use `getServiceUrl(service, env)` from `@codex/constants` — NEVER hardcode localhost URLs or port numbers
- **MUST** use `SERVICE_PORTS` from `@codex/constants` as single source of truth for port assignments

### Currency

- Default currency is **GBP (£)**, not USD ($)

---

## Common Developer Tasks

### Adding a New API Endpoint

1. Define Zod schema → `packages/validation/src/[domain].ts`
2. Add service method → `packages/[service]/src/services/*-service.ts` (extend `BaseService`)
3. Create worker route → `workers/[worker]/src/routes/*.ts` using `procedure()`
4. **Always**: Scope by creatorId/orgId, validate input, use transactions for multi-step
5. **Lists**: Return `new PaginatedResult(result.items, result.pagination)` from handler

### Implementing Content/Media Features

- Content lifecycle → `@codex/content` `ContentService`
- Content page URLs → `buildContentUrl(page.url, content)` from `apps/web/src/lib/utils/subdomain.ts` — handles cross-org subdomain routing and slug/ID fallback
- Media upload/transcode → `@codex/content` `MediaItemService`
- Streaming URLs → `@codex/access` `ContentAccessService` (signed R2 URLs)
- Transcoding → `@codex/transcoding` `TranscodingService` → RunPod
- Reference: `packages/content/src/services/content-service.ts`

### Handling Authentication/Authorization

- Session validation → `procedure({ policy: { auth: 'required' } })`
- Role checks → `policy: { roles: ['creator', 'admin'] }`
- Org membership → `policy: { requireOrgMembership: true }`
- Platform owner → `policy: { auth: 'platform_owner' }`
- Worker-to-worker → `policy: { auth: 'worker' }` (HMAC-SHA256)
- Reference: `packages/worker-utils/src/procedure/procedure.ts`

### Working with Database

- Production queries → `dbHttp` (stateless HTTP, Cloudflare Workers)
- Transactions → `dbWs` (WebSocket, stateful — required for `db.transaction()`)
- Scoping → **ALWAYS** `scopedNotDeleted(table, creatorId)` or `withCreatorScope()`
- Pagination → `withPagination({ page, limit })` returns `{ limit, offset }`
- Reference: `packages/database/CLAUDE.md`

### Testing

- Unit tests → `@codex/test-utils` factories, `setupTestDatabase()`
- Integration tests → Use `withNeonTestBranch()` (CI), `dbWs` for transactions
- Test factories → `packages/test-utils/src/factories.ts`
- Reference test → `packages/organization/src/services/__tests__/organization-service.test.ts`

### Handling SVG/Media

- SVG uploads → `@codex/validation` `sanitizeSvgContent()` (XSS prevention)
- Image processing → `@codex/image-processing` `ImageProcessingService` (WebP, 3 variants)
- R2 uploads → `@codex/cloudflare-clients` `R2Service`
- Local dev images → Use dev-cdn (port 4100) + Miniflare R2, NEVER external placeholder services

### Server Load Streaming (Shell + Stream Pattern)

SvelteKit server loads can return unresolved promises. The page renders immediately with awaited data; streamed data fills in via `{#await}` blocks with skeleton loading states.

**Rule: Await critical data, stream secondary data.**

```typescript
// +page.server.ts — Shell + Stream
export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();

  // AWAIT: Critical for first paint (hero, SEO, page structure)
  const content = await getPublicContent({ orgId: org.id, limit: 6 });

  return {
    newReleases: content?.items ?? [],                        // Awaited — renders immediately
    creators: getCreators({ slug: org.slug })                 // Streamed — skeleton → data
      .then(r => ({ items: r?.items ?? [], total: r?.pagination?.total ?? 0 }))
      .catch(() => ({ items: [], total: 0 })),
    continueWatching: getContinueWatching()                   // Streamed — skeleton → data
      .catch(() => undefined),
  };
};
```

```svelte
<!-- +page.svelte — Skeleton → Content -->
<HeroSection items={data.newReleases} />

{#await data.creators}
  <CreatorsSkeleton />
{:then creators}
  {#if creators.items.length > 0}
    <CreatorsSection items={creators.items} />
  {/if}
{/await}
```

**Streaming rules:**
- **MUST** `.catch()` on every returned promise — unhandled rejections crash the server
- **MUST** await data needed for SEO (`<svelte:head>`) and page structure
- **MUST** use `{#await}` blocks with skeleton loading states for streamed data
- **MUST** use design tokens in skeleton CSS (shimmer animation, `--color-surface-secondary`)
- With JS disabled, SvelteKit waits for all promises before sending HTML (graceful degradation)
- Streaming only works in `+page.server.ts`, NOT `+page.ts` (universal loads)

**Pages using streaming:** Org landing, content detail (org + creator), studio dashboard, studio customers.

### Studio SPA Mode

The studio uses `export const ssr = false` (`_org/[slug]/studio/+layout.ts`) — the entire studio sub-tree is client-rendered. This gives instant navigation between studio pages since there's no server HTML generation.

**What still works:**
- Parent org layout SSR's normally (auth, branding, org resolution)
- `+page.server.ts` files still execute (SvelteKit calls them via fetch)
- Auth guard in `+layout.server.ts` still redirects unauthenticated users
- Role guard still checks membership

**What changes:**
- Initial studio page load shows empty shell → client renders content
- Navigation between studio pages is instant (no loading bar)
- View Source shows no studio content (client-only)

**When to use `ssr = false`:** Only for route subtrees that are behind auth, not SEO-significant, and where instant navigation matters (admin panels, dashboards, settings).

### Server-Side KV Caching (VersionedCache)

Workers use `@codex/cache` `VersionedCache` for KV-backed cache-aside. Pattern:

```typescript
const cache = new VersionedCache({ kv: env.CACHE_KV });

// Cache-aside: try cache, fall back to DB, write-through
const data = await cache.get(CacheType.ORG_CONFIG, orgSlug, async () => {
  return await service.getPublicInfo(slug); // fetcher on miss
}, { ttl: 30 * 60 }); // 30 min TTL

// Invalidate on mutation (fire-and-forget via waitUntil)
executionCtx.waitUntil(
  cache.invalidate(CacheType.ORG_CONFIG, orgSlug).catch(() => {})
);
```

**Currently cached:** User profile (10min), user preferences (10min), org branding (30min), org content collection versions. See `docs/caching-strategy.md` for full details.

---

## Development

- **Start all services**: `pnpm dev` (from monorepo root — NEVER cd into individual workers)
- **Run tests**: `pnpm test`
- **Build**: `pnpm build`
- **Type check**: `pnpm typecheck`
- **DB migrations**: `pnpm db:migrate`

### Key Patterns Summary

| Pattern | Rule |
|---|---|
| **Transactions** | `db.transaction()` for multi-step — MUST use `dbWs` |
| **Scoping** | ALWAYS filter by `creatorId`/`orgId` — NEVER unscoped queries |
| **Soft Delete** | Set `deletedAt` — NEVER hard delete |
| **Errors** | Throw typed `ServiceError` subclass → procedure maps to HTTP |
| **Env** | Shared bindings defined in `@codex/shared-types` `HonoEnv` |
| **Logging** | Use `ObservabilityClient` with PII redaction — NEVER `console.log` |
| **Streaming** | Await critical data, stream secondary via bare promises + `{#await}` skeletons |
| **Studio** | `ssr = false` — client-rendered SPA for instant navigation |
| **KV Cache** | `VersionedCache` cache-aside with TTL + fire-and-forget invalidation |
