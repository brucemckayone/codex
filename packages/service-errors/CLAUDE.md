# @codex/service-errors

Standard error classes, `BaseService` foundation, and HTTP response mapping for all Codex services.

## Error Classes

All extend abstract `ServiceError` with `statusCode`, `code`, `message`, and optional `context`.

| Class | Status | Code | When to Use |
|---|---|---|---|
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | Not authenticated or invalid session |
| `ForbiddenError` | 403 | `FORBIDDEN` | Authenticated but lacks permission |
| `ValidationError` | 400 | `VALIDATION_ERROR` | Input validation failed (prefer Zod schemas instead) |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource doesn't exist |
| `ConflictError` | 409 | `CONFLICT` | Duplicate (e.g., slug already taken) |
| `BusinessLogicError` | 422 | `BUSINESS_LOGIC_ERROR` | Violates business rules (e.g., buy unpublished content) |
| `InternalServiceError` | 500 | `INTERNAL_ERROR` | Unexpected errors — never expose internal details |

```ts
// Correct usage — include correlation IDs, no PII
throw new NotFoundError('Content not found', { contentId: id });
throw new ForbiddenError('Access denied', { userId, contentId });
throw new ConflictError('Slug already exists', { slug });
throw new BusinessLogicError('Cannot purchase unpublished content', { contentId });
```

## BaseService

Abstract class — all domain services MUST extend it.

```ts
import { BaseService, type ServiceConfig } from '@codex/service-errors';

export class ContentService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config); // provides this.db, this.environment, this.obs
  }

  async getContent(id: string, creatorId: string) {
    const item = await this.db.query.content.findFirst({
      where: and(eq(schema.content.id, id), scopedNotDeleted(schema.content, creatorId))
    });
    if (!item) throw new NotFoundError('Content not found', { contentId: id });
    return item;
  }
}

// Instantiate via service registry (ctx.services.*), not directly in routes
const service = new ContentService({ db: createDbClient(env), environment: env.ENVIRONMENT });
```

**`ServiceConfig`**: `{ db: Database | DatabaseWs, environment: string }`

**Protected properties**: `this.db`, `this.environment`, `this.obs` (auto-created `ObservabilityClient` scoped to class name)

**`protected handleError(error, context?: string): never`** — re-throws `ServiceError` unchanged, wraps unknown errors as `InternalServiceError`. Takes optional string context (not an object).

```ts
try {
  await externalApi.call();
} catch (err) {
  this.handleError(err, 'external-api-call'); // wraps as InternalServiceError
}
```

## Error Mapping

**`mapErrorToResponse(error, options?)`** — converts any error to a standardized HTTP response.

- `ServiceError` → uses its `statusCode` and `code`
- `ZodError` → 422 with field-level details
- Unknown → 500 with generic message (never exposes internals)

Options: `{ includeStack?: boolean, logError?: boolean, obs?: ObservabilityClient }`

Returns: `{ statusCode: number, response: { error: { code, message, details? } } }`

In practice, `procedure()` from `@codex/worker-utils` calls this automatically — you don't call it manually in route handlers unless you bypass `procedure()`.

## Helper Functions

| Export | Purpose |
|---|---|
| `wrapError(error, context?)` | Wraps unknown errors as `InternalServiceError`; detects DB unique constraint → `ConflictError` |
| `isServiceError(error)` | Type guard: `error instanceof ServiceError` |
| `isKnownError(error)` | Type guard: `ServiceError` or `ZodError` |

## Error Response Wire Format

```json
{ "error": { "code": "NOT_FOUND", "message": "Content not found", "details": { "contentId": "uuid" } } }
```

## Strict Rules

- **MUST** extend `BaseService` for all service classes
- **MUST** throw typed `ServiceError` subclasses — NEVER `throw new Error(...)` or `throw 'string'`
- **MUST** use `handleError()` when catching unknown/external errors (wraps safely)
- **MUST** include correlation IDs in context (`contentId`, `userId`, `organizationId`) — NEVER PII
- **NEVER** catch and swallow errors in services — let them propagate to `procedure()`
- **NEVER** catch inside `db.transaction()` unless you want partial commit

## Reference Files

- `packages/service-errors/src/base-errors.ts` — `ServiceError` and all subclasses, `wrapError`, `isServiceError`
- `packages/service-errors/src/base-service.ts` — `BaseService`, `ServiceConfig`
- `packages/service-errors/src/error-mapper.ts` — `mapErrorToResponse`, `isKnownError`
