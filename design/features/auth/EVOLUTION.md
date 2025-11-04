# Authentication & Authorization: Long-Term Evolution

**Purpose**: This document defines the complete evolution of Codex's authentication and authorization system from Phase 1 through Phase 4+. It serves as the single source of truth for architecture decisions and guides all phase-specific design documents.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Part 1: Core Principles

### Design Philosophy

1. **Build for multi-tenant from day one** - Phase 1 uses single org, but schema/code supports unlimited orgs without migration
2. **Database-enforced isolation** - Row-level security (RLS) policies prevent data leaks between organizations
3. **Clear role hierarchy** - Roles are scoped to platform level or organization level, never mixed
4. **Creator flexibility** - Creators can belong to multiple organizations (Phase 2+)
5. **Customer anonymity** - Customers don't need organization membership; they just purchase content
6. **Security-first defaults** - Guards, RLS, and signed URLs all work together

### User Types (Universal Across All Phases)

| User Type | Introduced | Scope | Belongs To | Key Trait |
|-----------|-----------|-------|-----------|-----------|
| **Platform Owner** | Phase 1 | System-wide | Single org (Phase 1) or multiple orgs (Phase 2+) | Super admin, full access |
| **Organization Owner** | Phase 1 | Organization | One or more organizations | Owns/operates organization, manages team |
| **Organization Admin** | Phase 1 | Organization | One or more organizations | Staff with elevated perms, manages content approval |
| **Creator** | Phase 2 | Organization | Multiple organizations possible | Freelancer, uploads content, belongs to 1+ orgs |
| **Customer** | Phase 1 | None (purchases from orgs) | Not a member, just purchases | Browses, purchases, subscribes |
| **Guest** | Phase 1 | Public only | None | Unauthenticated visitor |

---

## Part 2: Phase-by-Phase Evolution

### Phase 1: Foundation (Single Organization, Multi-Team Ready)

**When**: MVP launch
**Scope**: You + optional admins managing one organization
**Architecture**: Single-tenant for operations, multi-tenant for code

#### Phase 1 Components

**Authentication**
- Email/password registration and login
- Session management with activeOrganizationId context
- Cloudflare KV session caching
- Password reset flow
- Email verification

**Authorization**
- Platform-level role: `platform_owner` or `customer`
- Organization-level role: `owner`, `admin`, `member` (for staff)
- Guard functions for route protection
- RLS policies written but not enforced (single org is safe)

**Organization Model**
- Single organization created at setup (or you create it)
- Organization has: owner, optional admins, members (Phase 2 adds creators)
- Organization invitations for team members (creators added in Phase 2)
- Session tracks `activeOrganizationId` (used in Phase 2+ for switching)

**Database Schema**
```
user (platform_owner | customer)
  ├─ session (activeOrganizationId)
  ├─ verification_token
  └─ profile (minimal)

organization (1 for Phase 1)
  ├─ organization_member (owner, admin, member roles)
  ├─ organization_invitation (team invites)
  └─ platform_settings (branding, contact info)
```

**Session Context**
```typescript
{
  userId: string;
  userRole: 'platform_owner' | 'customer';
  activeOrganizationId?: string; // Set if user is org member
  organizationRole?: 'owner' | 'admin' | 'member';
}
```

#### Phase 1 Limitations (Intentional)

- Creators are invited as team members with `member` role (Phase 2 upgrades them)
- No custom membership tiers (Phase 2)
- No creator revenue tracking in auth (e-commerce feature)
- No multi-org switching UI (Phase 2)
- RLS policies not enforced (single org removes need)

#### Phase 1 Guard Functions

```typescript
require.auth(event)                    // Authenticated user
require.owner(event)                   // Organization owner only
require.admin(event)                   // Admin or owner
require.member(event)                  // Any org member
require.platformOwner(event)           // System admin only
```

---

### Phase 2: Multi-Organization & Creators (Enhanced)

**When**: 3-6 months after Phase 1
**Scope**: Multiple organizations, creators belong to many
**Changes**: Schema stays the same, code changes for multi-org support

#### Phase 2 Additions

**Creator Role Evolution**
- `member` role in Phase 1 becomes `creator` in Phase 2
- Creators can join multiple organizations
- Creators have their own dashboard showing all org memberships
- Organization admin can promote `member` → `creator`

**Multi-Organization Support**
- Platform Owner can create new organizations
- Organization Owner is a user who owns one+ organizations
- Users can belong to multiple organizations
- Session `activeOrganizationId` can be switched via UI
- Subdomain routing: `org1.revelations.com`, `org2.revelations.com`

**Custom Membership Tiers** (Designed but not enforced)
- Organizations can define custom roles: `gold_member`, `vip_subscriber`, etc.
- RLS policies optionally filter content by membership tier
- Used for content access control (not auth, but auth supports it)

**RLS Policies Enforced**
- Enable row-level security on organization-scoped tables
- Automatic tenant isolation at database layer
- Prevents accidental data leaks across organizations

**Database Schema Changes**
- None! Schema already supports multi-org
- Just enable RLS policies

#### Phase 2 Guard Functions

```typescript
// Phase 1 guards still work
require.auth(event)
require.owner(event)
require.admin(event)
require.member(event)
require.platformOwner(event)

// New Phase 2 guards
require.creator(event)                 // Creator role specifically
require.role(['owner', 'admin'], event)  // Array-based role check
require.organizationAccess(orgId, event)   // Check user can access org
```

#### Phase 2 Session Context

```typescript
{
  userId: string;
  userRole: 'platform_owner' | 'customer';
  activeOrganizationId: string;        // Now required for org members
  organizationRole: 'owner' | 'admin' | 'member' | 'creator';
  availableOrganizations: Organization[]; // For switching
}
```

---

### Phase 3: Advanced Permissions & Multi-Tenant Expansion

**When**: 6-9 months after Phase 2
**Scope**: Granular permissions, custom roles, enterprise features
**Changes**: Schema extensions, permission matrix system

#### Phase 3 Additions

**Custom Roles Per Organization**
- Organizations define their own roles (not just owner/admin/member)
- Example: `instructor`, `moderator`, `support_staff`
- Assign custom permissions to each role
- Permission matrix: action × role → allowed/denied

**Granular Permissions**
- Move beyond role-based to permission-based
- Example: `can_upload_content`, `can_approve_content`, `can_view_analytics`
- Roles are collections of permissions
- Users can have individual permission grants

**Invitation System Evolution**
- Team member invitations become flexible
- Support for different invitation types:
  - Creator invitation (join as creator)
  - Staff invitation (join as admin)
  - Subscriber invitation (customer signup with code)

**Database Schema Additions**
```
custom_role (per organization)
  ├─ name, description
  └─ permissions (JSON or separate table)

permission (system-wide or org-level)
  └─ action, resource, scope

user_permission (grant individual permissions)
  └─ userId, organizationId, permission
```

---

### Phase 4+: Enterprise & Advanced Features

**When**: 9+ months
**Scope**: SSO, SAML, audit logging, advanced delegation
**Changes**: Enterprise authentication layers

#### Phase 4 Additions

**Single Sign-On (SSO)**
- SAML/OIDC support for enterprise organizations
- Organization can configure their own IdP
- Automatic user provisioning from IdP

**Audit Logging**
- Track all auth events: login, logout, permission changes
- Compliance: who did what, when, from where
- Exportable audit trail

**Advanced Delegation**
- Users can temporarily delegate access to others
- Example: "I need someone to manage my account for 1 week"
- Expirable delegations

**Session Policies**
- Organization can enforce session policies
- Example: "Sessions must be from approved IP ranges"
- Example: "Re-authenticate for sensitive actions"

**Multi-Factor Authentication (MFA)**
- Phase 1 has foundation for MFA
- Phase 4 makes it enterprise-grade
- Optional per organization, required for Platform Owner

---

## Part 3: Database Schema (Complete Evolution)

### Phase 1-2 Core Tables

```sql
-- User: Platform-wide identity
CREATE TABLE "user" (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  emailVerified BOOLEAN DEFAULT FALSE,
  name VARCHAR NOT NULL,
  role user_role DEFAULT 'customer', -- 'platform_owner' | 'customer'
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
CREATE TYPE user_role AS ENUM ('platform_owner', 'customer');

-- Session: Multi-org aware
CREATE TABLE session (
  id UUID PRIMARY KEY,
  userId UUID REFERENCES "user"(id) ON DELETE CASCADE,
  token VARCHAR UNIQUE NOT NULL,
  expiresAt TIMESTAMP,
  activeOrganizationId UUID REFERENCES organization(id) ON DELETE SET NULL,
  ipAddress VARCHAR,
  userAgent VARCHAR,
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Verification tokens
CREATE TABLE verification_token (
  id UUID PRIMARY KEY,
  userId UUID REFERENCES "user"(id) ON DELETE CASCADE,
  token VARCHAR UNIQUE NOT NULL,
  type verification_type DEFAULT 'email',
  expiresAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW()
);
CREATE TYPE verification_type AS ENUM ('email', 'password_reset');

-- Organization: Multi-tenant container
CREATE TABLE organization (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL, -- For subdomain routing
  ownerId UUID REFERENCES "user"(id) ON DELETE RESTRICT,
  logoUrl TEXT,
  primaryColorHex VARCHAR(7) DEFAULT '#3B82F6',
  businessName VARCHAR,
  contactEmail VARCHAR,
  timezone VARCHAR DEFAULT 'UTC',
  description TEXT,
  isPublic BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_organization_owner ON organization(ownerId);
CREATE INDEX idx_organization_slug ON organization(slug);

-- Organization members: Links users to orgs with roles
CREATE TABLE organization_member (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE,
  userId UUID REFERENCES "user"(id) ON DELETE CASCADE,
  role organization_role DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  joinedAt TIMESTAMP DEFAULT NOW(),
  invitedBy UUID REFERENCES "user"(id) ON DELETE SET NULL,
  invitedAt TIMESTAMP,
  CONSTRAINT unique_member_per_org UNIQUE(organizationId, userId)
);
CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'member');
CREATE INDEX idx_org_member_user ON organization_member(userId);
CREATE INDEX idx_org_member_org ON organization_member(organizationId);

-- Organization invitations: Pending member invites
CREATE TABLE organization_invitation (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE,
  email VARCHAR NOT NULL,
  role organization_role DEFAULT 'member',
  invitedBy UUID REFERENCES "user"(id) ON DELETE SET NULL,
  token VARCHAR UNIQUE NOT NULL,
  expiresAt TIMESTAMP,
  acceptedAt TIMESTAMP,
  acceptedBy UUID REFERENCES "user"(id) ON DELETE SET NULL,
  rejectedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_org_invitation_email ON organization_invitation(email);
CREATE INDEX idx_org_invitation_org ON organization_invitation(organizationId);
```

### Phase 3+ Extensions (Custom Roles & Permissions)

```sql
-- Custom roles per organization
CREATE TABLE organization_role_definition (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL, -- 'instructor', 'moderator', etc.
  description TEXT,
  permissions JSONB, -- Or reference separate table
  createdAt TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_role_name_per_org UNIQUE(organizationId, name)
);

-- Permissions (system-wide or org-specific)
CREATE TABLE permission (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE, -- NULL = system-wide
  action VARCHAR NOT NULL, -- 'upload_content', 'approve_content', etc.
  resource VARCHAR NOT NULL, -- 'content', 'offerings', 'analytics'
  scope VARCHAR DEFAULT 'organization', -- 'organization' | 'global'
  createdAt TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_action_resource UNIQUE(organizationId, action, resource)
);

-- User-specific permission grants (individual overrides)
CREATE TABLE user_permission (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE,
  userId UUID REFERENCES "user"(id) ON DELETE CASCADE,
  permissionId UUID REFERENCES permission(id) ON DELETE CASCADE,
  grantedAt TIMESTAMP DEFAULT NOW(),
  grantedBy UUID REFERENCES "user"(id),
  CONSTRAINT unique_user_permission UNIQUE(userId, permissionId)
);

-- Session policies (Phase 4)
CREATE TABLE session_policy (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id) ON DELETE CASCADE,
  maxSessionDuration INTEGER, -- seconds
  requireMFA BOOLEAN DEFAULT FALSE,
  allowedIpRanges JSONB, -- IP whitelist
  reAuthIntervalMinutes INTEGER, -- Re-auth for sensitive actions
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

### RLS Policies (Phase 2+)

```sql
-- Organization members: Only members of same org can see
ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_member_view ON organization_member
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
      AND om.userId = current_user_id()
    )
  );

-- Organization invitations: Only admins of org can see
ALTER TABLE organization_invitation ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_invitation_admin_view ON organization_invitation
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = organization_invitation.organizationId
      AND userId = current_user_id()
      AND role IN ('owner', 'admin')
    )
  );

-- User can accept invitation sent to their email
CREATE POLICY org_invitation_self_accept ON organization_invitation
  FOR UPDATE USING (
    email = current_user_email()
    AND acceptedAt IS NULL
  );
```

---

## Part 4: Session Management Evolution

### Phase 1: Simple Session Context

```typescript
interface Session {
  userId: string;
  userEmail: string;
  userRole: 'platform_owner' | 'customer';
  activeOrganizationId?: string;
  organizationRole?: 'owner' | 'admin' | 'member';
}
```

**Where it comes from:**
1. User logs in via email/password
2. Auth worker determines activeOrganizationId (their org or default)
3. Session stored in DB, cached in KV
4. Cookie set in browser
5. Middleware extracts session and populates `event.locals`

**Lifecycle:**
- Created: Login
- Cached: KV (fast lookups)
- Invalidated: Logout, password change
- Expired: TTL (24 hours default)

### Phase 2: Multi-Organization Context

```typescript
interface Session {
  userId: string;
  userEmail: string;
  userRole: 'platform_owner' | 'customer';
  activeOrganizationId: string; // Required for org members
  organizationRole: 'owner' | 'admin' | 'member' | 'creator';
  availableOrganizations: Organization[]; // For switching
  switchedAt?: Date; // Last org switch
}
```

**New behaviors:**
- User can switch organization in session
- Middleware re-validates access to requested org
- Available orgs cached in session for fast switching

### Phase 3+: Policy-Aware Sessions

```typescript
interface Session {
  // ... Phase 2 fields
  policies: SessionPolicy[];
  requiresMFA?: boolean;
  lastMFACheck?: Date;
  permissions: string[]; // Computed from role + custom grants
}
```

**New behaviors:**
- Session validates against org policies
- MFA checked if required
- Permissions pre-computed for faster auth checks

---

## Part 5: Guard Functions Evolution

### Phase 1 Guards

```typescript
require.auth(event)                 // Any authenticated user
require.owner(event)                // Org owner (own org only)
require.admin(event)                // Org admin or owner
require.member(event)               // Any org member
require.platformOwner(event)       // System admin
```

### Phase 2 Additions

```typescript
require.creator(event)              // Creator role specifically
require.role(['owner', 'admin'], event)  // Array-based checks
require.organizationAccess(orgId, event)  // Can access specific org
```

### Phase 3+ Additions

```typescript
require.permission('upload_content', event)  // Permission-based
require.permission(['upload_content', 'approve_content'], event)
require.policyCompliant(event)              // Meets org policies
```

---

## Part 6: Invitations Evolution

### Phase 1: Team Member Invitations

**Purpose**: Invite staff/team members to manage platform
**Sent to**: Email addresses
**Role**: `member` (becomes `creator` in Phase 2)
**Expires**: 7 days
**Acceptance**: Email link + account creation or login

**Flow:**
```
Org Owner invites: instructor@example.com (role=member)
  ↓
Email sent with token: /invite/accept?token=xyz
  ↓
User signs up or logs in
  ↓
User clicks link, automatically added to org
  ↓
User is now organization_member with role=member
```

### Phase 2: Creator Invitations

**Purpose**: Invite creators to join organization
**Similar to Phase 1 but:**
- Role is `creator` (not member)
- Creator can be invited to multiple orgs
- Creator has dashboard showing all org memberships

### Phase 2: Subscriber Invitations (Future)

**Purpose**: Send customer signup codes (different system, not auth)
**Note**: Customers don't use org invitations; they just purchase

### Phase 3+: Flexible Invitations

**New types:**
- Admin invitations (role=admin)
- Custom role invitations
- Conditional invitations (e.g., "join as instructor only for 2025")

---

## Part 7: Integration Points

### With Content Access
- Auth provides `activeOrganizationId` → Content Access scopes queries
- RLS ensures customer can't see other org's content
- Session context passed to content service

### With Admin Dashboard
- Auth guards protect `/admin/*` routes
- `require.owner()` / `require.admin()` gating
- Organization context used to scope all data

### With Platform Settings
- Auth guards protect `/settings` routes
- `require.owner()` only
- Organization ID determines which settings are loaded

### With E-Commerce / Offerings
- Auth provides `userId` and `activeOrganizationId`
- Purchases linked to organization
- Offerings scoped to organization

### With Notifications
- Auth session info passed to email service
- Organization contact info used for sender
- User email from session context

---

## Part 8: Security Architecture (Complete)

### Three Layers of Protection

**Layer 1: Application Guards**
```typescript
if (!event.locals.userId) throw redirect('/login');
if (event.locals.organizationRole !== 'owner') throw error(403);
```

**Layer 2: Database-Level Access Control (RLS)**
```sql
CREATE POLICY org_member_view ON organization_member
  FOR SELECT USING (organizationId = active_org_id());
```

**Layer 3: Query-Level Scoping**
```typescript
const members = await db.query.organizationMember.findMany({
  where: eq(organizationMember.organizationId, organizationId)
});
```

### Key Security Principles

1. **Default deny**: Access rejected unless explicitly granted
2. **Defense in depth**: Multiple layers (guards + RLS + queries)
3. **Fail secure**: Errors result in denial, not accidental grants
4. **Audit trail**: All auth events logged
5. **Token security**: Short TTL, signed tokens, rotation

---

## Part 9: Future Extensions (Phase 4+)

### SSO/SAML
- Organization configures their IdP
- Automatic user provisioning
- Sync role/group membership from IdP

### Advanced Delegation
- User A delegates access to User B for set period
- Granular: delegate specific organization, specific permissions
- Audit all delegated actions

### Audit Logging
- Every auth action logged with: who, what, when, where, why
- Exportable audit trail for compliance
- Real-time alerts for anomalies

### Session Policies
- Organization can enforce policies:
  - "Must re-authenticate every 4 hours"
  - "Only allow logins from these IP ranges"
  - "Require MFA for admin actions"

---

## Part 10: Implementation Roadmap

### Phase 1 (Weeks 1-4)
- [ ] Create user table with role enum
- [ ] Create organization table (1 org)
- [ ] Create organization_member table
- [ ] Implement BetterAuth with organization plugin
- [ ] Create session management with KV caching
- [ ] Implement guard functions
- [ ] Write RLS policy templates (not enforced)
- [ ] Create login/registration flows

### Phase 2 (After Phase 1 + 4 weeks)
- [ ] Enable RLS policies (no schema changes)
- [ ] Add organization creation UI
- [ ] Implement org switcher
- [ ] Add Creator role to organization_role enum
- [ ] Update guards for creator support
- [ ] Add subdomain routing
- [ ] Test multi-org data isolation

### Phase 3 (After Phase 2 + 4 weeks)
- [ ] Design custom role system
- [ ] Create organization_role_definition table
- [ ] Implement permission matrix
- [ ] Add UI for custom role creation
- [ ] Update guards for permission checks

### Phase 4+ (Future)
- [ ] Add SSO/SAML support
- [ ] Implement audit logging
- [ ] Add MFA enforcement
- [ ] Implement session policies

---

## Conclusion

This document defines the complete evolution of Codex's auth system. Each phase builds on the previous without breaking changes because:

1. **Schema is future-proof**: Supports multi-tenant from day one
2. **Code is extensible**: Guards and services accept new parameters
3. **RLS is prepared**: Policies written but enforced gradually
4. **Roles are flexible**: New roles added without enum changes

This allows fast Phase 1 delivery while building toward enterprise-grade Phase 4 features.

---

**See Also:**
- Phase 1 specifics: [pdr-phase-1.md](./pdr-phase-1.md) (user stories)
- Phase 1 implementation: [ttd-dphase-1.md](./ttd-dphase-1.md) (technical details)
- Full design foundation: [PHASE_1_AUTH_DESIGN.md](../../PHASE_1_AUTH_DESIGN.md) (detailed architecture)
