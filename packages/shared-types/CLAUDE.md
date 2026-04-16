# @codex/shared-types

TypeScript types only — zero runtime code. Single source of truth for API contracts and worker bindings.

## Key Exports

### `HonoEnv`

Type parameter for all Hono apps in this codebase:

```ts
import type { HonoEnv } from '@codex/shared-types';
const app = new Hono<HonoEnv>();
```

Combines `Bindings` and `Variables`.

### `Bindings`

All Cloudflare Worker environment bindings (required + optional):

```ts
type Bindings = {
  // Required on every worker
  ENVIRONMENT: string;
  DATABASE_URL: string;
  WORKER_SHARED_SECRET: string;

  // Optional (worker-specific)
  AUTH_SESSION_KV?: KVNamespace;
  RATE_LIMIT_KV?: KVNamespace;
  CACHE_KV?: KVNamespace;
  BRAND_KV?: KVNamespace;
  MEDIA_BUCKET?: R2Bucket;
  ASSETS_BUCKET?: R2Bucket;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  RESEND_API_KEY?: string;
  RUNPOD_API_KEY?: string;
  // ... (see worker-types.ts for full list)
}
```

### `Variables`

Context variables set by middleware during request processing:

```ts
interface Variables {
  session?: SessionData;
  user?: UserData;
  obs?: ObservabilityClient;
  requestId?: string;
  clientIP?: string;
  userAgent?: string;
  workerAuth?: boolean;
  organizationId?: string;
  organizationRole?: string;
  organizationMembership?: { role, status, joinedAt };
  rawBody?: string;  // for webhook signature verification
}
```

`Variables` is an **interface** (not type) — service packages augment it to add service instances.

### API Response Envelope Types

| Type | Wire Shape | Use For |
|---|---|---|
| `ApiSingleEnvelope<T>` | `{ data: T }` | Single-item responses (GET/POST/PATCH) |
| `ApiListEnvelope<T>` | `{ items: T[], pagination: PaginationMetadata }` | Paginated list responses |
| `ApiErrorEnvelope` | `{ error: { code, message, details? } }` | Error responses |
| `SingleItemResponse<T>` | `{ data: T }` | (alias for `ApiSingleEnvelope`) |
| `PaginatedListResponse<T>` | `{ items: T[], pagination: PaginationMetadata }` | (alias for `ApiListEnvelope`) |

```ts
interface PaginationMetadata { page: number; limit: number; total: number; totalPages: number; }
interface PaginationParams { page: number; limit: number; }
```

`procedure()` in `@codex/worker-utils` wraps handler returns in these envelopes automatically — you don't construct them manually.

### Context Types

```ts
type AuthenticatedContext<TEnv = HonoEnv> = {
  user: Required<NonNullable<UserData>>;
  session: SessionData | undefined;
  env: Bindings;
}

type EnrichedAuthContext<TEnv = HonoEnv> = AuthenticatedContext & {
  requestId: string;
  clientIP: string;
  userAgent: string;
  organizationId?: string;
  permissions: string[];
}
```

### User & Session Types

```ts
type UserProfile = { id, email, name, emailVerified, image, username, bio, socialLinks }
type UserData = UserProfile & { name: string | null, role: string, createdAt, ... }
type SessionData = { id, userId, expiresAt, token?, ... }
type ProgressData = { positionSeconds, durationSeconds, completed, updatedAt }
type CheckoutResponse = { sessionId, sessionUrl }
type ErrorResponse = { error: { code, message, details? } }  // same as ApiErrorEnvelope
```

### Organization Types

```ts
type OrgMemberRole = 'owner' | 'admin' | 'creator' | 'subscriber' | 'member'
type OrgMemberContext = { organizationId: string, role: OrgMemberRole }

interface MembershipLookupResponse { role: OrgMemberRole | null, joinedAt: string | null }
interface MyMembershipResponse { role: OrgMemberRole | null, status: 'active'|'inactive'|'invited'|null, joinedAt: string | null }
interface OrganizationWithRole { id, name, slug, logoUrl, role: OrgMemberRole }
```

### Settings Response Types

```ts
BrandingSettingsResponse  // All branding fields (colors, fonts, radius, density, hero layout, etc.)
ContactSettingsResponse   // Platform name, support email, timezone, social URLs
FeatureSettingsResponse   // { enableSignups, enablePurchases, enableSubscriptions }
AllSettingsResponse       // { branding, contact, features }
PublicBrandingResponse    // Subset of branding for public (unauthenticated) endpoints
```

### Other Types

```ts
CheckSlugResponse           // { available: boolean }
OrganizationPublicStatsResponse  // { content: { total, video, audio, written }, totalDurationSeconds, creators, totalViews, categories }
SortOrder                   // 'asc' | 'desc'
```

## Entity-Specific Response Types

**Important**: `ContentResponse`, `MediaResponse`, `OrgResponse`, etc. are defined in their respective service packages (`@codex/content`, `@codex/identity`, etc.) — not here. This avoids circular dependencies.

## Exceptions

BetterAuth endpoints in the auth worker return their own response format (not wrapped in `{ data }`). This is intentional — BetterAuth owns the auth response contract.

## Strict Rules

- **MUST** use `HonoEnv` as type parameter for all Hono apps — never define per-worker env types
- **MUST** use `ApiSingleEnvelope` / `ApiListEnvelope` for typing API response shapes
- **NEVER** add runtime code or logic to this package — types only
- **NEVER** import from this package in the SvelteKit web app at runtime — workers only

## Reference Files

- `packages/shared-types/src/worker-types.ts` — `HonoEnv`, `Bindings`, `Variables`, user/session types
- `packages/shared-types/src/api-responses.ts` — response envelopes, pagination, settings types
- `packages/shared-types/src/member-types.ts` — `OrgMemberRole`, `OrgMemberContext`
