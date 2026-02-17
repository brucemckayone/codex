# @codex/worker-utils

Hono worker factory & middleware.

## API
- **createWorker(config)**: Setup Hono with middleware stack (Tracking -> Log -> CORS -> Security -> Auth).
- **procedure(config)**: tRPC-style handler.
  - Policy: `auth: 'required'|'none'|'worker'`, `roles`.
  - Input: Zod schemas (`body`, `query`, `params`).
  - Handler: Typed context (`ctx.user`, `ctx.input`).
- **Middleware**: `createAuthMiddleware`, `createCorsMiddleware`, `createRequestTrackingMiddleware`.
- **Health**: `createHealthCheckHandler` (DB/KV/R2 checks).

## Usage
```ts
const app = createWorker({ serviceName: 'my-api' });
app.post('/', procedure({
  policy: { auth: 'required' },
  input: { body: schema },
  handler: async ({ user, input }) => { ... }
}));
```

## Common Patterns

### Creating Routes

All worker endpoints use `procedure()` to unify policy enforcement, validation, error handling, and response envelopes.

**Pattern 1: Public Endpoint** (No Auth)
```ts
app.get('/api/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => {
      return await ctx.services.content.getFeatured();
    },
  })
);
```

**Pattern 2: Authenticated Endpoint** (Requires Session)
```ts
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx) => {
      return await ctx.services.content.getById(
        ctx.input.params.id,
        ctx.user.id
      );
    },
  })
);
```

**Pattern 3: Create with Validation** (201 Created)
```ts
app.post('/api/content',
  procedure({
    policy: { auth: 'required' },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.content.create(
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);
```

**Pattern 4: Delete with No Content** (204 Response)
```ts
app.delete('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.content.delete(
        ctx.input.params.id,
        ctx.user.id
      );
      return null;
    },
  })
);
```

### Endpoint Types & Status Codes

| Method | Use Case | Success Status | Example |
|---|---|---|---|
| GET | Fetch data | 200 | Get content by ID |
| POST | Create resource | 201 | Create content |
| PATCH | Update resource | 200 | Update content |
| DELETE | Remove resource | 204 | Delete content |
| POST (action) | Execute action | 200 | Publish content |

**Note**: Always use `successStatus: 201` for POST creation, `successStatus: 204` for DELETE.

### Reference Implementations

**Content-API** (`/workers/content-api/src/routes/content.ts`):
- Full CRUD with scoping
- Publish/unpublish workflows
- Pagination & filtering

**Auth Worker** (`/workers/auth/src/index.ts`):
- BetterAuth integration
- Session caching

**Identity-API** (`/workers/identity-api/src/routes/organizations.ts`):
- Org CRUD
- Slug uniqueness checks

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
