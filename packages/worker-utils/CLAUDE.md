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

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
