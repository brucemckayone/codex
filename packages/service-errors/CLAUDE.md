# @codex/service-errors

Shared error classes and utilities for service layers. Provides consistent error handling and HTTP status mapping across all Codex services.

This package is a **foundation package** that all service packages depend on. It defines the error handling strategy for the entire platform, ensuring consistent behavior across services, workers, and client responses.

## Table of Contents

- [Overview](#overview)
- [Public API](#public-api)
- [Error Class Hierarchy](#error-class-hierarchy)
- [BaseService Class](#baseservice-class)
- [Custom Error Classes](#custom-error-classes)
- [HTTP Status Mapping](#http-status-mapping)
- [Usage Examples](#usage-examples)
- [Integration Points](#integration-points)
- [Error Response Format](#error-response-format)
- [Error Handling Patterns](#error-handling-patterns)
- [Development & Testing](#development--testing)

## Overview

### What This Package Does

@codex/service-errors provides a standardized error handling framework that enables:
- **Consistent error structure** across all services with code, message, status code, and context
- **Type-safe error handling** through custom error classes for each error scenario
- **HTTP status code mapping** that automatically converts service errors to appropriate HTTP responses
- **Base service class** that all domain services extend for unified error handling
- **Error wrapping utilities** that prevent internal implementation details from leaking to clients

### Business Responsibility

This package implements the error handling layer that sits between application logic and HTTP responses. Services throw domain-specific or base errors, workers catch them and map to standardized HTTP responses, and clients receive well-formed error objects with actionable information.

### Why It Exists

- **Consistency**: Every service, worker, and API client follows the same error handling patterns
- **Security**: Prevents accidental exposure of database errors, stack traces, and internal details
- **Debuggability**: Error context includes relevant business metadata for troubleshooting
- **Developer experience**: Removes boilerplate error handling code from every service

### Key Concepts

**ServiceError**: All custom errors extend this abstract base class. Each error has:
- `message`: Human-readable description of what went wrong
- `code`: Machine-readable error identifier (e.g., `NOT_FOUND`, `VALIDATION_ERROR`)
- `statusCode`: The HTTP status code this error maps to (400, 401, 403, 404, 409, 422, 500)
- `context`: Optional metadata for debugging (field names, resource IDs, constraint details)

**BaseService**: Abstract base class that all domain services extend. Provides:
- Unified constructor requiring database connection and environment
- Error handling method that wraps unknown errors
- Direct access to protected database instance

**ErrorMapper**: Converts all error types to standardized HTTP response format. Handles:
- ServiceError instances (custom errors with status codes)
- ZodError instances (validation schema failures)
- Unknown errors (wrapped as 500 internal errors)

## Public API

### Error Classes

| Export | Type | Purpose | When to Use |
|--------|------|---------|------------|
| `ServiceError` | Abstract class | Base class for all service errors | Extend to create custom errors |
| `NotFoundError` | Class | 404 - Resource not found | Query returns no results |
| `ValidationError` | Class | 400 - Input validation failed | Schema validation fails |
| `ForbiddenError` | Class | 403 - Access denied | User lacks permission |
| `ConflictError` | Class | 409 - Resource conflict | Duplicate key, slug exists |
| `BusinessLogicError` | Class | 422 - Business rule violated | Domain constraint failure |
| `InternalServiceError` | Class | 500 - Unexpected error | Wrap unknown database errors |

### Utilities & Type Guards

| Export | Type | Purpose |
|--------|------|---------|
| `isServiceError(error)` | Function | Type guard to check if error is a ServiceError |
| `wrapError(error, context)` | Function | Convert unknown errors to ServiceError instances |
| `mapErrorToResponse(error, options)` | Function | Convert any error to standardized HTTP response |
| `isKnownError(error)` | Function | Check if error is ServiceError or ZodError |

### Types

| Export | Purpose |
|--------|---------|
| `ErrorStatusCode` | Type union of valid error HTTP status codes: 400, 401, 403, 404, 409, 422, 500 |
| `ServiceConfig` | Configuration object for BaseService (db, environment) |
| `ErrorResponse` | Standard HTTP error response structure |
| `MappedError` | Result of error mapping (statusCode + ErrorResponse) |
| `ErrorMapperOptions` | Configuration for mapErrorToResponse (includeStack, logError) |

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

All errors in this hierarchy:
- Extend `ServiceError` (except ServiceError itself)
- Have `instanceof` checks working correctly through the chain
- Provide a `name` property matching the class name
- Capture stack traces when thrown
- Support optional context metadata

### Extending ServiceError

Domain-specific services create their own error classes by extending base errors:

```typescript
// Content service errors extend base errors
export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

// Organization service errors extend base errors
export class OrganizationAlreadyExistsError extends ConflictError {
  constructor(slug: string) {
    super('Organization already exists', { slug });
  }
}
```

## BaseService Class

The `BaseService` abstract class is the foundation for all domain services. Every service in the Codex platform extends this class.

### Constructor Signature

```typescript
export abstract class BaseService {
  constructor(config: ServiceConfig): void
}
```

### Constructor Parameters

**config: ServiceConfig**
- `db` (Database): Database connection instance for running queries
- `environment` (string): Runtime environment name (development, staging, production, test)

### Protected Properties

```typescript
protected readonly db: Database
protected readonly environment: string
```

Both properties are accessible to subclasses for database operations and environment-aware behavior.

### Protected Methods

#### handleError(error: unknown, context?: string): never

Handles unknown errors by wrapping them with service context. This method:
- Re-throws ServiceError instances unchanged
- Wraps unknown errors as InternalServiceError with service metadata
- Never returns (always throws)

**Parameters:**
- `error` (unknown): The error to handle
- `context` (string): Optional context description

**Always throws**: A ServiceError instance (either the original or a wrapper)

**Example:**
```typescript
export class ContentService extends BaseService {
  async publishContent(contentId: string) {
    try {
      const result = await this.db.update(content)
        .set({ status: 'published' })
        .where(eq(content.id, contentId))
        .returning();
      return result[0];
    } catch (error) {
      // Wraps unknown database errors with service context
      this.handleError(error, 'publish operation');
    }
  }
}
```

### Service Implementation Example

```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { content } from '@codex/database/schema';

export class ContentService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getContentById(contentId: string) {
    try {
      const result = await this.db.query.content.findFirst({
        where: eq(content.id, contentId),
      });

      if (!result) {
        throw new NotFoundError('Content not found', { contentId });
      }

      return result;
    } catch (error) {
      this.handleError(error);
    }
  }

  async createContent(input: CreateContentInput) {
    try {
      return await this.db.transaction(async (tx) => {
        const [result] = await tx.insert(content).values(input).returning();
        return result;
      });
    } catch (error) {
      this.handleError(error);
    }
  }
}
```

## Custom Error Classes

This section documents each error class with its HTTP status code, when it's thrown, what context to include, and usage patterns.

### NotFoundError (404)

**HTTP Status**: 404 Not Found

**Thrown When**: A database query finds no matching resource

**Context**: Should include resource identifiers and query parameters

**Example:**
```typescript
const user = await db.query.users.findFirst({
  where: eq(users.id, userId),
});

if (!user) {
  throw new NotFoundError('User not found', { userId });
}
```

**HTTP Response**:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "123" }
  }
}
```

### ValidationError (400)

**HTTP Status**: 400 Bad Request

**Thrown When**: Input validation fails (usually from Zod schema validation)

**Context**: Should describe which field failed and why

**Example:**
```typescript
const schema = z.object({
  email: z.string().email(),
  age: z.number().min(18),
});

try {
  const data = schema.parse(input);
} catch (error) {
  if (error instanceof ZodError) {
    // mapErrorToResponse automatically handles ZodError
    throw error;
  }
}

// Or manually for custom validation:
if (!isValidEmail(email)) {
  throw new ValidationError('Invalid email format', { field: 'email' });
}
```

**HTTP Response**:
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

**Thrown When**: User is authenticated but lacks permission for the action

**Context**: Include resource and permission details for security logs

**Example:**
```typescript
export class ContentService extends BaseService {
  async deleteContent(contentId: string, userId: string) {
    const content = await this.db.query.content.findFirst({
      where: eq(content.id, contentId),
    });

    if (content.creatorId !== userId) {
      throw new ForbiddenError(
        'You do not own this content',
        { contentId, userId, ownerId: content.creatorId }
      );
    }

    return await this.db.delete(content).where(eq(content.id, contentId));
  }
}
```

**HTTP Response**:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not own this content",
    "details": {
      "contentId": "abc-123",
      "userId": "user-456",
      "ownerId": "user-789"
    }
  }
}
```

### ConflictError (409)

**HTTP Status**: 409 Conflict

**Thrown When**: Operation conflicts with existing state (e.g., duplicate unique constraint)

**Context**: Include the conflicting field and existing resource ID

**Example:**
```typescript
export class OrganizationService extends BaseService {
  async createOrganization(input: CreateOrgInput) {
    try {
      return await this.db.insert(organizations).values(input).returning();
    } catch (error) {
      // Database unique constraint violation on slug column
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

**HTTP Response**:
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

**Thrown When**: Request is valid but violates business rules or domain constraints

**Context**: Include state information explaining why the operation cannot proceed

**Example:**
```typescript
export class ContentService extends BaseService {
  async publishContent(contentId: string) {
    const content = await this.getContent(contentId);

    // Content must have at least one media item
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

    // All media must be ready (processed)
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

    return await this.db.update(content)
      .set({ status: 'published' })
      .where(eq(content.id, contentId))
      .returning();
  }
}
```

**HTTP Response**:
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

**Thrown When**: Unexpected errors occur (database connection failure, missing config, etc.)

**Context**: Should include operation name and service context for debugging

**Important**: Never expose internal error details to clients. Error context is for backend logging only.

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

**HTTP Response**:
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

## HTTP Status Mapping

This table shows which errors map to which HTTP status codes:

| Error Class | HTTP Status | Use Case | Client Action |
|------------|-------------|----------|----------------|
| NotFoundError | 404 | Resource doesn't exist | Verify resource ID, redirect to list |
| ValidationError | 400 | Invalid input data | Show validation messages, fix form |
| ForbiddenError | 403 | User lacks permission | Show access denied message |
| ConflictError | 409 | State conflict (duplicate) | Suggest alternative, show existing |
| BusinessLogicError | 422 | Violates business rules | Show constraint message, suggest fix |
| InternalServiceError | 500 | Unexpected error | Retry or contact support |

**Note on 401 Unauthorized**: This status is not directly used by service errors. It's handled at the worker/middleware level for missing or invalid authentication tokens.

## Usage Examples

### Basic Error Throwing Pattern

```typescript
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  BusinessLogicError,
  BaseService,
  type ServiceConfig,
} from '@codex/service-errors';

export class UserService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getUser(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new NotFoundError('User not found', { userId });
    }

    return user;
  }

  async validateEmail(email: string) {
    if (!email.includes('@')) {
      throw new ValidationError('Invalid email format', { email });
    }
  }

  async updateProfile(userId: string, updatedBy: string, data: any) {
    // Check ownership
    if (userId !== updatedBy) {
      throw new ForbiddenError(
        'Cannot update another user profile',
        { userId, updatedBy }
      );
    }

    // Check business rules
    if (data.age < 18) {
      throw new BusinessLogicError(
        'User must be 18 or older',
        { age: data.age }
      );
    }

    return await this.db.update(users)
      .set(data)
      .where(eq(users.id, userId))
      .returning();
  }
}
```

### Error Handling in Worker Routes

```typescript
import { mapErrorToResponse } from '@codex/service-errors';
import { createAuthenticatedHandler } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono();

app.post('/users', createAuthenticatedHandler({
  schema: { body: createUserSchema },
  async handler(c, { validated }) {
    try {
      const userService = new UserService({
        db: c.env.DB,
        environment: c.env.ENVIRONMENT,
      });

      const newUser = await userService.createUser(validated);
      return c.json(newUser, 201);
    } catch (error) {
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(response, statusCode);
    }
  },
}));
```

### Type-Safe Error Checking

```typescript
import { isServiceError, isKnownError } from '@codex/service-errors';

async function handleOperation() {
  try {
    await service.performOperation();
  } catch (error) {
    // Check if it's a known application error
    if (isKnownError(error)) {
      // Safe to return to client
      return mapErrorToResponse(error);
    }

    // Unknown error - log it
    console.error('Unexpected error:', error);
    return { statusCode: 500, response: { error: { code: 'INTERNAL_ERROR' } } };
  }
}
```

### Error Context for Debugging

```typescript
// Service throws error with rich context
throw new BusinessLogicError(
  'Cannot process payment',
  {
    orderId: 'order-123',
    amount: 99.99,
    currency: 'USD',
    reason: 'account_balance_insufficient',
    accountBalance: 50.00,
    required: 99.99,
  }
);

// Error is caught and mapped
const { statusCode, response } = mapErrorToResponse(error);

// Response includes all context for debugging:
// {
//   statusCode: 422,
//   response: {
//     error: {
//       code: 'BUSINESS_LOGIC_ERROR',
//       message: 'Cannot process payment',
//       details: {
//         orderId: 'order-123',
//         amount: 99.99,
//         reason: 'account_balance_insufficient',
//         accountBalance: 50.00,
//         required: 99.99,
//       }
//     }
//   }
// }
```

### Wrapping Unknown Errors

```typescript
import { wrapError } from '@codex/service-errors';

async function riskyOperation() {
  try {
    // Call external API or database
    const result = await externalDatabase.query('SELECT * FROM users');
    return result;
  } catch (error) {
    // Converts any error to ServiceError
    // - If already ServiceError: returns unchanged
    // - If matches known patterns (unique constraint): specific error
    // - Otherwise: wraps as InternalServiceError (safe for client)
    throw wrapError(error, {
      operation: 'fetch users',
      endpoint: 'external-database',
    });
  }
}
```

## Integration Points

### Packages That Depend on @codex/service-errors

| Package | Purpose | Usage |
|---------|---------|-------|
| @codex/content | Content management service | Extends BaseService, defines ContentNotFoundError, etc. |
| @codex/identity | Organization/user service | Extends BaseService, defines OrganizationAlreadyExistsError, etc. |
| @codex/access | Content access control | Extends BaseService, defines AccessDeniedError, etc. |
| @codex/worker-utils | Worker route helpers | Uses mapErrorToResponse in route handlers |
| @codex/validation | Input validation | Uses ValidationError for schema failures |

### Dependency Tree

```
@codex/service-errors
├── @codex/database (dependency)
│   └── drizzle-orm (ORM library)
└── zod (dependency, for ZodError handling)

Packages that depend on @codex/service-errors:
├── @codex/content
├── @codex/identity
├── @codex/access
├── @codex/worker-utils
├── All service packages
└── All worker packages
```

### How Services Use This Package

1. **Service Definition**: Service class extends `BaseService` from @codex/service-errors
2. **Error Throwing**: Service methods throw specific error classes
3. **Error Context**: Rich context included for debugging
4. **Error Handling**: `handleError()` method wraps unknown database errors

```typescript
// packages/content/src/services/content-service.ts
import { BaseService } from '@codex/service-errors';

export class ContentService extends BaseService {
  async getContent(id: string) {
    const content = await this.db.query.content.findFirst(...);
    if (!content) {
      throw new NotFoundError('Content not found', { id });
    }
    return content;
  }
}
```

### How Workers Use This Package

1. **Error Mapping**: Worker routes import `mapErrorToResponse`
2. **Error Conversion**: Exceptions are converted to HTTP responses
3. **Consistent Format**: All API errors follow the same structure

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

## Error Response Format

All errors are transformed to a standardized JSON format for API responses.

### Response Structure

```typescript
interface ErrorResponse {
  error: {
    code: string;          // Machine-readable error code (e.g., "NOT_FOUND")
    message: string;       // Human-readable description
    details?: unknown;     // Optional context/metadata
  };
}
```

### Example Responses

**Not Found (404)**:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found",
    "details": {
      "contentId": "abc-123"
    }
  }
}
```

**Validation Error (400)**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "email",
        "message": "Invalid email"
      },
      {
        "path": "age",
        "message": "Must be at least 18"
      }
    ]
  }
}
```

**Forbidden (403)**:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource",
    "details": {
      "resource": "content-456",
      "requiredRole": "creator"
    }
  }
}
```

**Conflict (409)**:
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A resource with this identifier already exists",
    "details": {
      "slug": "my-organization",
      "existingId": "org-789"
    }
  }
}
```

**Business Logic Error (422)**:
```json
{
  "error": {
    "code": "BUSINESS_LOGIC_ERROR",
    "message": "Cannot publish content without media",
    "details": {
      "contentId": "content-123",
      "mediaCount": 0,
      "reason": "At least one media item required"
    }
  }
}
```

**Internal Error (500)**:
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

### Mapping Errors to Responses

The `mapErrorToResponse()` function converts any error type to this format:

```typescript
import { mapErrorToResponse } from '@codex/service-errors';

// ServiceError instance
const error1 = new NotFoundError('Item not found', { itemId: '123' });
const mapped1 = mapErrorToResponse(error1);
// => { statusCode: 404, response: { error: { ... } } }

// ZodError instance (from validation)
import { z } from 'zod';
const schema = z.object({ email: z.string().email() });
try {
  schema.parse({ email: 'invalid' });
} catch (error) {
  const mapped = mapErrorToResponse(error);
  // => { statusCode: 422, response: { error: { ... } } }
}

// Unknown error (wrapped safely)
try {
  throw new Error('Database connection failed');
} catch (error) {
  const mapped = mapErrorToResponse(error);
  // => { statusCode: 500, response: { error: { code: 'INTERNAL_ERROR', ... } } }
}
```

### MapErrorToResponse Options

The `mapErrorToResponse()` function accepts optional configuration:

```typescript
interface ErrorMapperOptions {
  /**
   * Whether to include stack trace in error response (development only)
   * @default false
   */
  includeStack?: boolean;

  /**
   * Whether to log internal errors to console
   * @default true
   */
  logError?: boolean;
}

// Example: Include stack trace in development
const { statusCode, response } = mapErrorToResponse(error, {
  includeStack: process.env.NODE_ENV === 'development',
  logError: true,
});
```

## Error Handling Patterns

This section documents common error handling patterns used throughout Codex services.

### Pattern 1: Query Returns Empty Result

**Situation**: Database query returns no results

**Pattern**:
```typescript
async getItemById(id: string) {
  const item = await this.db.query.items.findFirst({
    where: eq(items.id, id),
  });

  if (!item) {
    throw new NotFoundError('Item not found', { itemId: id });
  }

  return item;
}
```

### Pattern 2: Input Validation

**Situation**: Input fails schema validation

**Pattern**:
```typescript
async createItem(input: unknown) {
  // Zod automatically throws ZodError on validation failure
  const validated = createItemSchema.parse(input);

  // Continue with validated data
  return await this.db.insert(items).values(validated).returning();
}
```

**Note**: ZodError is automatically handled by `mapErrorToResponse()` and converted to 422 status with validation details.

### Pattern 3: Ownership/Authorization Check

**Situation**: User is authenticated but lacks permission

**Pattern**:
```typescript
async updateItem(itemId: string, userId: string, updates: any) {
  const item = await this.db.query.items.findFirst({
    where: eq(items.id, itemId),
  });

  if (item.ownerId !== userId) {
    throw new ForbiddenError(
      'You do not own this item',
      { itemId, userId, ownerId: item.ownerId }
    );
  }

  return await this.db.update(items)
    .set(updates)
    .where(eq(items.id, itemId))
    .returning();
}
```

### Pattern 4: Unique Constraint Violation

**Situation**: Database operation violates unique constraint

**Pattern**:
```typescript
async createItem(input: CreateItemInput) {
  try {
    return await this.db.insert(items).values(input).returning();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('unique constraint')
    ) {
      throw new ConflictError(
        'Item with this slug already exists',
        { slug: input.slug }
      );
    }
    this.handleError(error, 'create item');
  }
}
```

### Pattern 5: Business Rule Validation

**Situation**: Request is valid but violates domain logic

**Pattern**:
```typescript
async publishItem(itemId: string) {
  const item = await this.getItemById(itemId);

  // Check preconditions
  if (item.status !== 'draft') {
    throw new BusinessLogicError(
      'Only draft items can be published',
      { itemId, currentStatus: item.status }
    );
  }

  if (!item.hasRequiredFields()) {
    throw new BusinessLogicError(
      'Item is missing required fields',
      { itemId, missingFields: item.getMissingFields() }
    );
  }

  // Perform operation
  return await this.db.update(items)
    .set({ status: 'published' })
    .where(eq(items.id, itemId))
    .returning();
}
```

### Pattern 6: Database Error Wrapping

**Situation**: Unknown database error occurs

**Pattern**:
```typescript
async dangerousOperation() {
  try {
    return await this.db.execute(complexQuery());
  } catch (error) {
    // handleError wraps unknown errors as InternalServiceError
    // with service name and environment context
    this.handleError(error, 'dangerous operation');
  }
}
```

### Pattern 7: Transaction Safety

**Situation**: Multi-step operation needs atomic transaction

**Pattern**:
```typescript
async transferItem(itemId: string, fromUserId: string, toUserId: string) {
  try {
    return await this.db.transaction(async (tx) => {
      // All operations in transaction or none
      const item = await tx.query.items.findFirst({
        where: eq(items.id, itemId),
      });

      if (item.ownerId !== fromUserId) {
        throw new ForbiddenError('Cannot transfer item you do not own');
      }

      await tx.update(items)
        .set({ ownerId: toUserId })
        .where(eq(items.id, itemId));

      await tx.insert(auditLog).values({
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
```

### Pattern 8: Scoped Access Control

**Situation**: Query must be scoped to organization/creator

**Pattern**:
```typescript
async getItemsByOrganization(orgId: string) {
  try {
    return await this.db.query.items.findMany({
      where: eq(items.organizationId, orgId),
    });
  } catch (error) {
    this.handleError(error);
  }
}

async deleteItem(itemId: string, userId: string, orgId: string) {
  const item = await this.db.query.items.findFirst({
    where: and(
      eq(items.id, itemId),
      eq(items.organizationId, orgId) // Scoped query
    ),
  });

  if (!item) {
    // Could be 404 or forbidden depending on context
    // If item exists in different org, return 404 to hide org structure
    throw new NotFoundError('Item not found', { itemId });
  }

  if (item.creatorId !== userId && !userIsOrgAdmin(userId, orgId)) {
    throw new ForbiddenError('Cannot delete this item');
  }

  await this.db.delete(items)
    .where(eq(items.id, itemId));
}
```

## Development & Testing

### Running Tests

```bash
# Run all tests
npm run test

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Patterns

**Testing Error Throwing**:
```typescript
import { describe, it, expect } from 'vitest';
import { NotFoundError, ValidationError } from '@codex/service-errors';

describe('UserService', () => {
  it('should throw NotFoundError when user not found', () => {
    const service = new UserService(config);

    expect(() => service.getUser('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('should include context in error', () => {
    const service = new UserService(config);

    try {
      service.getUser('nonexistent');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.context).toEqual({ userId: 'nonexistent' });
    }
  });

  it('should have correct HTTP status code', () => {
    const error = new NotFoundError('Test');
    expect(error.statusCode).toBe(404);
  });
});
```

**Testing Error Mapping**:
```typescript
import { mapErrorToResponse } from '@codex/service-errors';

describe('Error Mapping', () => {
  it('should map NotFoundError to 404 response', () => {
    const error = new NotFoundError('Not found');
    const { statusCode, response } = mapErrorToResponse(error);

    expect(statusCode).toBe(404);
    expect(response.error.code).toBe('NOT_FOUND');
  });

  it('should wrap unknown errors safely', () => {
    const error = new Error('Database connection failed');
    const { statusCode, response } = mapErrorToResponse(error);

    expect(statusCode).toBe(500);
    expect(response.error.code).toBe('INTERNAL_ERROR');
    expect(response.error.message).not.toContain('Database');
  });
});
```

### Building the Package

```bash
# Build for production
npm run build

# Type check
npm run typecheck

# Lint and format
npm run lint
npm run format
```

### Package Structure

```
packages/service-errors/
├── src/
│   ├── index.ts              # Public API exports
│   ├── base-errors.ts        # Error classes and type guards
│   ├── base-service.ts       # BaseService abstract class
│   ├── error-mapper.ts       # Error to HTTP response mapping
│   └── __tests__/
│       └── base-errors.test.ts
├── dist/                      # Compiled output
├── package.json
├── tsconfig.json
└── README.md (this file)
```

### Adding New Error Types

To add a domain-specific error:

1. **Create error class in domain package** (not in service-errors):

```typescript
// packages/content/src/errors.ts
import { NotFoundError } from '@codex/service-errors';

export class MediaNotFoundError extends NotFoundError {
  constructor(mediaId: string) {
    super('Media file not found', { mediaId });
  }
}
```

2. **Use in service**:

```typescript
// packages/content/src/services/media-service.ts
async getMedia(mediaId: string) {
  const media = await this.db.query.media.findFirst({
    where: eq(media.id, mediaId),
  });

  if (!media) {
    throw new MediaNotFoundError(mediaId);
  }

  return media;
}
```

3. **Error is automatically handled by error mapper**:

```typescript
// workers/content-api/src/routes/media.ts
try {
  const media = await service.getMedia(id);
  return c.json(media);
} catch (error) {
  const { statusCode, response } = mapErrorToResponse(error);
  return c.json(response, statusCode);
}
```

### Key Principles

1. **Never expose internal errors**: Always wrap unknown errors with safe messages
2. **Include actionable context**: Error details help developers debug issues
3. **Use specific errors**: NotFoundError, ValidationError, etc. not generic Error
4. **Extend base errors**: Create domain-specific errors by extending NotFoundError, etc.
5. **Scope sensitive data**: Don't include passwords, tokens, or PII in context
6. **Consistent patterns**: All services follow the same error handling approach

## Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| @codex/database | Database access layer | workspace |
| zod | Schema validation library | ^3.24.1 |
| typescript | Type system | ^5.7.3 |

## Related Documentation

- [Database Package](../database/README.md) - Database queries and transactions
- [Worker Utils](../worker-utils/README.md) - Route handler helpers using mapErrorToResponse
- [Validation Package](../validation/README.md) - Schema validation (ZodError handling)
- [Content Package](../content/README.md) - Example service implementation
- [Identity Package](../identity/README.md) - Example service implementation
