# @codex/service-errors

Standard error handling, BaseService foundation, and HTTP response mapping.

## Error Classes
All extend `ServiceError` with `statusCode`, `code`, `message`, and optional `context`.

**Authentication & Authorization**
- `UnauthorizedError` (401): Not authenticated or invalid session.
- `ForbiddenError` (403): Lacks permission for action.

**Client Errors**
- `ValidationError` (400): Input validation failed.
- `NotFoundError` (404): Resource doesn't exist.
- `ConflictError` (409): Operation conflicts with existing state (e.g., duplicate slug).
- `BusinessLogicError` (422): Violates business rules (e.g., purchase before content published).

**Server Errors**
- `InternalServiceError` (500): Unexpected errors (wrapped, never exposes internal details).

## BaseService
Abstract class providing foundation for all domain services.

**Properties**
- `protected db`: Database client (HTTP or WebSocket).
- `protected environment`: Runtime environment string.
- `protected obs`: Scoped `ObservabilityClient` (auto-created with service name).

**Constructor**
```ts
constructor(config: ServiceConfig) // config: { db, environment }
```

**Methods**
- `protected handleError(error, context?)`: Wraps unknown errors, re-throws ServiceError unchanged.

**Usage**
```ts
export class ContentService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config); // Initializes db, environment, obs
  }

  async getContent(id: string) {
    const content = await this.db.query.content.findFirst({
      where: eq(schema.content.id, id)
    });
    if (!content) {
      throw new NotFoundError('Content not found', { contentId: id });
    }
    return content;
  }
}
```

## Error Mapping
### `mapErrorToResponse(error, options?)`
Converts any error to standardized HTTP response.

**Handles**
- `ServiceError`: Uses `statusCode` and `code` from error.
- `ZodError`: Maps to 422 with field-level validation details.
- Unknown errors: Logs (if enabled), returns 500 with generic message.

**Options**
- `includeStack?: boolean`: Include stack trace in dev (default: false).
- `logError?: boolean`: Log unknown errors (default: true).
- `obs?: ObservabilityClient`: Use for structured logging instead of console.

**Returns**
```ts
{
  statusCode: ErrorStatusCode,
  response: {
    error: {
      code: string,
      message: string,
      details?: unknown
    }
  }
}
```

**Worker Usage**
```ts
app.post('/content', async (c) => {
  try {
    const result = await contentService.createContent(input);
    return c.json(result);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err, { obs });
    return c.json(response, statusCode);
  }
});
```

## Helper Functions
- `wrapError(error, context?)`: Wraps unknown errors as `InternalServiceError`. Detects DB unique constraint violations (returns `ConflictError`).
- `isServiceError(error)`: Type guard for ServiceError instances.
- `isKnownError(error)`: Type guard for ServiceError or ZodError.

## Error Response Format
All errors return consistent JSON structure:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found",
    "details": { "contentId": "123" }
  }
}
```

## Patterns
**Service Layer**: Throw typed errors with context.
```ts
if (!hasAccess) {
  throw new ForbiddenError('Access denied', { userId, contentId });
}
```

**Worker Layer**: Map to HTTP responses.
```ts
catch (err) {
  const { statusCode, response } = mapErrorToResponse(err, { obs });
  return c.json(response, statusCode);
}
```

**Transactions**: Errors automatically rollback.
```ts
return this.db.transaction(async (tx) => {
  const item = await tx.insert(...).returning();
  if (conflict) throw new ConflictError('Duplicate');
  return item;
}); // Auto-rollback on error
```

## Error Handling Patterns

### In Services (Business Logic)
**Always throw typed errors** for expected failure cases:
```ts
// NOT FOUND: Resource doesn't exist
if (!content) throw new NotFoundError('Content not found', { contentId });

// FORBIDDEN: User lacks permission
if (content.creatorId !== userId) {
  throw new ForbiddenError('Access denied', { userId, contentId });
}

// CONFLICT: Duplicate resource
if (existingSlug) throw new ConflictError('Slug already exists', { slug });

// BUSINESS LOGIC: Rule violation
if (content.status !== 'published') {
  throw new BusinessLogicError('Cannot purchase unpublished content', { contentId });
}

// VALIDATION: Invalid input (prefer Zod schema validation instead)
if (!input.title?.trim()) {
  throw new ValidationError('Title required', { field: 'title' });
}
```

**Never catch and swallow errors** in services. Let them propagate to worker layer.

**Use `handleError()` for unknown errors** (database exceptions, third-party API failures):
```ts
try {
  await externalAPI.call();
} catch (err) {
  this.handleError(err, 'external-api-call'); // Wraps as InternalServiceError
}
```

### In Workers (HTTP Layer)
**Let `procedure()` handle errors automatically**. If using `procedure()` from `@codex/worker-utils`, errors are auto-mapped:
```ts
app.post('/content', procedure({
  handler: async ({ c, input, obs }) => {
    // Service throws NotFoundError, ForbiddenError, etc.
    return await contentService.createContent(input);
    // procedure() automatically calls mapErrorToResponse
  }
}));
```

**Manual error handling** (for non-procedure routes):
```ts
app.post('/content', async (c) => {
  try {
    const result = await contentService.createContent(input);
    return c.json(result);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err, { obs });
    return c.json(response, statusCode);
  }
});
```

### Error Context Rules
**Always include correlation IDs**:
```ts
throw new NotFoundError('Content not found', {
  contentId,        // Resource ID
  userId,           // Actor ID
  organizationId    // Scope ID
});
```

**Never include sensitive data**:
```ts
// ❌ DON'T: Expose credentials or PII
throw new UnauthorizedError('Invalid password', { password, email });

// ✅ DO: Use generic context
throw new UnauthorizedError('Invalid credentials', { userId });
```

**Keep messages user-facing**:
```ts
// ❌ DON'T: Internal implementation details
throw new InternalServiceError('Failed to connect to db.neon.tech:5432');

// ✅ DO: Generic message (details in logs via obs.trackError)
throw new InternalServiceError('Database unavailable');
```

### Error Response Format (Client Receives)
All errors follow this structure:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found",
    "details": {
      "contentId": "uuid-123"
    }
  }
}
```

**Status codes map directly to error classes**:
- `400` → `ValidationError`
- `401` → `UnauthorizedError`
- `403` → `ForbiddenError`
- `404` → `NotFoundError`
- `409` → `ConflictError`
- `422` → `BusinessLogicError` (or ZodError)
- `500` → `InternalServiceError`

### Transaction Error Handling
Errors thrown inside `db.transaction()` automatically rollback:
```ts
return this.db.transaction(async (tx) => {
  const content = await tx.insert(schema.content).values(data).returning();

  // If this throws, INSERT is rolled back
  if (conflictCheck) throw new ConflictError('Duplicate');

  // Multi-step: both succeed or both rollback
  await tx.insert(schema.media).values(mediaData);

  return content;
});
```

**Never catch errors inside transactions** unless you want to commit partial work.
