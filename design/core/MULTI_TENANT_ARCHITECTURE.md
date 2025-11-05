# Multi-Tenant Architecture

**Purpose**: This document defines Codex's multi-tenant architecture philosophy, patterns, and conventions. All features must follow these patterns to ensure proper data isolation, scalability, and Phase 2+ multi-organization support.

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## Table of Contents

1. [Introduction and Design Philosophy](#introduction-and-design-philosophy)
2. [Organization Model](#organization-model)
3. [User Types & Roles](#user-types--roles)
4. [Session Context Pattern](#session-context-pattern)
5. [Row-Level Security (RLS)](#row-level-security-rls)
6. [Query Patterns](#query-patterns)
7. [Phase Migration Strategy](#phase-migration-strategy)
8. [References](#references)

---

## Introduction and Design Philosophy

### Core Principles

Codex is architected as a **multi-tenant system from day one**, even though Phase 1 operates with a single organization. This architectural decision ensures:

1. **No schema migrations between phases** - The database schema supports unlimited organizations from the start
2. **Database-enforced isolation** - Row-level security (RLS) policies prevent data leaks between organizations
3. **Seamless Phase 2 transition** - Enabling multiple organizations requires no code refactoring, only feature enablement
4. **Clear ownership boundaries** - Every data entity belongs to exactly one organization (with rare exceptions)

### Multi-Tenant Design Philosophy

```
Build for multi-tenant from day one, operate as single-tenant in Phase 1
```

**Why This Approach?**

- **Prevents costly migrations**: Retrofitting multi-tenancy into a single-tenant system is expensive and risky
- **Enforces clean architecture**: Multi-tenant thinking leads to better data modeling and access control
- **Future-proofs the codebase**: Phase 2+ organizations can be enabled without major refactoring
- **Security by design**: Isolation mechanisms are tested from day one, not added later

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Organization as root entity** | All business data scoped to organizations, not users |
| **activeOrganizationId in session** | Session context carries organization scope for every request |
| **RLS policies prepared in Phase 1** | Policies designed and documented, enforced in Phase 2+ |
| **Organization-scoped queries** | Application layer always filters by organizationId, even with single org |
| **Creator multi-org support** | Creators can belong to multiple organizations (Phase 2+) |
| **Customer anonymity** | Customers purchase from organizations but aren't members |

---

## Organization Model

### Organization Entity

The `organization` table is the **root tenant container** for all business data:

```typescript
interface Organization {
  id: string;                    // UUID primary key
  name: string;                  // Display name (e.g., "Mindful Movement Studio")
  slug: string;                  // URL-safe identifier (e.g., "mindful-movement")
  ownerId: string;               // References user who owns this org

  // Branding & Configuration
  logoUrl?: string;
  primaryColorHex: string;       // Default: "#3B82F6"
  businessName?: string;         // Legal business name
  contactEmail?: string;
  timezone: string;              // Default: "UTC"
  description?: string;
  isPublic: boolean;             // Default: true

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### Organization Relationships

```
organization (1:N relationships)
  ├─ organization_member      // Users who belong to this org (owners, admins, creators)
  ├─ organization_invitation  // Pending invitations to join org
  ├─ platform_settings        // Org-specific settings (branding, policies)
  ├─ content                  // All content belongs to exactly one org
  ├─ offering                 // Events, services, programs (Phase 2+)
  ├─ purchase                 // Customer purchases from this org
  ├─ subscription             // Customer subscriptions (Phase 2+)
  └─ analytics_event          // Tracking events scoped to org
```

### Organization Membership

Users can have multiple relationships with organizations through the `organization_member` table:

```typescript
interface OrganizationMember {
  id: string;
  organizationId: string;        // FK to organization
  userId: string;                // FK to user
  role: OrganizationRole;        // 'owner' | 'admin' | 'member' | 'creator'
  joinedAt: Date;
  invitedBy?: string;            // FK to user who sent invitation
  invitedAt?: Date;
}

type OrganizationRole = 'owner' | 'admin' | 'member' | 'creator';
```

**Membership Constraints**:
- Each `(organizationId, userId)` pair is unique (a user can only have one role per organization)
- Phase 1: Users typically belong to one organization
- Phase 2+: Users (especially creators) can belong to multiple organizations

### Organization Invitations

Pending invitations are tracked separately from active memberships:

```typescript
interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;                 // Email of invitee (may not be registered yet)
  role: OrganizationRole;        // Role they'll receive upon acceptance
  invitedBy: string;             // FK to user who sent invite
  token: string;                 // Secure, unique invitation token
  expiresAt: Date;               // Default: 7 days from creation
  acceptedAt?: Date;
  acceptedBy?: string;
  rejectedAt?: Date;
  createdAt: Date;
}
```

---

## User Types & Roles

### Dual Role System

Codex uses a **two-tier role system**:

1. **Platform-level role**: Stored in `user.role` - determines system-wide permissions
2. **Organization-level role**: Stored in `organization_member.role` - determines permissions within a specific organization

### User Type Hierarchy

| User Type | Platform Role | Org Role | Scope | Belongs To | Key Trait |
|-----------|---------------|----------|-------|-----------|-----------|
| **Platform Owner** | `platform_owner` | `owner` (of one or more orgs) | System-wide | Single org (Phase 1) or multiple orgs (Phase 2+) | Super admin, can create organizations |
| **Organization Owner** | `customer` | `owner` | Organization | One or more organizations | Owns/operates organization, manages team |
| **Organization Admin** | `customer` | `admin` | Organization | One or more organizations | Staff with elevated permissions, manages content approval |
| **Organization Member** | `customer` | `member` | Organization | One organization typically | Team member, limited permissions |
| **Creator** | `customer` | `creator` | Organization | Multiple organizations possible (Phase 2+) | Content creator, uploads to one or more orgs |
| **Customer** | `customer` | (none) | Public/Purchased content | Not a member | Browses, purchases, subscribes |
| **Guest** | (none) | (none) | Public only | None | Unauthenticated visitor |

### Role Semantics

**Platform-Level Roles** (`user.role`):
- `platform_owner`: Can create new organizations, access system-wide admin features
- `customer`: Everyone else (including org owners, admins, creators)

**Organization-Level Roles** (`organization_member.role`):
- `owner`: Full control over organization, can manage settings, team, content, analytics
- `admin`: Elevated permissions, can approve content, manage team members, view analytics
- `member`: Basic team member, limited permissions (Phase 1 uses this for staff)
- `creator`: Content creator who can belong to multiple organizations (Phase 2+)

### Permission Hierarchy

```
Within an Organization:

Platform Owner (if member)
  └─ Organization Owner
      └─ Organization Admin
          └─ Organization Member / Creator
              └─ Customer (purchases from org, not a member)
                  └─ Guest (unauthenticated)
```

### Phase 1 vs Phase 2+ Role Usage

**Phase 1**:
- Single organization only
- Team members invited as `member` role
- Creators are team members with `member` role (promoted to `creator` in Phase 2)

**Phase 2+**:
- Multiple organizations supported
- `creator` role specifically for content creators who can join multiple orgs
- Organization Owner can manage multiple organizations
- Session includes organization switching capability

---

## Session Context Pattern

### Session Structure

Every authenticated session includes **organization context**:

```typescript
interface Session {
  // User Identity
  userId: string;
  userEmail: string;
  userRole: 'platform_owner' | 'customer';   // Platform-level role

  // Organization Context (Phase 1)
  activeOrganizationId?: string;              // Current org user is operating in
  organizationRole?: OrganizationRole;        // User's role in active org

  // Phase 2+ Additions
  availableOrganizations?: Organization[];    // Orgs user can switch to
  switchedAt?: Date;                         // Last org switch timestamp

  // Session Metadata
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}
```

### Active Organization Context

The `activeOrganizationId` field is **critical** for multi-tenancy:

**Phase 1 Behavior**:
- Set automatically during login to the user's organization (if they're a member)
- Remains constant throughout session (no switching)
- Used to scope all queries, even with only one organization

**Phase 2+ Behavior**:
- User can switch between organizations they belong to
- Switching updates `activeOrganizationId` and `organizationRole` in session
- Session cache (Cloudflare KV) invalidated on switch
- All subsequent requests operate in context of new active organization

### Session Lifecycle

```
1. Login
   ↓
2. Determine user's organization(s)
   ↓
3. Set activeOrganizationId:
   - If user is member of 1 org → use that org
   - If user is member of multiple orgs → use last active or default
   - If user is not a member → null
   ↓
4. Load organizationRole for active org
   ↓
5. Store session in:
   - Database (persistent)
   - Cloudflare KV (cache)
   - Cookie (session token)
   ↓
6. Middleware extracts session → event.locals
   ↓
7. Every request includes organization context
```

### Organization Context in Application Code

**Server-Side (SvelteKit)**:

```typescript
// hooks.server.ts - Session validation populates event.locals
export const handle: Handle = async ({ event, resolve }) => {
  // Session loaded from KV or DB
  const session = await auth.getSession(event);

  // Populate locals with session context
  event.locals.user = session?.user || null;
  event.locals.session = session || null;

  // Organization context available in all handlers
  return resolve(event);
};

// +page.server.ts - Use organization context
export const load: PageServerLoad = async ({ locals }) => {
  const { user, session } = locals;

  if (!session?.activeOrganizationId) {
    throw error(403, 'No active organization');
  }

  // All queries scoped to active organization
  const content = await db.query.content.findMany({
    where: eq(content.organizationId, session.activeOrganizationId)
  });

  return { content };
};
```

**Client-Side (Svelte Store)**:

```typescript
// Auth store exposes organization context
import { authStore } from '$lib/stores/auth';

$: organizationId = $authStore.session?.activeOrganizationId;
$: organizationRole = $authStore.session?.organizationRole;
```

---

## Row-Level Security (RLS)

### RLS Philosophy

**Defense in depth**: RLS policies provide **database-level** enforcement of multi-tenant isolation, complementing application-level authorization.

```
Layer 1: Application Guards (route protection)
         ↓
Layer 2: Query-Level Filtering (application code)
         ↓
Layer 3: Row-Level Security (database enforcement)
```

Even if application code has a bug, RLS policies prevent data leaks between organizations.

### Phase 1 vs Phase 2+ RLS

**Phase 1**:
- RLS policies **designed and documented** but **not enforced**
- Single organization makes RLS unnecessary (no risk of cross-org data access)
- Policies tested but not enabled in production

**Phase 2+**:
- RLS policies **enabled** on all multi-tenant tables
- Database automatically filters rows based on session context
- Prevents accidental data leaks when multiple organizations exist

### RLS Policy Patterns

#### Pattern 1: Organization Member Visibility

Users can only see organization members of orgs they belong to:

```sql
-- Enable RLS on organization_member table
ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;

-- Policy: Users see members of organizations they belong to
CREATE POLICY org_member_view ON organization_member
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
        AND om.userId = current_user_id()  -- Custom function returning session userId
    )
  );
```

#### Pattern 2: Organization Owner Full Access

Organization owners have full control over their org's data:

```sql
-- Policy: Organization owners can manage invitations
CREATE POLICY org_invitation_owner_manage ON organization_invitation
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM organization_member
      WHERE organizationId = organization_invitation.organizationId
        AND userId = current_user_id()
        AND role = 'owner'
    )
  );
```

#### Pattern 3: Admin or Owner Access

Admins and owners share elevated permissions:

```sql
-- Policy: Admins and owners can view/edit content
CREATE POLICY content_admin_edit ON content
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM organization_member
      WHERE organizationId = content.organizationId
        AND userId = current_user_id()
        AND role IN ('owner', 'admin')
    )
  );
```

#### Pattern 4: Self-Service Operations

Users can accept invitations sent to their email:

```sql
-- Policy: Users can accept invitations sent to their email
CREATE POLICY org_invitation_self_accept ON organization_invitation
  FOR UPDATE
  USING (
    email = current_user_email()  -- Custom function returning session email
    AND acceptedAt IS NULL
  );
```

### RLS Helper Functions

Custom PostgreSQL functions provide session context to RLS policies:

```sql
-- Function: Get current user ID from session context
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;

-- Function: Get current user email from session context
CREATE OR REPLACE FUNCTION current_user_email()
RETURNS VARCHAR AS $$
  SELECT current_setting('app.user_email', TRUE);
$$ LANGUAGE SQL STABLE;

-- Function: Get active organization ID from session context
CREATE OR REPLACE FUNCTION active_org_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.active_org_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;
```

### Setting Session Context for RLS

Before executing queries, set session variables for RLS:

```typescript
// Set session context for RLS evaluation
await db.execute(sql`
  SELECT
    set_config('app.user_id', ${session.userId}, true),
    set_config('app.user_email', ${session.userEmail}, true),
    set_config('app.active_org_id', ${session.activeOrganizationId}, true)
`);

// Now all queries respect RLS policies
const members = await db.query.organizationMember.findMany();
// RLS automatically filters to current user's organizations
```

### RLS Policy Templates

**Content Table** (organization-scoped):

```sql
ALTER TABLE content ENABLE ROW LEVEL SECURITY;

-- View: Members see their org's content
CREATE POLICY content_view ON content
  FOR SELECT
  USING (
    organizationId = active_org_id()
    OR EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = content.organizationId
        AND userId = current_user_id()
    )
  );

-- Insert: Members can create content in their org
CREATE POLICY content_insert ON content
  FOR INSERT
  WITH CHECK (
    organizationId = active_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = content.organizationId
        AND userId = current_user_id()
        AND role IN ('owner', 'admin', 'creator')
    )
  );

-- Update: Owners/admins/creators can edit their org's content
CREATE POLICY content_update ON content
  FOR UPDATE
  USING (
    organizationId = active_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = content.organizationId
        AND userId = current_user_id()
        AND role IN ('owner', 'admin', 'creator')
    )
  );

-- Delete: Only owners can delete content
CREATE POLICY content_delete ON content
  FOR DELETE
  USING (
    organizationId = active_org_id()
    AND EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = content.organizationId
        AND userId = current_user_id()
        AND role = 'owner'
    )
  );
```

---

## Query Patterns

### Organization-Scoped Query Pattern

**Golden Rule**: Every query on multi-tenant data **must** include `organizationId` filter.

```typescript
// GOOD: Explicit organization scoping
const content = await db.query.content.findMany({
  where: eq(content.organizationId, session.activeOrganizationId)
});

// BAD: Missing organization filter (only safe with RLS enabled)
const content = await db.query.content.findMany();
```

### Common Query Patterns

#### Pattern 1: Load Organization's Resources

```typescript
// Load all content for active organization
export async function loadOrganizationContent(organizationId: string) {
  return await db.query.content.findMany({
    where: eq(content.organizationId, organizationId),
    orderBy: desc(content.createdAt)
  });
}

// Load organization members
export async function loadOrganizationMembers(organizationId: string) {
  return await db.query.organizationMember.findMany({
    where: eq(organizationMember.organizationId, organizationId),
    with: {
      user: true  // Include user details
    }
  });
}
```

#### Pattern 2: Check User's Organization Access

```typescript
// Verify user belongs to organization
export async function userBelongsToOrg(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const membership = await db.query.organizationMember.findFirst({
    where: and(
      eq(organizationMember.userId, userId),
      eq(organizationMember.organizationId, organizationId)
    )
  });

  return !!membership;
}

// Get user's role in organization
export async function getUserOrgRole(
  userId: string,
  organizationId: string
): Promise<OrganizationRole | null> {
  const membership = await db.query.organizationMember.findFirst({
    where: and(
      eq(organizationMember.userId, userId),
      eq(organizationMember.organizationId, organizationId)
    )
  });

  return membership?.role || null;
}
```

#### Pattern 3: Load User's Organizations

```typescript
// Get all organizations user belongs to (Phase 2+)
export async function getUserOrganizations(userId: string) {
  const memberships = await db.query.organizationMember.findMany({
    where: eq(organizationMember.userId, userId),
    with: {
      organization: true  // Include full organization details
    }
  });

  return memberships.map(m => ({
    organization: m.organization,
    role: m.role,
    joinedAt: m.joinedAt
  }));
}
```

#### Pattern 4: Admin Dashboard Queries

```typescript
// Admin dashboard: Revenue for organization
export async function getOrganizationRevenue(
  organizationId: string,
  startDate: Date,
  endDate: Date
) {
  return await db.query.purchase.findMany({
    where: and(
      eq(purchase.organizationId, organizationId),
      gte(purchase.createdAt, startDate),
      lte(purchase.createdAt, endDate)
    ),
    orderBy: desc(purchase.createdAt)
  });
}

// Admin dashboard: Customer list for organization
export async function getOrganizationCustomers(organizationId: string) {
  const purchases = await db.query.purchase.findMany({
    where: eq(purchase.organizationId, organizationId),
    with: {
      user: true  // Include customer details
    }
  });

  // Deduplicate customers
  const customerMap = new Map();
  purchases.forEach(p => {
    if (!customerMap.has(p.userId)) {
      customerMap.set(p.userId, p.user);
    }
  });

  return Array.from(customerMap.values());
}
```

#### Pattern 5: Cross-Organization Queries (Rare)

Some queries intentionally span multiple organizations:

```typescript
// Platform Owner: View all organizations
export async function getAllOrganizations() {
  return await db.query.organization.findMany({
    orderBy: desc(organization.createdAt)
  });

  // No organizationId filter - intentionally system-wide
}

// User: Get all organizations I belong to
export async function getMyOrganizations(userId: string) {
  return await db.query.organizationMember.findMany({
    where: eq(organizationMember.userId, userId),
    with: { organization: true }
  });

  // No single organizationId filter - user can belong to multiple orgs
}
```

### Query Guard Utilities

Helper functions enforce organization scoping:

```typescript
// Require organization context in session
export function requireOrganizationContext(session: Session | null): string {
  if (!session?.activeOrganizationId) {
    throw error(403, 'No active organization context');
  }
  return session.activeOrganizationId;
}

// Usage in route handler
export const load: PageServerLoad = async ({ locals }) => {
  const orgId = requireOrganizationContext(locals.session);

  // orgId is guaranteed to exist
  const content = await loadOrganizationContent(orgId);
  return { content };
};
```

---

## Phase Migration Strategy

### Phase 1: Single-Tenant Operations, Multi-Tenant Code

**Database**:
- Schema supports unlimited organizations
- Single organization created during setup
- RLS policies designed but not enforced

**Application Code**:
- All queries include `organizationId` filter
- Session includes `activeOrganizationId` (always same value)
- Guards check organization membership (even with one org)

**Why?**
- Tests multi-tenant patterns with zero risk
- Prepares codebase for Phase 2 without refactoring
- Enforces clean separation of concerns

### Phase 2: Multi-Organization Activation

**Changes Required**:

1. **Enable RLS Policies**:
   ```sql
   -- Run migration to enable RLS on all multi-tenant tables
   ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;
   ALTER TABLE content ENABLE ROW LEVEL SECURITY;
   ALTER TABLE offering ENABLE ROW LEVEL SECURITY;
   -- ... etc.
   ```

2. **Add Organization Creation UI**:
   - Platform Owner can create new organizations
   - Organization Owner can create additional organizations

3. **Add Organization Switcher**:
   - UI component showing user's available organizations
   - Clicking switches `activeOrganizationId` in session

4. **Update Session Logic**:
   - Handle multiple organizations in `availableOrganizations`
   - Support organization switching API endpoint

5. **Enable Creator Role**:
   - Update `organization_role` enum to include `creator`
   - Add UI for promoting `member` → `creator`

**What Doesn't Change**:
- Database schema (no migration)
- Query patterns (already organization-scoped)
- Authorization guards (already check organization membership)
- RLS policies (already written, just enabling)

### Phase 3+: Advanced Multi-Tenancy

**Phase 3 Additions**:
- Custom roles per organization
- Granular permissions beyond role-based
- Organization-specific workflows
- Advanced delegation

**Phase 4 Additions**:
- SSO per organization
- Organization-specific session policies
- White-label per organization
- Enterprise compliance features

---

## Database Schema Conventions

### Naming Conventions

**Tables with Organization Scoping**:
- Include `organizationId UUID` column (foreign key to `organization.id`)
- Index on `organizationId` for query performance
- RLS policies enabled (Phase 2+)

**Example**:
```sql
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizationId UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  title VARCHAR NOT NULL,
  -- ... other columns
  CONSTRAINT fk_content_org FOREIGN KEY (organizationId)
    REFERENCES organization(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_org ON content(organizationId);
```

### Organization-Scoped Tables

Tables that include `organizationId`:

- `content` - Videos, audio, written content
- `offering` - Events, services, programs (Phase 2+)
- `organization_member` - Team members
- `organization_invitation` - Pending invites
- `platform_settings` - Org-specific settings
- `purchase` - Customer purchases (tracks which org sold it)
- `subscription` - Customer subscriptions (Phase 2+)
- `booking` - Event/service bookings (Phase 2+)
- `review` - Content/offering reviews
- `analytics_event` - Tracking events
- `notification` - User notifications
- `credit_transaction` - Credit purchases/usage (Phase 2+)

### Non-Scoped Tables

Tables without `organizationId` (system-wide):

- `user` - Platform-wide user identity
- `session` - User sessions (includes `activeOrganizationId`)
- `verification_token` - Email/password reset tokens
- `organization` - Organizations themselves

### Foreign Key Cascade Rules

**DELETE CASCADE**: When organization deleted, remove related data:
```sql
organizationId UUID REFERENCES organization(id) ON DELETE CASCADE
```

**DELETE RESTRICT**: Prevent deletion if related data exists:
```sql
ownerId UUID REFERENCES user(id) ON DELETE RESTRICT
```

**DELETE SET NULL**: Clear reference but keep record:
```sql
invitedBy UUID REFERENCES user(id) ON DELETE SET NULL
```

---

## References

### Feature Documents Referencing Multi-Tenant Architecture

**Authentication & Authorization**:
- [Authentication EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md) - Primary source for user types, roles, session context
- [Authentication Phase 1 PRD](/home/user/codex/design/features/auth/pdr-phase-1.md) - Multi-tenant foundation
- [Authentication Phase 1 TDD](/home/user/codex/design/features/auth/ttd-dphase-1.md) - Session management implementation

**Admin Dashboard**:
- [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md) - Organization-scoped queries, access control
- Admin Dashboard Phase 1 PRD - Dashboard data scoping patterns
- Admin Dashboard Phase 1 TDD - Query implementation examples

**Platform Settings**:
- [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md) - Organization settings and isolation
- Platform Settings Phase 1 PRD - Settings ownership and access
- Platform Settings Phase 1 TDD - Settings storage and retrieval

**Content Management**:
- Content Access EVOLUTION - Content organization scoping
- Content Management PRD - Content ownership and permissions
- Content Management TDD - Content queries with org context

**E-Commerce**:
- Offerings PRD - Organization-scoped offerings
- Purchases PRD - Purchase tracking per organization
- Subscriptions PRD - Subscription scoping (Phase 2+)

### Related Core Documents

- [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md) - How features depend on multi-tenancy
- Database Schema - Full schema with organization relationships
- Testing Strategy - Testing multi-tenant isolation
- Security & Compliance - Data isolation requirements

---

## Appendix: Quick Reference

### Session Context Checklist

Every authenticated request should have:
- ✅ `session.userId` - Who is making the request
- ✅ `session.userRole` - Platform-level permissions
- ✅ `session.activeOrganizationId` - Which organization context
- ✅ `session.organizationRole` - Permissions within that organization

### Query Checklist

Before writing a query on multi-tenant data:
- ✅ Does it filter by `organizationId`?
- ✅ Is the organizationId from `session.activeOrganizationId`?
- ✅ Will this work correctly when multiple orgs exist?
- ✅ Is there an appropriate RLS policy defined?

### RLS Enablement Checklist (Phase 2)

For each multi-tenant table:
- ✅ `ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;`
- ✅ `CREATE POLICY {table}_view FOR SELECT ...`
- ✅ `CREATE POLICY {table}_insert FOR INSERT ...`
- ✅ `CREATE POLICY {table}_update FOR UPDATE ...`
- ✅ `CREATE POLICY {table}_delete FOR DELETE ...`
- ✅ Test policies with multiple organizations
- ✅ Test policies with users in different organizations

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Status**: Active - Reference Document
