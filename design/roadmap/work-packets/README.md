# Work Packets Directory

This directory contains detailed implementation work packets for the Codex platform.

## Active Work Packets

| ID | Name | Status | Priority | Dependencies |
|----|------|--------|----------|--------------|
| P1-CONTENT-001 | Content Management Service | ✅ Implemented | P0 | - |
| P1-ACCESS-001 | Content Access & Playback | 🚧 To Be Implemented | P0 | P1-CONTENT-001, P1-ECOM-001 |
| P1-ECOM-001 | Stripe Checkout | 🚧 To Be Implemented | P0 | - |
| P1-ECOM-002 | Stripe Webhooks | 🚧 To Be Implemented | P0 | P1-ECOM-001 |
| P1-ADMIN-001 | Admin Dashboard | 🚧 To Be Implemented | P0 | P1-CONTENT-001 |
| P1-SETTINGS-001 | Platform Settings | 🚧 To Be Implemented | P1 | - |
| P1-NOTIFY-001 | Email Service | 🚧 To Be Implemented | P1 | - |
| P1-TRANSCODE-001 | Media Transcoding | 🚧 To Be Implemented | P1 | P1-CONTENT-001 |

## Recent Changes

### November 2025: Route-Level Security Policies

**What Changed**: Migrated from global authentication middleware to route-level declarative security policies.

**Impact**: All new API endpoints should use `withPolicy()` and `POLICY_PRESETS` instead of relying on global auth.

**See**: [ARCHITECTURE-CHANGELOG.md](./ARCHITECTURE-CHANGELOG.md) for complete migration guide and examples.

## Implementation Standards

When implementing a work packet:

1. **Follow Current Patterns**: Check recently completed work packets (e.g., P1-CONTENT-001) for the latest architectural patterns
2. **Use Worker Utils**: Leverage `@codex/worker-utils` for standardized worker setup
3. **Route-Level Security**: Apply `withPolicy()` to each route (don't rely on global auth)
4. **Validation Separation**: Keep Zod schemas in `@codex/validation`, not in route files
5. **Service Layer**: Business logic in `@codex/content` or relevant package, not in routes
6. **Error Handling**: Use `createAuthenticatedHandler()` for automatic error formatting
7. **Testing**: Follow the three-tier testing strategy (validation, service, integration)

## Quick Reference

### Route Security Patterns

```typescript
import { withPolicy, POLICY_PRESETS } from '@codex/worker-utils';

// Read operations - any authenticated user
app.get('/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({ /* ... */ })
);

// Create/Update - creator or admin only
app.post('/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({ /* ... */ })
);

// Destructive operations - stricter rate limit
app.delete('/:id',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'auth', // 5 req/15min
  }),
  createAuthenticatedHandler({ /* ... */ })
);
```

### Worker Setup

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'your-api',
  version: '1.0.0',
  enableRequestTracking: true,
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Use route-level policies
});

app.route('/api/resource', resourceRoutes);

export default app;
```

## Documentation

- **Architecture Changes**: [ARCHITECTURE-CHANGELOG.md](./ARCHITECTURE-CHANGELOG.md)
- **Security Policies**: `packages/worker-utils/SECURITY_POLICY_USAGE.md`
- **Testing Standards**: `design/infrastructure/Testing.md`
- **Code Standards**: `STANDARDS.md`
- **Database Schema**: `design/features/shared/database-schema.md`

## Work Packet Template

Each work packet should include:

1. **Status & Metadata**: Current status, priority, effort estimate, branch name
2. **Current State**: What's implemented vs. what needs implementation
3. **Dependencies**: Required work packets and existing infrastructure
4. **Database Schema**: Complete table definitions with migrations
5. **Validation Schemas**: Zod schemas for all inputs
6. **Service Layer**: Business logic implementation
7. **API Endpoints**: Complete route handlers with security policies
8. **Testing Strategy**: Validation, service, and integration test specs
9. **Definition of Done**: Comprehensive checklist
10. **Documentation References**: Links to relevant design docs

## Need Help?

- Check [ARCHITECTURE-CHANGELOG.md](./ARCHITECTURE-CHANGELOG.md) for recent architectural changes
- Review P1-CONTENT-001 as the reference implementation for current patterns
- See `packages/worker-utils/SECURITY_POLICY_USAGE.md` for security policy examples
