# Organization Authorization Implementation

## Overview

This document outlines the requirements and implementation plan for adding organization-level authorization to the Codex platform. Currently, the system supports **dual ownership** of content:

- **Personal Content**: `organizationId = NULL` (owned by creator)
- **Organization Content**: `organizationId` is set (owned by organization)

The next phase is to implement proper authorization checks to ensure users can only access organizations they're members of, and can only perform actions on content within those organizations.

---

## Current State

### What's Working ✅

1. **Database Schema**: Complete multi-tenant schema with organization support
   - `organizations` table with creator ownership
   - `organization_members` table with role-based membership
   - Content tables support both personal and organization ownership
   - Proper foreign key constraints and indexes

2. **API Infrastructure**: Workers are set up and deployed
   - `identity-api`: Organization CRUD operations
   - `content-api`: Content and media management
   - Rate limiting implemented (100 req/min)
   - Integration tests cover all endpoints
   - Session authentication on all protected routes

3. **Dual Ownership Model**: Content can be personal OR organizational
   - Personal: `creatorId` set, `organizationId = NULL`
   - Organizational: `creatorId` and `organizationId` both set
   - Queries correctly filter by `creatorId` for current scope

### What's Missing ❌

1. **Organization Authorization Middleware**: No checks verify user membership
2. **Organization Context**: No way to determine which org a request is for
3. **Permission Enforcement**: Users can potentially access any organization
4. **Role-Based Access Control**: Membership roles exist but aren't enforced

---

## Implementation Requirements

### 1. Organization Context Middleware

**Location**: `packages/security/src/organization-context.ts`

**Purpose**: Extract and validate organization context from requests

**Requirements**:
- Accept organization ID from multiple sources (header, query param, path param)
- Verify organization exists in database
- Attach organization to request context
- Handle personal vs organizational requests

**Implementation Pattern**:
```typescript
export function requireOrganizationContext(options?: {
  optional?: boolean;
  sources?: ('header' | 'query' | 'path')[];
}) {
  return async (c: Context, next: Next) => {
    // 1. Extract org ID from request (check header, query, path)
    // 2. If org ID found, verify it exists
    // 3. Attach to c.var for downstream use
    // 4. If required and missing, return 400
    await next();
  };
}
```

**API Contract**:
```typescript
// Request methods
c.req.header('X-Organization-Id')
c.req.query('organizationId')
c.req.param('organizationId')

// Context variables
c.var.organizationId // string | undefined
c.var.isPersonalRequest // boolean
```

### 2. Organization Membership Middleware

**Location**: `packages/security/src/organization-membership.ts`

**Purpose**: Verify user is a member of the organization

**Requirements**:
- Query `organization_members` table for user + org combination
- Cache membership checks (KV or in-memory)
- Return 403 if user is not a member
- Attach membership role to context

**Implementation Pattern**:
```typescript
export function requireOrganizationMembership(options?: {
  roles?: ('owner' | 'admin' | 'member')[];
  allowCreator?: boolean; // Allow org creator even if not in members table
}) {
  return async (c: Context, next: Next) => {
    const userId = c.var.user.id;
    const orgId = c.var.organizationId;

    // 1. Check if user is org creator (always has access)
    // 2. Query organization_members for user + org
    // 3. If required role specified, verify user has it
    // 4. Attach membership to c.var
    // 5. Return 403 if not authorized

    await next();
  };
}
```

**API Contract**:
```typescript
c.var.organizationMembership // { role: string; joinedAt: Date } | undefined
c.var.isOrganizationCreator // boolean
```

### 3. Content Authorization Middleware

**Location**: `packages/security/src/content-authorization.ts`

**Purpose**: Verify user can access/modify specific content items

**Requirements**:
- For personal content: verify user is the creator
- For org content: verify user is org member
- Handle different permission levels (read vs write)
- Support bulk operations

**Implementation Pattern**:
```typescript
export function requireContentAccess(options?: {
  action: 'read' | 'write' | 'delete';
  contentIdParam?: string; // Default: 'id'
}) {
  return async (c: Context, next: Next) => {
    const contentId = c.req.param(options?.contentIdParam || 'id');
    const userId = c.var.user.id;

    // 1. Fetch content item
    // 2. If organizationId is NULL, verify userId === creatorId
    // 3. If organizationId is set, verify user is org member
    // 4. For write/delete, check role permissions
    // 5. Return 403 if not authorized

    await next();
  };
}
```

### 4. Update Identity API Routes

**Location**: `workers/identity-api/src/routes/organizations.ts`

**Changes Required**:

#### GET /api/organizations (list)
- **Current**: Lists all organizations
- **Required**: Only show organizations user is a member of or created
- **Query**: Join with `organization_members` table

#### GET /api/organizations/:id
- **Current**: Returns any organization
- **Required**: Verify user is a member before returning
- **Middleware**: Add `requireOrganizationMembership()`

#### PATCH /api/organizations/:id
- **Current**: No authorization
- **Required**: Only owners/admins can update
- **Middleware**: Add `requireOrganizationMembership({ roles: ['owner', 'admin'] })`

#### DELETE /api/organizations/:id
- **Current**: No authorization
- **Required**: Only owners can delete
- **Middleware**: Add `requireOrganizationMembership({ roles: ['owner'] })`

#### New Endpoint: GET /api/organizations/:id/members
- List all members of an organization
- Require membership to view
- Include role and join date

#### New Endpoint: POST /api/organizations/:id/members
- Add a user to an organization
- Only owners/admins can add members
- Validate user exists before adding

#### New Endpoint: DELETE /api/organizations/:id/members/:userId
- Remove a member from organization
- Only owners/admins can remove
- Cannot remove the creator

### 5. Update Content API Routes

**Location**: `workers/content-api/src/routes/content.ts` and `media.ts`

**Changes Required**:

#### POST /api/content (create)
- **Current**: Creates content with `creatorId`
- **Required**: If `organizationId` in body, verify user is member
- **Middleware**: Add optional organization context and membership check

#### GET /api/content (list)
- **Current**: Filters by `creatorId` only
- **Required**: Support filtering by organization
- **Query Enhancement**: If `organizationId` in query, verify membership

#### GET /api/content/:id
- **Current**: No authorization
- **Required**: Verify user can access this content
- **Middleware**: Add `requireContentAccess({ action: 'read' })`

#### PATCH /api/content/:id
- **Current**: No authorization
- **Required**: Verify user can modify this content
- **Middleware**: Add `requireContentAccess({ action: 'write' })`

#### DELETE /api/content/:id
- **Current**: No authorization
- **Required**: Verify user can delete this content
- **Middleware**: Add `requireContentAccess({ action: 'delete' })`

**Same changes apply to media routes** (`/api/media/*`)

### 6. Testing Requirements

**Location**: Test files need comprehensive coverage

#### Unit Tests for Middleware
- `packages/security/src/organization-context.test.ts`
  - Test extracting org ID from various sources
  - Test handling missing organization
  - Test optional vs required context

- `packages/security/src/organization-membership.test.ts`
  - Test membership verification
  - Test role-based access
  - Test creator bypass
  - Test caching behavior

- `packages/security/src/content-authorization.test.ts`
  - Test personal content access
  - Test organization content access
  - Test different action types

#### Integration Tests for APIs
- `workers/identity-api/src/routes/organizations.test.ts`
  - Test membership filtering in list endpoint
  - Test authorization on all CRUD operations
  - Test new member management endpoints

- `workers/content-api/src/routes/content.test.ts`
  - Test creating personal vs org content
  - Test accessing content based on membership
  - Test unauthorized access returns 403

### 7. Database Queries to Update

**Service Layer Changes**:

#### `packages/identity/src/organization-service.ts`
```typescript
// New method: Get user's organizations
async getUserOrganizations(userId: string): Promise<Organization[]> {
  // JOIN organizations with organization_members
  // WHERE members.userId = ? OR organizations.creatorId = ?
}

// New method: Check membership
async checkMembership(userId: string, orgId: string): Promise<MembershipInfo | null> {
  // Query organization_members for user + org
  // Return role and joinedAt if found
}

// New method: Add member
async addMember(orgId: string, userId: string, role: string): Promise<void> {
  // Insert into organization_members
  // Validate role is valid enum
}

// New method: Remove member
async removeMember(orgId: string, userId: string): Promise<void> {
  // Delete from organization_members
  // Prevent removing creator
}
```

#### `packages/content/src/content-service.ts`
```typescript
// Update: List content to support org filtering
async listContent(filters: {
  creatorId?: string;
  organizationId?: string; // Add this
  status?: string;
  contentType?: string;
  limit: number;
  offset: number;
}): Promise<Content[]> {
  // Add organizationId to WHERE clause
}

// New method: Get content with authorization check
async getContentWithAuth(contentId: string, userId: string): Promise<Content> {
  // Fetch content
  // Verify user can access (creator or org member)
  // Throw 403 if not authorized
}
```

### 8. Environment Variables

**No new environment variables required** - uses existing:
- `DATABASE_URL`: For membership queries
- `RATE_LIMIT_KV`: Optionally cache membership checks

### 9. Documentation Updates

**Files to Update**:
- `README.md`: Add section on organization authorization
- `docs/API.md`: Document organization context headers
- `docs/ARCHITECTURE.md`: Explain authorization flow

### 10. Security Considerations

**Critical Security Requirements**:

1. **Always verify membership** before allowing access to organization resources
2. **Never trust client-provided organization IDs** without verification
3. **Log authorization failures** for security monitoring
4. **Rate limit membership checks** to prevent enumeration attacks
5. **Validate roles** against known enum values only
6. **Prevent privilege escalation** - users cannot promote themselves
7. **Audit trail** - log who adds/removes members

**XSS Prevention**: Already handled by Zod validation in existing code

**SQL Injection**: Already handled by Drizzle ORM parameterized queries

**IDOR Prevention**: The main focus of this implementation

---

## Implementation Plan

### Phase 1: Middleware Foundation
1. Create `organization-context.ts` middleware
2. Create `organization-membership.ts` middleware
3. Create `content-authorization.ts` middleware
4. Write unit tests for all middleware
5. Export from `@codex/security` package

### Phase 2: Identity API Updates
1. Add organization membership endpoints
2. Add authorization middleware to existing endpoints
3. Update service layer with new queries
4. Write integration tests
5. Deploy and test in preview environment

### Phase 3: Content API Updates
1. Add authorization middleware to content endpoints
2. Add authorization middleware to media endpoints
3. Update service layer to handle organization filtering
4. Write integration tests
5. Deploy and test in preview environment

### Phase 4: Testing & Documentation
1. Run full test suite
2. Perform manual security testing
3. Update API documentation
4. Update architecture documentation
5. Create migration guide for existing data

### Phase 5: Deployment
1. Deploy to production in maintenance window
2. Monitor error rates and authorization failures
3. Verify no legitimate access is blocked
4. Enable audit logging
5. Document any issues and fixes

---

## API Examples

### Creating Personal Content
```typescript
POST /api/content
Headers: { Cookie: 'session=...' }
Body: {
  "title": "My Personal Video",
  "slug": "my-personal-video",
  "contentType": "video"
  // organizationId is NULL
}
// Creates content with organizationId = NULL
```

### Creating Organization Content
```typescript
POST /api/content
Headers: {
  Cookie: 'session=...',
  'X-Organization-Id': 'org-uuid-123'
}
Body: {
  "title": "Company Training Video",
  "slug": "company-training-video",
  "contentType": "video",
  "organizationId": "org-uuid-123"
}
// Middleware verifies user is member of org-uuid-123
// Creates content with both creatorId and organizationId
```

### Listing Organization Content
```typescript
GET /api/content?organizationId=org-uuid-123
Headers: { Cookie: 'session=...' }
// Middleware verifies user is member of org-uuid-123
// Returns only content where organizationId = org-uuid-123
```

### Accessing Organization
```typescript
GET /api/organizations/org-uuid-123
Headers: { Cookie: 'session=...' }
// Middleware verifies user is member or creator
// Returns organization details
```

---

## Testing Checklist

Before considering this implementation complete, verify:

- [ ] Personal content (organizationId = NULL) is only accessible by creator
- [ ] Organization content is accessible by all org members
- [ ] Non-members receive 403 when accessing org content
- [ ] Organization list only shows user's organizations
- [ ] Cannot create content for an org without membership
- [ ] Cannot modify org settings without owner/admin role
- [ ] Cannot remove organization creator from members
- [ ] Rate limiting works on membership checks
- [ ] Audit logs capture authorization events
- [ ] No information leakage in error messages
- [ ] Integration tests cover all authorization paths
- [ ] Load testing confirms performance is acceptable

---

## Migration Considerations

**Existing Data**:
- All existing content has `organizationId = NULL` (personal content)
- All existing organizations have a `creatorId` (automatic membership)
- No `organization_members` rows exist yet

**Migration Steps**:
1. No database migration needed (schema already supports it)
2. Optionally: Create initial `organization_members` row for each org creator
3. Update frontend to include organization context in requests
4. Gradual rollout: enable authorization checks incrementally

---

## Questions to Resolve

Before implementation, clarify:

1. **Member Roles**: What permissions does each role have?
   - `owner`: Full control (delete org, manage members, manage content)
   - `admin`: Manage members and content, cannot delete org
   - `member`: Create and manage own content within org, view other content

2. **Content Visibility**: Can members view all org content?
   - Proposed: Yes, all members can read all org content
   - Write/delete requires being the content creator OR admin/owner

3. **Multiple Organizations**: Can users belong to multiple orgs?
   - Yes (already supported by schema)

4. **Organization Context**: How does frontend specify which org a request is for?
   - Proposed: `X-Organization-Id` header OR `organizationId` query param
   - Path-based alternative: `/api/organizations/:orgId/content`

5. **Personal Content Migration**: Should personal content be movable to organizations?
   - Proposed: Yes, add endpoint to transfer content ownership

---

## Success Criteria

This implementation is complete when:

1. ✅ All middleware is implemented and tested
2. ✅ All API endpoints have proper authorization
3. ✅ Integration tests cover authorization flows
4. ✅ Documentation is updated
5. ✅ No security vulnerabilities in code review
6. ✅ Performance benchmarks are met
7. ✅ Deployed to production successfully
8. ✅ No increase in error rates
9. ✅ User feedback is positive

---

## References

- Database Schema: `packages/database/src/schema/`
- Security Package: `packages/security/src/`
- Identity Service: `packages/identity/src/`
- Content Service: `packages/content/src/`
- API Workers: `workers/content-api/`, `workers/identity-api/`
