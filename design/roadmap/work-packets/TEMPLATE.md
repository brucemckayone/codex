# [PACKET-ID]: [Feature Name]

**Priority**: P0/P1/P2
**Status**: 🚧 Not Started | 🏗️ In Progress | ✅ Complete
**Estimated Effort**: [X-Y days]

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

> **Goal**: Provide a high-level prose description of this feature. Focus on WHAT and WHY, not HOW.

[Write 2-4 paragraphs describing:]
- **What is this feature?** - Core functionality and purpose
- **Why does it exist?** - Business value and user needs it addresses
- **How does it fit into the overall system?** - Where it sits in the architecture
- **Who uses it and when?** - User personas and usage scenarios

**Example**:
> Content Access controls who can stream what content and tracks viewing progress. It enforces business rules (free vs purchased vs members-only), generates time-limited streaming URLs, and maintains playback state for resume functionality. This service bridges content ownership with content delivery, ensuring creators get paid and users get seamless viewing experiences.

---

## System Context

> **Goal**: Show where this feature fits in the larger system architecture.

### Upstream Dependencies
- **[Service/System Name]**: What data/functionality we consume from this system
- **[Another Service]**: How we integrate with this

### Downstream Consumers
- **[Service/System Name]**: What data/functionality we provide to this system
- **[Another Service]**: How they integrate with us

### External Services
- **[External Service]**: Purpose and integration points
- **[Database/Storage]**: Data persistence layer

### Integration Flow
```
[Optional: Simple diagram or text flow showing the data/request flow]
User Request → Auth Service → This Service → Database → R2 Storage → Response
```

---

## Database Schema

> **Goal**: Define the complete data model with architectural rationale. This section should be DETAILED.

### Tables

#### `[table_name]`
**Purpose**: [Why this table exists and what domain concept it represents]

```typescript
// Drizzle schema definition
export const tableName = pgTable('table_name', {
  id: text('id').primaryKey(),
  // ... all columns with types and constraints
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'), // Soft delete pattern
});
```

**Columns**:
- `id`: Primary key - [rationale for ID strategy]
- `column_name`: [Purpose and business meaning]
- `deletedAt`: Soft delete timestamp (NULL = active, NOT NULL = deleted)

**Constraints**:
- Primary Key: `id`
- Foreign Keys: [List with rationale]
- Unique Constraints: [List with rationale]
- Check Constraints: [List with rationale - these must be added manually to migrations]

**Indexes**:
- `idx_name`: [Columns indexed and query performance rationale]

### Relationships

```
[table_a] 1---N [table_b]
  └─ Foreign key: table_b.table_a_id → table_a.id
  └─ Business rule: [Why this relationship exists]
```

### Migration Considerations

- **Manual Steps Required**:
  - Add CHECK constraints to migration (Drizzle doesn't generate these automatically)
  - Create indexes for foreign keys and frequently queried columns

- **Data Migration**:
  - [Any data migration steps needed if updating existing tables]

---

## Service Architecture

> **Goal**: Describe service responsibilities and business logic at a HIGH LEVEL. Avoid detailed code.

### Service Responsibilities

**[ServiceName]** (extends `BaseService` from `@codex/service-errors`):
- **Primary Responsibility**: [What is the main job of this service?]
- **Key Operations**:
  - `operation1()`: [High-level description of what it does and why]
  - `operation2()`: [High-level description]

### Key Business Rules

1. **[Rule Category]**
   - [Specific rule and rationale]
   - [Another rule]

2. **[Another Category]**
   - [Rule description]

**Example**:
> **Access Control**:
> - Free content (price = 0) is accessible to all authenticated users
> - Paid content requires a purchase record with matching content_id and user_id
> - Members-only content requires organization membership verification

### Error Handling Approach

**Custom Error Classes** (extend base errors from `@codex/service-errors`):
- `[ErrorName]`: Thrown when [condition], maps to HTTP [status code]
- `[AnotherError]`: Thrown when [condition], maps to HTTP [status code]

**Error Recovery**:
- [How the service handles failures]
- [Retry strategies if applicable]

### Transaction Boundaries

> Where do we use `db.transaction()` and why?

- **[Operation Name]**: Requires transaction because [multiple tables/rollback needs]
- **[Another Operation]**: Single operation, no transaction needed

---

## API Integration

> **Goal**: Show endpoint structure and patterns WITHOUT detailed implementation code.

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| POST | `/api/resource` | Create new resource | `POLICY_PRESETS.authenticated()` |
| GET | `/api/resource/:id` | Retrieve resource | `POLICY_PRESETS.creator()` |
| PATCH | `/api/resource/:id` | Update resource | `POLICY_PRESETS.creator()` |
| DELETE | `/api/resource/:id` | Soft delete resource | `POLICY_PRESETS.creator()` |

### Standard Pattern

All endpoints follow this pattern from `@codex/worker-utils`:

```typescript
app.post('/api/resource',
  withPolicy(POLICY_PRESETS.authenticated()), // Route-level security
  createAuthenticatedHandler({
    inputSchema: resourceSchema, // From @codex/validation
    handler: async ({ input, context }) => {
      const service = new ResourceService(context);
      const result = await service.create(input);
      return { data: result }; // StandardResponse from @codex/shared-types
    }
  })
);
```

### Security Policies

- **`POLICY_PRESETS.authenticated()`**: Any authenticated user
- **`POLICY_PRESETS.creator()`**: User must be the creator/owner
- **`POLICY_PRESETS.platformOwner()`**: Admin-only access
- **Custom policies**: [If you need custom authorization logic]

### Response Format

All endpoints return standardized responses from `@codex/shared-types`:

```typescript
// Success (single item)
{ data: T }

// Success (paginated list)
{
  data: T[],
  pagination: { page, pageSize, totalCount, totalPages }
}

// Error (mapped via mapErrorToResponse)
{
  error: {
    message: string,
    code: string,
    details?: Record<string, any>
  }
}
```

---

## Available Patterns & Utilities

> **Goal**: Reference existing packages and highlight specific functions useful for this work packet.

### Foundation Packages

#### `@codex/database`
- **Query Helpers**:
  - `scopedNotDeleted(table, userId)`: Combines creator scoping + soft delete filtering
  - `withPagination(query, page, pageSize)`: Standardized pagination
  - `creatorScope(table, userId)`: Filter by creator ownership
  - `orgScope(table, organizationId)`: Filter by organization

- **Transaction Support**:
  - `db.transaction(async (tx) => { ... })`: Atomic multi-step operations

- **Error Detection**:
  - `isUniqueViolation(error)`: Check for unique constraint violations
  - `isForeignKeyViolation(error)`: Check for foreign key violations

**When to use**: All service implementations use these for data access

---

#### `@codex/service-errors`
- **BaseService**: Extend this for all service classes
  - Provides: `this.db`, `this.userId`, `this.environment`
  - Constructor: `constructor(config: ServiceConfig)`

- **Error Classes**:
  - `NotFoundError(message)`: 404 responses
  - `ValidationError(message, details?)`: 400 responses
  - `ConflictError(message)`: 409 responses
  - `ForbiddenError(message)`: 403 responses
  - `InternalServiceError(message)`: 500 responses

- **Error Mapping**:
  - `mapErrorToResponse(error)`: Converts service errors to HTTP responses

**When to use**: Every service extends BaseService, every worker catches with mapErrorToResponse

---

#### `@codex/validation`
- **Schema Pattern**:
  - Define Zod schemas for all inputs
  - Type inference: `type T = z.infer<typeof schema>`
  - Validation happens automatically in createAuthenticatedHandler()

- **Security**:
  - All schemas prevent XSS, injection, path traversal
  - Enums must align with database CHECK constraints

**When to use**: Define schemas for all API inputs and service parameters

---

#### `@codex/security`
- **Middleware**:
  - `securityHeaders()`: CSP, X-Frame-Options, HSTS
  - `rateLimit(preset)`: KV-backed rate limiting
  - `requireAuth()`: Session validation (if you need global auth)

- **Worker Auth**:
  - `workerAuth()`: HMAC-based worker-to-worker authentication

**When to use**: Applied in worker setup via createWorker()

---

### Utility Packages

#### `@codex/worker-utils`
- **Worker Setup**:
  - `createWorker(config)`: Fully configured Hono app with middleware
  - Returns app with security headers, CORS, logging, error handling

- **Route Handlers**:
  - `createAuthenticatedHandler({ inputSchema, handler })`: Unified handler pattern
  - Handles: validation, authentication context, error mapping

- **Security Policies**:
  - `withPolicy(policy)`: Route-level authorization
  - `POLICY_PRESETS.authenticated()`: Requires valid session
  - `POLICY_PRESETS.creator()`: Requires creator ownership
  - `POLICY_PRESETS.platformOwner()`: Requires admin role

**When to use**: Every worker uses createWorker(), every protected route uses withPolicy()

---

#### `@codex/cloudflare-clients`
- **R2 Storage**:
  - `R2Service.put(bucket, key, data)`: Upload file
  - `R2Service.get(bucket, key)`: Download file
  - `R2Service.delete(bucket, key)`: Delete file
  - `R2Service.generateSignedUrl(bucket, key, expiresIn)`: Time-limited streaming URLs

- **Retry Logic**: Automatic exponential backoff on failures

**When to use**: Any feature involving file storage (media, images, assets)

---

#### `@codex/observability`
- **Logging**:
  - `ObservabilityClient.info(message, metadata)`: Info logs
  - `ObservabilityClient.error(message, error)`: Error logs with stack traces
  - Structured logging with request context

**When to use**: All services and workers for monitoring and debugging

---

#### `@codex/test-utils`
- **Database Testing**:
  - `setupTestDatabase()`: Initialize test database
  - `teardownTestDatabase()`: Clean up after tests
  - `withNeonTestBranch()`: Ephemeral test branches per file

- **Test Fixtures**:
  - `seedTestUsers()`: Create test user data

**When to use**: All integration tests

---

## Dependencies

> **Goal**: Clearly state what must be in place before implementation can start.

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| [Service/Package] | ✅ Available | What we need from it |
| [Another Service] | ❌ Blocked | Waiting for [work packet ID] |
| [Infrastructure] | 🏗️ Partial | What exists / what's missing |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| [Service/Package] | 🚧 Future | Would enable [additional functionality] |

### Infrastructure Ready

- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline (Cloudflare Workers)
- ✅ R2 Storage access
- [Add other infrastructure that's already in place]

---

## Implementation Checklist

> **Goal**: High-level tasks, NOT detailed code steps.

- [ ] **Database Setup**
  - [ ] Create schema definitions in `@codex/database`
  - [ ] Generate migration with `pnpm db:gen:drizzle`
  - [ ] Manually add CHECK constraints to migration
  - [ ] Run migration in development

- [ ] **Service Layer**
  - [ ] Create service package under `packages/[name]/`
  - [ ] Implement [ServiceName] extending BaseService
  - [ ] Define custom error classes
  - [ ] Implement core business logic methods
  - [ ] Add unit tests

- [ ] **Validation**
  - [ ] Add Zod schemas to `@codex/validation`
  - [ ] Ensure enums match database constraints
  - [ ] Add schema tests

- [ ] **Worker/API**
  - [ ] Create worker or add routes to existing worker
  - [ ] Implement endpoints using createAuthenticatedHandler()
  - [ ] Apply appropriate security policies with withPolicy()
  - [ ] Add integration tests

- [ ] **Integration**
  - [ ] Wire service into dependent services
  - [ ] Test end-to-end workflows
  - [ ] Update CLAUDE.md documentation

- [ ] **Deployment**
  - [ ] Update wrangler.jsonc with bindings
  - [ ] Test in preview environment
  - [ ] Run migrations in staging
  - [ ] Deploy to production

---

## Testing Strategy

> **Goal**: Describe testing approach at a high level, not specific test cases.

### Unit Tests
- **Service Layer**: Test business logic in isolation
  - Mock database with test fixtures
  - Verify error handling (custom error classes thrown correctly)
  - Test transaction boundaries (rollback on failure)

### Integration Tests
- **API Endpoints**: Test full request-response cycle
  - Use `@codex/test-utils` for database setup
  - Test authentication/authorization (various user roles)
  - Verify response formats match `@codex/shared-types`
  - Test error responses (4xx, 5xx status codes)

### Database Tests
- **Schema Validation**:
  - Test constraints (unique, foreign key, check)
  - Verify soft delete behavior (deletedAt filtering)
  - Test scoping (creator/organization isolation)

### E2E Scenarios
- **[Primary User Flow]**: [Description of end-to-end test]
- **[Error Scenario]**: [How system should behave when things go wrong]

### Local Development Testing
- **Tools**:
  - `pnpm test`: Run all tests
  - `pnpm dev`: Local worker development
  - [Any other tools like MailHog, Docker, etc.]

---

## Notes

> Additional context, decisions, or considerations that don't fit elsewhere.

- [Architectural decision and rationale]
- [Performance considerations]
- [Security considerations]
- [Future enhancements to consider]

---

**Last Updated**: [Date]
**Template Version**: 1.0
