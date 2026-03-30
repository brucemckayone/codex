# Codex Packages

21 packages across 3 layers: Foundation, Service, Utility.

## Package Registry

### Foundation (core infrastructure — no business logic)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/database** | Drizzle ORM, Neon PostgreSQL | `dbHttp`, `dbWs`, `schema`, `scopedNotDeleted`, `withPagination` | [database/CLAUDE.md](database/CLAUDE.md) |
| **@codex/shared-types** | TypeScript contracts, API shapes | `HonoEnv`, `SingleItemResponse`, `PaginatedListResponse`, `ErrorResponse` | [shared-types/CLAUDE.md](shared-types/CLAUDE.md) |
| **@codex/service-errors** | Error classes, BaseService | `BaseService`, `NotFoundError`, `ForbiddenError`, `mapErrorToResponse` | [service-errors/CLAUDE.md](service-errors/CLAUDE.md) |
| **@codex/security** | Auth middleware, rate limiting | `requireAuth`, `optionalAuth`, `workerAuth`, `rateLimit`, `securityHeaders` | [security/CLAUDE.md](security/CLAUDE.md) |
| **@codex/validation** | Zod schemas, sanitization | `*Schema`, `sanitizeSvgContent`, `orgSlugSchema` | [validation/CLAUDE.md](validation/CLAUDE.md) |
| **@codex/constants** | Shared constants, URLs | `SERVICE_PORTS`, `getServiceUrl`, `isDev`, `getCookieConfig`, `RESERVED_SUBDOMAINS` | [constants/CLAUDE.md](constants/CLAUDE.md) |

### Services (business logic — extend BaseService, use Foundation)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/content** | Content/media lifecycle | `ContentService`, `MediaItemService` | [content/CLAUDE.md](content/CLAUDE.md) |
| **@codex/organization** | Org CRUD, membership | `OrganizationService` | [organization/CLAUDE.md](organization/CLAUDE.md) |
| **@codex/identity** | User profiles, identity | `IdentityService` | [identity/CLAUDE.md](identity/CLAUDE.md) |
| **@codex/access** | Access control, signed URLs, playback | `ContentAccessService` | [access/CLAUDE.md](access/CLAUDE.md) |
| **@codex/purchase** | Stripe checkout, webhooks, revenue | `PurchaseService`, `createStripeClient` | [purchase/CLAUDE.md](purchase/CLAUDE.md) |
| **@codex/notifications** | Email templates, sending | `NotificationsService`, `TemplateService` | [notifications/CLAUDE.md](notifications/CLAUDE.md) |
| **@codex/admin** | Admin analytics, content mgmt | `AnalyticsService` | [admin/CLAUDE.md](admin/CLAUDE.md) |
| **@codex/transcoding** | RunPod transcoding pipeline | `TranscodingService` | [transcoding/CLAUDE.md](transcoding/CLAUDE.md) |

### Utilities (shared tools — no business logic, no database access)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/worker-utils** | Worker factory, procedure handler | `createWorker`, `procedure`, `PaginatedResult` | [worker-utils/CLAUDE.md](worker-utils/CLAUDE.md) |
| **@codex/cloudflare-clients** | R2 and KV wrappers | `R2Service`, `R2SigningClient` | [cloudflare-clients/CLAUDE.md](cloudflare-clients/CLAUDE.md) |
| **@codex/cache** | Version-based cache invalidation | `VersionedCache`, `CacheType` | [cache/CLAUDE.md](cache/CLAUDE.md) |
| **@codex/observability** | Structured logging, PII redaction | `ObservabilityClient`, `createRequestTimer` | [observability/CLAUDE.md](observability/CLAUDE.md) |
| **@codex/image-processing** | Image resize, WebP conversion | `ImageProcessingService` | [image-processing/CLAUDE.md](image-processing/CLAUDE.md) |
| **@codex/platform-settings** | Settings facade (branding, features) | `PlatformSettingsFacade` | [platform-settings/CLAUDE.md](platform-settings/CLAUDE.md) |
| **@codex/test-utils** | Test DB setup, factories, seeders | `setupTestDatabase`, `seedTestUsers` | [test-utils/CLAUDE.md](test-utils/CLAUDE.md) |

---

## Dependency Graph

```
Foundation (no dependencies between foundation packages):
  database, shared-types, service-errors, security, validation, constants

Services (depend on Foundation):
  content      → database, service-errors, validation, cloudflare-clients
  organization → database, service-errors, validation
  identity     → database, service-errors, validation
  access       → database, service-errors, cloudflare-clients, purchase
  purchase     → database, service-errors, validation (+ Stripe SDK)
  notifications→ database, service-errors, validation
  admin        → database, service-errors
  transcoding  → database, service-errors, cloudflare-clients

Utilities (used by Workers and Services):
  worker-utils → security, service-errors, shared-types, observability
  cloudflare-clients → (standalone, Cloudflare SDK only)
  cache        → (standalone, KV only)
  observability→ (standalone)
  image-processing → cloudflare-clients, validation
  platform-settings → database, cloudflare-clients
  test-utils   → database
```

---

## Adding a New Package

1. Create `packages/{name}/` with `package.json` (`"name": "@codex/{name}"`)
2. Add `src/index.ts` barrel export
3. If it has business logic → extend `BaseService` from `@codex/service-errors`
4. If it has DB queries → use `@codex/database` with mandatory scoping
5. Add `CLAUDE.md` following the template in existing packages
6. Register in the table above

## Shared Patterns

All service packages follow these patterns. See root [CLAUDE.md](../CLAUDE.md) for strict rules.

| Pattern | Implementation |
|---|---|
| **New API** | Zod schema (`@codex/validation`) → Service method (`BaseService`) → Worker route (`procedure()`) |
| **Scoping** | ALWAYS `scopedNotDeleted(table, creatorId)` — unscoped queries are a data exposure vulnerability |
| **Transactions** | `db.transaction(async (tx) => { ... })` — errors auto-rollback |
| **Errors** | Throw typed `ServiceError` subclass — NEVER raw strings. Service `handleError()` wraps unknowns |
| **Logging** | `this.obs.info/warn/error()` via `ObservabilityClient` — NEVER `console.log` |
| **Soft Delete** | Set `deletedAt = new Date()` — NEVER hard delete. Filter with `whereNotDeleted()` |
