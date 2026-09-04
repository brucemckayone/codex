# Codex Phase 1: Multi-Tenant Authentication Design

**Status**: Architecture Document - Phase 1 Implementation
**Last Updated**: 2025-11-04
**Scope**: Backend Authentication & Authorization (Database schema, RLS policies, guard functions, auth worker integration)

---

## Executive Summary

This document defines the authentication and authorization system for Codex Phase 1, designed with multi-tenant extensibility built into the foundation.

**Phase 1 Focus:**
- Single organization (your platform)
- Organization owner + optional admins can manage the platform
- Customers/subscribers browse and purchase (no organization membership)
- Creators added in Phase 2+
- Custom membership tiers (levels/permissions) added in Phase 2+

**Architecture is built for multi-tenant from day one** - when Phase 2 launches, we activate the multi-org features without schema changes.

---

## Part 1: User Role Hierarchy

### Core Roles & Their Scope

| Role | Scope | Manages | Belongs To | Phase |
|------|-------|---------|-----------|-------|
| **Platform Owner** (You) | System-wide | Organizations, billing, system settings | None (root) | 1 |
| **Organization Owner** | Organization | Team, content approval, org settings, offerings | 1+ orgs | 1+ |
| **Organization Admin** | Organization | Content approval, team, customer support | 1+ orgs | 1+ |
| **Creator** | Organization | Own content, offerings | 1+ orgs | 2+ |
| **Customer/Subscriber** | None | Profile, purchases, bookings | None | 1+ |
| **Guest** | None | None | None | 1+ |

### Permission Matrix (Phase 1)

```
ACTION                          | Platform Owner | Org Owner | Org Admin | Creator | Customer | Guest
─────────────────────────────────────────────────────────────────────────────────────────────────────
Browse public content           |       ✓        |     ✓     |     ✓     |    ✓    |    ✓     |   ✓
View organization settings      |       ✓        |     ✓     |     ✓     |    ✗    |    ✗     |   ✗
Edit organization settings      |       ✓        |     ✓     |     ✗     |    ✗    |    ✗     |   ✗
Invite/manage team members      |       ✓        |     ✓     |     ✓     |    ✗    |    ✗     |   ✗
Approve/publish content         |       ✓        |     ✓     |     ✓     |    ✗    |    ✗     |   ✗
View organization analytics     |       ✓        |     ✓     |     ✓     |    ✗    |    ✗     |   ✗
Purchase/subscribe              |       ✓        |     ✓     |     ✓     |    ✓    |    ✓     |   ✓
View own subscriptions/library  |       ✓        |     ✓     |     ✓     |    ✓    |    ✓     |   ✗
Book offerings                  |       ✓        |     ✓     |     ✓     |    ✓    |    ✓     |   ✗
```

### Custom Membership Tiers (Phase 2+ Consideration)

*Note: Designed for, not implemented in Phase 1*

Organizations may want custom roles like:
- `gold_member` - Access to premium content
- `silver_member` - Access to standard content
- `vip_subscriber` - Early access to new offerings

**Schema ready for Phase 2:**
```typescript
// Custom role levels per organization
interface CustomMembershipTier {
  organizationId: string;
  tierName: string; // 'gold_member', 'vip', etc.
  description: string;
  permissions: string[]; // ['view_premium_content', 'early_access']
  priceMonthly?: number;
}
```

---

## Part 2: Database Schema

### BetterAuth Core Tables

```sql
-- User: Platform-wide identity (BetterAuth managed)
CREATE TABLE "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  emailVerified BOOLEAN DEFAULT FALSE,
  name VARCHAR(255),
  image TEXT,

  -- Platform-level role
  role user_role DEFAULT 'customer', -- 'platform_owner' | 'customer'

  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Session: Authentication state with organization context
CREATE TABLE session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expiresAt TIMESTAMP,

  -- Multi-tenant context: Which org is user currently acting as?
  -- This is SET when user logs in or switches organization
  -- NULL for customers (they don't belong to orgs)
  activeOrganizationId UUID REFERENCES organization(id) ON DELETE SET NULL,

  ipAddress VARCHAR(45),
  userAgent VARCHAR(500),
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Email verification tokens (BetterAuth managed)
CREATE TABLE verification_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  type verification_type DEFAULT 'email',
  expiresAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Enums
CREATE TYPE user_role AS ENUM ('platform_owner', 'customer');
CREATE TYPE verification_type AS ENUM ('email', 'password_reset');
```

### Organization Tables

```sql
-- Organization: Multi-tenant container
-- In Phase 1: One organization (you create it)
-- In Phase 2+: Many organizations (users create them)
CREATE TABLE organization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity: Used in subdomain routing (Phase 2+)
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL, -- 'yogastudio' → yogastudio.revelations.com

  -- Owner: Single owner per organization
  -- (Can be the same person owning multiple orgs)
  ownerId UUID NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,

  -- Business info (Phase 2: consider separate branding table)
  businessName VARCHAR(255),
  contactEmail VARCHAR(255),
  timezone VARCHAR(100) DEFAULT 'UTC',

  -- Branding (Phase 2: move to separate table)
  logoUrl TEXT,
  primaryColorHex VARCHAR(7) DEFAULT '#3B82F6',
  description TEXT,

  -- Visibility
  isPublic BOOLEAN DEFAULT TRUE,

  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Organization Members: Links users to organizations
-- Only for team members (admins, creators, etc.)
-- Customers/subscribers NOT in this table
CREATE TABLE organization_member (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizationId UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  userId UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Role within this organization (extensible for Phase 2+)
  role organization_role DEFAULT 'member', -- 'owner' | 'admin' | 'member' (creator)

  -- Metadata
  joinedAt TIMESTAMP DEFAULT NOW(),
  invitedBy UUID REFERENCES "user"(id) ON DELETE SET NULL,
  invitedAt TIMESTAMP,

  -- Constraints
  CONSTRAINT unique_member_per_org UNIQUE(organizationId, userId)
);

-- Organization Invitations: Pending team member invites
-- ONLY for inviting creators/staff, NOT for customer subscriptions
CREATE TABLE organization_invitation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizationId UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role organization_role DEFAULT 'member',

  -- Who invited this person
  invitedBy UUID NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,

  -- Token for accepting invitation
  token VARCHAR(255) UNIQUE NOT NULL,
  expiresAt TIMESTAMP DEFAULT NOW() + INTERVAL '7 days',

  -- Response
  acceptedAt TIMESTAMP,
  acceptedBy UUID REFERENCES "user"(id) ON DELETE SET NULL,
  rejectedAt TIMESTAMP,

  createdAt TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_email CHECK (
    email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'
  )
);

-- Enums
CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'member');

-- Indexes
CREATE INDEX idx_organization_owner ON organization(ownerId);
CREATE INDEX idx_organization_member_user ON organization_member(userId);
CREATE INDEX idx_organization_member_org ON organization_member(organizationId);
CREATE INDEX idx_organization_invitation_email ON organization_invitation(email);
```

---

## Part 3: Session & Authentication Context

### Where Auth Context Comes From

**Session creation flow (when user logs in):**

```
User submits: email + password
    ↓
Auth Worker (BetterAuth) validates credentials against database
    ↓
If valid:
  1. Create session record in `session` table
  2. Determine activeOrganizationId:
     - If user.role = 'platform_owner' → Set to their organization (Phase 1)
     - If user is organization member → Set to their organization
     - If user is customer → activeOrganizationId = NULL
  3. Generate JWT token
  4. Store session in Cloudflare KV (cache, TTL = expiry time)
  5. Return JWT in HTTP-only cookie
    ↓
Browser stores cookie automatically
    ↓
On next request, middleware extracts session
```

### Session Context Object (After Login)

```typescript
// This object is available in all authenticated requests
// It comes from three sources: JWT token, session lookup, and middleware enrichment

interface AuthContext {
  // User identity (from JWT)
  userId: string;
  userEmail: string;
  userRole: 'platform_owner' | 'customer';

  // Organization context (from session + membership lookup)
  // ✓ Platform Owner: activeOrganizationId = their default org
  // ✓ Organization member: activeOrganizationId = their org
  // ✓ Customer: activeOrganizationId = null
  activeOrganizationId?: string;
  organizationMemberId?: string; // Their membership record ID
  organizationRole?: 'owner' | 'admin' | 'member';

  // Security info
  sessionId: string;
  sessionExpiresAt: Date;
}

// EXAMPLE: Studio Owner (Org Admin)
{
  userId: 'user_123',
  userEmail: 'owner@yogastudio.com',
  userRole: 'customer', // Yes, at platform level they're a customer
  activeOrganizationId: 'org_456',
  organizationMemberId: 'member_789',
  organizationRole: 'owner'
}

// EXAMPLE: Regular Customer
{
  userId: 'user_000',
  userEmail: 'student@example.com',
  userRole: 'customer',
  activeOrganizationId: undefined, // NOT a member
  organizationRole: undefined
}

// EXAMPLE: Platform Owner (You)
{
  userId: 'user_bruce',
  userEmail: 'bruce@codex.com',
  userRole: 'platform_owner',
  activeOrganizationId: 'org_1', // Your organization
  organizationRole: 'owner'
}
```

### How activeOrganizationId Gets Set & Passed

**During Login (Auth Worker):**
```typescript
// workers/auth/src/handlers/login.ts

async function handleLogin(event: RequestEvent) {
  const { email, password } = await event.request.json();

  // 1. Validate credentials against `user` table
  const user = await validateCredentials(email, password);
  if (!user) return error('Invalid credentials');

  // 2. Determine activeOrganizationId based on user role
  let activeOrganizationId: string | null = null;

  if (user.role === 'platform_owner') {
    // Platform owner: Set to their organization (created during setup)
    const userOrg = await db.query.organization.findFirst({
      where: eq(organization.ownerId, user.id)
    });
    activeOrganizationId = userOrg?.id || null;
  } else {
    // Regular user: Check if they're a member of any organization
    const membership = await db.query.organizationMember.findFirst({
      where: eq(organizationMember.userId, user.id)
    });
    activeOrganizationId = membership?.organizationId || null;
  }

  // 3. Create session with activeOrganizationId
  const session = await createSession({
    userId: user.id,
    activeOrganizationId, // ← SET HERE
    token: generateToken(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });

  // 4. Cache in Cloudflare KV
  await kv.put(
    `session:${session.token}`,
    JSON.stringify({
      userId: session.userId,
      activeOrganizationId: session.activeOrganizationId,
      role: user.role
    }),
    { expirationTtl: 86400 } // 24 hours
  );

  // 5. Return to client
  return response.withCookie({
    name: 'auth-token',
    value: session.token,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  });
}
```

**In SvelteKit Middleware:**
```typescript
// apps/web/src/hooks.server.ts

async function sessionHandler({ event, resolve }) {
  // 1. Extract token from cookie
  const token = event.cookies.get('auth-token');
  if (!token) {
    event.locals.session = null;
    return resolve(event);
  }

  // 2. Check Cloudflare KV cache first (fast, <10ms)
  const cached = await event.platform?.env?.SESSION_KV?.get(
    `session:${token}`,
    'json'
  );

  if (cached) {
    // Cache hit!
    event.locals.userId = cached.userId;
    event.locals.userRole = cached.role;
    event.locals.activeOrganizationId = cached.activeOrganizationId; // ← FROM CACHE
    event.locals.session = cached;
    return resolve(event);
  }

  // 3. Cache miss: Fetch from database
  const session = await db.query.session.findFirst({
    where: eq(session.token, token),
    with: { user: true }
  });

  if (!session) {
    event.locals.session = null;
    return resolve(event);
  }

  // 4. Populate event.locals with context
  event.locals.userId = session.userId;
  event.locals.userRole = session.user.role;
  event.locals.activeOrganizationId = session.activeOrganizationId; // ← FROM DB
  event.locals.session = session;

  // 5. Re-cache for next request
  await event.platform?.env?.SESSION_KV?.put(
    `session:${token}`,
    JSON.stringify({
      userId: session.userId,
      activeOrganizationId: session.activeOrganizationId,
      role: session.user.role
    }),
    { expirationTtl: 86400 }
  );

  return resolve(event);
}
```

**In Route Handlers:**
```typescript
// src/routes/admin/settings/+page.server.ts

export async function load(event: RequestEvent) {
  // activeOrganizationId is already in event.locals
  // It was set by middleware during session validation
  const { activeOrganizationId } = event.locals;

  if (!activeOrganizationId) {
    throw error(403, 'Not an organization member');
  }

  // Use it to scope queries
  const settings = await db.query.organization.findFirst({
    where: eq(organization.id, activeOrganizationId)
  });

  return { settings };
}
```

---

## Part 4: Row-Level Security (RLS) Policies

### RLS Strategy

PostgreSQL RLS enforces tenant isolation at the database layer - a second line of defense after application-level checks.

**For Phase 1**: RLS policies are written but commented out (single-tenant is safe)
**For Phase 2+**: Uncomment RLS policies for automatic enforcement

### RLS Policy Templates

```sql
-- ===== ORGANIZATION MEMBERS TABLE =====
ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;

-- Members can see other members in their organization
CREATE POLICY org_member_view ON organization_member
  FOR SELECT
  USING (
    -- User can see members if:
    -- 1. User is an org owner/admin, OR
    -- 2. User is themselves a member of that org
    EXISTS (
      SELECT 1 FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
      AND om.userId = current_user_id()
    )
  );

-- Only org admins can insert members
CREATE POLICY org_member_insert ON organization_member
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
      AND om.userId = current_user_id()
      AND om.role IN ('owner', 'admin')
    )
  );

-- Only org owners can delete members
CREATE POLICY org_member_delete ON organization_member
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
      AND om.userId = current_user_id()
      AND om.role = 'owner'
    )
  );


-- ===== ORGANIZATION INVITATIONS TABLE =====
ALTER TABLE organization_invitation ENABLE ROW LEVEL SECURITY;

-- Only org admins can view/manage invitations
CREATE POLICY org_invitation_view ON organization_invitation
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = organization_invitation.organizationId
      AND userId = current_user_id()
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY org_invitation_insert ON organization_invitation
  FOR INSERT
  WITH CHECK (
    -- Only admins can create invitations
    EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = organization_invitation.organizationId
      AND userId = current_user_id()
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY org_invitation_accept ON organization_invitation
  FOR UPDATE
  USING (
    -- User can accept an invitation sent to their email
    email = current_user_email()
    AND acceptedAt IS NULL
  )
  WITH CHECK (
    -- Can only accept, not modify other fields
    acceptedAt IS NOT NULL
    AND acceptedBy = current_user_id()
  );


-- ===== ORGANIZATION TABLE (Read-Only) =====
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;

-- Anyone can view public organizations
CREATE POLICY org_view_public ON organization
  FOR SELECT
  USING (
    isPublic = TRUE
    OR ownerId = current_user_id()
    OR EXISTS (
      SELECT 1 FROM organization_member
      WHERE organizationId = organization.id
      AND userId = current_user_id()
    )
  );

-- Only owner can modify organization
CREATE POLICY org_update ON organization
  FOR UPDATE
  USING (ownerId = current_user_id() OR is_platform_owner(current_user_id()))
  WITH CHECK (ownerId = current_user_id() OR is_platform_owner(current_user_id()));
```

### Helper Functions for RLS

```sql
-- Get current user ID from JWT claims
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'sub')::uuid;
$$ LANGUAGE SQL STABLE;

-- Get current user email
CREATE OR REPLACE FUNCTION current_user_email() RETURNS VARCHAR AS $$
  SELECT (auth.jwt() ->> 'email');
$$ LANGUAGE SQL STABLE;

-- Check if user is platform owner
CREATE OR REPLACE FUNCTION is_platform_owner(user_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM "user"
    WHERE id = user_id AND role = 'platform_owner'
  );
$$ LANGUAGE SQL STABLE;
```

---

## Part 5: Guard Functions (Access Control)

### Simplified Guard Pattern with Role Arrays

```typescript
// packages/web/src/lib/server/guards.ts

import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Require user to be authenticated
 */
export function requireAuth(event: RequestEvent) {
  if (!event.locals.userId) {
    throw redirect(303, `/login?redirect=${encodeURIComponent(event.url.pathname)}`);
  }
  return { userId: event.locals.userId };
}

/**
 * Require specific platform-level role(s)
 * @param allowedRoles Array of allowed platform roles
 */
export function requirePlatformRole(
  event: RequestEvent,
  allowedRoles: string[]
): { userId: string } {
  const { userId } = requireAuth(event);
  const userRole = event.locals.userRole;

  if (!allowedRoles.includes(userRole)) {
    throw redirect(303, '/access-denied?reason=insufficient-role');
  }

  return { userId };
}

/**
 * Require specific organization-level role(s)
 * @param allowedRoles Array of allowed organization roles
 */
export function requireOrganizationRole(
  event: RequestEvent,
  allowedRoles: string[]
) {
  const { userId } = requireAuth(event);
  const { activeOrganizationId, organizationRole } = event.locals;

  if (!activeOrganizationId) {
    throw redirect(303, '/access-denied?reason=not-member');
  }

  if (!allowedRoles.includes(organizationRole || '')) {
    throw redirect(303, '/access-denied?reason=insufficient-org-role');
  }

  return { userId, organizationId: activeOrganizationId, role: organizationRole };
}

/**
 * Require user to be organization member (any role)
 */
export function requireOrganizationMember(event: RequestEvent) {
  const { userId } = requireAuth(event);
  const { activeOrganizationId, organizationRole } = event.locals;

  if (!activeOrganizationId) {
    throw redirect(303, '/access-denied?reason=not-member');
  }

  return { userId, organizationId: activeOrganizationId, role: organizationRole };
}

/**
 * Shorthand guards for common role checks
 */
export const require = {
  auth: (event: RequestEvent) => requireAuth(event),
  owner: (event: RequestEvent) => requireOrganizationRole(event, ['owner']),
  admin: (event: RequestEvent) => requireOrganizationRole(event, ['owner', 'admin']),
  member: (event: RequestEvent) => requireOrganizationMember(event),
  platformOwner: (event: RequestEvent) => requirePlatformRole(event, ['platform_owner']),
};
```

### Usage in Routes

```typescript
// Example: Organization settings (owner only)
// src/routes/[org]/admin/settings/+page.server.ts

import { require } from '$lib/server/guards';

export async function load(event: RequestEvent) {
  const { organizationId } = require.owner(event);

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId)
  });

  return { organization: org };
}

export const actions = {
  updateSettings: async (event) => {
    const { organizationId } = require.owner(event);
    const formData = await event.request.formData();

    await db.update(organization)
      .set({
        logoUrl: formData.get('logoUrl'),
        primaryColorHex: formData.get('primaryColorHex')
      })
      .where(eq(organization.id, organizationId));

    return { success: true };
  }
};
```

```typescript
// Example: Approve content (admin+)
// src/routes/[org]/admin/content/+page.server.ts

import { require } from '$lib/server/guards';

export async function load(event: RequestEvent) {
  const { organizationId } = require.admin(event); // Admin or owner

  const content = await db.query.content.findMany({
    where: eq(content.organizationId, organizationId)
  });

  return { content };
}

export const actions = {
  publishContent: async (event) => {
    const { organizationId } = require.admin(event);
    const formData = await event.request.formData();
    const contentId = formData.get('contentId');

    // Verify content belongs to this org
    const item = await db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId)
      )
    });

    if (!item) throw error(404, 'Content not found');

    await db.update(content)
      .set({ status: 'published' })
      .where(eq(content.id, contentId));

    return { success: true };
  }
};
```

---

## Part 6: Query Scoping (Organization Isolation)

### Critical Rule: Always Include Organization ID

```typescript
// ✅ CORRECT: Scoped to organization
const members = await db
  .select()
  .from(organizationMember)
  .where(
    and(
      eq(organizationMember.organizationId, organizationId),
      eq(organizationMember.role, 'admin')
    )
  );

// ❌ WRONG: No organization check (data leak!)
const members = await db
  .select()
  .from(organizationMember)
  .where(eq(organizationMember.role, 'admin'));
```

### Member-Level Filtering in Content

Content should also support member-level filtering (Phase 2+):

```typescript
// Phase 2: Custom membership tiers
interface ContentAccess {
  contentId: string;
  organizationId: string;
  requiredTier?: 'gold_member' | 'silver_member' | 'standard';
  requiredRole?: 'admin' | 'member';
}

// Query with member filtering
const visibleContent = await db
  .select()
  .from(content)
  .where(
    and(
      eq(content.organizationId, organizationId),
      or(
        eq(content.status, 'published'),
        eq(content.createdBy, userId) // User can see their own unpublished
      ),
      // Phase 2: Add tier/role filtering here
    )
  );
```

---

## Part 7: Invitations (Creators Only, Not Subscribers)

### Invitation Types

**Creator Invitation** (Team Member)
```
Used for: Inviting creators, admins, staff to manage content
Who can invite: Organization owner/admin
Expires: 7 days
Accept action: User joins organization as member
Effect: User gets organization_member record with role
```

**Customer Subscription** (NOT An Invitation)
```
Used for: Customers subscribing to content/offerings
Who initiates: Customer themselves (via purchase)
Mechanism: Purchase creates subscription record, NO invitation involved
Effect: Customer gains access, NO organization_member record
```

### Invitation Flow (Code)

```typescript
// Invite a creator to join organization
// src/routes/[org]/admin/invite-team/+page.server.ts

import { require } from '$lib/server/guards';

export const actions = {
  sendInvitation: async (event) => {
    const { organizationId } = require.admin(event);
    const formData = await event.request.formData();
    const email = formData.get('email');
    const role = formData.get('role'); // 'admin' or 'member'

    // Check user hasn't already invited this person
    const existing = await db.query.organizationInvitation.findFirst({
      where: and(
        eq(organizationInvitation.organizationId, organizationId),
        eq(organizationInvitation.email, email),
        isNull(organizationInvitation.acceptedAt),
        isNull(organizationInvitation.rejectedAt)
      )
    });

    if (existing) {
      return error(400, 'Invitation already sent');
    }

    // Create invitation
    const token = generateSecureToken();
    const invitation = await db.insert(organizationInvitation).values({
      organizationId,
      email,
      role,
      invitedBy: event.locals.userId,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }).returning();

    // Send email via notification service
    await sendEmail({
      to: email,
      template: 'organization-invitation',
      data: {
        inviterName: event.locals.user.name,
        organizationName: org.name,
        acceptLink: `${BASE_URL}/invite/accept?token=${token}`,
        expiresIn: '7 days'
      }
    });

    return { success: true, invitationId: invitation.id };
  }
};
```

```typescript
// Accept invitation
// src/routes/invite/accept/+page.server.ts

export async function load(event: RequestEvent) {
  const token = event.url.searchParams.get('token');

  if (!token) {
    throw error(400, 'Missing invitation token');
  }

  // Validate token exists and isn't expired
  const invitation = await db.query.organizationInvitation.findFirst({
    where: and(
      eq(organizationInvitation.token, token),
      gt(organizationInvitation.expiresAt, new Date()),
      isNull(organizationInvitation.acceptedAt)
    ),
    with: { organization: true }
  });

  if (!invitation) {
    throw error(400, 'Invalid or expired invitation');
  }

  return { invitation };
}

export const actions = {
  accept: async (event) => {
    const token = event.url.searchParams.get('token');
    const { userId } = require.auth(event);
    const user = await getUser(userId);

    // Get invitation
    const invitation = await db.query.organizationInvitation.findFirst({
      where: eq(organizationInvitation.token, token)
    });

    // Verify email matches
    if (user.email !== invitation.email) {
      return error(403, 'Invitation email does not match your account');
    }

    // Accept invitation
    await db.update(organizationInvitation)
      .set({
        acceptedAt: new Date(),
        acceptedBy: userId
      })
      .where(eq(organizationInvitation.id, invitation.id));

    // Add user as organization member
    await db.insert(organizationMember).values({
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
      joinedAt: new Date(),
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.invitedAt
    });

    // Update session to set activeOrganizationId
    // (User will need to log back in or we refresh their session)

    return { success: true };
  }
};
```

---

## Part 8: Multiple Organization Ownership

### Scenario: Owner of Multiple Organizations

```
User "Sarah" is the organization owner for:
  - Yoga Studio A (ownerId = sarah.id)
  - Yoga Studio B (ownerId = sarah.id)
  - Pilates Plus (ownerId = sarah.id)

When Sarah logs in:
  - session.activeOrganizationId = one of her orgs (default to first/last)
  - She sees dropdown: "Switch to Yoga Studio B"
  - Clicking switches activeOrganizationId for that session
```

### Implementation: Organization Selector

```typescript
// After login, fetch all organizations user owns/members of
// src/lib/server/auth.ts

async function enrichSession(userId: string): Promise<EnrichedSession> {
  const user = await getUser(userId);

  let organizations: Organization[] = [];

  if (user.role === 'platform_owner') {
    // Platform owner can see all orgs (or just manage theirs in Phase 1)
    organizations = await db.query.organization.findMany();
  } else {
    // Get organizations where user is a member or owner
    const memberships = await db.query.organizationMember.findMany({
      where: eq(organizationMember.userId, userId),
      with: { organization: true }
    });

    organizations = memberships.map(m => m.organization);

    // Also include organizations they own
    const owned = await db.query.organization.findMany({
      where: eq(organization.ownerId, userId)
    });

    organizations = [...new Set([...organizations, ...owned])];
  }

  // Set default organization (first in list or last accessed)
  const activeOrganizationId = organizations[0]?.id;

  return {
    userId,
    userRole: user.role,
    activeOrganizationId,
    availableOrganizations: organizations
  };
}
```

### Organization Switcher UI

```typescript
// src/routes/[org]/settings/organization-switcher/+page.server.ts

import { require } from '$lib/server/guards';

export async function load(event: RequestEvent) {
  const { userId } = require.auth(event);

  // Get all organizations user belongs to
  const memberships = await db.query.organizationMember.findMany({
    where: eq(organizationMember.userId, userId),
    with: { organization: true }
  });

  const owned = await db.query.organization.findMany({
    where: eq(organization.ownerId, userId)
  });

  const organizations = [
    ...memberships.map(m => ({ ...m.organization, role: m.role })),
    ...owned.map(o => ({ ...o, role: 'owner' }))
  ];

  return { organizations };
}

export const actions = {
  switchOrganization: async (event) => {
    const { userId } = require.auth(event);
    const formData = await event.request.formData();
    const newOrgId = formData.get('organizationId');

    // Verify user has access to this organization
    const access = await db.query.organizationMember.findFirst({
      where: and(
        eq(organizationMember.organizationId, newOrgId),
        eq(organizationMember.userId, userId)
      )
    });

    if (!access) {
      return error(403, 'No access to that organization');
    }

    // Update session's activeOrganizationId
    await db.update(session)
      .set({ activeOrganizationId: newOrgId })
      .where(
        and(
          eq(session.userId, userId),
          // Only update the current session
          eq(session.token, event.cookies.get('auth-token'))
        )
      );

    return { success: true };
  }
};
```

---

## Part 9: Integration with Auth Worker & Security Package

### Auth Worker Flow (Simplified)

```typescript
// workers/auth/src/index.ts

import { Hono } from 'hono';
import { securityHeaders, rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';
import { auth } from '@codex/database';

const app = new Hono();

// Apply security middleware
app.use('*', securityHeaders({ environment: 'production' }));
app.use('/login', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.auth // 5 req/15 min
}));

// Mount BetterAuth routes
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

// Custom endpoints
app.post('/login', async (c) => {
  const { email, password } = await c.req.json();

  // BetterAuth validates and creates session with activeOrganizationId
  // (as implemented in Part 3 above)

  return c.json({ success: true });
});

app.get('/session', async (c) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '');

  if (!token) {
    return c.json({ authenticated: false });
  }

  // Get from KV cache or database
  const session = await getSession(token, c.env.SESSION_KV);

  return c.json({
    authenticated: !!session,
    session
  });
});

export default app;
```

### SvelteKit Integration

```typescript
// apps/web/src/hooks.server.ts

import { sequence } from '@sveltejs/kit/hooks';
import { securityHeaders, rateLimit } from '@codex/security';
import type { Handle } from '@sveltejs/kit';

// 1. Security headers
const securityHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Add security headers via middleware
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  return response;
};

// 2. Session/auth context
const authHandle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('auth-token');

  if (token) {
    // Check KV cache first
    const cached = await event.platform?.env?.SESSION_KV?.get(
      `session:${token}`,
      'json'
    );

    if (cached) {
      event.locals.userId = cached.userId;
      event.locals.userRole = cached.role;
      event.locals.activeOrganizationId = cached.activeOrganizationId;
      event.locals.session = cached;
    } else {
      // Query database
      const session = await db.query.session.findFirst({
        where: eq(session.token, token),
        with: { user: true }
      });

      if (session) {
        event.locals.userId = session.userId;
        event.locals.userRole = session.user.role;
        event.locals.activeOrganizationId = session.activeOrganizationId;
      }
    }
  }

  return resolve(event);
};

// 3. Subdomain extraction (for Phase 2+)
const subdomainHandle: Handle = async ({ event, resolve }) => {
  const subdomain = extractSubdomain(event.url.hostname);

  if (subdomain && subdomain !== 'www') {
    const org = await db.query.organization.findFirst({
      where: eq(organization.slug, subdomain)
    });

    event.locals.requestedOrganization = org;
  }

  return resolve(event);
};

export const handle = sequence(securityHandle, authHandle, subdomainHandle);
```

---

## Part 10: Phase 1 Implementation Checklist

**Database Setup**
- [ ] Create `user`, `session`, `verification_token` tables
- [ ] Create `organization`, `organization_member`, `organization_invitation` tables
- [ ] Create enums: `user_role`, `organization_role`, `verification_type`
- [ ] Add indexes on foreign keys
- [ ] Write RLS policy templates (commented out for Phase 1)
- [ ] Create helper functions (current_user_id, is_platform_owner)

**BetterAuth Configuration**
- [ ] Install organization plugin
- [ ] Configure plugin settings
- [ ] Add custom session fields: `activeOrganizationId`
- [ ] Implement login flow with activeOrganizationId set
- [ ] Implement invitation acceptance

**Access Control**
- [ ] Create guard functions with role array pattern
- [ ] Implement organization context middleware
- [ ] Add query scoping utilities
- [ ] Create service layer for organization queries

**Security Package Integration**
- [ ] Apply securityHeaders middleware to auth worker
- [ ] Apply rateLimit middleware to login endpoints
- [ ] Configure rate limit presets
- [ ] Remove secret leakage from health endpoints

**Routes & Flows**
- [ ] Registration flow (creates customer account)
- [ ] Login flow (sets activeOrganizationId)
- [ ] Organization setup (Phase 1: you create one)
- [ ] Team member invitation (org owner/admin only)
- [ ] Invitation acceptance (creator joins)

**Testing**
- [ ] Test customer login (activeOrganizationId = null)
- [ ] Test org member login (activeOrganizationId set)
- [ ] Test guards prevent unauthorized access
- [ ] Test organization isolation in queries
- [ ] Test invitations work correctly
- [ ] Test rate limiting on login

---

## Part 11: Phase 2+ (Zero-Effort Upgrade)

When you're ready to support multiple organizations:

**What Stays The Same**
- All database tables
- All guard functions
- All query patterns
- BetterAuth configuration

**What Changes**
- Enable RLS policies (uncomment)
- Add organization creation UI
- Add organization switcher
- Enable subdomain routing
- Add custom membership tier support
- Add creator invitation support

**No schema migrations needed** - the foundation is built in Phase 1.

---

## Conclusion

This design provides:

✅ **Phase 1**: Single org with admin team, complete implementation
✅ **Security**: Multi-layer isolation (guards + RLS)
✅ **Clarity**: Auth context clearly defined and passed
✅ **Extensibility**: Framework for Phase 2+ (creators, custom tiers, multi-org)
✅ **Integration**: Works with auth worker and security package

**Key Point**: The foundation is built for multi-tenant from day one. Phase 2 just activates existing features without refactoring.
