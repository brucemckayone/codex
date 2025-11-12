# @codex/worker-utils

Shared utilities and factories for Cloudflare Workers using Hono.

## Purpose

Reduces boilerplate and ensures consistency across all API workers by providing:
- Worker factory with standard middleware
- Route handler factories
- Common middleware creators
- Error handling utilities

## Key Features

### 1. Worker Factory

Creates a fully configured Hono app with:
- Request logging
- CORS configuration
- Security headers
- Health check endpoint
- Authentication middleware
- Standard error handlers

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
});

// Just mount your routes!
app.route('/api/content', contentRoutes);
app.route('/api/media', mediaRoutes);

export default app;
```

### 2. Route Handler Factories

Eliminate boilerplate in route handlers:

**Before** (50 lines):
```typescript
app.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    const body = await c.req.json();
    const validationResult = createContentSchema.safeParse(body);

    if (!validationResult.success) {
      return c.json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validationResult.error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        },
      }, 400);
    }

    const service = createContentService({ db: dbHttp, environment: c.env.ENVIRONMENT });
    const content = await service.create(validationResult.data, user.id);

    return c.json({ data: content }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});
```

**After** (8 lines):
```typescript
import { createAuthenticatedHandler } from '@codex/worker-utils';

app.post('/', createAuthenticatedHandler({
  schema: createContentSchema,
  handler: async (input, ctx) => {
    const service = createContentService({ db: dbHttp, environment: ctx.env.ENVIRONMENT });
    return service.create(input, ctx.user.id);
  },
  successStatus: 201,
}));
```

### 3. Middleware Creators

Individual middleware factories if you need custom setup:

```typescript
import {
  createLoggerMiddleware,
  createCorsMiddleware,
  createSecurityHeadersMiddleware,
  createAuthMiddleware,
} from '@codex/worker-utils';

const app = new Hono();
app.use('*', createLoggerMiddleware());
app.use('*', createCorsMiddleware());
app.use('*', createSecurityHeadersMiddleware());
app.use('/api/*', createAuthMiddleware());
```

### 4. Error Handling

Consistent error handling across all endpoints:

```typescript
import { withErrorHandling, formatValidationError } from '@codex/worker-utils';

app.get('/:id', withErrorHandling(async (c) => {
  const id = c.req.param('id');
  const content = await service.get(id);
  return c.json({ data: content });
}));
```

## Benefits

- **Reduce boilerplate by 80%** in route handlers
- **Consistency** across all workers
- **Type safety** with TypeScript
- **Easy updates** - change once, applies everywhere
- **Better testing** - less code to test per endpoint

## Components

### Worker Factory
- `createWorker()` - Complete worker setup

### Middleware
- `createLoggerMiddleware()` - Request logging
- `createCorsMiddleware()` - CORS configuration
- `createSecurityHeadersMiddleware()` - Security headers
- `createAuthMiddleware()` - Session authentication
- `createHealthCheckHandler()` - Health check endpoint
- `createNotFoundHandler()` - 404 handler
- `createErrorHandler()` - Global error handler

### Route Helpers
- `createAuthenticatedHandler()` - Full POST/PUT/PATCH handler
- `createAuthenticatedGetHandler()` - Simple GET handler
- `withErrorHandling()` - Error wrapper
- `formatValidationError()` - Format Zod errors
- `requireUser()` - Get authenticated user

## Savings

Per worker:
- **~150 lines** of middleware boilerplate
- **~30-40 lines per endpoint** × N endpoints
- **Total: 400-800 lines per worker**
