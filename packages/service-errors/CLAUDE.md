# @codex/service-errors

Standard error handling & BaseService.

## Classes
- **ServiceError**: Abstract base.
- **NotFoundError** (404)
- **ValidationError** (400)
- **UnauthorizedError** (401)
- **ForbiddenError** (403)
- **ConflictError** (409)
- **BusinessLogicError** (422)
- **InternalServiceError** (500)

## API
- **BaseService**: Abstract class with `db` and `handleError()`.
- **mapErrorToResponse(err)**: Converts to `{ statusCode, response }`.
- **wrapError(err)**: Safely wraps unknown errors. Detects DB constraints.

## Usage
```ts
// Service
if (!found) throw new NotFoundError('Item not found');

// Worker
const { statusCode, response } = mapErrorToResponse(err);
return c.json(response, statusCode);
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
