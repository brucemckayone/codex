# Cloudflare Workers Configuration Reference

This document serves as the single source of truth for shared configuration values across all Cloudflare Workers in the monorepo.

## Standard Wrangler Configuration

When creating a new worker or modifying existing workers, use these standard values.

### Compatibility Settings (ALL WORKERS)

```toml
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
```

**Rationale:**
- `nodejs_compat` enables Node.js APIs in Cloudflare Workers
- Compatibility date should be updated annually or when adopting new Cloudflare features

### Observability (ALL WORKERS)

```toml
[observability]
enabled = true
```

**Rationale:** All workers should have observability enabled for monitoring and debugging.

## KV Namespaces

| Namespace | Binding | ID | Used By | Purpose |
|-----------|---------|-----|---------|---------|
| Rate Limiting | `RATE_LIMIT_KV` | `cea7153364974737b16870df08f31083` | All workers | Rate limiting for API endpoints |
| Auth Sessions | `AUTH_SESSION_KV` | `82d04a4236df4aac8e9d87793344f0ed` | auth only | Session storage for Better Auth |

### Adding to wrangler.jsonc

```toml
# Rate limiting (all workers)
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "cea7153364974737b16870df08f31083"

# Auth sessions (auth worker only)
[[kv_namespaces]]
binding = "AUTH_SESSION_KV"
id = "82d04a4236df4aac8e9d87793344f0ed"
```

## Environment Variables (Standard)

These environment variables are consistent across all workers (unless noted otherwise).

### Production Environment

```toml
[env.production.vars]
ENVIRONMENT = "production"
DB_METHOD = "PRODUCTION"
WEB_APP_URL = "https://codex.revelations.studio"
API_URL = "https://api.revelations.studio"
```

### Staging Environment

```toml
[env.staging.vars]
ENVIRONMENT = "staging"
DB_METHOD = "PRODUCTION"
WEB_APP_URL = "https://codex-staging.revelations.studio"
API_URL = "https://api-staging.revelations.studio"
```

### Worker-Specific Variables

Some workers require additional environment variables:

**ecom-api:**
```toml
[env.production.vars]
AUTH_WORKER_URL = "https://auth.revelations.studio"

[env.staging.vars]
AUTH_WORKER_URL = "https://auth-staging.revelations.studio"
```

## Secrets Management

Secrets are **never** stored in wrangler.jsonc. They must be set via CLI or CI/CD.

### Common Secrets

| Secret | Required By | Description |
|--------|-------------|-------------|
| `DATABASE_URL` | All workers | PostgreSQL connection string (Neon) |
| `SESSION_SECRET` | auth | Session encryption key |
| `BETTER_AUTH_SECRET` | auth | Better Auth encryption key |
| `STRIPE_SECRET_KEY` | ecom-api | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | ecom-api | Stripe webhook signing secret |

### Setting Secrets

```bash
# Production
wrangler secret put DATABASE_URL --env production
wrangler secret put SESSION_SECRET --env production

# Staging
wrangler secret put DATABASE_URL --env staging
wrangler secret put SESSION_SECRET --env staging
```

**Important:** Secrets set via CLI are bound to specific environments and worker names.

## Build Configuration

### Standard Build System: Vite

All workers use Vite for building, which provides:
- Fast builds via esbuild
- Better tree-shaking
- Consistent output paths
- TypeScript support out of the box

### Output Path Convention

```toml
main = "dist/index.js"
```

**All workers** use this standard output path.

### Vite Configuration

Workers use shared Vite configuration from `config/vite/worker.config.ts`:

```typescript
// workers/my-worker/vite.config.ts
import { createWorkerConfig } from '../../config/vite/worker.config';

export default createWorkerConfig({
  workerName: 'my-worker',
  // additionalExternals: ['my-package'], // if needed
});
```

### Test Configuration

Workers use shared Vitest configuration from `config/vitest/worker.config.ts`:

```typescript
// workers/my-worker/vitest.config.ts
import { workerVitestConfig } from '../../config/vitest/worker.config';
export default workerVitestConfig;
```

## Routes and Domains

Each worker has its own custom domain patterns:

| Worker | Production Domain | Staging Domain |
|--------|------------------|----------------|
| auth | `auth.revelations.studio` | `auth-staging.revelations.studio/*` |
| content-api | `content-api.revelations.studio/*` | `content-api-staging.revelations.studio/*` |
| identity-api | `identity-api.revelations.studio/*` | `identity-api-staging.revelations.studio/*` |
| ecom-api | `api.revelations.studio` | `api-staging.revelations.studio/*` |

### Route Configuration Pattern

```toml
# Production routes
[[env.production.routes]]
pattern = "my-worker.revelations.studio/*"
custom_domain = true

# Staging routes
[[env.staging.routes]]
pattern = "my-worker-staging.revelations.studio/*"
custom_domain = true
```

## TypeScript Configuration

Workers use shared TypeScript configuration:

```json
{
  "extends": "../../config/typescript/worker.tsconfig.json"
}
```

Standard settings include:
- `moduleResolution: "bundler"` (for Vite)
- `types: ["@cloudflare/workers-types"]`
- `lib: ["ESNext", "WebWorker"]`

## Creating a New Worker

When creating a new Cloudflare Worker:

1. **Copy an existing worker** (e.g., `content-api`) as a starting point
2. **Update worker-specific values:**
   - Name in `package.json` and `wrangler.jsonc`
   - Routes in `wrangler.jsonc`
   - Service name in worker setup code
3. **Keep standard values** from this document
4. **Add KV namespaces** only if needed (RATE_LIMIT_KV is standard)
5. **Document any new secrets** in this file
6. **Use shared configs** for Vite, Vitest, and TypeScript

## Maintenance Notes

### Updating Compatibility Date

The `compatibility_date` should be reviewed annually. When updating:

1. Test all workers in staging first
2. Review [Cloudflare compatibility dates changelog](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
3. Update all workers simultaneously
4. Update this document

### Adding New Environment Variables

When adding new environment variables:

1. Determine if it's worker-specific or shared
2. Update this document
3. Update all affected `wrangler.jsonc` files
4. Update CI/CD if needed

### KV Namespace IDs

KV namespace IDs are permanent. Do not change them unless:
- Creating a new namespace for a new purpose
- Explicitly migrating data to a new namespace

**Never** reuse namespace IDs for different purposes.

## References

- [Wrangler Configuration Docs](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- [KV Namespace Documentation](https://developers.cloudflare.com/kv/)
