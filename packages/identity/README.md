# @codex/identity

Identity and organization management service layer for the Codex platform.

## Overview

`@codex/identity` provides type-safe, production-ready services for managing organizations and identity-related operations in a multi-tenant environment. Built on Drizzle ORM with strict TypeScript typing and comprehensive error handling.

## Installation

This package is part of the Codex monorepo and uses pnpm workspaces:

```bash
pnpm add @codex/identity
```

## Core Features

- **Organization Management** - Full CRUD operations for multi-tenant organizations
- **Type Safety** - Zero `any` types, all types properly inferred from Drizzle ORM
- **Soft Deletes** - Data preservation with `deleted_at` timestamps
- **Transaction Safety** - Multi-step operations wrapped in database transactions
- **Custom Error Classes** - Clear, structured error handling for API responses
- **Pagination & Filtering** - Built-in support for list queries with search and sorting
- **Slug Validation** - Unique slug enforcement with case-insensitive lookups

## Quick Start

```typescript
import { createOrganizationService } from '@codex/identity';
import { dbHttp } from '@codex/database';

// Initialize the service
const service = createOrganizationService({
  db: dbHttp,
  environment: 'production',
});

// Create an organization
const org = await service.create({
  name: 'Acme Corporation',
  slug: 'acme-corp',
  description: 'Leading provider of innovative solutions',
  logoUrl: 'https://example.com/logo.png',
  websiteUrl: 'https://acme-corp.com',
});

console.log(`Created organization: ${org.id}`);
```

## API Documentation

### OrganizationService

The main service for managing organizations.

#### `create(input: CreateOrganizationInput): Promise<Organization>`

Creates a new organization with validated input.

```typescript
const org = await service.create({
  name: 'My Organization',
  slug: 'my-org',           // Required: URL-friendly unique identifier
  description: 'Optional description',
  logoUrl: 'https://example.com/logo.png',
  websiteUrl: 'https://example.com',
});
```

**Throws:**
- `ConflictError` - If slug already exists (unique constraint violation)
- `ValidationError` - If input fails schema validation

#### `get(id: string): Promise<Organization | null>`

Retrieves an organization by ID. Returns `null` if not found or soft-deleted.

```typescript
const org = await service.get('550e8400-e29b-41d4-a716-446655440000');

if (org) {
  console.log(`Found: ${org.name}`);
} else {
  console.log('Organization not found');
}
```

#### `getBySlug(slug: string): Promise<Organization | null>`

Retrieves an organization by its slug. Case-insensitive lookup.

```typescript
const org = await service.getBySlug('acme-corp');
// Also works: await service.getBySlug('ACME-CORP');
```

#### `update(id: string, input: UpdateOrganizationInput): Promise<Organization>`

Updates an organization with partial data. Only provided fields are updated.

```typescript
const updated = await service.update(orgId, {
  name: 'Updated Organization Name',
  description: 'New description',
});
```

**Throws:**
- `OrganizationNotFoundError` - If organization doesn't exist or is deleted
- `ConflictError` - If updating slug to one that already exists

#### `delete(id: string): Promise<void>`

Soft deletes an organization by setting `deleted_at` timestamp.

```typescript
await service.delete(orgId);
// Organization still exists in database but won't appear in queries
```

**Note:** Content belonging to deleted organizations remains but displays as "deleted organization".

**Throws:**
- `OrganizationNotFoundError` - If organization doesn't exist or is already deleted

#### `list(filters?: OrganizationFilters, pagination?: PaginationParams): Promise<PaginatedResponse<Organization>>`

Lists organizations with optional filtering, searching, sorting, and pagination.

```typescript
// Basic listing
const { items, pagination } = await service.list();

// With search
const results = await service.list({
  search: 'acme',              // Searches name and description
});

// With pagination
const page2 = await service.list({}, {
  page: 2,
  limit: 20,
});

// With sorting
const sorted = await service.list({
  sortBy: 'name',              // 'name' | 'createdAt'
  sortOrder: 'asc',            // 'asc' | 'desc'
});

// Combined
const filtered = await service.list(
  {
    search: 'tech',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  {
    page: 1,
    limit: 50,
  }
);

console.log(`Found ${pagination.total} organizations`);
console.log(`Showing page ${pagination.page} of ${pagination.totalPages}`);
```

#### `isSlugAvailable(slug: string): Promise<boolean>`

Checks if a slug is available for use. Useful for frontend validation.

```typescript
const available = await service.isSlugAvailable('new-org');

if (available) {
  console.log('Slug is available!');
} else {
  console.log('Slug is already taken');
}
```

## Type Exports

### Core Types

```typescript
import type {
  Organization,           // Complete organization object
  NewOrganization,       // Organization creation type
  Database,              // Database client type
  ServiceConfig,         // Service initialization config
  PaginationParams,      // Pagination query parameters
  PaginationMetadata,    // Pagination response metadata
  PaginatedResponse,     // Generic paginated response
  OrganizationFilters,   // Organization list filters
  SortOrder,             // 'asc' | 'desc'
} from '@codex/identity';
```

### Validation Types

```typescript
import type {
  CreateOrganizationInput,  // Validated creation input
  UpdateOrganizationInput,  // Validated update input
  OrganizationQueryInput,   // Validated query parameters
} from '@codex/identity';
```

### Error Types

```typescript
import {
  IdentityServiceError,        // Base error class
  OrganizationNotFoundError,   // Organization not found
  NotFoundError,               // Generic not found
  ValidationError,             // Input validation failed
  ConflictError,               // Unique constraint violation
  ForbiddenError,              // Authorization error
  BusinessLogicError,          // Business rule violation
  InternalServiceError,        // Internal error
  isIdentityServiceError,      // Type guard
  wrapError,                   // Error wrapper utility
} from '@codex/identity';
```

## Validation Schemas

The package re-exports Zod schemas for convenience:

```typescript
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationQuerySchema,
} from '@codex/identity';

// Manual validation
const validated = createOrganizationSchema.parse(userInput);
```

## Error Handling

All service methods throw typed errors that can be caught and handled appropriately:

```typescript
import {
  OrganizationNotFoundError,
  ConflictError,
  mapErrorToResponse,
} from '@codex/identity';

try {
  const org = await service.create({ name: 'Test', slug: 'test' });
} catch (error) {
  if (error instanceof ConflictError) {
    console.error('Slug already exists');
  } else if (error instanceof OrganizationNotFoundError) {
    console.error('Organization not found');
  } else {
    console.error('Unexpected error:', error);
  }
}

// For API responses, use the error mapper
const errorResponse = mapErrorToResponse(error);
// Returns: { error: { code: string, message: string, status: number } }
```

## Usage Examples

### Worker Integration

```typescript
import { Hono } from 'hono';
import { createOrganizationService } from '@codex/identity';
import { dbHttp } from '@codex/database';
import { createAuthenticatedHandler } from '@codex/worker-utils';

const app = new Hono();

app.post(
  '/api/organizations',
  createAuthenticatedHandler({
    schema: { body: createOrganizationSchema },
    handler: async (c, ctx) => {
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT,
      });
      return service.create(ctx.validated.body);
    },
    successStatus: 201,
  })
);
```

### Testing

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDatabase, createUniqueSlug } from '@codex/test-utils';
import { createOrganizationService } from '@codex/identity';

describe('Organization Tests', () => {
  let service;

  beforeAll(() => {
    const db = setupTestDatabase();
    service = createOrganizationService({ db, environment: 'test' });
  });

  it('should create organization', async () => {
    const org = await service.create({
      name: 'Test Org',
      slug: createUniqueSlug('test'),
    });

    expect(org.id).toBeDefined();
    expect(org.name).toBe('Test Org');
  });
});
```

### Service Composition

```typescript
import { createOrganizationService, type Organization } from '@codex/identity';
import { createContentService } from '@codex/content';
import { dbHttp } from '@codex/database';

const orgService = createOrganizationService({
  db: dbHttp,
  environment: 'production',
});

const contentService = createContentService({
  db: dbHttp,
  environment: 'production',
});

// Create organization and content in same workflow
const org = await orgService.create({
  name: 'Content Publishers Inc',
  slug: 'content-pub',
});

const article = await contentService.create({
  title: 'First Article',
  organizationId: org.id,  // Link to organization
  // ... other fields
});
```

## Database Schema

Organizations are stored in the `organizations` table with the following structure:

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  logo_url VARCHAR(1024),
  website_url VARCHAR(1024),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);
```

## Dependencies

### Required Dependencies

- `@codex/database` - Database client and schema definitions
- `@codex/validation` - Zod validation schemas
- `@codex/service-errors` - Error handling utilities
- `@codex/observability` - Logging and monitoring
- `drizzle-orm` - Database ORM

### Integration Points

This package is used by:
- `@codex/content` - Content service (organizationId foreign key)
- `workers/identity-api` - REST API for organization management
- `workers/auth` - Authentication and authorization
- `workers/content-api` - Content API endpoints

## Architecture Principles

### Type Safety

All types are properly inferred from the database schema using Drizzle ORM. No `any` types are used anywhere in the codebase.

```typescript
// Types are automatically inferred
const org: Organization = await service.get(id);
```

### Transaction Safety

Multi-step operations use database transactions to ensure data consistency:

```typescript
await this.db.transaction(async (tx) => {
  // Verify organization exists
  const existing = await tx.query.organizations.findFirst({
    where: eq(organizations.id, id),
  });

  if (!existing) {
    throw new OrganizationNotFoundError(id);
  }

  // Update organization
  await tx.update(organizations)
    .set({ ...updates })
    .where(eq(organizations.id, id));
});
```

### Soft Deletes

Organizations are never hard-deleted. Instead, a `deleted_at` timestamp is set, preserving data integrity and audit trails.

### Security Model

- **Slug Uniqueness**: Enforced at database level with unique constraint
- **Case-Insensitive Lookups**: Slugs stored lowercase for consistent queries
- **Authorization**: Caller responsible for user permission checks before calling service methods
- **Input Validation**: All inputs validated with Zod schemas before database operations

## Testing

Run the test suite:

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

The package includes comprehensive tests covering:
- Organization CRUD operations
- Slug uniqueness validation
- Soft delete behavior
- Pagination and filtering
- Error handling
- Transaction safety

## License

Part of the Codex platform monorepo.
