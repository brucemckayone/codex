# @codex/service-errors

Centralized error handling system for Codex service layers, providing type-safe error classes with HTTP status code mapping and consistent error responses across all services.

## Overview

The `@codex/service-errors` package provides a comprehensive error handling framework designed for service-oriented architectures. It ensures consistent error handling patterns, automatic HTTP status code mapping, and secure error responses that never expose internal implementation details.

### Key Features

- **Type-Safe Error Classes**: Strongly-typed error hierarchies with full TypeScript support
- **HTTP Status Mapping**: Automatic mapping of service errors to appropriate HTTP status codes
- **Context-Rich Errors**: Attach contextual metadata to errors for better debugging
- **Generic Error Mapper**: Convert any error to standardized HTTP responses
- **Security-First**: Never exposes internal stack traces or sensitive details in production
- **Zod Integration**: Built-in support for Zod validation error formatting
- **Domain-Specific Extensions**: Easy to extend for domain-specific error types

## Installation

```bash
pnpm add @codex/service-errors
```

## Core Concepts

### Error Hierarchy

All service errors extend the base `ServiceError` class, which provides:
- **code**: String error code (e.g., "NOT_FOUND", "VALIDATION_ERROR")
- **statusCode**: HTTP status code (400, 401, 403, 404, 409, 422, 500)
- **message**: Human-readable error message
- **context**: Optional metadata object for debugging

### Supported Error Types

| Error Class | Status Code | Use Case |
|-------------|-------------|----------|
| `NotFoundError` | 404 | Resource doesn't exist |
| `ValidationError` | 400 | Input validation failed |
| `ForbiddenError` | 403 | User lacks permissions |
| `ConflictError` | 409 | Resource conflict (e.g., duplicate) |
| `BusinessLogicError` | 422 | Business rule violation |
| `InternalServiceError` | 500 | Unexpected errors |

## API Reference

### Base Error Classes

#### `ServiceError`

Abstract base class for all service errors.

```typescript
abstract class ServiceError extends Error {
  public readonly code: string;
  public readonly statusCode: ErrorStatusCode;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: ErrorStatusCode,
    context?: Record<string, unknown>
  );
}
```

**Example: Creating Custom Error Classes**

```typescript
import { ServiceError } from '@codex/service-errors';

class CustomError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CUSTOM_ERROR', 400, context);
  }
}
```

#### `NotFoundError`

Thrown when a requested resource doesn't exist.

```typescript
class NotFoundError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { NotFoundError } from '@codex/service-errors';

throw new NotFoundError('User not found', { userId: '123' });
// {
//   code: 'NOT_FOUND',
//   statusCode: 404,
//   message: 'User not found',
//   context: { userId: '123' }
// }
```

#### `ValidationError`

Thrown when input validation fails.

```typescript
class ValidationError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { ValidationError } from '@codex/service-errors';

throw new ValidationError('Invalid email format', {
  field: 'email',
  value: 'invalid'
});
```

#### `ForbiddenError`

Thrown when user lacks permission to perform an action.

```typescript
class ForbiddenError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { ForbiddenError } from '@codex/service-errors';

throw new ForbiddenError('Cannot modify another user\'s content', {
  userId: currentUserId,
  contentOwnerId: ownerId
});
```

#### `ConflictError`

Thrown when operation conflicts with existing state.

```typescript
class ConflictError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { ConflictError } from '@codex/service-errors';

throw new ConflictError('Content with this slug already exists', {
  slug: 'my-article'
});
```

#### `BusinessLogicError`

Thrown when operation violates business rules.

```typescript
class BusinessLogicError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { BusinessLogicError } from '@codex/service-errors';

throw new BusinessLogicError('Cannot publish draft without content', {
  contentId: '123',
  status: 'draft'
});
```

#### `InternalServiceError`

Thrown for unexpected errors. Should be logged and wrapped to prevent detail exposure.

```typescript
class InternalServiceError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>);
}
```

**Example:**

```typescript
import { InternalServiceError } from '@codex/service-errors';

throw new InternalServiceError('Database connection failed', {
  operation: 'content.create'
});
```

### Utility Functions

#### `isServiceError()`

Type guard to check if an error is a ServiceError.

```typescript
function isServiceError(error: unknown): error is ServiceError;
```

**Example:**

```typescript
import { isServiceError } from '@codex/service-errors';

try {
  await riskyOperation();
} catch (error) {
  if (isServiceError(error)) {
    console.log('Service error:', error.code, error.statusCode);
  } else {
    console.log('Unknown error:', error);
  }
}
```

#### `wrapError()`

Safely wraps unknown errors to prevent internal detail exposure.

```typescript
function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ServiceError;
```

**Behavior:**
- Returns the error unchanged if it's already a `ServiceError`
- Converts database unique constraint violations to `ConflictError`
- Wraps all other errors as `InternalServiceError` with generic message

**Example:**

```typescript
import { wrapError } from '@codex/service-errors';

try {
  await database.query('INSERT INTO ...');
} catch (error) {
  // Safely wrap unknown errors
  throw wrapError(error, { operation: 'database.insert' });
}
```

#### `mapErrorToResponse()`

Converts any error to a standardized HTTP error response.

```typescript
function mapErrorToResponse(
  error: unknown,
  options?: ErrorMapperOptions
): MappedError;

interface ErrorMapperOptions {
  includeStack?: boolean;  // Include stack trace (dev only)
  logError?: boolean;      // Log internal errors to console
}

interface MappedError {
  statusCode: ErrorStatusCode;
  response: ErrorResponse;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

**Handles:**
- `ServiceError` instances (with custom status codes)
- `ZodError` instances (validation errors)
- Unknown errors (wrapped as 500 internal errors)

**Example:**

```typescript
import { mapErrorToResponse } from '@codex/service-errors';

app.post('/api/content', async (c) => {
  try {
    const content = await contentService.create(input);
    return c.json({ data: content }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
    // Response format:
    // {
    //   error: {
    //     code: 'NOT_FOUND',
    //     message: 'Content not found',
    //     details: { contentId: '123' }
    //   }
    // }
  }
});
```

**With Options:**

```typescript
const { statusCode, response } = mapErrorToResponse(error, {
  includeStack: process.env.NODE_ENV === 'development',
  logError: true
});
```

#### `isKnownError()`

Type guard to check if error is a known application error (ServiceError or ZodError).

```typescript
function isKnownError(error: unknown): boolean;
```

**Example:**

```typescript
import { isKnownError } from '@codex/service-errors';

try {
  await operation();
} catch (error) {
  if (isKnownError(error)) {
    // Expected application error
    console.log('Known error:', error);
  } else {
    // Unexpected error - alert monitoring
    Sentry.captureException(error);
  }
}
```

## Usage Patterns

### 1. Creating Domain-Specific Errors

Extend base error classes for domain-specific error types:

```typescript
import {
  NotFoundError,
  BusinessLogicError,
  ConflictError,
  ForbiddenError
} from '@codex/service-errors';

// Content domain errors
export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

export class MediaNotFoundError extends NotFoundError {
  constructor(mediaItemId: string) {
    super('Media item not found', { mediaItemId });
  }
}

export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaItemId: string) {
    super('Media item not ready for publishing', { mediaItemId });
  }
}

export class SlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Content with this slug already exists', { slug });
  }
}

export class MediaOwnershipError extends ForbiddenError {
  constructor(mediaItemId: string, userId: string) {
    super('User does not own this media item', { mediaItemId, userId });
  }
}
```

### 2. Using in Service Layer

Service methods should throw appropriate errors:

```typescript
import { wrapError, ConflictError, NotFoundError } from '@codex/service-errors';

class ContentService {
  async create(input: CreateInput, userId: string): Promise<Content> {
    try {
      const [content] = await this.db
        .insert(contentTable)
        .values({ ...input, userId })
        .returning();

      return content;
    } catch (error) {
      // Check for unique constraint violation
      if (error instanceof Error && error.message.includes('unique constraint')) {
        throw new ConflictError('Content with this slug already exists', {
          slug: input.slug
        });
      }
      // Wrap unknown errors to prevent detail exposure
      throw wrapError(error, { operation: 'content.create' });
    }
  }

  async get(contentId: string, userId: string): Promise<Content> {
    const content = await this.db.query.content.findFirst({
      where: eq(contentTable.id, contentId)
    });

    if (!content) {
      throw new NotFoundError('Content not found', { contentId });
    }

    if (content.userId !== userId) {
      throw new ForbiddenError('Cannot access another user\'s content', {
        contentId,
        userId,
        ownerId: content.userId
      });
    }

    return content;
  }

  async publish(contentId: string, userId: string): Promise<Content> {
    const content = await this.get(contentId, userId);

    if (content.status === 'published') {
      throw new BusinessLogicError('Content is already published', { contentId });
    }

    if (!content.mediaItemId) {
      throw new BusinessLogicError('Cannot publish content without media', { contentId });
    }

    const [updated] = await this.db
      .update(contentTable)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(contentTable.id, contentId))
      .returning();

    return updated;
  }
}
```

### 3. Using in API Handlers (Manual Error Handling)

```typescript
import { mapErrorToResponse } from '@codex/service-errors';
import { Hono } from 'hono';

const app = new Hono();

app.post('/api/content', async (c) => {
  try {
    const input = await c.req.json();
    const userId = c.get('user').id;

    const content = await contentService.create(input, userId);

    return c.json({ data: content }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

app.get('/api/content/:id', async (c) => {
  try {
    const contentId = c.req.param('id');
    const userId = c.get('user').id;

    const content = await contentService.get(contentId, userId);

    return c.json({ data: content });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});
```

### 4. Using with Route Helpers (Automatic Error Handling)

The `@codex/worker-utils` package provides route helpers with automatic error handling:

```typescript
import { createAuthenticatedHandler } from '@codex/worker-utils';
import { z } from 'zod';

// Errors are automatically caught and mapped to responses
app.post('/', createAuthenticatedHandler({
  schema: {
    body: z.object({
      title: z.string(),
      content: z.string(),
      slug: z.string()
    })
  },
  handler: async (_c, ctx) => {
    // Thrown errors are automatically mapped to HTTP responses
    return contentService.create(ctx.validated.body, ctx.user.id);
  },
  successStatus: 201
}));

app.get('/:id', createAuthenticatedHandler({
  schema: {
    params: z.object({ id: z.string().uuid() })
  },
  handler: async (_c, ctx) => {
    // NotFoundError automatically returns 404
    // ForbiddenError automatically returns 403
    return contentService.get(ctx.validated.params.id, ctx.user.id);
  }
}));
```

### 5. Error Response Format

All errors are mapped to a consistent response format:

```typescript
{
  "error": {
    "code": "NOT_FOUND",              // Error code
    "message": "Content not found",   // User-friendly message
    "details": {                      // Optional context
      "contentId": "123"
    }
  }
}
```

**ServiceError Example:**

```typescript
throw new NotFoundError('User not found', { userId: '456' });

// Response (404):
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "456" }
  }
}
```

**ZodError Example:**

```typescript
// When Zod validation fails
const schema = z.object({ email: z.string().email() });
schema.parse({ email: 'invalid' });

// Response (422):
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "email",
        "message": "Invalid email"
      }
    ]
  }
}
```

**Unknown Error Example:**

```typescript
throw new Error('Database connection failed');

// Response (500):
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
    // No details exposed for security
  }
}
```

## Best Practices

### 1. Always Use Domain-Specific Errors

Create specific error classes for your domain:

```typescript
// Good
throw new ContentNotFoundError(contentId);

// Avoid
throw new NotFoundError('Content not found', { contentId });
```

### 2. Wrap Unknown Errors

Never let unknown errors escape your service layer:

```typescript
try {
  await externalAPI.call();
} catch (error) {
  // Always wrap unknown errors
  throw wrapError(error, { operation: 'external-api' });
}
```

### 3. Include Meaningful Context

Add context that helps with debugging but doesn't expose secrets:

```typescript
// Good
throw new ForbiddenError('Cannot access resource', {
  userId,
  resourceId,
  requiredRole: 'admin'
});

// Bad - exposes sensitive data
throw new ForbiddenError('Access denied', {
  userPassword: 'secret123',  // Never include secrets
  apiKey: 'key-xyz'
});
```

### 4. Use Appropriate Error Types

Choose the correct error type for the situation:

- **404 NotFoundError**: Resource doesn't exist
- **400 ValidationError**: Input format is invalid
- **403 ForbiddenError**: User lacks permission
- **409 ConflictError**: Duplicate resource or state conflict
- **422 BusinessLogicError**: Valid input but violates business rules
- **500 InternalServiceError**: Unexpected errors

### 5. Log Internal Errors

Always log unexpected errors for monitoring:

```typescript
try {
  await criticalOperation();
} catch (error) {
  console.error('Critical operation failed:', error);
  throw wrapError(error, { operation: 'critical-op' });
}
```

## Integration with Other Packages

### @codex/worker-utils

Automatic error handling in route handlers:

```typescript
import { createAuthenticatedHandler } from '@codex/worker-utils';

// Errors are automatically caught and mapped
app.post('/', createAuthenticatedHandler({
  schema: { body: createSchema },
  handler: async (_c, ctx) => {
    return service.create(ctx.validated.body, ctx.user.id);
  }
}));
```

### @codex/validation (Zod)

ZodError is automatically formatted by `mapErrorToResponse`:

```typescript
import { z } from 'zod';
import { mapErrorToResponse } from '@codex/service-errors';

const schema = z.object({ email: z.string().email() });

try {
  schema.parse(input);
} catch (error) {
  const { statusCode, response } = mapErrorToResponse(error);
  // Automatically formats Zod errors with field paths
}
```

## Security Considerations

1. **Never Expose Internal Details**: The error mapper sanitizes all unknown errors
2. **Stack Traces**: Only include stack traces in development mode
3. **Context Safety**: Be careful what you include in error context
4. **Generic Messages**: Unknown errors always return generic "An unexpected error occurred"

## TypeScript Support

Full TypeScript support with strict type checking:

```typescript
import type { ErrorStatusCode, ErrorResponse, MappedError } from '@codex/service-errors';

function handleError(error: unknown): MappedError {
  const mapped = mapErrorToResponse(error);
  // TypeScript knows the exact shape of the response
  const code: string = mapped.response.error.code;
  const status: ErrorStatusCode = mapped.statusCode;
  return mapped;
}
```

## License

Part of the Codex monorepo.
