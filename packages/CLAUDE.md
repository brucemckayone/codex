# Codex Packages

22 packages across 3 layers: Foundation, Service, Utility.

## Package Registry

### Foundation (core infrastructure — no business logic)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/database** | Drizzle ORM, Neon PostgreSQL | `dbHttp`, `dbWs`, `schema`, `scopedNotDeleted`, `withPagination` | [database/CLAUDE.md](database/CLAUDE.md) |
| **@codex/shared-types** | TypeScript contracts, API shapes | `HonoEnv`, `SingleItemResponse`, `PaginatedListResponse`, `ErrorResponse`, `Bindings` | [shared-types/CLAUDE.md](shared-types/CLAUDE.md) |
| **@codex/service-errors** | Error classes, BaseService | `BaseService`, `NotFoundError`, `ForbiddenError`, `ValidationError`, `BusinessLogicError`, `mapErrorToResponse` | [service-errors/CLAUDE.md](service-errors/CLAUDE.md) |
| **@codex/security** | Auth middleware, rate limiting | `requireAuth`, `optionalAuth`, `workerAuth`, `rateLimit`, `securityHeaders` | [security/CLAUDE.md](security/CLAUDE.md) |
| **@codex/validation** | Zod schemas, sanitization | `*Schema`, `sanitizeSvgContent`, `validateImageUpload`, `orgSlugSchema` | [validation/CLAUDE.md](validation/CLAUDE.md) |
| **@codex/constants** | Shared constants, URLs | `SERVICE_PORTS`, `getServiceUrl`, `isDev`, `getCookieConfig`, `RESERVED_SUBDOMAINS`, `CURRENCY`, `FEES` | [constants/CLAUDE.md](constants/CLAUDE.md) |

### Services (business logic — extend BaseService, use Foundation)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/content** | Content/media lifecycle | `ContentService`, `MediaItemService` | [content/CLAUDE.md](content/CLAUDE.md) |
| **@codex/organization** | Org CRUD, membership | `OrganizationService` | [organization/CLAUDE.md](organization/CLAUDE.md) |
| **@codex/identity** | User profiles, identity | `IdentityService` | [identity/CLAUDE.md](identity/CLAUDE.md) |
| **@codex/access** | Access control, signed URLs, playback | `ContentAccessService` | [access/CLAUDE.md](access/CLAUDE.md) |
| **@codex/purchase** | Stripe one-time checkout, purchase history | `PurchaseService`, `createStripeClient` | [purchase/CLAUDE.md](purchase/CLAUDE.md) |
| **@codex/subscription** | Subscription tiers, Stripe Connect, revenue splits | `TierService`, `SubscriptionService`, `ConnectAccountService`, `calculateRevenueSplit` | [subscription/CLAUDE.md](subscription/CLAUDE.md) |
| **@codex/notifications** | Email templates, sending | `NotificationsService`, `TemplateService`, `NotificationPreferencesService` | [notifications/CLAUDE.md](notifications/CLAUDE.md) |
| **@codex/admin** | Admin analytics, content/customer mgmt | `AdminAnalyticsService`, `AdminContentManagementService`, `AdminCustomerManagementService` | [admin/CLAUDE.md](admin/CLAUDE.md) |
| **@codex/transcoding** | RunPod transcoding pipeline, R2 key builders | `TranscodingService`, `getContentThumbnailKey`, `getOrgLogoKey`, `getUserAvatarKey` | [transcoding/CLAUDE.md](transcoding/CLAUDE.md) |

### Utilities (shared tools — no business logic, no direct DB access)
| Package | Purpose | Key Exports | CLAUDE.md |
|---|---|---|---|
| **@codex/worker-utils** | Worker factory, procedure handler, service registry | `createWorker`, `procedure`, `multipartProcedure`, `PaginatedResult`, `createServiceRegistry`, `sendEmailToWorker` | [worker-utils/CLAUDE.md](worker-utils/CLAUDE.md) |
| **@codex/cloudflare-clients** | R2, presigned URLs, CDN cache purge | `R2Service`, `R2SigningClient`, `createR2SigningClientFromEnv`, `CachePurgeClient` | [cloudflare-clients/CLAUDE.md](cloudflare-clients/CLAUDE.md) |
| **@codex/cache** | Version-based KV cache invalidation | `VersionedCache`, `CacheType`, `buildCacheKey` | [cache/CLAUDE.md](cache/CLAUDE.md) |
| **@codex/observability** | Structured logging, PII redaction | `ObservabilityClient`, `createRequestTimer` | [observability/CLAUDE.md](observability/CLAUDE.md) |
| **@codex/image-processing** | Image resize (WASM), WebP variants, R2 upload | `ImageProcessingService`, `OrphanedFileService`, `InvalidImageError` | [image-processing/CLAUDE.md](image-processing/CLAUDE.md) |
| **@codex/platform-settings** | Settings facade (branding, contact, features) | `PlatformSettingsFacade`, `BrandingSettingsService`, `ContactSettingsService`, `FeatureSettingsService` | [platform-settings/CLAUDE.md](platform-settings/CLAUDE.md) |
| **@codex/test-utils** | Test DB setup, entity factories, mocks | `setupTestDatabase`, `seedTestUsers`, `createTestContentInput`, `createMockObservability`, subscription factories | [test-utils/CLAUDE.md](test-utils/CLAUDE.md) |

---

## Dependency Graph

```
Foundation (no dependencies between foundation packages):
  database, shared-types, service-errors, security, validation, constants

Services (depend on Foundation):
  content      → database, service-errors, validation, cloudflare-clients, transcoding
  organization → database, service-errors, validation
  identity     → database, service-errors, validation, cloudflare-clients, cache
  access       → database, service-errors, cloudflare-clients, purchase
  purchase     → database, service-errors, validation (+ Stripe SDK)
  subscription → database, service-errors, validation, constants (+ Stripe SDK)
  notifications→ database, service-errors, validation, platform-settings
  admin        → database, service-errors
  transcoding  → database, service-errors, cloudflare-clients

Utilities (used by Workers and Services):
  worker-utils    → security, service-errors, shared-types, observability + all services
  cloudflare-clients → (standalone, Cloudflare + AWS SDK only)
  cache           → (standalone, KV only)
  observability   → (standalone)
  image-processing→ cloudflare-clients, validation, transcoding (key builders), @cf-wasm/photon
  platform-settings→ database, cloudflare-clients, service-errors, shared-types, validation
  test-utils      → database
```

---

## Where Do I Find X?

| I need to... | Package |
|---|---|
| Create/update/delete content or media items | `@codex/content` |
| Check access, generate streaming URLs | `@codex/access` |
| User profile, avatars | `@codex/identity` |
| Org settings (branding, features, contact) | `@codex/platform-settings` |
| One-time purchases, purchase history | `@codex/purchase` |
| Subscription tiers, billing, Stripe Connect | `@codex/subscription` |
| Send emails, manage templates | `@codex/notifications` |
| Transcode media, R2 key builders | `@codex/transcoding` |
| Admin analytics, content moderation | `@codex/admin` |
| Upload/resize images | `@codex/image-processing` |
| KV cache with version invalidation | `@codex/cache` |
| R2 put/get/delete, presigned URLs | `@codex/cloudflare-clients` |
| Build a worker route | `@codex/worker-utils` (`procedure()`) |
| Error types, BaseService | `@codex/service-errors` |
| Input validation schemas | `@codex/validation` |
| Service URLs, constants | `@codex/constants` |
| Logging | `@codex/observability` |
| Test factories, DB setup | `@codex/test-utils` |

---

## Adding a New Package

1. Create `packages/{name}/` with `package.json` (`"name": "@codex/{name}"`)
2. Add `src/index.ts` barrel export
3. If it has business logic → extend `BaseService` from `@codex/service-errors`
4. If it has DB queries → use `@codex/database` with mandatory `scopedNotDeleted()` scoping
5. Add `CLAUDE.md` following the template in existing packages
6. If it needs to be in `procedure()` handlers → add to service registry in `packages/worker-utils/src/procedure/service-registry.ts`
7. Register in the table above

## Shared Patterns

All service packages follow these patterns. See root [CLAUDE.md](../CLAUDE.md) for strict rules.

| Pattern | Implementation |
|---|---|
| **New API** | Zod schema (`@codex/validation`) → Service method (`BaseService`) → Worker route (`procedure()`) |
| **Scoping** | ALWAYS `scopedNotDeleted(table, creatorId)` — unscoped queries are a data exposure vulnerability |
| **Transactions** | `db.transaction(async (tx) => { ... })` — errors auto-rollback; requires `dbWs` |
| **Errors** | Throw typed `ServiceError` subclass — NEVER raw strings. `handleError()` wraps unknowns |
| **Logging** | `this.obs.info/warn/error()` via `ObservabilityClient` — NEVER `console.log` |
| **Soft Delete** | Set `deletedAt = new Date()` — NEVER hard delete. Filter with `whereNotDeleted()` |
| **Currency** | All amounts in pence (GBP) — default currency is £, not $ |
