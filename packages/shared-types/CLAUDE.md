# @codex/shared-types

TypeScript definitions only. Single source of truth for API contracts and shared types.

## Key Exports

### HonoEnv
Type definition for all Cloudflare Worker Hono apps:
```ts
interface HonoEnv {
  Bindings: {
    DATABASE_URL: string;
    AUTH_SESSION_KV: KVNamespace;
    MEDIA_BUCKET: R2Bucket;
    CACHE_KV: KVNamespace;
    WORKER_SHARED_SECRET: string;
    // ... additional per-worker bindings
  };
  Variables: {
    user: UserData | null;
    session: SessionData | null;
    requestId: string;
  };
}
```

### API Response Types

| Type | Shape | Used For |
|---|---|---|
| `SingleItemResponse<T>` | `{ data: T }` | GET single, POST create, PATCH update |
| `PaginatedListResponse<T>` | `{ items: T[], pagination: PaginationMetadata }` | GET list endpoints |
| `ErrorResponse` | `{ error: { code, message, details? } }` | All error responses |

```ts
interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

### Context Types
| Type | Description |
|---|---|
| `AuthenticatedContext` | Context with guaranteed `user` and `session` |
| `EnrichedAuthContext` | Extended context with org membership data |

### Domain Response Types
- `ContentResponse` — content item with relations
- `MediaResponse` — media item with status/variants
- `OrgResponse` — organization with branding

### Worker Communication Types
- `WorkerRequestHeaders` — HMAC signature headers for worker-to-worker calls
- `TranscodeRequest` / `TranscodeResponse` — media-api transcoding contract

## Usage

```ts
import type { HonoEnv, SingleItemResponse } from '@codex/shared-types';

const app = new Hono<HonoEnv>();

app.get('/', (c) => {
  const user = c.get('user');  // Typed as UserData | null
  return c.json({ data: result } satisfies SingleItemResponse<typeof result>);
});
```

## Exceptions

**BetterAuth endpoints**: The Auth worker uses BetterAuth which has its own response format — NOT wrapped in `{ data: T }`:
```ts
// BetterAuth returns directly, not wrapped
{ user?: UserData; session?: SessionData } | null
```
This is a documented exception because BetterAuth owns the response contract.

## Strict Rules

- **MUST** use `HonoEnv` as the type parameter for all Hono apps — NEVER define custom env types per worker
- **MUST** use `SingleItemResponse<T>` / `PaginatedListResponse<T>` for typing API responses — NEVER invent custom response shapes
- **NEVER** add business logic to this package — it is types-only, zero runtime code
- **NEVER** import from this package at runtime in the web app — these types are for workers only

## Integration

- **Depends on**: Nothing (types-only package)
- **Used by**: All workers (via `HonoEnv`), `@codex/worker-utils` (response types)

## Reference Files

- `packages/shared-types/src/api-responses.ts` — response types
- `packages/shared-types/src/worker-types.ts` — worker communication types
- `packages/shared-types/src/index.ts` — barrel export
