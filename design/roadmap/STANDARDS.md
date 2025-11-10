# Codex Development Standards

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## Purpose

This document outlines coding standards, design patterns, and best practices for the Codex platform. All work packets must follow these standards.

---

## Table of Contents

1. [Testing Standards](#1-testing-standards)
2. [Security Standards](#2-security-standards)
3. [Code Organization](#3-code-organization)
4. [Database Patterns](#4-database-patterns)
5. [API Design](#5-api-design)
6. [Error Handling](#6-error-handling)
7. [Logging & Observability](#7-logging--observability)
8. [TypeScript Standards](#8-typescript-standards)

---

## 1. Testing Standards

### 1.1 Test-Driven Development (TDD)

**Rule**: Write tests before implementation.

**Example**:
```typescript
// ❌ Wrong: Implementation first
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// ✅ Right: Test first
describe('calculateTotal', () => {
  it('should sum item prices', () => {
    const items = [{ price: 10 }, { price: 20 }];
    expect(calculateTotal(items)).toBe(30);
  });
});
// Then implement
```

### 1.2 Separation of Concerns in Tests

**Rule**: Separate validation logic from database calls to enable unit testing without DB.

**Example**:
```typescript
// ❌ Wrong: Validation mixed with DB
async function createUser(data: any) {
  if (!data.email) throw new Error('Email required');
  return db.insert(users).values(data);
}
// Can't unit test validation without DB!

// ✅ Right: Separate validation
function validateUser(data: any): ValidationResult {
  if (!data.email) return { valid: false, error: 'Email required' };
  if (!isValidEmail(data.email)) return { valid: false, error: 'Invalid email' };
  return { valid: true };
}

async function createUser(data: any) {
  const validation = validateUser(data); // Unit testable!
  if (!validation.valid) throw new Error(validation.error);
  return db.insert(users).values(data);
}
```

### 1.3 Test Organization

**Structure**:
```
packages/feature/src/
  service.ts
  service.test.ts           # Unit tests (co-located)
  validation.ts
  validation.test.ts        # Pure logic tests
tests/
  integration.test.ts       # Integration tests
  ```

**Test Categories**:
- **Unit Tests**: Pure functions, validation logic, utilities
- **Integration Tests**: Database operations, API endpoints
- **E2E Tests**: Complete user flows (Playwright)

### 1.4 Test Utilities

**Use** `@codex/test-utils` for:
- Factories (test data generation)
- Database helpers (transaction management)
- Miniflare helpers (worker testing)

**Example**:
```typescript
import { createTestUser, withTestDb } from '@codex/test-utils';

describe('User Service', () => {
  it('should create user', async () => {
    await withTestDb(async (db) => {
      const user = await createUser(createTestUser());
      expect(user.id).toBeDefined();
    });
  });
});
```

---

## 2. Security Standards

### 2.1 Use Security Package

**Always use** `@codex/security` for:
- Security headers
- Rate limiting
- CSP policies
- CORS configuration

**Example**:
```typescript
import { securityHeaders, rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';

app.use('*', securityHeaders({ environment: 'production' }));
app.use('/api/*', rateLimit({ ...RATE_LIMIT_PRESETS.api }));
```

### 2.2 Input Validation

**Always validate** user input with Zod schemas from `@codex/validation`.

**Example**:
```typescript
import { userSchema } from '@codex/validation';

// ❌ Wrong: No validation
async function createUser(data: any) {
  return db.insert(users).values(data);
}

// ✅ Right: Validate with Zod
async function createUser(data: unknown) {
  const validated = userSchema.parse(data); // Throws if invalid
  return db.insert(users).values(validated);
}
```

### 2.3 SQL Injection Prevention

**Always use** Drizzle ORM parameterized queries.

**Example**:
```typescript
// ❌ NEVER: String concatenation
await db.execute(`SELECT * FROM users WHERE email = '${userInput}'`);

// ✅ Right: Parameterized query
await db.select().from(users).where(eq(users.email, userInput));
```

### 2.4 Secrets Management

**Rules**:
- NEVER commit secrets to git
- Use environment variables
- Access via `c.env` in workers
- Mask secrets in logs

**Example**:
```typescript
// ❌ Wrong: Hardcoded
const apiKey = 'sk_live_abc123';

// ✅ Right: Environment variable
const apiKey = c.env.STRIPE_SECRET_KEY;
```

---

## 3. Code Organization

### 3.1 Package Structure

```
packages/feature-name/
├── src/
│   ├── index.ts           # Public exports
│   ├── service.ts         # Business logic
│   ├── service.test.ts
│   ├── validation.ts      # Validation schemas
│   ├── validation.test.ts
│   └── types.ts           # TypeScript types
├── package.json
└── vitest.config.ts
```

### 3.2 Service Layer Pattern

**Structure**:
```typescript
// types.ts
export interface IFeatureService {
  create(data: CreateInput): Promise<Entity>;
  findById(id: string): Promise<Entity | null>;
  update(id: string, data: UpdateInput): Promise<Entity>;
  delete(id: string): Promise<void>;
}

// service.ts
export class FeatureService implements IFeatureService {
  async create(data: CreateInput): Promise<Entity> {
    // Validation
    const validated = validateCreateInput(data);

    // Business logic
    const entity = await db.insert(table).values(validated).returning();

    // Side effects (if any)
    await this.notifyCreation(entity);

    return entity;
  }
}

// index.ts
export { featureService } from './service';
export type { IFeatureService } from './types';
```

### 3.3 Worker Structure

**Use Hono framework** as established in existing workers.

**Example**:
```typescript
import { Hono } from 'hono';
import { securityHeaders } from '@codex/security';

type Bindings = {
  DATABASE_URL: string;
  // ... other bindings
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders());
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
```

---

## 4. Database Patterns

### 4.1 Drizzle ORM

**Use Drizzle** for all database operations (already established).

**Query Patterns**:
```typescript
// Select
const user = await db.query.users.findFirst({
  where: eq(users.id, id),
});

// Insert
const [newUser] = await db.insert(users).values(data).returning();

// Update
await db.update(users).set(data).where(eq(users.id, id));

// Delete
await db.delete(users).where(eq(users.id, id));

// Relations
const user = await db.query.users.findFirst({
  where: eq(users.id, id),
  with: {
    accounts: true,
    sessions: true,
  },
});
```

### 4.2 Migrations

**Use Drizzle Kit**:
```bash
# Generate migration from schema
pnpm --filter @codex/database db:gen:drizzle

# Apply migrations
pnpm --filter @codex/database db:migrate
```

**Schema Files**:
- Co-locate related tables
- Use clear naming
- Add JSDoc comments

**Example**:
```typescript
/**
 * Content table stores published digital content (videos, audio)
 */
export const content = pgTable('content', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  organizationId: text('organization_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 5. API Design

### 5.1 RESTful Conventions

**Follow REST principles**:
- GET: Retrieve resource(s)
- POST: Create resource
- PUT: Update entire resource
- PATCH: Partial update
- DELETE: Remove resource

**URL Structure**:
```
GET    /api/content           # List
GET    /api/content/:id       # Get one
POST   /api/content           # Create
PUT    /api/content/:id       # Update
DELETE /api/content/:id       # Delete
```

### 5.2 Response Format

**Success**:
```typescript
return c.json({
  data: result,
  meta: { timestamp: new Date().toISOString() }
}, 200);
```

**Error**:
```typescript
return c.json({
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Email is required',
    field: 'email',
  }
}, 400);
```

### 5.3 Status Codes

- `200 OK`: Success
- `201 Created`: Resource created
- `400 Bad Request`: Validation error
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: Not authorized
- `404 Not Found`: Resource not found
- `409 Conflict`: Duplicate resource
- `422 Unprocessable Entity`: Business logic error
- `429 Too Many Requests`: Rate limited
- `500 Internal Server Error`: Unexpected error

---

## 6. Error Handling

### 6.1 Error Pattern

**Structure**:
```typescript
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Usage
if (!data.email) {
  throw new ValidationError('Email is required', 'email');
}

// In handler
try {
  await createUser(data);
} catch (err) {
  if (err instanceof ValidationError) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: err.message, field: err.field } }, 400);
  }
  // Log unexpected errors
  obs.trackError(err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } }, 500);
}
```

### 6.2 Never Expose Internal Details

**Example**:
```typescript
// ❌ Wrong: Exposes internals
throw new Error('Database connection failed at postgres://user:pass@host');

// ✅ Right: Generic message
throw new Error('Unable to process request');
// Log detailed error internally with observability
obs.trackError(dbError, { context: 'createUser' });
```

---

## 7. Logging & Observability

### 7.1 Use Observability Package

**Always use** `@codex/observability`:

**Example**:
```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('service-name', c.env.ENVIRONMENT);

// Info logging
obs.info('User created', { userId: user.id });

// Error tracking
obs.trackError(err, { context: 'createUser', userId: user.id });

// Performance tracking
const timer = obs.startTimer('db-query');
await db.query.users.findMany();
timer.end();
```

### 7.2 PII Redaction

**Always redact** PII from logs:

```typescript
import { redactEmail } from '@codex/observability';

// ❌ Wrong: Logs full email
obs.info('User login', { email: user.email });

// ✅ Right: Redact PII
obs.info('User login', { email: redactEmail(user.email) }); // u***@example.com
```

---

## 8. TypeScript Standards

### 8.1 Type Safety

**Rules**:
- No `any` types (use `unknown` if type is truly unknown)
- Define interfaces for all public APIs
- Use strict mode
- Export types alongside implementations

**Example**:
```typescript
// ❌ Wrong: any
function process(data: any) {
  return data.something;
}

// ✅ Right: Proper types
interface ProcessInput {
  something: string;
}

function process(data: ProcessInput): string {
  return data.something;
}
```

### 8.2 Naming Conventions

- **Interfaces**: `IServiceName`, `IRepository`
- **Types**: `EntityName`, `CreateInput`, `UpdateInput`
- **Constants**: `UPPER_SNAKE_CASE`
- **Functions**: `camelCase`
- **Classes**: `PascalCase`
- **Files**: `kebab-case.ts`

---

## Design Patterns

### Repository Pattern (Not Currently Used)

If needed in future:
```typescript
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  create(data: CreateUserInput): Promise<User>;
  update(id: string, data: UpdateUserInput): Promise<User>;
  delete(id: string): Promise<void>;
}
```

### Service Layer (Currently Used)

**Pattern**: Business logic in services, validation separate, thin controllers.

**Example**: See `workers/auth/src/index.ts` for established pattern.

---

## Code Review Checklist

Before submitting PR:

- [ ] All tests passing
- [ ] No `any` types
- [ ] Validation separated from DB calls
- [ ] Security middleware applied
- [ ] Observability logging added
- [ ] PII redacted from logs
- [ ] Error handling consistent
- [ ] API responses follow standard format
- [ ] No secrets hardcoded
- [ ] Types exported
- [ ] JSDoc comments on public APIs

---

## References

**Existing Code Examples**:
- Worker pattern: `workers/auth/src/index.ts`
- Security: `packages/security/src/`
- Observability: `packages/observability/src/`
- Database: `packages/database/src/`
- Validation: `packages/validation/src/`

**Documentation**:
- [Testing Strategy](../infrastructure/Testing.md)
- [Security Guide](../infrastructure/SECURITY.md)
- [Code Structure](../infrastructure/CodeStructure.md)
- [CI/CD Guide](../infrastructure/CICD.md)

---

**Last Updated**: 2025-11-05
