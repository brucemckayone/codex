# @codex/shared-types

Shared TypeScript types for the Codex platform.

## Purpose

Provides common type definitions used across all Cloudflare Workers and services to ensure consistency and reduce duplication.

## Types Included

### Worker Types
- `Bindings` - Cloudflare Workers environment bindings
- `Variables` - Hono context variables
- `SessionData` - User session information
- `UserData` - Authenticated user data
- `ErrorResponse` - Standard API error response format
- `SuccessResponse<T>` - Standard API success response format
- `HonoEnv` - Combined Hono environment type
- `AuthenticatedContext` - Type-safe authenticated context

## Usage

```typescript
import type { HonoEnv, AuthenticatedContext } from '@codex/shared-types';

const app = new Hono<HonoEnv>();

// Use in route handlers
app.post('/api/resource', async (c) => {
  const user = c.get('user'); // Typed as UserData | undefined
  // ...
});
```

## Benefits

- **Single source of truth** for common types
- **Consistency** across all workers
- **Reduced duplication** - types defined once
- **Easy updates** - change propagates everywhere
