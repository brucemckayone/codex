# @codex/service-errors

Standardized error handling framework for all Codex services. Provides consistent error classes, HTTP status code mapping, and utilities for service error management across the entire platform.

This is a **foundation package** that all service packages depend on. It defines the error handling strategy that ensures consistent behavior across services, workers, and client responses.

---

## Table of Contents

1. [Overview](#overview)
2. [Public API Reference](#public-api-reference)
3. [Error Class Hierarchy](#error-class-hierarchy)
4. [BaseService Abstract Class](#baseservice-abstract-class)
5. [Error Classes & HTTP Status Codes](#error-classes--http-status-codes)
6. [Core Usage Patterns](#core-usage-patterns)
7. [Error Mapper Utilities](#error-mapper-utilities)
8. [Integration Points](#integration-points)
9. [Type System & Contracts](#type-system--contracts)
10. [Error Response Format](#error-response-format)
11. [Advanced Error Handling](#advanced-error-handling)
12. [Security & Best Practices](#security--best-practices)
13. [Performance Notes](#performance-notes)
14. [Testing Error Scenarios](#testing-error-scenarios)

---

## Overview

### What This Package Does

@codex/service-errors provides the unified error handling foundation for the entire Codex platform. It enables:

- **Consistent error structure** across all services with code, message, status code, and context
- **Type-safe error handling** through custom error classes for each scenario (404, 400, 403, 409, 422, 500)
- **Automatic HTTP status mapping** converting service errors to appropriate HTTP responses
- **Base service class** (BaseService) all domain services extend for unified initialization
- **Error wrapping utilities** preventing internal implementation details from leaking to clients
- **V8 stack trace capture** for debugging (Node.js and Cloudflare Workers)

### Business Responsibility

This package implements the error handling boundary between application logic and HTTP responses. The flow is:

1. **Service layer** throws domain-specific errors with business context
2. **Worker middleware** catches errors and maps to standardized HTTP responses
3. **Clients** receive well-formed error objects with actionable information

This separation ensures:
- Service code focuses on business logic (not HTTP concerns)
- Workers focus on routing and response formatting (not business logic)
- Clients have consistent error handling regardless of endpoint

### Architectural Position

```
Application Code
    ↓
Service Layer (throws ServiceError subclasses)
    ↓
mapErrorToResponse() (converts to HTTP)
    ↓
HTTP Client (receives standardized ErrorResponse)
```

---

## Public API Reference

### Error Classes (Exported)

| Class | HTTP Status | Import | Purpose | When to Use |
|-------|-------------|--------|---------|------------|
| `ServiceError` | N/A (abstract) | Base class | Abstract base for all service errors | Extend for domain-specific errors |
| `NotFoundError` | 404 | Thrown by services | Resource doesn't exist | Query returns no rows |
| `UnauthorizedError` | 401 | Thrown by services | User not authenticated | No session, invalid token |
| `ValidationError` | 400 | Thrown manually or via mapErrorToResponse | Input validation failed | User input invalid |
| `ForbiddenError` | 403 | Thrown by services | Authenticated but lacks permission | User owns different resource |
| `ConflictError` | 409 | Thrown by services | Operation conflicts with state | Duplicate unique constraint |
| `BusinessLogicError` | 422 | Thrown by services | Business rule violated | State machine violation |
| `InternalServiceError` | 500 | Thrown by error handlers | Unexpected error | Catch-all for unknown errors |

### Utility Functions (Exported)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `mapErrorToResponse()` | `(error: unknown, options?: ErrorMapperOptions) => MappedError` | Convert any error to HTTP response |
| `isServiceError()` | `(error: unknown) => error is ServiceError` | Type guard for ServiceError instances |
| `wrapError()` | `(error: unknown, context?: Record) => ServiceError` | Convert unknown errors safely |
| `isKnownError()` | `(error: unknown) => boolean` | Check if error is ServiceError or ZodError |

### Base Service & Config (Exported)

| Export | Type | Purpose |
|--------|------|---------|
| `BaseService` | Abstract class | Foundation for all domain services |
| `ServiceConfig` | Interface | Configuration: { db, environment } |

### Response Types (Exported)

| Type | Purpose |
|------|---------|
| `ErrorResponse` | Standard HTTP error response structure |
| `ErrorStatusCode` | Union: `400 | 401 | 403 | 404 | 409 | 422 | 500` |
| `MappedError` | Result: { statusCode, response } |
| `ErrorMapperOptions` | Configuration for mapErrorToResponse |

---

## Error Class Hierarchy

```
Error (JavaScript built-in)
└── ServiceError (abstract)
    ├── NotFoundError (404)
    ├── UnauthorizedError (401) [reserved for auth middleware]
    ├── ValidationError (400)
    ├── ForbiddenError (403)
    ├── ConflictError (409)
    ├── BusinessLogicError (422)
    └── InternalServiceError (500)
```

### Inheritance Characteristics

- All errors properly chain instanceof checks
- All errors provide `name` property matching class name
- All errors capture V8 stack traces (V8 runtimes: Node.js, Cloudflare Workers)
- All errors support optional `context` metadata for debugging
- All errors serialize correctly for logging and HTTP transport

---

## BaseService Abstract Class

The `BaseService` abstract class is the foundation for all domain services. Every service extends this class to ensure consistent initialization, database access, and error handling.

### Constructor

```typescript
abstract class BaseService {
  constructor(config: ServiceConfig)
}
```

**Parameters:**
- `config.db` (typeof dbHttp | typeof dbWs) - Database connection instance for queries
- `config.environment` (string) - Runtime environment string (development, staging, production, test)

### Protected Properties (Inherited by Subclasses)

```typescript
protected readonly db: typeof dbHttp | typeof dbWs
protected readonly environment: string
protected readonly obs: ObservabilityClient
```

These are accessible to all service subclasses.

### Protected Methods

#### handleError(error: unknown, context?: string): never

Wraps unknown errors with service context. This method:

**Behavior:**
- If error is already ServiceError: re-throws unchanged
- If error is unknown: wraps as InternalServiceError with service name and environment
- Always throws (never returns)

**Parameters:**
- `error` (unknown) - The error to handle
- `context` (string, optional) - Context description for logging

**Returns:** Never (always throws ServiceError)

**Example:**

```typescript
export class ContentService extends BaseService {
  async publishContent(contentId: string) {
    try {
      const result = await this.db.update(schema.content)
        .set({ status: 'published' })
        .where(eq(schema.content.id, contentId))
        .returning();
      return result[0];
    } catch (error) {
      // Wraps database errors, re-throws ServiceErrors unchanged
      this.handleError(error, 'publish operation');
    }
  }
}
```

### Service Implementation Pattern

All services follow this pattern:

```typescript
import { BaseService, type ServiceConfig, NotFoundError } from '@codex/service-errors';
import { schema } from '@codex/database';
import { eq } from 'drizzle-orm';

export class MyService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getItem(id: string) {
    const item = await this.db.query.items.findFirst({
      where: eq(schema.items.id, id),
    });

    if (!item) {
      throw new NotFoundError('Item not found', { id });
    }

    return item;
  }

  async createItem(input: CreateItemInput) {
    try {
      return await this.db.transaction(async (tx) => {
        const [item] = await tx.insert(schema.items)
          .values(input)
          .returning();
        return item;
      });
    } catch (error) {
      this.handleError(error, 'create item');
    }
  }
}
```

**Key patterns:**
- Always extend BaseService
- Always call super(config) in constructor
- Throw specific errors, not generic ones
- Use handleError() to wrap unknown database errors
- Use transactions for multi-step operations

---

## Error Classes & HTTP Status Codes

### NotFoundError (404)

**HTTP Status:** 404 Not Found

**When to throw:** Database query returns no matching resource

**Semantics:** Client requested resource that doesn't exist

**Context typically includes:** Resource ID, query parameters

**Example:**

```typescript
export class UserService extends BaseService {
  async getUserById(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user) {
      throw new NotFoundError('User not found', { userId });
    }

    return user;
  }
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "user-123" }
  }
}
```

**Client action:** Verify ID, redirect to listing, or show 404 page

---

### UnauthorizedError (401)

**HTTP Status:** 401 Unauthorized

**When to throw:** No valid session/token, session expired, credentials invalid

**Semantics:** Authentication required but missing or invalid

**Context typically includes:** Session ID, token status

**Note:** Usually thrown by auth middleware, not services

**Example:**

```typescript
const session = await getSessionOrThrow();
if (!session || session.expiresAt < new Date()) {
  throw new UnauthorizedError('Session expired', { sessionId: session?.id });
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Session expired"
  }
}
```

**Client action:** Redirect to login, refresh token, or show login form

---

### ValidationError (400)

**HTTP Status:** 400 Bad Request

**When to throw:** Input validation fails (manually or via Zod)

**Semantics:** Request is malformed or violates input constraints

**Context typically includes:** Field name, validation reason

**Note:** Usually comes from Zod schemas, automatically handled by mapErrorToResponse()

**Example:**

```typescript
if (!isValidEmail(email)) {
  throw new ValidationError('Invalid email format', { email });
}

// Or via Zod:
const result = createUserSchema.safeParse(input);
if (!result.success) {
  // mapErrorToResponse() converts ZodError to ValidationError
}
```

**HTTP Response (manual):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": { "email": "invalid@" }
  }
}
```

**HTTP Response (from Zod):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      { "path": "email", "message": "Invalid email" },
      { "path": "age", "message": "Must be 18 or older" }
    ]
  }
}
```

**Client action:** Show validation messages, highlight invalid fields

---

### ForbiddenError (403)

**HTTP Status:** 403 Forbidden

**When to throw:** User is authenticated but lacks permission for action

**Semantics:** You're not allowed to do this

**Context typically includes:** Resource ID, missing permission

**Difference from UnauthorizedError:** 401 = missing auth, 403 = has auth but no permission

**Example:**

```typescript
export class ContentService extends BaseService {
  async deleteContent(contentId: string, userId: string) {
    const content = await this.getContentById(contentId);

    if (content.creatorId !== userId) {
      throw new ForbiddenError(
        'You do not own this content',
        { contentId, userId, ownerId: content.creatorId }
      );
    }

    return await this.db.delete(schema.content)
      .where(eq(schema.content.id, contentId));
  }
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not own this content",
    "details": {
      "contentId": "content-123",
      "userId": "user-456",
      "ownerId": "user-789"
    }
  }
}
```

**Client action:** Show access denied, suggest contacting owner, hide action

---

### ConflictError (409)

**HTTP Status:** 409 Conflict

**When to throw:** Operation conflicts with existing state (e.g., duplicate unique constraint)

**Semantics:** Your request conflicts with current state

**Context typically includes:** The conflicting field and existing resource ID

**Common causes:**
- Duplicate email on user creation
- Duplicate slug on organization creation
- Duplicate username
- Any unique constraint violation

**Example:**

```typescript
export class OrganizationService extends BaseService {
  async createOrganization(input: CreateOrgInput) {
    try {
      const [org] = await this.db.insert(schema.organizations)
        .values(input)
        .returning();
      return org;
    } catch (error) {
      // wrapError() detects unique constraint violations automatically
      throw wrapError(error, { table: 'organizations' });
    }
  }
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Organization slug already exists",
    "details": { "slug": "my-org" }
  }
}
```

**Client action:** Suggest alternative value, highlight field, show existing item

---

### BusinessLogicError (422)

**HTTP Status:** 422 Unprocessable Entity

**When to throw:** Request is valid but violates business rules or state constraints

**Semantics:** Your input is valid but breaks business rules

**Context typically includes:** State info explaining why operation cannot proceed

**Difference from ValidationError:** 400 = input invalid, 422 = input valid but breaks rules

**Common scenarios:**
- Cannot publish without required fields
- Cannot transition to invalid state
- Insufficient balance for transaction
- Cannot delete item with dependencies

**Example:**

```typescript
export class ContentService extends BaseService {
  async publishContent(contentId: string) {
    const content = await this.getContentById(contentId);

    // Input is valid, but business rule prevents publishing
    if (content.mediaItems.length === 0) {
      throw new BusinessLogicError(
        'Cannot publish content without media',
        {
          contentId,
          mediaCount: content.mediaItems.length,
          requiredCount: 1,
        }
      );
    }

    // Check transcoding status
    const unreadyMedia = content.mediaItems.filter(m => m.status !== 'ready');
    if (unreadyMedia.length > 0) {
      throw new BusinessLogicError(
        'Cannot publish content with unprocessed media',
        {
          contentId,
          unreadyCount: unreadyMedia.length,
          unreadyIds: unreadyMedia.map(m => m.id),
        }
      );
    }

    return await this.db.update(schema.content)
      .set({ status: 'published' })
      .where(eq(schema.content.id, contentId))
      .returning();
  }
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "BUSINESS_LOGIC_ERROR",
    "message": "Cannot publish content without media",
    "details": {
      "contentId": "content-123",
      "mediaCount": 0,
      "requiredCount": 1
    }
  }
}
```

**Client action:** Show helpful message about why operation failed, explain remediation

---

### InternalServiceError (500)

**HTTP Status:** 500 Internal Server Error

**When to throw:** Unexpected errors occur (database connection failure, missing config, etc.)

**Semantics:** Something went wrong on the server

**Context includes:** Only safe context (service name, environment, operation)

**CRITICAL:** Never expose internal error details to clients. Context is for backend logging only.

**Example:**

```typescript
export class DatabaseService extends BaseService {
  async query(sql: string) {
    try {
      return await this.db.execute(sql);
    } catch (error) {
      // Don't expose database error message to client
      this.handleError(error, 'database query execution');
    }
  }
}
```

handleError() automatically creates InternalServiceError with safe context:

```typescript
protected handleError(error: unknown, context?: string): never {
  if (isServiceError(error)) {
    throw error;
  }
  throw wrapError(error, {
    service: this.constructor.name,
    environment: this.environment,
    ...(context && { context }),
  });
}
```

**HTTP Response:**

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

**Client action:** Retry, contact support, report issue

---

## Core Usage Patterns

### Pattern 1: Query with Not-Found Check

```typescript
async getItem(itemId: string) {
  const item = await this.db.query.items.findFirst({
    where: eq(schema.items.id, itemId),
  });

  if (!item) {
    throw new NotFoundError('Item not found', { itemId });
  }

  return item;
}
```

**Flow:** Query → Check result → Throw NotFoundError if missing

---

### Pattern 2: Ownership Verification

```typescript
async deleteItem(itemId: string, userId: string) {
  const item = await this.getItem(itemId); // May throw NotFoundError

  if (item.ownerId !== userId) {
    throw new ForbiddenError(
      'You do not own this item',
      { itemId, userId, ownerId: item.ownerId }
    );
  }

  await this.db.delete(schema.items)
    .where(eq(schema.items.id, itemId));
}
```

**Flow:** Get item → Verify ownership → Delete OR throw ForbiddenError

---

### Pattern 3: Unique Constraint Handling

```typescript
async createItem(input: CreateItemInput) {
  try {
    const [item] = await this.db.insert(schema.items)
      .values(input)
      .returning();
    return item;
  } catch (error) {
    // wrapError() detects unique constraint violations
    throw wrapError(error, { table: 'items', input });
  }
}
```

**Flow:** Try insert → Catch error → wrapError() detects constraint type → Throw appropriate error

**Note:** wrapError() checks error.message for "unique constraint" pattern

---

### Pattern 4: State Machine Validation

```typescript
async publishItem(itemId: string) {
  const item = await this.getItem(itemId);

  if (item.status !== 'draft') {
    throw new BusinessLogicError(
      `Only draft items can be published (current: ${item.status})`,
      { itemId, currentStatus: item.status, allowedStatus: 'draft' }
    );
  }

  const missingFields = this.getMissingRequiredFields(item);
  if (missingFields.length > 0) {
    throw new BusinessLogicError(
      'Cannot publish item missing required fields',
      { itemId, missingFields }
    );
  }

  return await this.db.update(schema.items)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(schema.items.id, itemId))
    .returning();
}
```

**Flow:** Validate state → Validate prerequisites → Transition state OR throw BusinessLogicError

---

### Pattern 5: Multi-Tenant Scoped Access

```typescript
async deleteOrgItem(itemId: string, userId: string, orgId: string) {
  // First: Verify user is org member
  const isMember = await this.isOrgMember(userId, orgId);
  if (!isMember) {
    throw new ForbiddenError(
      'You are not a member of this organization',
      { userId, orgId }
    );
  }

  // Then: Query with org scope (prevents leaking items from other orgs)
  const item = await this.db.query.items.findFirst({
    where: and(
      eq(schema.items.id, itemId),
      eq(schema.items.organizationId, orgId)
    ),
  });

  if (!item) {
    // Don't reveal whether item exists in other org
    throw new NotFoundError('Item not found', { itemId });
  }

  // Additional permission check
  const canDelete = item.creatorId === userId || await this.isOrgAdmin(userId, orgId);
  if (!canDelete) {
    throw new ForbiddenError('Cannot delete this item');
  }

  await this.db.delete(schema.items)
    .where(eq(schema.items.id, itemId));
}
```

**Flow:** Verify access → Query with scope → Check permissions → Delete OR throw error

**Important:** Always scope queries by organization to prevent data leakage

---

### Pattern 6: Transaction Safety with Error Handling

```typescript
async transferItem(itemId: string, fromUserId: string, toUserId: string) {
  try {
    return await this.db.transaction(async (tx) => {
      const item = await tx.query.items.findFirst({
        where: eq(schema.items.id, itemId),
      });

      if (!item) {
        throw new NotFoundError('Item not found', { itemId });
      }

      if (item.ownerId !== fromUserId) {
        throw new ForbiddenError('Cannot transfer item you do not own');
      }

      // Update owner
      await tx.update(schema.items)
        .set({ ownerId: toUserId })
        .where(eq(schema.items.id, itemId));

      // Create audit log entry
      await tx.insert(schema.auditLog).values({
        itemId,
        action: 'transfer',
        fromUserId,
        toUserId,
        timestamp: new Date(),
      });

      return item;
    });
  } catch (error) {
    // All-or-nothing: transaction rolled back if any error occurs
    this.handleError(error, 'transfer item');
  }
}
```

**Flow:** Begin transaction → Multiple operations → All succeed or all rollback → Any error wrapped by handleError()

**Important:** Use db.transaction() for multi-step operations to ensure atomicity

---

## Error Mapper Utilities

### mapErrorToResponse(error, options?)

Converts any error type to standardized HTTP response with status code.

**Signature:**

```typescript
function mapErrorToResponse(
  error: unknown,
  options?: ErrorMapperOptions
): MappedError
```

**Handles all error types:**
- ServiceError instances (uses built-in statusCode and code)
- ZodError instances (validates and converts to 422)
- Unknown errors (wraps as 500 safely)

**Options:**

```typescript
interface ErrorMapperOptions {
  /**
   * Include stack trace in response (development only)
   * @default false
   */
  includeStack?: boolean;

  /**
   * Log unknown errors to console or observability client
   * @default true
   */
  logError?: boolean;

  /**
   * Optional observability client for structured logging
   * If provided and logError is true, logs via this client
   */
  obs?: ObservabilityClient;
}
```

**Returns:**

```typescript
interface MappedError {
  statusCode: ErrorStatusCode;  // 400, 401, 403, 404, 409, 422, or 500
  response: ErrorResponse;      // Standardized error object
}
```

**Example usage in worker:**

```typescript
import { mapErrorToResponse } from '@codex/service-errors';

app.get('/:id', async (c) => {
  try {
    const content = await service.getContent(c.req.param('id'));
    return c.json(content);
  } catch (error) {
    const { statusCode, response } = mapErrorToResponse(error, {
      obs: observabilityClient,
      logError: true,
    });
    return c.json(response, statusCode);
  }
});
```

**Development mode with stack traces:**

```typescript
const { statusCode, response } = mapErrorToResponse(error, {
  includeStack: process.env.NODE_ENV === 'development',
  logError: true,
});
```

---

### isServiceError(error)

Type guard to check if error is a ServiceError instance.

**Signature:**

```typescript
function isServiceError(error: unknown): error is ServiceError
```

**Returns:** true if error is ServiceError or subclass, false otherwise

**Example:**

```typescript
try {
  await service.operation();
} catch (error) {
  if (isServiceError(error)) {
    // Type-safe: error is ServiceError
    console.log(`Service error code: ${error.code}`);
    console.log(`Status: ${error.statusCode}`);
  } else {
    // Unknown error type
    console.error('Unexpected error:', error);
  }
}
```

---

### wrapError(error, context?)

Converts unknown errors to ServiceError instances safely. Core utility for error handling.

**Signature:**

```typescript
function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ServiceError
```

**Behavior:**
- If error is already ServiceError: returns unchanged (idempotent)
- If error message includes "unique constraint": returns ConflictError
- Otherwise: returns InternalServiceError (safe for client)

**Returns:** ServiceError instance (never throws)

**Example: Database insert with constraint handling**

```typescript
async createUser(input: CreateUserInput) {
  try {
    const [user] = await this.db.insert(schema.users)
      .values(input)
      .returning();
    return user;
  } catch (error) {
    // Automatically detects unique constraint violations
    throw wrapError(error, {
      table: 'users',
      operation: 'create',
      email: input.email,
    });
  }
}
```

When wrapError() detects "unique constraint" in error message:
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Resource already exists",
    "details": {
      "table": "users",
      "operation": "create",
      "email": "user@example.com"
    }
  }
}
```

---

### isKnownError(error)

Type guard to check if error is a known application error type.

**Signature:**

```typescript
function isKnownError(error: unknown): boolean
```

**Returns:** true if error is ServiceError or ZodError, false otherwise

**Example:**

```typescript
try {
  await operation();
} catch (error) {
  if (isKnownError(error)) {
    // Safe to send to client (either ServiceError or ZodError)
    const { statusCode, response } = mapErrorToResponse(error);
    return c.json(response, statusCode);
  } else {
    // Unknown error type - log and return generic response
    console.error('Unexpected error type:', error);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } },
      500
    );
  }
}
```

---

## Integration Points

### Packages That Depend on @codex/service-errors

| Package | Usage |
|---------|-------|
| @codex/content | Extends BaseService, throws domain-specific errors |
| @codex/identity | Extends BaseService, throws organization-specific errors |
| @codex/access | Extends BaseService, throws access control errors |
| @codex/purchase | Extends BaseService, throws payment-specific errors |
| @codex/worker-utils | Uses mapErrorToResponse in route handlers |
| All worker packages | Use mapErrorToResponse to convert service errors |

### Dependency Graph

```
@codex/service-errors (foundation)
├─ Depends on:
│  ├─ @codex/database (for ServiceDatabase type)
│  ├─ @codex/observability (for logging)
│  └─ zod (for ZodError type guard)
│
└─ Depended on by:
   ├─ @codex/content
   ├─ @codex/identity
   ├─ @codex/access
   ├─ @codex/purchase
   ├─ @codex/worker-utils
   └─ All worker packages
```

### How Services Use This Package

**1. Service Definition**

```typescript
import { BaseService, type ServiceConfig, NotFoundError } from '@codex/service-errors';
import { dbHttp } from '@codex/database';

export class MyService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getItem(id: string) {
    const item = await this.db.query.items.findFirst(/* ... */);
    if (!item) {
      throw new NotFoundError('Item not found', { id });
    }
    return item;
  }
}
```

**2. Service Instantiation**

```typescript
// In worker route
const service = new MyService({
  db: dbHttp,
  environment: process.env.ENVIRONMENT || 'development',
});
```

**3. Error Throwing**

Services throw specific error classes with rich context.

**4. Error Mapping**

```typescript
app.get('/:id', async (c) => {
  try {
    const item = await service.getItem(c.req.param('id'));
    return c.json(item);
  } catch (error) {
    const { statusCode, response } = mapErrorToResponse(error);
    return c.json(response, statusCode);
  }
});
```

### How Workers Use This Package

1. **Import mapErrorToResponse** - Convert errors to HTTP responses
2. **Import error classes** - For type guards in catch blocks
3. **Use in route handlers** - All routes should map errors
4. **Pass observability client** - For structured error logging

---

## Type System & Contracts

### ErrorStatusCode

Union type of valid HTTP error status codes.

```typescript
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 500
```

**Values:**
- `400` - ValidationError (input invalid)
- `401` - UnauthorizedError (missing auth)
- `403` - ForbiddenError (lacks permission)
- `404` - NotFoundError (resource missing)
- `409` - ConflictError (state conflict)
- `422` - BusinessLogicError (rule violated)
- `500` - InternalServiceError (unexpected)

---

### ServiceConfig

Configuration object required by all services.

**Definition:**

```typescript
interface ServiceConfig {
  /** Database connection instance (dbHttp for workers, dbWs for tests) */
  db: typeof dbHttp | typeof dbWs;

  /** Runtime environment (development, staging, production, test) */
  environment: string;
}
```

**Usage in services:**

```typescript
const service = new ContentService({
  db: dbHttp,
  environment: 'production',
});
```

---

### ErrorResponse

Standard error response structure returned by mapErrorToResponse().

**Definition:**

```typescript
interface ErrorResponse {
  error: {
    code: string;        // Machine-readable code (NOT_FOUND, FORBIDDEN, etc.)
    message: string;     // Human-readable message
    details?: unknown;   // Optional context (validation errors, resource IDs, etc.)
  };
}
```

**Example responses:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "abc-123" }
  }
}
```

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not own this resource"
  }
}
```

---

### MappedError

Result of error mapping operation.

**Definition:**

```typescript
interface MappedError {
  statusCode: ErrorStatusCode;
  response: ErrorResponse;
}
```

**Usage:**

```typescript
const { statusCode, response } = mapErrorToResponse(error);
return c.json(response, statusCode);
```

---

### ErrorMapperOptions

Configuration for mapErrorToResponse() function.

**Definition:**

```typescript
interface ErrorMapperOptions {
  includeStack?: boolean;
  logError?: boolean;
  obs?: ObservabilityClient;
}
```

---

## Error Response Format

### Standard Response Structure

```typescript
interface ErrorResponse {
  error: {
    code: string;          // Machine-readable error code
    message: string;       // Human-readable description
    details?: unknown;     // Optional metadata
  };
}
```

### HTTP Status Code Mapping

| Error Class | Status | When Sent | Client Action |
|-------------|--------|-----------|----------------|
| NotFoundError | 404 | Resource doesn't exist | Check ID, redirect, or 404 page |
| UnauthorizedError | 401 | No valid auth | Login, refresh token, re-auth |
| ValidationError | 400 | Input invalid | Show field errors |
| ForbiddenError | 403 | Lacks permission | Show access denied, hide action |
| ConflictError | 409 | State conflict | Suggest alternative, try again |
| BusinessLogicError | 422 | Rule violated | Show explanation, help user fix |
| InternalServiceError | 500 | Unexpected | Retry, contact support |

### Example Response Bodies

**404 Not Found:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found",
    "details": { "contentId": "abc-123" }
  }
}
```

**400 Validation Error (from Zod):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      { "path": "email", "message": "Invalid email" },
      { "path": "age", "message": "Must be at least 18" }
    ]
  }
}
```

**403 Forbidden:**

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource",
    "details": { "resource": "content-456", "required": "owner" }
  }
}
```

**409 Conflict:**

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A resource with this identifier already exists",
    "details": { "slug": "my-organization", "type": "organization" }
  }
}
```

**422 Business Logic Error:**

```json
{
  "error": {
    "code": "BUSINESS_LOGIC_ERROR",
    "message": "Cannot publish content without media",
    "details": {
      "contentId": "content-789",
      "mediaCount": 0,
      "requiredCount": 1
    }
  }
}
```

**500 Internal Error:**

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

---

## Advanced Error Handling

### Creating Domain-Specific Error Classes

Domain packages create their own error classes by extending base errors:

**In domain package (e.g., packages/content/src/errors.ts):**

```typescript
import { NotFoundError, ConflictError, BusinessLogicError } from '@codex/service-errors';

export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

export class MediaNotFoundError extends NotFoundError {
  constructor(mediaId: string) {
    super('Media file not found', { mediaId });
  }
}

export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaIds: string[]) {
    super('Cannot publish with unprocessed media', {
      mediaIds,
      mediaCount: mediaIds.length,
    });
  }
}

export class SlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Content slug already exists', { slug });
  }
}
```

**In service:**

```typescript
import { ContentNotFoundError, SlugConflictError } from './errors';

export class ContentService extends BaseService {
  async getContent(id: string) {
    const content = await this.db.query.content.findFirst({
      where: eq(schema.content.id, id),
    });

    if (!content) {
      throw new ContentNotFoundError(id);
    }

    return content;
  }

  async createContent(input: CreateContentInput) {
    try {
      const [content] = await this.db.insert(schema.content)
        .values(input)
        .returning();
      return content;
    } catch (error) {
      throw wrapError(error);
    }
  }
}
```

**In worker route:**

```typescript
try {
  const content = await service.getContent(id);
  return c.json(content);
} catch (error) {
  // All errors are automatically mapped correctly
  const { statusCode, response } = mapErrorToResponse(error);
  return c.json(response, statusCode);
}
```

### Error Recovery Strategies

**For NotFoundError (404):**
- Log with context (resource ID, query params)
- Return 404 (don't retry)
- Client: redirect to listing or show 404 page

**For ValidationError (400):**
- Log validation errors for debugging
- Return 400 with detailed field errors
- Client: fix inputs and resubmit

**For ForbiddenError (403):**
- Log permission denial (userId, resource, action)
- Return 403 (don't retry)
- Client: request access or try different resource

**For ConflictError (409):**
- Log with conflicting value and existing ID
- Return 409 with conflict details
- Client: choose different value or use existing resource

**For BusinessLogicError (422):**
- Log with business context (current state, required conditions)
- Return 422 with remediation hints
- Client: follow instructions to fix state

**For InternalServiceError (500):**
- Log full error for investigation
- Return 500 with generic message
- Client: retry after brief delay

---

## Security & Best Practices

### Never Expose Internal Details

**DON'T:**
```typescript
try {
  await database.query(sql);
} catch (error) {
  throw new InternalServiceError(error.message, { sql });
}
```

**DO:**
```typescript
try {
  await database.query(sql);
} catch (error) {
  this.handleError(error, 'database query');
}
```

handleError() safely wraps errors without exposing details.

---

### Include Rich Context for Debugging

**DON'T:**
```typescript
if (!user) {
  throw new NotFoundError('User not found');
}
```

**DO:**
```typescript
if (!user) {
  throw new NotFoundError('User not found', {
    userId,
    operation: 'getUserById',
    queried: new Date().toISOString(),
  });
}
```

Context helps debugging without exposing to clients.

---

### Use Specific Error Classes

**DON'T:**
```typescript
if (!user) {
  throw new Error('Not found');
}
```

**DO:**
```typescript
if (!user) {
  throw new NotFoundError('User not found', { userId });
}
```

Specific errors enable automatic HTTP mapping.

---

### Prevent Data Leakage in Scoped Queries

**DON'T:**
```typescript
// Returns 'not found' only for items in this org
// Reveals whether item exists in other org
const item = await this.db.query.items.findFirst({
  where: eq(schema.items.id, itemId),
});
```

**DO:**
```typescript
// Query with org scope
const item = await this.db.query.items.findFirst({
  where: and(
    eq(schema.items.id, itemId),
    eq(schema.items.organizationId, orgId),
  ),
});

// Same error regardless of whether item exists in other org
if (!item) {
  throw new NotFoundError('Item not found');
}
```

Always scope queries to prevent data leakage.

---

### Idempotent Error Wrapping

The wrapError() function is idempotent:

```typescript
const serviceError = new NotFoundError('Test');
const wrapped = wrapError(serviceError);
console.log(wrapped === serviceError); // true (returned unchanged)
```

Safe to call multiple times.

---

### Stack Trace Capture

Stack traces are automatically captured in V8 runtimes (Node.js, Cloudflare Workers):

```typescript
const error = new NotFoundError('Test');
console.log(error.stack); // Includes full stack trace

// Can be included in development responses
const { statusCode, response } = mapErrorToResponse(error, {
  includeStack: process.env.NODE_ENV === 'development',
});
```

---

## Performance Notes

### Error Creation

- Error creation is lightweight (properties assigned, no computation)
- Stack trace capture is conditional on V8 runtime (no overhead in other runtimes)
- Context object is reference-stored (not deep-cloned)

### Error Mapping

- ServiceError mapping: O(1) (just property access)
- ZodError mapping: O(n) where n = validation errors
- Unknown error logging: Includes console.error() (can be disabled)

### Recommendations

1. **Throw errors only for exceptional conditions** - Don't use for control flow
2. **Avoid throwing errors in loops** - Check conditions before loop
3. **Context is cheap** - Include rich debugging metadata without penalty
4. **mapErrorToResponse is fast** - Safe to call on every error

---

## Testing Error Scenarios

### Running Tests

```bash
# Run test suite
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Test File Location

`packages/service-errors/src/__tests__/base-errors.test.ts`

### Testing Error Throwing

```typescript
import { describe, it, expect } from 'vitest';
import { NotFoundError } from '@codex/service-errors';

describe('Service', () => {
  it('should throw NotFoundError when item not found', async () => {
    const service = new ItemService(config);

    await expect(
      service.getItem('nonexistent')
    ).rejects.toThrow(NotFoundError);
  });

  it('should include context in thrown error', async () => {
    const service = new ItemService(config);

    try {
      await service.getItem('nonexistent');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).context).toEqual({
        itemId: 'nonexistent',
      });
    }
  });

  it('should have correct HTTP status code', () => {
    const error = new NotFoundError('Not found');
    expect(error.statusCode).toBe(404);
  });

  it('should have correct error code', () => {
    const error = new NotFoundError('Not found');
    expect(error.code).toBe('NOT_FOUND');
  });
});
```

### Testing Error Mapping

```typescript
import { mapErrorToResponse, NotFoundError } from '@codex/service-errors';
import { ZodError } from 'zod';

describe('Error Mapping', () => {
  it('should map NotFoundError to 404', () => {
    const error = new NotFoundError('Not found');
    const { statusCode, response } = mapErrorToResponse(error);

    expect(statusCode).toBe(404);
    expect(response.error.code).toBe('NOT_FOUND');
    expect(response.error.message).toBe('Not found');
  });

  it('should include context in mapped response', () => {
    const error = new NotFoundError('Not found', { userId: 'test-123' });
    const { statusCode, response } = mapErrorToResponse(error);

    expect(response.error.details).toEqual({ userId: 'test-123' });
  });

  it('should map ZodError to 422 with field details', () => {
    const schema = z.object({ email: z.string().email() });
    try {
      schema.parse({ email: 'invalid' });
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);

      expect(statusCode).toBe(422);
      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.error.details)).toBe(true);
    }
  });

  it('should wrap unknown errors safely without exposing details', () => {
    const dbError = new Error('Database connection failed at host:5432');
    const { statusCode, response } = mapErrorToResponse(dbError);

    expect(statusCode).toBe(500);
    expect(response.error.code).toBe('INTERNAL_ERROR');
    expect(response.error.message).toBe('An unexpected error occurred');
    // Database details NOT exposed
    expect(response.error.message).not.toContain('Database');
  });

  it('should detect unique constraint violations', () => {
    const dbError = new Error('duplicate key value violates unique constraint "users_email_key"');
    const { statusCode, response } = mapErrorToResponse(dbError);

    expect(statusCode).toBe(409); // ConflictError
    expect(response.error.code).toBe('CONFLICT');
  });
});
```

### Testing Service Implementation

```typescript
import { BaseService, NotFoundError, ForbiddenError } from '@codex/service-errors';
import { dbWs } from '@codex/database';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService({
      db: dbWs,
      environment: 'test',
    });
  });

  it('should throw NotFoundError for missing user', async () => {
    await expect(
      service.getUserById('nonexistent')
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw ForbiddenError when user lacks permission', async () => {
    // Create test user and content
    const user1 = await service.createUser({ name: 'User 1' });
    const user2 = await service.createUser({ name: 'User 2' });
    const content = await contentService.createContent({
      creatorId: user1.id,
      title: 'Test',
    });

    // User 2 cannot delete User 1's content
    await expect(
      contentService.deleteContent(content.id, user2.id)
    ).rejects.toThrow(ForbiddenError);
  });

  it('should throw ConflictError for duplicate email', async () => {
    const input = { email: 'user@example.com', name: 'Test' };
    await service.createUser(input);

    // Creating with same email should fail
    await expect(
      service.createUser(input)
    ).rejects.toThrow(ConflictError);
  });

  it('should throw BusinessLogicError when violating business rules', async () => {
    const user = await service.createUser({ name: 'Test' });
    const item = await itemService.createItem({
      creatorId: user.id,
      status: 'draft',
    });

    // Cannot publish without required fields
    item.title = undefined;
    await expect(
      itemService.publishItem(item.id)
    ).rejects.toThrow(BusinessLogicError);
  });
});
```

### Testing Type Guards

```typescript
import { isServiceError, isKnownError, NotFoundError } from '@codex/service-errors';
import { ZodError } from 'zod';

describe('Type Guards', () => {
  it('should identify ServiceError instances', () => {
    const error = new NotFoundError('Test');
    expect(isServiceError(error)).toBe(true);
  });

  it('should reject non-ServiceError types', () => {
    expect(isServiceError(new Error('Regular'))).toBe(false);
    expect(isServiceError('string')).toBe(false);
    expect(isServiceError(null)).toBe(false);
  });

  it('should identify known errors (ServiceError or ZodError)', () => {
    const serviceError = new NotFoundError('Test');
    expect(isKnownError(serviceError)).toBe(true);

    const zodError = zSchema.safeParse({}).error;
    expect(isKnownError(zodError)).toBe(true);

    const unknownError = new Error('Unknown');
    expect(isKnownError(unknownError)).toBe(false);
  });
});
```

### Test Patterns for Error Context

```typescript
describe('Error Context', () => {
  it('should preserve complex context objects', () => {
    const context = {
      userId: 'user-123',
      operation: 'delete',
      metadata: { version: 1, timestamp: new Date() },
      nested: { field: 'value' },
    };

    const error = new NotFoundError('Test', context);

    expect(error.context).toEqual(context);
    expect(error.context?.userId).toBe('user-123');
  });

  it('should handle undefined context', () => {
    const error = new NotFoundError('Test');
    expect(error.context).toBeUndefined();
  });

  it('should serialize context in responses', () => {
    const error = new NotFoundError('Not found', { itemId: '123' });
    const { response } = mapErrorToResponse(error);

    expect(response.error.details).toEqual({ itemId: '123' });
  });
});
```

---

## Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| @codex/database | Database client types (ServiceDatabase) | workspace |
| @codex/observability | Logging client (ObservabilityClient) | workspace |
| zod | Schema validation (ZodError handling) | ^3.24.1 |
| typescript | TypeScript language (dev) | ^5.7.3 |
| vitest | Testing framework (dev) | ^4.0.2 |
| vite | Build tool (dev) | ^7.2.2 |

### Production Dependencies

Only 3 production dependencies (plus workspace packages):
- `zod` - For ZodError type detection in mapErrorToResponse()
- `@codex/database` - For ServiceDatabase type
- `@codex/observability` - For structured logging in error mapper

### Zero Complex Dependencies

No external dependencies for error handling logic. All core functionality is pure TypeScript.

---

## Related Documentation

- [Database Package](../database/CLAUDE.md) - Database operations and transaction patterns
- [Worker Utils](../worker-utils/CLAUDE.md) - Route handlers using mapErrorToResponse
- [Validation Package](../validation/CLAUDE.md) - Schema validation and ZodError handling
- [Content Package](../content/CLAUDE.md) - Example service implementation extending BaseService
- [Identity Package](../identity/CLAUDE.md) - Example service implementation with domain-specific errors
- [Security Package](../security/CLAUDE.md) - Authentication errors and security context

---

## Key Design Principles

1. **Consistency** - Every service and worker follows same error patterns
2. **Type Safety** - Error types prevent passing wrong status codes
3. **Security** - Internal errors never expose implementation details
4. **Debuggability** - Error context includes business metadata
5. **Simplicity** - Minimal boilerplate, maximum clarity
6. **Composability** - Extend base errors for domain-specific errors
7. **V8 Compatibility** - Stack traces work in Node.js and Workers
8. **Idempotency** - wrapError() and error handling safe to apply multiple times

---

## Quick Reference

### Error Selection Flowchart

```
Does resource exist?
├─ No → NotFoundError (404)
└─ Yes → Continue

Is user authenticated?
├─ No → UnauthorizedError (401) [auth middleware]
└─ Yes → Continue

Does user have permission?
├─ No → ForbiddenError (403)
└─ Yes → Continue

Is input valid?
├─ No → ValidationError (400) [Zod]
└─ Yes → Continue

Does operation violate state constraints?
├─ No → Continue
└─ Yes → ConflictError (409) [unique] or BusinessLogicError (422) [rule]

Unexpected error occurred?
├─ Yes → InternalServiceError (500) [handleError]
└─ No → Success!
```

### Import Checklist for New Service

```typescript
// Always import:
import { BaseService, NotFoundError } from '@codex/service-errors';
import type { ServiceConfig } from '@codex/service-errors';

// Usually import:
import { ForbiddenError, ConflictError, BusinessLogicError } from '@codex/service-errors';

// Use in constructor:
constructor(config: ServiceConfig) {
  super(config);
}

// Always in catch blocks:
this.handleError(error, 'operation name');

// Always in database inserts:
throw wrapError(error, { table: 'name' });
```

### Import Checklist for New Worker

```typescript
// Always import:
import { mapErrorToResponse } from '@codex/service-errors';

// Use in all route handlers:
try {
  // ... handler logic
} catch (error) {
  const { statusCode, response } = mapErrorToResponse(error, { obs });
  return c.json(response, statusCode);
}
```

---

**Last Updated**: 2025-01-11
**Version**: 1.0.0
**Status**: Complete
**Maintained by**: Codex Documentation Team
