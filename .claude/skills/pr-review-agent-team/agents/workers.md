# Worker Agent Specification

## Domain
Hono routes, procedure() handler, HTTP patterns, input validation, response formats.

## File Patterns to Review
- `workers/*/src/routes/**/*.ts`
- `workers/*/src/index.ts`
- `packages/worker-utils/src/procedure.ts`
- `workers/*/src/middleware/**/*.ts`

## Checklist

### Procedure Handler Usage

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] ALL routes use `procedure()` wrapper
- [CRITICAL] No business logic in routes (delegate to services via ctx.services)
- [WARN] No direct database access in routes
- [CRITICAL] Procedure config includes proper policies
- [INFO] Route handlers are thin (max 10-15 lines)

### HTTP Status Codes

- [CRITICAL] POST creates return `successStatus: 201`
- [CRITICAL] DELETE operations return `successStatus: 204` with `null`
- [WARN] Standard GET returns 200
- [CRITICAL] 404 for not found resources
- [CRITICAL] No 200 for POST creation (use 201)
- [INFO] 400 for validation errors, 401 for auth, 403 for forbidden

### Input Validation

- [CRITICAL] All inputs validated via Zod schemas
- [CRITICAL] Path params validated: `input: { params: z.object({ id: uuidSchema }) }`
- [CRITICAL] Body validated: `input: { body: createContentSchema }`
- [WARN] Query params for pagination/filters with schemas
- [CRITICAL] No validation logic in handler (use schemas)
- [INFO] Schema reuse from `@codex/validation`

### Response Patterns

- [WARN] Use proper response types from `@codex/shared-types`
- [WARN] Errors thrown as service errors (not manual responses)
- [CRITICAL] No generic `c.json()` for errors (use procedure error mapping)
- [INFO] Consistent response structure: `{ data, meta }`
- [INFO] Pagination metadata: `{ page, limit, total, hasMore }`

### Route Organization

- [WARN] Routes grouped by domain (content.ts, media.ts, etc.)
- [WARN] Proper HTTP method usage (GET, POST, PATCH, DELETE)
- [INFO] Consider pagination for list endpoints
- [INFO] Nested routes follow RESTful conventions

### Error Handling

- [CRITICAL] Service errors thrown, not caught and converted manually
- [WARN] Procedure maps errors to correct HTTP status
- [INFO] Error messages are user-friendly (no internals)

## Code Examples

### Correct: Procedure with Auth, Validation, and Service Delegation
```typescript
// workers/content-api/src/routes/content.ts
import { procedure } from '@codex/worker-utils';
import { createContentSchema, uuidSchema } from '@codex/validation';
import { NotFoundError } from '@codex/service-errors';

export const createContentRoute = procedure({
  policy: { auth: 'required' },
  rateLimit: 'api',
  successStatus: 201,
  input: {
    body: createContentSchema
  }
}).handler(async ({ ctx, input }) => {
  // Delegate to service - no business logic here
  const result = await ctx.services.content.create(
    ctx.session.userId,
    input.body
  );
  return { data: result };
});

export const getContentRoute = procedure({
  policy: { auth: 'required' },
  input: {
    params: z.object({ id: uuidSchema })
  }
}).handler(async ({ ctx, input }) => {
  const item = await ctx.services.content.getById(
    input.params.id,
    ctx.session.userId
  );
  return { data: item };
});
```

### Incorrect: Missing Auth and Validation
```typescript
// ❌ CRITICAL: No auth policy
export const createContentRoute = procedure({
  // Missing: policy: { auth: 'required' }
}).handler(async ({ ctx }) => {
  return ctx.services.content.create(ctx.session.userId, await ctx.req.json());
});

// ❌ CRITICAL: No input validation
export const getContentRoute = procedure({
}).handler(async ({ ctx }) => {
  const id = ctx.req.param('id'); // Not validated
  return ctx.services.content.getById(id, ctx.session.userId);
});
```

### Incorrect: Business Logic in Route
```typescript
// ❌ WARN: Business logic belongs in service
export const createContentRoute = procedure({
  policy: { auth: 'required' },
  input: { body: createContentSchema }
}).handler(async ({ ctx, input }) => {
  // This logic should be in the service
  const slug = slugify(input.body.title);
  const existing = await ctx.db.query.content.findFirst({
    where: eq(content.slug, slug)
  });
  if (existing) {
    throw new ConflictError('Slug exists');
  }
  // ... rest of logic
});
```

### Correct: DELETE with 204 Status
```typescript
export const deleteContentRoute = procedure({
  policy: { auth: 'required' },
  successStatus: 204,
  input: {
    params: z.object({ id: uuidSchema })
  }
}).handler(async ({ ctx, input }) => {
  await ctx.services.content.delete(input.params.id, ctx.session.userId);
  return null; // 204 No Content
});
```

### Incorrect: Wrong Status Code
```typescript
// ❌ CRITICAL: POST should return 201, not 200
export const createContentRoute = procedure({
  policy: { auth: 'required' },
  successStatus: 200, // Wrong! Should be 201
  input: { body: createContentSchema }
}).handler(async ({ ctx, input }) => {
  // ...
});

// ❌ CRITICAL: DELETE should return 204
export const deleteContentRoute = procedure({
  policy: { auth: 'required' },
  successStatus: 200, // Wrong! Should be 204
  input: { params: z.object({ id: uuidSchema }) }
}).handler(async ({ ctx, input }) => {
  // ...
});
```

### Correct: Route Registration Pattern
```typescript
// workers/content-api/src/index.ts
import { Hono } from 'hono';
import { contentRoutes } from './routes/content';
import { mediaRoutes } from './routes/media';

const app = new Hono<{ Bindings: Env }>();

app.route('/', contentRoutes);
app.route('/media', mediaRoutes);

export default app;
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Missing auth policies | `security-reviewer` |
| Missing input schemas | `security-reviewer` |
| Business logic in routes | `service-reviewer` |
| Database queries in routes | `database-reviewer` |
| Missing response types | `architecture-reviewer` |

## Critical File References

- `packages/worker-utils/src/procedure.ts` - Procedure handler implementation
- `workers/content-api/src/routes/content.ts` - Standard CRUD patterns
- `workers/ecom-api/src/routes/checkout.ts` - External API patterns
- `workers/auth/src/index.ts` - BetterAuth integration
- `packages/shared-types/src/response.ts` - Response type definitions
