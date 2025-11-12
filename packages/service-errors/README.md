# @codex/service-errors

Shared error classes and error handling utilities for Codex service layers.

## Purpose

Provides consistent error handling across all services with:
- Type-safe error classes
- HTTP status code mapping
- Context-rich error information
- Generic error mapper for HTTP responses

## Error Classes

### Base Classes

- `ServiceError` - Abstract base class for all service errors
- `NotFoundError` (404) - Resource not found
- `ValidationError` (400) - Input validation failed
- `ForbiddenError` (403) - Authorization failed
- `ConflictError` (409) - Resource conflict (e.g., duplicate)
- `BusinessLogicError` (422) - Business rule violation
- `InternalServiceError` (500) - Unexpected error

### Utilities

- `isServiceError()` - Type guard for ServiceError
- `wrapError()` - Safely wrap unknown errors
- `mapErrorToResponse()` - Convert errors to HTTP responses
- `isKnownError()` - Check if error is known (ServiceError or ZodError)

## Usage

### Creating Domain-Specific Errors

```typescript
import { NotFoundError, BusinessLogicError } from '@codex/service-errors';

// Extend base classes for domain-specific errors
export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaItemId: string) {
    super('Media item not ready for publishing', { mediaItemId });
  }
}
```

### Using in Services

```typescript
import { wrapError, ConflictError } from '@codex/service-errors';
import { isUniqueViolation } from '@codex/database';

class ContentService {
  async create(input: CreateInput): Promise<Content> {
    try {
      const [content] = await this.db.insert(content).values(input).returning();
      return content;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Content with this slug already exists', { slug: input.slug });
      }
      throw wrapError(error, { operation: 'content.create' });
    }
  }
}
```

### Using in API Handlers

```typescript
import { mapErrorToResponse } from '@codex/service-errors';

app.post('/api/content', async (c) => {
  try {
    const content = await contentService.create(input);
    return c.json({ data: content }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});
```

## Benefits

- **Consistency** - Same error structure across all services
- **Type Safety** - TypeScript knows exact error types
- **HTTP Mapping** - Automatic status code assignment
- **Context** - Rich error context for debugging
- **Security** - Never exposes internal details
- **DRY** - Write error handling once, use everywhere
