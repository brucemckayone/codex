# Codex Packages

18 packages across 3 layers: Foundation, Service, Utility.

## Quick Ref
| Pkg | Use | Key Exports |
|---|---|---|
| **database** | Data Access | `dbHttp`, `dbWs`, `schema` |
| **shared-types** | Contracts | `HonoEnv`, `*Response` |
| **validation** | Input Check | `*Schema` (Zod) |
| **service-errors**| Error Handling| `BaseService`, `*Error` |
| **security** | Auth/Protection| `requireAuth`, `rateLimit` |
| **content** | Content Logic | `ContentService`, `MediaItemService` |
| **identity** | Org Logic | `OrganizationService` |
| **access** | Access/Stream | `ContentAccessService` |
| **purchase** | Stripe/Sales | `PurchaseService` |
| **worker-utils** | Worker Setup | `createWorker`, `procedure` |
| **cloudflare** | R2/KV | `R2Service` |
| **observability** | Logs | `ObservabilityClient` |
| **test-utils** | Testing | `setupTestDatabase` |

## Foundation
- **database**: Drizzle/Neon. `dbHttp` (prod), `dbWs` (txn).
- **shared-types**: TS defs only. Env, Bindings, Responses.
- **service-errors**: `BaseService`, `mapErrorToResponse`, Standard Errors.
- **security**: Headers, Rate Limit (KV), Session Auth, Worker HMAC.
- **validation**: Zod schemas. Primitives + Domain.

## Services
- **content**: Lifecycle (draft->pub->del). Media transcoding status.
- **identity**: Orgs (CRUD, slug check).
- **access**: Check perms, Sign R2 URLs, Playback progress.
- **purchase**: Stripe Checkout, Webhooks, Revenue Split.

## Utilities
- **worker-utils**: `createWorker` (Hono app), `procedure` (tRPC-like handler), Health.
- **cloudflare-clients**: R2 wrappers (retry, sign).
- **test-utils**: DB setup, seeders.

## Patterns
- **New API**: Schema (`validation`) -> Service Method -> Worker Route (`procedure`).
- **Scoping**: Always filter by `creatorId` or `organizationId`.
- **Transactions**: Use `db.transaction()` for multi-step.
- **Errors**: Service throws `*Error`; Worker maps to HTTP.