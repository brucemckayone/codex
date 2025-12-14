# @codex/service-errors

Standardized error handling framework for all Codex services. Provides consistent error classes, HTTP status code mapping, and utilities for service error management across the entire platform.

This is a **foundation package** that all service packages depend on. It defines the error handling strategy that ensures consistent behavior across services, workers, and client responses.

---

## Table of Contents

1. [Overview](#overview)
2. [Public API](#public-api)
3. [Error Class Hierarchy](#error-class-hierarchy)
4. [BaseService Class](#baseservice-class)
5. [Error Classes & Status Codes](#error-classes--status-codes)
6. [Usage Examples](#usage-examples)
7. [Integration Points](#integration-points)
8. [Error Response Format](#error-response-format)
9. [Error Handling Patterns](#error-handling-patterns)
10. [Error Mapper Utilities](#error-mapper-utilities)
11. [Type System](#type-system)
12. [Performance Notes](#performance-notes)
13. [Testing](#testing)

---

## Overview

### What This Package Does

@codex/service-errors provides the error handling foundation for the entire Codex platform. It enables:

- **Consistent error structure** across all services with code, message, status code, and context
- **Type-safe error handling** through custom error classes for each error scenario
- **Automatic HTTP status mapping** converting service errors to appropriate HTTP responses
- **Base service class** that all domain services extend for unified error handling
- **Error wrapping utilities** preventing internal implementation details from leaking to clients

### Business Responsibility

This package implements the error handling layer between application logic and HTTP responses. Services throw domain-specific errors, workers catch and map them to standardized HTTP responses, and clients receive well-formed error objects with actionable information.

### Key Concepts

**ServiceError**: Base abstract class for all custom errors. Each error has:
- `message` - Human-readable description of what went wrong
- `code` - Machine-readable error identifier (NOT_FOUND, VALIDATION_ERROR, etc.)
- `statusCode` - HTTP status code (400, 401, 403, 404, 409, 422, 500)
- `context` - Optional metadata for debugging (field names, resource IDs, constraint details)

**BaseService**: Abstract base class all domain services extend:
- Provides unified constructor requiring database connection and environment
- Includes error handling method that wraps unknown errors
- Protected database instance accessible to subclasses

**ErrorMapper**: Converts all error types to standardized HTTP response format:
- Handles ServiceError instances with built-in status codes
- Handles ZodError instances from validation schemas
- Wraps unknown errors safely as 500 internal errors

---

## Public API

### Error Classes

| Export | Type | HTTP Status | Purpose |
|--------|------|-------------|---------|
| `NotFoundError` | Class | 404 | Resource doesn't exist |
| `ValidationError` | Class | 400 | Input validation failed |
| `ForbiddenError` | Class | 403 | User lacks permission |
| `ConflictError` | Class | 409 | State conflict (duplicate) |
| `BusinessLogicError` | Class | 422 | Business rule violated |
| `InternalServiceError` | Class | 500 | Unexpected error |
| `ServiceError` | Abstract class | N/A | Base class for all errors |

### Utility Functions

| Export | Type | Purpose |
|--------|------|---------|
| `mapErrorToResponse(error, options?)` | Function | Convert any error to HTTP response |
| `isServiceError(error)` | Function | Type guard for ServiceError instances |
| `wrapError(error, context?)` | Function | Convert unknown errors to ServiceError |
| `isKnownError(error)` | Function | Check if error is ServiceError or ZodError |

### Base Service

| Export | Type | Purpose |
|--------|------|---------|
| `BaseService` | Abstract class | Foundation for all domain services |
| `ServiceConfig` | Interface | Configuration for BaseService (db, environment) |

### Response Types

| Export | Type | Purpose |
|--------|------|---------|
| `ErrorResponse` | Interface | Standard HTTP error response structure |
| `MappedError` | Interface | Result of error mapping (statusCode + ErrorResponse) |
| `ErrorMapperOptions` | Interface | Configuration for mapErrorToResponse |
| `ErrorStatusCode` | Type | Union of valid error HTTP status codes |

---

## Error Class Hierarchy

```
Error (JavaScript built-in)
└── ServiceError (abstract)
    ├── NotFoundError (404)
    ├── ValidationError (400)
    ├── ForbiddenError (403)
    ├── ConflictError (409)
    ├── BusinessLogicError (422)
    └── InternalServiceError (500)
```

All errors extend `ServiceError` and:
- Properly chain instanceof checks through the inheritance hierarchy
- Provide `name` property matching the class name
- Capture stack traces for debugging (V8 runtime - Node.js, Cloudflare Workers)
- Support optional context metadata for additional information
- Serialize correctly for logging and transport

---

## BaseService Class

The `BaseService` abstract class is the foundation for all domain services in Codex. Every service extends this class to ensure consistent initialization, database access, and error handling.

### Constructor Signature

```typescript
abstract class BaseService {
  constructor(config: ServiceConfig)
}
```

### Constructor Parameters

**config: ServiceConfig**
- `db` (typeof dbHttp | typeof dbWs) - Database connection instance for queries
- `environment` (string) - Runtime environment (development, staging, production, test)

### Protected Properties

```typescript
protected readonly db: typeof dbHttp | typeof dbWs
protected readonly environment: string
```

Both accessible to subclasses for database operations and environment-aware behavior.

### Protected Methods

#### handleError(error: unknown, context?: string): never

Wraps unknown errors with service context. This method:
- Re-throws ServiceError instances unchanged
- Wraps unknown errors as InternalServiceError with service metadata
- Never returns (always throws)

**Parameters:**
- `error` (unknown) - The error to handle
- `context` (string, optional) - Context description (e.g., "publish operation")

**Always throws** a ServiceError instance

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
      this.handleError(error, 'publish operation');
    }
  }
}
```

### Service Implementation Example

```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { schema } from '@codex/database';
import { eq } from 'drizzle-orm';

export class UserService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getUserById(userId: string) {
    try {
      const user = await this.db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });

      if (!user) {
        throw new NotFoundError('User not found', { userId });
      }

      return user;
    } catch (error) {
      this.handleError(error);
    }
  }

  async createUser(input: CreateUserInput) {
    try {
      const [user] = await this.db.transaction(async (tx) => {
        return await tx.insert(schema.users).values(input).returning();
      });
      return user;
    } catch (error) {
      this.handleError(error);
    }
  }
}
```

---

## Error Classes & Status Codes

### NotFoundError (404)

**HTTP Status**: 404 Not Found

**When to throw**: Database query finds no matching resource

**Context includes**: Resource identifiers and query parameters

**Example:**

```typescript
const user = await this.db.query.users.findFirst({
  where: eq(schema.users.id, userId),
});

if (!user) {
  throw new NotFoundError('User not found', { userId });
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

### ValidationError (400)

**HTTP Status**: 400 Bad Request

**When to throw**: Input validation fails (usually from Zod schema)

**Context includes**: Field name and validation reason

**Example:**

```typescript
if (!isValidEmail(email)) {
  throw new ValidationError('Invalid email format', { email });
}
```

**Note**: Most validation errors come from Zod schemas, automatically handled by `mapErrorToResponse()`

**HTTP Response:**

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

### ForbiddenError (403)

**HTTP Status**: 403 Forbidden

**When to throw**: User is authenticated but lacks permission for the action

**Context includes**: Resource and permission details for security logs

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

### ConflictError (409)

**HTTP Status**: 409 Conflict

**When to throw**: Operation conflicts with existing state (e.g., duplicate unique constraint)

**Context includes**: The conflicting field and existing resource ID

**Example:**

```typescript
export class OrganizationService extends BaseService {
  async createOrganization(input: CreateOrgInput) {
    try {
      return await this.db.insert(schema.organizations)
        .values(input)
        .returning();
    } catch (error) {
      if (error instanceof Error && error.message.includes('unique constraint')) {
        throw new ConflictError(
          'Organization slug already exists',
          { slug: input.slug }
        );
      }
      this.handleError(error);
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

### BusinessLogicError (422)

**HTTP Status**: 422 Unprocessable Entity

**When to throw**: Request is valid but violates domain constraints or business rules

**Context includes**: State information explaining why operation cannot proceed

**Example:**

```typescript
export class ContentService extends BaseService {
  async publishContent(contentId: string) {
    const content = await this.getContentById(contentId);

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

    const unreadyMedia = content.mediaItems.filter(m => !m.isReady);
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

### InternalServiceError (500)

**HTTP Status**: 500 Internal Server Error

**When to throw**: Unexpected errors occur (database connection failure, missing config, etc.)

**Context includes**: Operation name and service context for backend logging only

**Important**: Never expose internal error details to clients. Context is for backend logging only.

**Example:**

```typescript
export class DatabaseService extends BaseService {
  async query(sql: string) {
    try {
      return await this.db.execute(sql);
    } catch (error) {
      // Don't expose database error details to client
      throw new InternalServiceError(
        'An unexpected error occurred',
        {
          service: 'DatabaseService',
          operation: 'query',
          environment: this.environment,
        }
      );
    }
  }
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

---

## Usage Examples

### Basic Pattern: Query Returns Empty Result

```typescript
import { NotFoundError, BaseService, type ServiceConfig } from '@codex/service-errors';
import { eq } from 'drizzle-orm';

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

### Pattern: Ownership Check

```typescript
import { ForbiddenError, BaseService, type ServiceConfig } from '@codex/service-errors';

export class ContentService extends BaseService {
  async updateContent(contentId: string, userId: string, updates: any) {
    const content = await this.getContentById(contentId);

    if (content.creatorId !== userId) {
      throw new ForbiddenError(
        'You do not own this content',
        { contentId, userId }
      );
    }

    return await this.db.update(schema.content)
      .set(updates)
      .where(eq(schema.content.id, contentId))
      .returning();
  }
}
```

### Pattern: Unique Constraint Violation

```typescript
import { ConflictError, wrapError, BaseService } from '@codex/service-errors';

export class OrganizationService extends BaseService {
  async createOrganization(input: CreateOrgInput) {
    try {
      return await this.db.insert(schema.organizations)
        .values(input)
        .returning();
    } catch (error) {
      // wrapError detects unique constraint violations
      throw wrapError(error, { table: 'organizations' });
    }
  }
}
```

### Pattern: Business Rule Validation

```typescript
import { BusinessLogicError, BaseService } from '@codex/service-errors';

export class PaymentService extends BaseService {
  async processPayment(orderId: string, amount: number) {
    const account = await this.getAccount(orderId);

    if (account.balance < amount) {
      throw new BusinessLogicError(
        'Insufficient account balance',
        {
          orderId,
          required: amount,
          available: account.balance,
          shortfall: amount - account.balance,
        }
      );
    }

    return await this.debitAccount(orderId, amount);
  }
}
```

### Pattern: Transaction Safety

```typescript
import { BaseService } from '@codex/service-errors';

export class TransferService extends BaseService {
  async transferItem(itemId: string, fromUserId: string, toUserId: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const item = await tx.query.items.findFirst({
          where: eq(schema.items.id, itemId),
        });

        if (item.ownerId !== fromUserId) {
          throw new ForbiddenError('Cannot transfer item you do not own');
        }

        await tx.update(schema.items)
          .set({ ownerId: toUserId })
          .where(eq(schema.items.id, itemId));

        await tx.insert(schema.auditLog).values({
          itemId,
          action: 'transfer',
          fromUserId,
          toUserId,
        });

        return item;
      });
    } catch (error) {
      this.handleError(error);
    }
  }
}
```

### Pattern: Scoped Access Control

```typescript
import { NotFoundError, ForbiddenError, BaseService } from '@codex/service-errors';
import { and, eq } from 'drizzle-orm';

export class ItemService extends BaseService {
  async deleteItem(itemId: string, userId: string, orgId: string) {
    // Query with org scope (prevents leaking org structure)
    const item = await this.db.query.items.findFirst({
      where: and(
        eq(schema.items.id, itemId),
        eq(schema.items.organizationId, orgId)
      ),
    });

    if (!item) {
      throw new NotFoundError('Item not found', { itemId });
    }

    if (item.creatorId !== userId && !await this.isOrgAdmin(userId, orgId)) {
      throw new ForbiddenError('Cannot delete this item');
    }

    await this.db.delete(schema.items)
      .where(eq(schema.items.id, itemId));
  }
}
```

---

## Integration Points

### Packages That Depend on @codex/service-errors

| Package | Usage |
|---------|-------|
| @codex/content | Extends BaseService, defines domain-specific errors |
| @codex/identity | Extends BaseService, defines organization-specific errors |
| @codex/access | Extends BaseService, defines access control errors |
| @codex/purchase | Extends BaseService, defines payment-specific errors |
| @codex/worker-utils | Uses mapErrorToResponse in route handlers |
| All worker packages | Use mapErrorToResponse to convert service errors |

### Dependency Graph

```
@codex/service-errors
├─ @codex/database (dependency)
└─ zod (dependency, for ZodError handling)

Packages depending on @codex/service-errors:
├─ @codex/content
├─ @codex/identity
├─ @codex/access
├─ @codex/purchase
├─ @codex/worker-utils
├─ All service packages
└─ All worker packages
```

### How Services Use This Package

1. **Service Definition** - Service class extends BaseService
2. **Error Throwing** - Service methods throw specific error classes
3. **Error Context** - Rich context included for debugging
4. **Error Handling** - handleError() method wraps unknown database errors

```typescript
// packages/content/src/services/content-service.ts
import { BaseService, NotFoundError } from '@codex/service-errors';

export class ContentService extends BaseService {
  async getContent(id: string) {
    const content = await this.db.query.content.findFirst({
      where: eq(schema.content.id, id),
    });

    if (!content) {
      throw new NotFoundError('Content not found', { id });
    }

    return content;
  }
}
```

### How Workers Use This Package

1. **Error Mapping** - Worker routes import mapErrorToResponse
2. **Error Conversion** - Exceptions converted to HTTP responses
3. **Consistent Format** - All API errors follow standard structure

```typescript
// workers/content-api/src/routes/content.ts
import { mapErrorToResponse } from '@codex/service-errors';

app.get('/:id', handler(async (c) => {
  try {
    const content = await service.getContent(c.req.param('id'));
    return c.json(content);
  } catch (error) {
    const { statusCode, response } = mapErrorToResponse(error);
    return c.json(response, statusCode);
  }
}));
```

---

## Error Response Format

All errors are transformed to a standardized JSON format for API responses.

### Response Structure

```typescript
interface ErrorResponse {
  error: {
    code: string;          // Machine-readable error code
    message: string;       // Human-readable description
    details?: unknown;     // Optional context/metadata
  };
}
```

### HTTP Status Code Mapping

| Error Class | HTTP Status | Meaning | Client Action |
|------------|-------------|---------|----------------|
| NotFoundError | 404 | Resource doesn't exist | Verify ID or redirect |
| ValidationError | 400 | Invalid input | Show validation messages |
| ForbiddenError | 403 | Lacks permission | Show access denied |
| ConflictError | 409 | State conflict | Suggest alternative |
| BusinessLogicError | 422 | Rule violated | Show constraint message |
| InternalServiceError | 500 | Unexpected error | Retry or contact support |

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

**400 Validation Error:**
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
    "details": { "resource": "content-456" }
  }
}
```

**409 Conflict:**
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A resource with this identifier already exists",
    "details": { "slug": "my-organization" }
  }
}
```

**422 Business Logic Error:**
```json
{
  "error": {
    "code": "BUSINESS_LOGIC_ERROR",
    "message": "Cannot publish content without media",
    "details": { "mediaCount": 0, "requiredCount": 1 }
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

## Error Handling Patterns

### Pattern 1: Service Method with Proper Error Handling

```typescript
async getItem(itemId: string) {
  try {
    const item = await this.db.query.items.findFirst({
      where: eq(schema.items.id, itemId),
    });

    if (!item) {
      throw new NotFoundError('Item not found', { itemId });
    }

    return item;
  } catch (error) {
    this.handleError(error);
  }
}
```

**Flow**: Try query → Check result → Throw specific error OR handle unknown error

### Pattern 2: Catch Database Constraint Violations

```typescript
async createItem(input: CreateItemInput) {
  try {
    const [item] = await this.db.insert(schema.items)
      .values(input)
      .returning();
    return item;
  } catch (error) {
    // wrapError automatically detects unique constraint violations
    throw wrapError(error, { table: 'items', input });
  }
}
```

**Flow**: Try insert → Catch error → Let wrapError detect constraint type → Throw appropriate error

### Pattern 3: Multiple Permission Checks

```typescript
async updateItem(itemId: string, userId: string, orgId: string, data: any) {
  const item = await this.getItem(itemId); // May throw NotFoundError

  // Check ownership
  if (item.ownerId !== userId) {
    throw new ForbiddenError('Cannot update item you do not own');
  }

  // Check org membership
  const isMember = await this.isOrgMember(userId, orgId);
  if (!isMember) {
    throw new ForbiddenError('You are not a member of this organization');
  }

  return await this.db.update(schema.items)
    .set(data)
    .where(eq(schema.items.id, itemId))
    .returning();
}
```

**Flow**: Validate prerequisites → Multiple permission checks → Perform operation OR throw ForbiddenError

### Pattern 4: State Machine Validation

```typescript
async publishItem(itemId: string) {
  const item = await this.getItem(itemId);

  // Check current state
  if (item.status !== 'draft') {
    throw new BusinessLogicError(
      'Only draft items can be published',
      { itemId, currentStatus: item.status }
    );
  }

  // Check required fields
  const missing = this.getMissingRequiredFields(item);
  if (missing.length > 0) {
    throw new BusinessLogicError(
      'Cannot publish item missing required fields',
      { itemId, missingFields: missing }
    );
  }

  // Perform state transition
  return await this.db.update(schema.items)
    .set({ status: 'published' })
    .where(eq(schema.items.id, itemId))
    .returning();
}
```

**Flow**: Get item → Validate state → Validate prerequisites → Transition state OR throw BusinessLogicError

### Pattern 5: Scoped Multi-Tenant Query

```typescript
async getOrganizationItems(userId: string, orgId: string) {
  // First: Verify user is org member
  const isMember = await this.isOrgMember(userId, orgId);
  if (!isMember) {
    throw new ForbiddenError('You are not a member of this organization');
  }

  // Then: Query with org scope
  return await this.db.query.items.findMany({
    where: eq(schema.items.organizationId, orgId),
  });
}
```

**Flow**: Verify access → Query with scope → Return results

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

**Handles:**
- ServiceError instances (custom errors with built-in status codes)
- ZodError instances (validation errors from schemas)
- Unknown errors (wrapped safely as 500 internal errors)

**Options:**

```typescript
interface ErrorMapperOptions {
  /**
   * Whether to include stack trace in response (development only)
   * @default false
   */
  includeStack?: boolean;

  /**
   * Whether to log internal errors to console
   * @default true
   */
  logError?: boolean;
}
```

**Returns:**

```typescript
interface MappedError {
  statusCode: ErrorStatusCode;  // HTTP status code
  response: ErrorResponse;      // Response body
}
```

**Example:**

```typescript
try {
  await service.create(input);
} catch (error) {
  const { statusCode, response } = mapErrorToResponse(error, {
    includeStack: process.env.NODE_ENV === 'development',
    logError: true,
  });
  return c.json(response, statusCode);
}
```

### isServiceError(error)

Type guard to check if error is a ServiceError instance.

**Signature:**

```typescript
function isServiceError(error: unknown): error is ServiceError
```

**Returns**: true if error is ServiceError or subclass, false otherwise

**Example:**

```typescript
try {
  await service.operation();
} catch (error) {
  if (isServiceError(error)) {
    // Type-safe: error is ServiceError
    console.log(`Service error: ${error.code}`);
  } else {
    // Unknown error
    console.error('Unexpected error:', error);
  }
}
```

### wrapError(error, context?)

Converts unknown errors to ServiceError instances safely.

**Signature:**

```typescript
function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ServiceError
```

**Behavior:**
- If error is already ServiceError: returns unchanged
- If error matches database unique constraint: returns ConflictError
- Otherwise: returns InternalServiceError (safe for client)

**Returns**: ServiceError instance (never throws)

**Example:**

```typescript
try {
  await db.insert(schema.users).values(input);
} catch (error) {
  // Detects unique constraint and returns ConflictError
  // Otherwise returns InternalServiceError with safe message
  throw wrapError(error, { operation: 'create user' });
}
```

### isKnownError(error)

Type guard to check if error is ServiceError or ZodError.

**Signature:**

```typescript
function isKnownError(error: unknown): boolean
```

**Returns**: true if error is a known application error type

**Example:**

```typescript
try {
  await operation();
} catch (error) {
  if (isKnownError(error)) {
    // Safe to send to client
    const { statusCode, response } = mapErrorToResponse(error);
    return c.json(response, statusCode);
  } else {
    // Unknown error - log and return generic message
    console.error('Unexpected error:', error);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } },
      500
    );
  }
}
```

---

## Type System

### ErrorStatusCode

Union type of valid HTTP error status codes for this package.

```typescript
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 500
```

**Values:**
- 400 - ValidationError
- 401 - (Reserved for auth middleware)
- 403 - ForbiddenError
- 404 - NotFoundError
- 409 - ConflictError
- 422 - BusinessLogicError
- 500 - InternalServiceError

### ServiceConfig

Configuration object required by all services.

```typescript
interface ServiceConfig {
  db: typeof dbHttp | typeof dbWs;  // Database connection
  environment: string;               // Runtime environment
}
```

**Usage in services:**

```typescript
const service = new ContentService({
  db: dbHttp,
  environment: 'production',
});
```

### ErrorResponse

Standard error response structure for all errors.

```typescript
interface ErrorResponse {
  error: {
    code: string;        // Machine-readable code
    message: string;     // Human-readable message
    details?: unknown;   // Optional context
  };
}
```

### MappedError

Result of error mapping operation.

```typescript
interface MappedError {
  statusCode: ErrorStatusCode;
  response: ErrorResponse;
}
```

---

## Performance Notes

### Error Creation Overhead

- Error creation is lightweight (only properties assigned, no computation)
- Stack trace capture is conditional on V8 runtime (Node.js, Cloudflare Workers)
- Context object is reference-stored (not deep-cloned)

### Error Mapping Performance

- Error mapping is O(1) for ServiceError instances (just property access)
- ZodError mapping is O(n) where n = number of validation failures
- Unknown error handling includes console.error() which can be disabled via options

### Recommendation

Don't throw errors in tight loops. Create errors only when exceptional conditions occur.

### Best Practices

1. **Throw early** - Validate and throw errors as soon as conditions are detected
2. **Context is cheap** - Include rich context for debugging without performance penalty
3. **Catch specific errors** - Use error.code to check error types in catch blocks
4. **Wrap once** - Use wrapError() or handleError() once per error, not multiple times

---

## Testing

### Running Tests

```bash
# Run tests
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
});
```

### Testing Error Mapping

```typescript
import { mapErrorToResponse } from '@codex/service-errors';

describe('Error Mapping', () => {
  it('should map NotFoundError to 404', () => {
    const error = new NotFoundError('Not found');
    const { statusCode, response } = mapErrorToResponse(error);

    expect(statusCode).toBe(404);
    expect(response.error.code).toBe('NOT_FOUND');
  });

  it('should map ZodError to 422', () => {
    const schema = z.object({ email: z.string().email() });
    try {
      schema.parse({ email: 'invalid' });
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);

      expect(statusCode).toBe(422);
      expect(response.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should wrap unknown errors safely', () => {
    const error = new Error('Database connection failed');
    const { statusCode, response } = mapErrorToResponse(error);

    expect(statusCode).toBe(500);
    expect(response.error.code).toBe('INTERNAL_ERROR');
    // Message should NOT expose database details
    expect(response.error.message).not.toContain('Database');
  });
});
```

### Testing Service Implementation

```typescript
import { BaseService, NotFoundError } from '@codex/service-errors';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService({
      db: dbWs,
      environment: 'test',
    });
  });

  it('should create user with valid input', async () => {
    const input = { email: 'user@example.com', name: 'Test' };
    const user = await service.createUser(input);

    expect(user.id).toBeDefined();
    expect(user.email).toBe('user@example.com');
  });

  it('should throw NotFoundError for missing user', async () => {
    await expect(
      service.getUserById('nonexistent')
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw ConflictError for duplicate email', async () => {
    const input = { email: 'user@example.com' };
    await service.createUser(input);

    await expect(
      service.createUser(input)
    ).rejects.toThrow(ConflictError);
  });
});
```

### Test Utilities

The package includes comprehensive test utilities in `__tests__/base-errors.test.ts` covering:
- Error instantiation and properties
- Error inheritance chains
- Type guards (isServiceError, isKnownError)
- Error wrapping (wrapError)
- Error serialization
- Error mapping (mapErrorToResponse)
- Stack trace capture

### Key Test Patterns

1. **Test error throwing** - Verify errors are thrown in correct conditions
2. **Test error properties** - Verify code, message, statusCode, context
3. **Test inheritance** - Verify instanceof checks work correctly
4. **Test mapping** - Verify errors map to correct HTTP status/response
5. **Test wrapping** - Verify unknown errors are safely wrapped
6. **Test type guards** - Verify type guard functions work correctly

---

## Creating Domain-Specific Errors

Domain packages create their own error classes by extending base errors:

### In Domain Package (e.g., @codex/content)

```typescript
// packages/content/src/errors.ts
import { NotFoundError, ConflictError } from '@codex/service-errors';

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

export class SlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Content slug already exists', { slug });
  }
}
```

### In Service

```typescript
import { ContentNotFoundError } from './errors';

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
}
```

### In Worker Route

```typescript
try {
  const content = await service.getContent(id);
  return c.json(content);
} catch (error) {
  // ContentNotFoundError is automatically handled
  const { statusCode, response } = mapErrorToResponse(error);
  return c.json(response, statusCode);
}
```

---

## Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| @codex/database | Database client types | workspace |
| zod | Schema validation (ZodError handling) | ^3.24.1 |
| typescript | Type system | ^5.7.3 |

### No Production Dependencies

The package has zero production dependencies other than zod (for type guards). All other dependencies are dev dependencies for building and testing.

---

## Related Documentation

- [Database Package](../database/CLAUDE.md) - Database operations and transactions
- [Worker Utils](../worker-utils/CLAUDE.md) - Route handlers using mapErrorToResponse
- [Validation Package](../validation/CLAUDE.md) - Schema validation and ZodError handling
- [Content Package](../content/CLAUDE.md) - Example service implementation
- [Identity Package](../identity/CLAUDE.md) - Example service implementation

---

## Key Design Principles

1. **Consistency** - Every service and worker follows the same error patterns
2. **Type Safety** - Error types prevent passing wrong status codes
3. **Security** - Internal errors never expose implementation details to clients
4. **Debuggability** - Error context includes business metadata for troubleshooting
5. **Simplicity** - Minimal boilerplate, maximum clarity
6. **Inheritance** - Custom errors extend base errors, not creating new classes
7. **V8 Runtime** - Stack trace capture works in Node.js and Cloudflare Workers

---

**Last Updated**: 2025-12-14
**Version**: 1.0.0
**Status**: Complete
