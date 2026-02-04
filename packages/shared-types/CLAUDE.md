# @codex/shared-types

TS definitions only. Source of truth.

## Contents
- **HonoEnv**: `Bindings` (R2, KV, DB), `Variables` (user, session).
- **Responses**:
  - `SingleItemResponse<T>`
  - `PaginatedListResponse<T>`
  - `ErrorResponse`
- **Context**: `AuthenticatedContext`, `EnrichedAuthContext`.
- **Domain**: `ContentResponse`, `MediaResponse`, `OrgResponse`.

## Usage
```ts
const app = new Hono<HonoEnv>();
app.get('/', (c) => {
  const user = c.get('user'); // Typed
  return c.json({ data: ... } satisfies ContentResponse);
});
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
