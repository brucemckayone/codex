# @codex/organization

**Organization Management Service**

Core service package for managing organizations within Codex. Provides type-safe business logic for organization creation, retrieval, updates, and deletions with full transaction safety and soft-delete preservation of historical data.

---

## Overview

`@codex/identity` provides the service layer for identity management in Codex. The primary responsibility is managing organizations as multi-tenant groupings that contain content, users, and roles. Organizations are the fundamental scoping mechanism for content ownership and access control throughout the platform.

**Primary Use Cases**:
- Create organizations with unique slugs
- Manage organization metadata (name, description, branding)
- Query organizations with pagination and search
- Soft-delete organizations while preserving data integrity
- Check slug availability before user interactions
- Integration point for user membership and roles (future)

**Architecture Position**: Service layer component between workers and database foundation. Extends `BaseService` from `@codex/service-errors` package and depends on Drizzle ORM database access.

---

## Public API

### Exports Overview

| Export | Type | Purpose |
|--------|------|---------|
| `OrganizationService` | Service Class | Handles all organization CRUD operations |
| `Organization` | Type | Database record type for organizations |
| `NewOrganization` | Type | Input type for creating organizations |
| `OrganizationFilters` | Type | Query filter parameters |
| `PaginatedResponse<T>` | Type | Standard paginated list response wrapper |
| `PaginationMetadata` | Type | Pagination metadata structure |
| `PaginationParams` | Type | Pagination input parameters |
| `CreateOrganizationInput` | Type | Zod-validated create input (from @codex/validation) |
| `UpdateOrganizationInput` | Type | Zod-validated update input (from @codex/validation) |
| `OrganizationNotFoundError` | Error Class | Thrown when organization doesn't exist |
| `ConflictError` | Error Class | Thrown when slug already exists |
| `createOrganizationSchema` | Zod Schema | Validation schema for create operations |
| `updateOrganizationSchema` | Zod Schema | Validation schema for update operations |
| `organizationQuerySchema` | Zod Schema | Validation schema for list query parameters |

---

## Core Service: OrganizationService

The primary exported service class. Extends `BaseService` to provide type-safe organization management with automatic validation, transaction safety, and custom error handling.

### Initialization

```typescript
import { OrganizationService } from '@codex/organization';
import { dbHttp } from '@codex/database';

const service = new OrganizationService({
  db: dbHttp,
  environment: 'production',
});
```

**Constructor Parameters**:
- `db` (Database): Drizzle ORM client instance (dbHttp for HTTP, dbWs for tests)
- `environment` (string): Deployment environment ('production', 'staging', 'test')

### Public Methods

#### `create(input: CreateOrganizationInput): Promise<Organization>`

Creates a new organization with unique slug validation.

**Parameters**:
- `input.name` (string, 1-255 chars): Organization display name. Sanitized to prevent XSS.
- `input.slug` (string, 1-255 chars): URL-friendly identifier. Must be unique. Validated as valid slug format.
- `input.description` (string | null, max 5000 chars): Optional organization description.
- `input.logoUrl` (string | null): Optional URL to organization logo. Validated as valid URL.
- `input.websiteUrl` (string | null): Optional organization website. Validated as valid URL.

**Returns**: Created `Organization` object with all fields including:
- `id` (uuid): Generated organization ID
- `createdAt`, `updatedAt`, `deletedAt` (timestamps)
- All input fields

**Errors**:
- `ConflictError`: Thrown if slug already exists (unique constraint violation)
- `ValidationError`: Thrown if input fails Zod schema validation
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const org = await service.create({
  name: 'Acme Corporation',
  slug: 'acme-corp',
  description: 'World leader in cartoon products',
  logoUrl: 'https://example.com/logo.png',
  websiteUrl: 'https://acme.example.com',
});

console.log(org.id); // UUID string
console.log(org.slug); // 'acme-corp'
```

---

#### `get(id: string): Promise<Organization | null>`

Retrieves organization by ID. Returns null if organization not found or deleted.

**Parameters**:
- `id` (uuid string): Organization ID to retrieve

**Returns**: Organization object or null if not found/deleted

**Errors**:
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const org = await service.get('123e4567-e89b-12d3-a456-426614174000');

if (org) {
  console.log(org.name);
} else {
  console.log('Organization not found');
}
```

---

#### `getBySlug(slug: string): Promise<Organization | null>`

Retrieves organization by slug. Case-insensitive slug matching. Returns null if not found or deleted.

**Parameters**:
- `slug` (string): Organization slug to look up (case-insensitive)

**Returns**: Organization object or null if not found/deleted

**Errors**:
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const org = await service.getBySlug('acme-corp');

if (org) {
  console.log(`Organization: ${org.name} (ID: ${org.id})`);
} else {
  console.log('No organization found with that slug');
}
```

---

#### `update(id: string, input: UpdateOrganizationInput): Promise<Organization>`

Updates organization with partial data. All fields are optional. Validates slug uniqueness if slug is changed. Uses transactions for multi-step consistency.

**Parameters**:
- `id` (uuid string): Organization ID to update
- `input`: Partial update object (any combination of name, slug, description, logoUrl, websiteUrl)

**Returns**: Updated Organization object

**Errors**:
- `OrganizationNotFoundError`: If organization with ID doesn't exist
- `ConflictError`: If new slug already exists (when slug is changed)
- `ValidationError`: If input fails schema validation
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const updated = await service.update('123e4567-e89b-12d3-a456-426614174000', {
  description: 'Updated description',
  logoUrl: 'https://example.com/new-logo.png',
});

console.log(updated.description);
```

---

#### `delete(id: string): Promise<void>`

Soft-deletes organization by setting `deletedAt` timestamp. Does NOT delete related content or memberships. Data remains queryable with explicit `whereNotDeleted` filter.

**Parameters**:
- `id` (uuid string): Organization ID to delete

**Returns**: void (no return value)

**Errors**:
- `OrganizationNotFoundError`: If organization doesn't exist
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
try {
  await service.delete('123e4567-e89b-12d3-a456-426614174000');
  console.log('Organization deleted');
} catch (error) {
  if (error instanceof OrganizationNotFoundError) {
    console.error('Organization not found');
  }
}

// Organization record still exists in database
// But deletedAt is set, so queries skip it by default
const deleted = await service.get('123e4567-e89b-12d3-a456-426614174000');
console.log(deleted); // null (filtered by whereNotDeleted)
```

---

#### `list(filters?: OrganizationFilters, pagination?: PaginationParams): Promise<PaginatedResponse<Organization>>`

Lists organizations with optional filtering, search, and sorting. Returns paginated results with metadata.

**Parameters**:
- `filters` (OrganizationFilters, optional):
  - `search` (string, max 255): Search string matched against name and description (case-insensitive LIKE)
  - `sortBy` ('createdAt' | 'name', default 'createdAt'): Column to sort by
  - `sortOrder` ('asc' | 'desc', default 'desc'): Sort direction

- `pagination` (PaginationParams, optional):
  - `page` (number, default 1): Page number (1-indexed)
  - `limit` (number, default 20): Results per page

**Returns**: `PaginatedResponse<Organization>`:
```typescript
{
  items: Organization[],
  pagination: {
    page: number,
    limit: number,
    total: number,           // Total matching records
    totalPages: number       // Total available pages
  }
}
```

**Errors**:
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const result = await service.list(
  {
    search: 'acme',
    sortBy: 'name',
    sortOrder: 'asc',
  },
  {
    page: 1,
    limit: 10,
  }
);

console.log(`Found ${result.pagination.total} organizations`);
result.items.forEach(org => {
  console.log(`- ${org.name} (${org.slug})`);
});
```

---

#### `isSlugAvailable(slug: string): Promise<boolean>`

Checks if slug is available for use. Useful for frontend validation before creation or updates.

**Parameters**:
- `slug` (string): Slug to check availability

**Returns**: `true` if slug is available, `false` if taken

**Errors**:
- `InternalServiceError`: Wrapped database errors

**Example**:
```typescript
const available = await service.isSlugAvailable('new-org-slug');

if (available) {
  console.log('Slug is available');
} else {
  console.log('Slug is already taken');
}
```

---

## Data Models

### Organizations Table

Database table: `organizations`

**Columns**:

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PRIMARY KEY, auto-generated | Unique organization identifier |
| `name` | VARCHAR(255) | NOT NULL | Display name of organization |
| `slug` | VARCHAR(255) | NOT NULL, UNIQUE | URL-friendly identifier for lookups |
| `description` | TEXT | nullable | Optional organization description |
| `logoUrl` | TEXT | nullable | Optional logo image URL |
| `websiteUrl` | TEXT | nullable | Optional website URL |
| `createdAt` | TIMESTAMP | NOT NULL, default now | Record creation time |
| `updatedAt` | TIMESTAMP | NOT NULL, default now | Last modification time |
| `deletedAt` | TIMESTAMP | nullable | Soft delete marker |

**Indexes**:
- `idx_organizations_slug`: On `slug` column for fast lookups

**Key Relationships**:
- Referenced by `organizationMemberships` (one-to-many)
- Referenced by media items and content (one-to-many)

**Soft Delete Behavior**:
- Deleted organizations have `deletedAt` set to current timestamp
- Related content remains in database with `organizationId` pointing to deleted organization
- Queries use `whereNotDeleted(organizations)` helper to exclude deleted records
- Historical data preserved for audit and compliance

---

## Usage Examples

### Basic Organization Creation

```typescript
import { OrganizationService } from '@codex/organization';
import { dbHttp } from '@codex/database';

const service = new OrganizationService({
  db: dbHttp,
  environment: 'production',
});

// Create new organization
const org = await service.create({
  name: 'Example Corp',
  slug: 'example-corp',
  description: 'An example organization',
});

console.log(`Created organization: ${org.slug} (${org.id})`);
```

### Error Handling for Duplicate Slug

```typescript
import { ConflictError, OrganizationService } from '@codex/organization';

try {
  const org = await service.create({
    name: 'My Org',
    slug: 'existing-slug', // Already taken
  });
} catch (error) {
  if (error instanceof ConflictError) {
    console.error('Slug is already in use. Please choose a different slug.');
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

### Slug Availability Check

```typescript
// Useful for frontend validation before form submission
const slugs = ['acme-corp', 'my-company', 'test'];

for (const slug of slugs) {
  const available = await service.isSlugAvailable(slug);
  console.log(`${slug}: ${available ? 'available' : 'taken'}`);
}
```

### Search and Pagination

```typescript
// List organizations matching search term
const result = await service.list(
  { search: 'tech' },  // Search name and description
  { page: 1, limit: 20 }
);

console.log(`Showing ${result.items.length} of ${result.pagination.total} results`);
console.log(`Page ${result.pagination.page} of ${result.pagination.totalPages}`);

// Display results
result.items.forEach(org => {
  console.log(`${org.name} (${org.slug})`);
});
```

### Update Organization

```typescript
const updated = await service.update(
  'org-id-uuid',
  {
    description: 'Updated description',
    logoUrl: 'https://example.com/new-logo.png',
  }
);

console.log(`Updated organization: ${updated.name}`);
```

### Soft Delete Organization

```typescript
try {
  await service.delete('org-id-uuid');
  console.log('Organization soft-deleted');
} catch (error) {
  if (error instanceof OrganizationNotFoundError) {
    console.error('Organization not found');
  }
}

// Organization record still exists in database
// But deletedAt is set, so queries skip it by default
const deleted = await service.get('org-id-uuid');
console.log(deleted); // null (filtered by whereNotDeleted)
```

### Integration with Other Services

```typescript
// Typical pattern: Create organization then initialize membership
import { OrganizationService } from '@codex/organization';
// import { UserService } from '@codex/users'; // Future

const orgService = new OrganizationService({
  db: dbHttp,
  environment: 'production',
});

// Create organization
const org = await orgService.create({
  name: 'Startup Inc',
  slug: 'startup-inc',
});

// Future: Add creator as organization owner
// const userService = new UserService({ db: dbHttp });
// await userService.addOrganizationMember({
//   organizationId: org.id,
//   userId: creatorUserId,
//   role: 'owner',
// });
```

---

## Integration Points

### Dependencies (What This Package Uses)

| Package | Purpose | Import Patterns |
|---------|---------|-----------------|
| `@codex/database` | Drizzle ORM client and schema | `dbHttp`, `dbWs`, `organizations` table, `whereNotDeleted`, `isUniqueViolation` helpers |
| `@codex/validation` | Zod schemas for input validation | `createOrganizationSchema`, `updateOrganizationSchema`, `organizationQuerySchema` |
| `@codex/service-errors` | Base service class and error classes | `BaseService`, `NotFoundError`, custom error handling |

### Dependents (Packages/Workers Using This)

| Component | Usage | Details |
|-----------|-------|---------|
| `workers/identity-api` | Organization REST API | Create, read, update, delete endpoints; list with search |
| `@codex/content` | Content scoping | Organizations contain media items and content |
| Future: `@codex/users` | Membership and roles | User-to-organization relationships |

### Data Flow

```
Client Request
    ↓
workers/identity-api (REST endpoints)
    ↓
OrganizationService (business logic)
    ↓
@codex/database (Drizzle ORM)
    ↓
Neon PostgreSQL (organizations table)
```

---

## Error Handling

### Error Classes

#### OrganizationNotFoundError

Thrown when attempting to access or modify non-existent organization.

**When thrown**:
- `get(id)` when organization doesn't exist or is deleted
- `update(id, data)` when organization doesn't exist or is deleted
- `delete(id)` when organization doesn't exist or is deleted

**How to handle**:
```typescript
import { OrganizationNotFoundError } from '@codex/organization';

try {
  const org = await service.get(unknownId);
} catch (error) {
  if (error instanceof OrganizationNotFoundError) {
    // Respond with 404 to client
    // Log appropriate context
    console.error(`Organization ${error.context.organizationId} not found`);
  }
}
```

#### ConflictError

Thrown when a unique constraint is violated (e.g., duplicate slug).

**When thrown**:
- `create(input)` when slug already exists
- `update(id, data)` when new slug conflicts with existing organization

**How to handle**:
```typescript
import { ConflictError } from '@codex/organization';

try {
  const org = await service.create({ slug: 'taken-slug' });
} catch (error) {
  if (error instanceof ConflictError) {
    // Respond with 409 Conflict to client
    // Suggest alternative slug to user
    console.error(`Slug '${error.context.slug}' is already in use`);
  }
}
```

#### ValidationError

Thrown when input data fails Zod schema validation.

**When thrown**:
- Any method when input doesn't match schema
- Invalid email, URL, slug format
- String length violations

**How to handle**:
```typescript
import { ValidationError } from '@codex/organization';

try {
  const org = await service.create({ name: '' }); // Too short
} catch (error) {
  if (error instanceof ValidationError) {
    // Respond with 422 Unprocessable Entity to client
    console.error('Invalid input:', error.message);
  }
}
```

#### InternalServiceError

Wrapped database errors and unexpected failures.

**When thrown**:
- Database connection failures
- Transaction rollbacks
- Unexpected query errors

**How to handle**:
```typescript
import { InternalServiceError } from '@codex/organization';

try {
  const org = await service.get(id);
} catch (error) {
  if (error instanceof InternalServiceError) {
    // Respond with 500 Internal Server Error
    // Log full error for debugging
    console.error('Service error:', error.message, error.context);
    // Alert monitoring/observability system
  }
}
```

### Error Recovery Strategies

**Duplicate Slug**:
```typescript
// Check availability before attempting creation
const available = await service.isSlugAvailable(proposedSlug);
if (!available) {
  // Suggest alternatives to user
  const alternativeSlug = `${proposedSlug}-${Date.now()}`;
}
```

**Organization Not Found**:
```typescript
// Refresh org list or redirect user
const org = await service.get(organizationId);
if (!org) {
  // Organization may have been deleted
  // Redirect to organization list
  // Show appropriate message
}
```

**Validation Failures**:
```typescript
// Re-validate with schema before service call
import { createOrganizationSchema } from '@codex/organization';

try {
  const validated = createOrganizationSchema.parse(userInput);
  const org = await service.create(validated);
} catch (error) {
  // Schema validation failed - show error to user
}
```

---

## Slug Management

Slugs are URL-friendly identifiers for organizations. Must be unique and follow strict validation.

### Slug Validation Rules

- **Length**: 1-255 characters
- **Format**: Lowercase alphanumeric with hyphens (matches `/^[a-z0-9-]+$/`)
- **Uniqueness**: No two active organizations can have same slug
- **Case**: Automatically converted to lowercase in database queries

### Slug Best Practices

```typescript
// GOOD: Descriptive, lowercase, hyphens
'acme-corporation'
'startup-inc'
'tech-company-2024'

// BAD: Uppercase, spaces, special chars
'ACME-CORPORATION'  // Will be lowercased
'acme corporation'  // Spaces not allowed
'acme_corp'         // Underscores not allowed
'acme.corp'         // Dots not allowed
```

### Checking Slug Availability

Always check availability before user-facing operations:

```typescript
// Frontend form submission
const slug = userInput.toLowerCase().trim();

// Validate format first
if (!/^[a-z0-9-]+$/.test(slug)) {
  showError('Slug must contain only lowercase letters, numbers, and hyphens');
  return;
}

// Check availability
const available = await service.isSlugAvailable(slug);
if (!available) {
  showError('This slug is already taken');
  return;
}

// Safe to create
const org = await service.create({ name, slug });
```

---

## Soft Deletes and Data Preservation

Organizations use soft deletes exclusively. Deleted organizations are marked with `deletedAt` timestamp but remain in database.

### Why Soft Deletes

- **Data Integrity**: Organizations can't be deleted if they contain content
- **Audit Trail**: Historical records preserved for compliance
- **Cascading Protection**: Content references don't break
- **Recovery**: Accidentally deleted organizations can be recovered

### Querying Deleted Organizations

Default queries exclude deleted records:

```typescript
// Returns null - soft deleted records filtered automatically
const org = await service.get('deleted-org-id');

// Returns null - getBySlug also filters deleted
const org = await service.getBySlug('deleted-slug');

// List excludes deleted - pagination counts only active
const { items } = await service.list();
```

### Handling Deleted Organization Content

When organization is deleted:

```typescript
// 1. Organization soft-deletes
await service.delete(orgId);

// 2. Content remains in database
// SELECT * FROM media_items WHERE organization_id = 'orgId'
// Still returns results!

// 3. Display UI shows "deleted organization"
// On content retrieval, check if organization exists
const content = await getContent(contentId);
const org = await service.get(content.organizationId);
if (!org) {
  display('Content from deleted organization');
}
```

---

## Scoping and Multi-Tenant Support

Organizations are the fundamental scoping mechanism for multi-tenancy in Codex.

### Organization-Scoped Data

Data scoped to organizations:
- Media items (belongs to organization)
- Content (published to organization)
- Organization memberships (users in organizations)
- Roles and permissions (per organization)

### Access Control Pattern

```typescript
// When accessing scoped data, verify organization exists
async function getOrganizationContent(orgId: string) {
  // Verify organization exists and user has access
  const org = await orgService.get(orgId);
  if (!org) {
    throw new OrganizationNotFoundError(orgId);
  }

  // Verify user is member of organization
  // (Future: implemented in @codex/users)

  // Now safe to query organization content
  return getContent(orgId);
}
```

### NULL Organizations

Some content can belong to no organization (`organizationId = null`). This represents "personal" content created by users without an organization context.

---

## Membership and Roles (Future)

Currently, this package manages organizations only. User membership and roles are planned for implementation.

**Future Interface** (not yet implemented):

```typescript
// Eventually in @codex/users or similar
interface OrganizationMember {
  id: uuid;
  organizationId: uuid;
  userId: string;
  role: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member';
  status: 'active' | 'inactive' | 'invited';
  joinedAt: Date;
}

// Planned methods
// - addMember(orgId, userId, role)
// - removeMember(orgId, userId)
// - updateMemberRole(orgId, userId, newRole)
// - listMembers(orgId)
// - getMemberPermissions(orgId, userId)
```

---

## Performance Notes

### Query Optimization

- **Slug lookups**: Indexed on `organizations.slug` for O(1) retrieval
- **Deletion filtering**: `whereNotDeleted()` adds simple index-friendly condition
- **Pagination**: Uses LIMIT/OFFSET with sort column indexes

### Recommendations

**Avoid**:
```typescript
// Bad: Fetches all orgs, filters in memory
const allOrgs = await service.list({ limit: 10000 });
const myOrg = allOrgs.items.find(o => o.name === search);
```

**Do**:
```typescript
// Good: Uses database search and pagination
const { items } = await service.list({ search }, { limit: 10 });
```

**Batch Operations**:
```typescript
// If checking multiple slugs, do in parallel
const results = await Promise.all([
  service.isSlugAvailable('slug1'),
  service.isSlugAvailable('slug2'),
  service.isSlugAvailable('slug3'),
]);
```

### Caching Strategy

Service does not implement caching. Cache at application layer if needed:

```typescript
// Example: Cache organization for duration of request
const cache = new Map<string, Organization>();

async function getCachedOrg(id: string) {
  if (cache.has(id)) return cache.get(id);

  const org = await service.get(id);
  if (org) cache.set(id, org);
  return org;
}
```

---

## Testing

### Test Setup

Tests use `@codex/test-utils` and `neon-testing` for isolated database branches:

```typescript
import {
  setupTestDatabase,
  teardownTestDatabase,
  createUniqueSlug,
  withNeonTestBranch,
} from '@codex/test-utils';

// Enable ephemeral Neon branch
withNeonTestBranch();

describe('OrganizationService', () => {
  let service: OrganizationService;
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new OrganizationService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });
});
```

### Testing Patterns

**Test Creation**:
```typescript
it('should create organization', async () => {
  const result = await service.create({
    name: 'Test Org',
    slug: createUniqueSlug('test'),
  });

  expect(result.id).toBeDefined();
  expect(result.name).toBe('Test Org');
});
```

**Test Errors**:
```typescript
it('should throw on duplicate slug', async () => {
  const slug = createUniqueSlug('dup');
  await service.create({ name: 'First', slug });

  await expect(
    service.create({ name: 'Second', slug })
  ).rejects.toThrow(ConflictError);
});
```

**Test Soft Deletes**:
```typescript
it('should soft delete organization', async () => {
  const org = await service.create({ name: 'Temp', slug });
  await service.delete(org.id);

  const retrieved = await service.get(org.id);
  expect(retrieved).toBeNull(); // Filtered by whereNotDeleted
});
```

### Test Utilities

Use provided helpers:

```typescript
// Create unique slug for test isolation
const slug = createUniqueSlug('test-org');

// Validates database connection before tests
await validateDatabaseConnection(db);
```

---

## Development

### Build

```bash
npm run build
```

Outputs compiled TypeScript to `dist/` directory with type declarations.

### Type Checking

```bash
npm run typecheck
```

Validates TypeScript types without emitting code.

### Running Tests

```bash
# Run once
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Code Quality

```bash
npm run lint    # Lint with Biome
npm run format  # Format with Biome
```

---

## Quick Reference

### When to Use OrganizationService

| Use Case | Method | Example |
|----------|--------|---------|
| Create new organization | `create()` | User signs up new organization |
| Get organization details | `get()` or `getBySlug()` | Load org page, verify ownership |
| Update organization | `update()` | User edits organization settings |
| Delete organization | `delete()` | User requests org deletion |
| List organizations | `list()` | Search, paginate, filter organizations |
| Check slug available | `isSlugAvailable()` | Real-time slug validation on form |

### Type Imports

```typescript
// Service class
import { OrganizationService } from '@codex/organization';

// Data types
import type {
  Organization,
  OrganizationFilters,
  PaginatedResponse,
} from '@codex/organization';

// Validation schemas
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/organization';

// Error handling
import {
  OrganizationNotFoundError,
  ConflictError,
  ValidationError,
} from '@codex/organization';
```

---

## API Summary

| Method | Input | Output | Errors |
|--------|-------|--------|--------|
| `create()` | `CreateOrganizationInput` | `Organization` | `ConflictError`, `ValidationError` |
| `get()` | organization ID | `Organization \| null` | `InternalServiceError` |
| `getBySlug()` | slug | `Organization \| null` | `InternalServiceError` |
| `update()` | ID + `UpdateOrganizationInput` | `Organization` | `OrganizationNotFoundError`, `ConflictError` |
| `delete()` | organization ID | void | `OrganizationNotFoundError` |
| `list()` | filters + pagination | `PaginatedResponse<Organization>` | `InternalServiceError` |
| `isSlugAvailable()` | slug | boolean | `InternalServiceError` |
