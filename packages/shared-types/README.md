# @codex/shared-types

Shared TypeScript types for the Codex platform. This package provides common type definitions used across Cloudflare Workers and services to ensure consistency and type safety throughout the platform.

## Installation

This package is part of the Codex monorepo and is installed automatically as a workspace dependency.

```bash
pnpm add @codex/shared-types
```

## Features

- **Worker Environment Types**: Standardized `Bindings` and `Variables` for Cloudflare Workers
- **Authentication Types**: Session and user data structures for authenticated contexts
- **API Response Types**: Consistent error and success response formats
- **Context Types**: Type-safe request contexts with optional enrichment
- **Zero Dependencies**: Pure TypeScript definitions with no runtime dependencies

## Core Types

### Worker Environment

#### `Bindings`

Standard Cloudflare Workers bindings available to all workers:

```typescript
import type { Bindings } from '@codex/shared-types';

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    // env.DATABASE_URL - Neon PostgreSQL connection
    // env.ENVIRONMENT - Environment name (development, staging, production)
    // env.WEB_APP_URL - Web application URL for CORS
    // env.RATE_LIMIT_KV - Rate limiting KV namespace
  }
}
```

#### `Variables`

Context variables set during request processing:

```typescript
import type { Variables } from '@codex/shared-types';

// Variables are set by middleware and available in route handlers
{
  session?: SessionData;       // User session (from requireAuth)
  user?: UserData;             // User data (from requireAuth)
  obs?: unknown;               // Observability client
  requestId?: string;          // Request tracking ID
  clientIP?: string;           // Client IP address
  userAgent?: string;          // User agent string
  workerAuth?: boolean;        // Worker-to-worker auth flag
  organizationId?: string;     // Organization context
}
```

#### `HonoEnv`

Combined environment type for Hono framework:

```typescript
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

app.get('/example', (c) => {
  // c.env - typed Bindings
  // c.var - typed Variables
});
```

### Authentication Types

#### `SessionData`

User session information from the authentication system:

```typescript
import type { SessionData } from '@codex/shared-types';

const session: SessionData = {
  id: 'session_123',
  userId: 'user_456',
  expiresAt: new Date('2025-12-31'),
  token: 'optional_token'
};
```

#### `UserData`

User information for API operations:

```typescript
import type { UserData } from '@codex/shared-types';

const user: UserData = {
  id: 'user_123',
  email: 'user@example.com',
  name: 'John Doe',
  role: 'admin',
  emailVerified: true,
  createdAt: new Date('2025-01-01')
};
```

#### `AuthenticatedContext`

Context with guaranteed user presence (post-authentication):

```typescript
import type { AuthenticatedContext, HonoEnv } from '@codex/shared-types';

function handleAuthenticatedRequest(ctx: AuthenticatedContext<HonoEnv>) {
  // ctx.user is guaranteed to exist
  // ctx.session is available
  // ctx.env contains typed bindings

  const userId = ctx.user.id;
  const databaseUrl = ctx.env.DATABASE_URL;
}
```

#### `EnrichedAuthContext`

Extended context with request metadata for security auditing:

```typescript
import type { EnrichedAuthContext, HonoEnv } from '@codex/shared-types';

function handleEnrichedRequest(ctx: EnrichedAuthContext<HonoEnv>) {
  // All AuthenticatedContext properties plus:
  const {
    requestId,      // Unique request identifier
    clientIP,       // Client IP from Cloudflare headers
    userAgent,      // User agent string
    organizationId, // Optional organization scope
    permissions     // User permissions/roles
  } = ctx;
}
```

### API Response Types

#### `ErrorResponse`

Standard error response format:

```typescript
import type { ErrorResponse } from '@codex/shared-types';

const error: ErrorResponse = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request data',
    details: {
      field: 'email',
      reason: 'Invalid format'
    }
  }
};
```

#### `SuccessResponse<T>`

Standard success response with optional pagination metadata:

```typescript
import type { SuccessResponse } from '@codex/shared-types';

const response: SuccessResponse<User[]> = {
  data: [
    { id: '1', email: 'user1@example.com', name: 'User 1' },
    { id: '2', email: 'user2@example.com', name: 'User 2' }
  ],
  meta: {
    page: 1,
    limit: 10,
    total: 100,
    hasMore: true
  }
};
```

## Usage Examples

### Basic Worker Setup

```typescript
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
```

### Extending Shared Bindings

Workers with additional bindings should extend the base types:

```typescript
import type {
  Bindings as SharedBindings,
  Variables
} from '@codex/shared-types';

// Add worker-specific bindings
type AuthBindings = SharedBindings & {
  SESSION_SECRET: string;
  AUTH_SESSION_KV: KVNamespace;
};

// Create worker-specific environment
type AuthEnv = {
  Bindings: AuthBindings;
  Variables: Variables;
};

const app = new Hono<AuthEnv>();
```

### Authenticated Route Handlers

```typescript
import type { HonoEnv, AuthenticatedContext } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

// Route handler with authenticated context
app.get('/me', async (c) => {
  const user = c.var.user; // May be undefined

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ data: user });
});

// Helper function with guaranteed auth
function requireAuth(
  c: Context<HonoEnv>
): c is Context<HonoEnv> & { var: { user: UserData } } {
  return !!c.var.user;
}

app.get('/profile', async (c) => {
  if (!requireAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // c.var.user is now guaranteed to exist
  const userId = c.var.user.id;
  return c.json({ data: { userId } });
});
```

### API Response Helpers

```typescript
import type { SuccessResponse, ErrorResponse } from '@codex/shared-types';

// Success response helper
function success<T>(data: T, meta?: SuccessResponse<T>['meta']): SuccessResponse<T> {
  return { data, ...(meta && { meta }) };
}

// Error response helper
function error(code: string, message: string, details?: unknown): ErrorResponse {
  return {
    error: { code, message, ...(details && { details }) }
  };
}

// Usage in route
app.get('/users', async (c) => {
  const users = await db.getUsers();

  return c.json(success(users, {
    page: 1,
    limit: 10,
    total: users.length,
    hasMore: false
  }));
});
```

### Multi-tenant Context

```typescript
import type { EnrichedAuthContext } from '@codex/shared-types';

async function handleOrganizationRequest(ctx: EnrichedAuthContext) {
  const { user, organizationId, permissions } = ctx;

  // Check organization access
  if (!organizationId) {
    return error('MISSING_CONTEXT', 'Organization ID required');
  }

  // Verify permissions
  if (!permissions.includes('org:read')) {
    return error('FORBIDDEN', 'Insufficient permissions');
  }

  // Process request with organization context
  const data = await getOrganizationData(organizationId, user.id);
  return success(data);
}
```

## Package Exports

The package provides two export paths:

```typescript
// Main export (all types)
import type {
  Bindings,
  Variables,
  SessionData,
  UserData,
  ErrorResponse,
  SuccessResponse,
  HonoEnv,
  AuthenticatedContext,
  EnrichedAuthContext
} from '@codex/shared-types';

// Worker types only
import type { HonoEnv } from '@codex/shared-types/worker';
```

## Type Safety Best Practices

### 1. Use Specific Context Types

```typescript
// Good: Specific context type
function handleRequest(ctx: AuthenticatedContext) {
  const userId = ctx.user.id; // Type-safe
}

// Avoid: Generic context
function handleRequest(ctx: any) {
  const userId = ctx.user?.id; // Not type-safe
}
```

### 2. Extend Types for Worker-Specific Needs

```typescript
// Good: Extend shared types
type CustomBindings = SharedBindings & {
  CUSTOM_KV: KVNamespace;
};

// Avoid: Redefining from scratch
type CustomBindings = {
  DATABASE_URL: string;
  CUSTOM_KV: KVNamespace;
  // Missing other shared bindings
};
```

### 3. Use Type Guards

```typescript
function isAuthenticated(
  c: Context<HonoEnv>
): c is Context<HonoEnv> & { var: { user: UserData } } {
  return !!c.var.user;
}

app.get('/protected', async (c) => {
  if (!isAuthenticated(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // TypeScript knows user exists here
  return c.json({ userId: c.var.user.id });
});
```

## Integration with Other Packages

This package is commonly used with:

- **@codex/worker-utils**: Worker factory and middleware that set context variables
- **@codex/security**: Authentication middleware that populates session/user data
- **@codex/service-errors**: Error handling that produces `ErrorResponse` format
- **@codex/validation**: Request validation that integrates with response types

Example integration:

```typescript
import type { HonoEnv, SuccessResponse } from '@codex/shared-types';
import { createWorker } from '@codex/worker-utils';
import { requireAuth } from '@codex/security';
import { createAuthenticatedHandler } from '@codex/worker-utils';

const app = createWorker<HonoEnv>();

app.get('/api/users',
  requireAuth,
  createAuthenticatedHandler({
    schema: getUsersSchema,
    handler: async (ctx) => {
      // ctx is EnrichedAuthContext
      const users = await getUsers(ctx.user.id);
      return { data: users }; // Returns SuccessResponse
    }
  })
);
```

## Development

```bash
# Type checking
pnpm typecheck

# Run tests (in monorepo root)
pnpm test
```

## License

Private package - part of the Codex platform.
