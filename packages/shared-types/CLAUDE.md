# @codex/shared-types

TS definitions only. Source of truth.

## Contents
- **HonoEnv**: `Bindings` (R2, KV, DB), `Variables` (user, session).
- **Response Types**:
  - `SingleItemResponse<T>` - Single item wrapped in `{ data: T }`
  - `PaginatedListResponse<T>` - List with `{ items: T[], pagination: {...} }`
  - `ErrorResponse` - Error response format
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

## API Response Type Standards

All API endpoints should return responses in one of the following formats:

### 1. Single Item Response
Use for endpoints that return a single resource.
```typescript
// Type definition
export interface SingleItemResponse<T> {
  data: T;
}

// Example usage in API client
request<SingleItemResponse<UserData>>('identity', '/api/user/profile')
// Returns: { data: { id, email, name, ... } }
```

### 2. Paginated List Response
Use for endpoints that return a list with pagination metadata.
```typescript
// Type definition
export interface PaginatedListResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Example usage in API client
request<PaginatedListResponse<ContentItem>>('content', '/api/content')
// Returns: { items: [...], pagination: { page: 1, limit: 20, total: 145, totalPages: 8 } }
```

### 3. Null Response
Use for endpoints that return 204 No Content.
```typescript
// Example: DELETE endpoints
request<void>('content', `/api/content/${id}`, { method: 'DELETE' })
// Returns: null
```

### 4. Custom Response
Use only when the response structure fundamentally differs from the standard patterns.
Examples include:
- Aggregated analytics (e.g., `{ totalRevenueCents, totalPurchases, ... }`)
- Success confirmations (e.g., `{ success: true, message: "..." }`)
- Boolean responses (e.g., `{ available: true }`)

Custom responses must have JSDoc documentation with examples.

### Exceptions

**BetterAuth Endpoints**: The Auth worker uses BetterAuth which has its own response format.
```typescript
// BetterAuth returns this format directly, not wrapped
request<{ user?: UserData; session?: SessionData } | null>('auth', '/api/auth/get-session')
// Returns: { user: {...}, session: {...} } or null
```

This is a documented exception because BetterAuth owns the response contract.
