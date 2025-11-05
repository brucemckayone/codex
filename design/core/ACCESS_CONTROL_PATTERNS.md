# Access Control Patterns

**Purpose**: This document defines Codex's access control architecture, patterns, and implementations. It consolidates security-in-depth principles across authentication, authorization, and resource protection layers.

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## Table of Contents

1. [Introduction and Security Philosophy](#introduction-and-security-philosophy)
2. [Three-Layer Model Overview](#three-layer-model-overview)
3. [Layer 1: Application Guards](#layer-1-application-guards)
4. [Layer 2: Database RLS](#layer-2-database-rls)
5. [Layer 3: Query Scoping & Signed URLs](#layer-3-query-scoping--signed-urls)
6. [Common Patterns](#common-patterns)
7. [Best Practices](#best-practices)
8. [Security Considerations](#security-considerations)
9. [References](#references)

---

## Introduction and Security Philosophy

### Security-in-Depth Philosophy

Codex implements a **defense-in-depth** security model where multiple independent layers protect against unauthorized access. If one layer fails or is bypassed, additional layers still provide protection.

```
┌─────────────────────────────────────────────┐
│  User Request                               │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 1: Application Guards                │
│  - Route protection                         │
│  - Authentication checks                    │
│  - Authorization enforcement                │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 2: Database RLS Policies             │
│  - Row-level security                       │
│  - Database-enforced isolation              │
│  - Multi-tenant protection                  │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 3: Query Scoping & Signed URLs       │
│  - Organization-scoped queries              │
│  - Purchase verification                    │
│  - Time-limited signed URLs                 │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Protected Resource                         │
└─────────────────────────────────────────────┘
```

### Key Security Principles

1. **Default Deny**: Access is rejected unless explicitly granted
2. **Defense in Depth**: Multiple layers (guards + RLS + query scoping)
3. **Fail Secure**: Errors result in denial, not accidental grants
4. **Audit Trail**: All authentication and authorization events are logged
5. **Token Security**: Short TTL, signed tokens, automatic rotation
6. **Least Privilege**: Users receive minimum permissions necessary

### When Protection Occurs

| Layer | Phase | When Enforced | Purpose |
|-------|-------|---------------|---------|
| **Application Guards** | Request handling | Before route handler executes | Fast-fail for unauthorized requests |
| **Database RLS** | Query execution | During database query (Phase 2+) | Database-level enforcement of isolation |
| **Query Scoping** | Data access | In application queries | Explicit filtering by context |
| **Signed URLs** | Content delivery | Before media streaming | Time-limited, tamper-proof access |

---

## Three-Layer Model Overview

### Layer 1: Application Guards

**Purpose**: Fast-fail route protection at the application boundary

**Characteristics**:
- Executes in SvelteKit route handlers
- Redirects or throws errors immediately
- Checks authentication state and role/permissions
- Prevents unauthorized code execution

**When to Use**:
- Protecting admin routes
- Requiring authentication for pages
- Enforcing role-based access
- Validating email verification

### Layer 2: Database RLS

**Purpose**: Database-enforced multi-tenant data isolation

**Characteristics**:
- PostgreSQL Row-Level Security policies
- Automatic filtering of query results
- Protection against application bugs
- Phase 2+ enforcement (designed in Phase 1)

**When to Use** (Phase 2+):
- Multi-organization data isolation
- Preventing cross-tenant data leaks
- Protecting sensitive data at database level
- Defense against SQL injection or ORM bugs

### Layer 3: Query Scoping & Signed URLs

**Purpose**: Application-level data filtering and content access control

**Characteristics**:
- Explicit organization scoping in queries
- Purchase verification before content access
- Time-limited signed URLs for media
- IP-bound signatures for streaming

**When to Use**:
- Every query on organization-scoped data
- Before generating content URLs
- Purchase validation for paid content
- Preventing media URL sharing

---

## Layer 1: Application Guards

### Authentication Guards

Guards that verify user identity and session state.

#### `requireAuth(event)`

**Purpose**: Require user to be authenticated

**Implementation**:

```typescript
import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Require user to be authenticated
 * Redirects to /login if not authenticated
 */
export function requireAuth(event: RequestEvent) {
  if (!event.locals.user) {
    throw redirect(
      303,
      `/login?redirect=${encodeURIComponent(event.url.pathname)}`
    );
  }
  return event.locals.user;
}
```

**Usage**:

```typescript
// +page.server.ts
export const load: PageServerLoad = async (event) => {
  const user = requireAuth(event);

  // User is guaranteed to be authenticated
  const content = await contentService.getUserContent(user.id);
  return { content };
};
```

**Behavior**:
- Redirects to `/login` with return URL if not authenticated
- Returns authenticated user object
- Preserves original destination for post-login redirect

#### `requireVerifiedEmail(event)`

**Purpose**: Require email verification before access

**Implementation**:

```typescript
/**
 * Require email to be verified
 * Redirects to /verify-email if not verified
 */
export function requireVerifiedEmail(event: RequestEvent) {
  const user = requireAuth(event);
  if (!user.emailVerified) {
    throw redirect(303, '/verify-email?prompt=true');
  }
  return user;
}
```

**Usage**:

```typescript
// +page.server.ts - Purchase flow requires verified email
export const load: PageServerLoad = async (event) => {
  const user = requireVerifiedEmail(event);

  // User has verified email
  const checkout = await stripeService.createCheckout(user);
  return { checkout };
};
```

#### `optionalAuth(event)`

**Purpose**: Populate user if available, but don't require

**Implementation**:

```typescript
/**
 * Optional auth: populate user if available, but don't require
 */
export function optionalAuth(event: RequestEvent) {
  return event.locals.user || null;
}
```

**Usage**:

```typescript
// +page.server.ts - Public page with conditional features
export const load: PageServerLoad = async (event) => {
  const user = optionalAuth(event);

  const publicContent = await contentService.getPublicContent();
  const userLibrary = user
    ? await contentService.getUserLibrary(user.id)
    : null;

  return { publicContent, userLibrary };
};
```

### Authorization Guards

Guards that verify user permissions and roles.

#### `requireOwner(event)`

**Purpose**: Require user to be Platform Owner

**Implementation**:

```typescript
/**
 * Require user to be Platform Owner
 * Redirects to /library if not owner
 */
export function requireOwner(event: RequestEvent) {
  const user = requireAuth(event);
  if (user.role !== 'owner') {
    throw redirect(303, '/library?error=unauthorized');
  }
  return user;
}
```

**Usage**:

```typescript
// src/routes/admin/+layout.server.ts
export const load: LayoutServerLoad = async (event) => {
  const owner = requireOwner(event);

  // Only Platform Owner can access admin routes
  return { owner };
};
```

**Access Control Tree**:

```
Platform Owner (you)
  ├─ System Admin Panel (Phase 1)
  │   ├─ Organization management
  │   ├─ User management (system-wide)
  │   └─ System settings
  │
Organization Owner
  ├─ Organization Dashboard (Phase 1+)
  │   ├─ Content management
  │   ├─ Team management
  │   ├─ Customer management
  │   ├─ Analytics
  │   ├─ Settings
  │   └─ Offerings (Phase 2+)
  │
Organization Admin
  ├─ Limited Admin Dashboard (Phase 1+)
  │   ├─ Content approval/publishing
  │   ├─ View-only team settings
  │   ├─ Customer support tools
  │   └─ Analytics (limited)
  │
Creator (Phase 2+)
  └─ Creator Dashboard
      ├─ My content
      ├─ My offerings
      ├─ My earnings
      └─ Organization switching
```

#### `requireCreatorAccess(event)`

**Purpose**: Require user to be Owner or Creator (Phase 3+)

**Implementation**:

```typescript
/**
 * Future-proof: Support for Media Owner role (Phase 3)
 * Require user to be Owner or Creator
 */
export function requireCreatorAccess(event: RequestEvent) {
  const user = requireAuth(event);
  if (user.role !== 'owner' && user.role !== 'creator') {
    throw redirect(303, '/library?error=unauthorized');
  }
  return user;
}
```

**Usage**:

```typescript
// src/routes/create/+page.server.ts
export const load: PageServerLoad = async (event) => {
  const creator = requireCreatorAccess(event);

  // User can upload content
  return { creator };
};
```

### Resource Guards

Guards that verify access to specific resources.

#### Organization Membership Guard

**Purpose**: Verify user belongs to organization

**Implementation**:

```typescript
/**
 * Require user to be member of organization
 * Throws 403 error if not a member
 */
export async function requireOrganizationMember(
  event: RequestEvent,
  organizationId: string
) {
  const user = requireAuth(event);

  const membership = await db.query.organizationMember.findFirst({
    where: and(
      eq(organizationMember.userId, user.id),
      eq(organizationMember.organizationId, organizationId)
    )
  });

  if (!membership) {
    throw error(403, 'Not a member of this organization');
  }

  return membership;
}
```

**Usage**:

```typescript
// src/routes/org/[id]/+page.server.ts
export const load: PageServerLoad = async ({ params, ...event }) => {
  const membership = await requireOrganizationMember(event, params.id);

  // User is confirmed member
  const orgData = await loadOrganizationData(params.id);
  return { orgData, membership };
};
```

#### Organization Role Guard

**Purpose**: Require specific role within organization

**Implementation**:

```typescript
/**
 * Require specific role in organization
 * Throws 403 if user doesn't have required role
 */
export async function requireOrganizationRole(
  event: RequestEvent,
  organizationId: string,
  requiredRole: OrganizationRole | OrganizationRole[]
) {
  const membership = await requireOrganizationMember(event, organizationId);

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  if (!roles.includes(membership.role)) {
    throw error(403, `Requires ${roles.join(' or ')} role`);
  }

  return membership;
}
```

**Usage**:

```typescript
// src/routes/org/[id]/settings/+page.server.ts
export const load: PageServerLoad = async ({ params, ...event }) => {
  // Only owner or admin can access settings
  const membership = await requireOrganizationRole(
    event,
    params.id,
    ['owner', 'admin']
  );

  const settings = await settingsService.getSettings(params.id);
  return { settings, membership };
};
```

### Guard Composition

Guards can be composed to create complex authorization logic.

#### Pattern: Chained Guards

```typescript
// Multiple guards in sequence
export const load: PageServerLoad = async (event) => {
  // Step 1: Must be authenticated
  const user = requireAuth(event);

  // Step 2: Must have verified email
  requireVerifiedEmail(event);

  // Step 3: Must be organization owner
  const membership = await requireOrganizationRole(
    event,
    user.organizationId,
    'owner'
  );

  return { user, membership };
};
```

#### Pattern: Conditional Guards

```typescript
// Guard based on resource state
export const load: PageServerLoad = async ({ params, ...event }) => {
  const content = await contentService.getContent(params.id);

  if (content.isPublished) {
    // Public content - optional auth
    const user = optionalAuth(event);
    return { content, user };
  } else {
    // Unpublished content - require ownership
    const user = requireAuth(event);
    await requireOrganizationRole(
      event,
      content.organizationId,
      ['owner', 'admin', 'creator']
    );
    return { content, user };
  }
};
```

#### Pattern: Guard Factories

```typescript
/**
 * Create a guard that checks multiple conditions
 */
export function createAccessGuard(options: {
  requireAuth?: boolean;
  requireVerified?: boolean;
  requireRole?: 'owner' | 'customer';
  requireOrgRole?: OrganizationRole | OrganizationRole[];
}) {
  return async (event: RequestEvent, organizationId?: string) => {
    let user = null;

    if (options.requireAuth) {
      user = requireAuth(event);
    }

    if (options.requireVerified && user) {
      requireVerifiedEmail(event);
    }

    if (options.requireRole && user?.role !== options.requireRole) {
      throw error(403, `Requires ${options.requireRole} role`);
    }

    if (options.requireOrgRole && organizationId && user) {
      await requireOrganizationRole(event, organizationId, options.requireOrgRole);
    }

    return user;
  };
}

// Usage
const requireAdmin = createAccessGuard({
  requireAuth: true,
  requireVerified: true,
  requireOrgRole: ['owner', 'admin']
});

export const load: PageServerLoad = async ({ params, ...event }) => {
  await requireAdmin(event, params.orgId);
  // User is authenticated, verified, and is owner/admin
};
```

---

## Layer 2: Database RLS

### RLS Enforcement Strategy

**Phase 1**: RLS policies are **designed and documented** but **not enforced**
- Single organization eliminates cross-tenant risk
- Application guards and query scoping provide sufficient protection
- Policies are tested but not enabled in production

**Phase 2+**: RLS policies are **enabled and enforced**
- Multiple organizations require database-level isolation
- RLS provides defense against application bugs
- Automatic filtering based on session context

### When RLS is Enforced

RLS policies protect against:

1. **Data Leakage** (Org A sees Org B content)
   - Layer 1: organizationId check in every query
   - Layer 2: RLS policies block cross-org access
   - Layer 3: Signed URLs include orgId

2. **Unauthorized Access** (Non-member accesses org data)
   - Layer 1: Guard checks organization membership
   - Layer 2: RLS filters to user's organizations
   - Layer 3: Query explicitly scopes to organization

3. **Privilege Escalation** (Member performs owner-only action)
   - Layer 1: Guard checks required role
   - Layer 2: RLS policy checks role in USING clause
   - Layer 3: Service layer validates permissions

### RLS Policy Patterns

For detailed RLS policy patterns, see [Multi-Tenant Architecture - Row-Level Security](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md#row-level-security-rls).

#### Pattern Summary: Organization Member Visibility

```sql
-- Users can only see organization members of orgs they belong to
CREATE POLICY org_member_view ON organization_member
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM organization_member AS om
      WHERE om.organizationId = organization_member.organizationId
        AND om.userId = current_user_id()
    )
  );
```

#### Pattern Summary: Organization Owner Full Access

```sql
-- Organization owners have full control over their org's data
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

#### Pattern Summary: Role-Based Access

```sql
-- Admins and owners can view/edit content
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

### Setting Session Context for RLS

When RLS is enabled (Phase 2+), set session variables before queries:

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

### RLS Helper Functions

```sql
-- Function: Get current user ID from session context
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;

-- Function: Get active organization ID from session context
CREATE OR REPLACE FUNCTION active_org_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.active_org_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE;
```

---

## Layer 3: Query Scoping & Signed URLs

### Organization Scoping

**Golden Rule**: Every query on organization-scoped data **must** include `organizationId` filter.

#### Pattern: Organization-Scoped Queries

```typescript
// GOOD: Explicit organization scoping
const content = await db.query.content.findMany({
  where: eq(content.organizationId, session.activeOrganizationId)
});

// BAD: Missing organization filter (only safe with RLS enabled)
const content = await db.query.content.findMany();
```

#### Pattern: Load Organization Resources

```typescript
/**
 * Load all content for active organization
 */
export async function loadOrganizationContent(organizationId: string) {
  return await db.query.content.findMany({
    where: eq(content.organizationId, organizationId),
    orderBy: desc(content.createdAt)
  });
}

/**
 * Load organization members
 */
export async function loadOrganizationMembers(organizationId: string) {
  return await db.query.organizationMember.findMany({
    where: eq(organizationMember.organizationId, organizationId),
    with: {
      user: true  // Include user details
    }
  });
}
```

#### Pattern: Admin Dashboard Queries

```typescript
/**
 * Admin dashboard: Revenue for organization
 */
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
```

### Purchase Verification

Purchase-based access control ensures users can only access content they've purchased.

#### Access Control Flow

```
1. User Request
   ↓
2. Server-Side Load (+page.server.ts)
   ├─ requireAuth(event): Ensure user is logged in
   ├─ contentAccessService.checkAccess(userId, contentId, 'content')
   │  └─ Query purchases table:
   │     SELECT * FROM purchases
   │     WHERE customerId = userId
   │       AND itemId = contentId
   │       AND itemType = 'content'
   │       AND status = 'completed'
   │       AND refundedAt IS NULL
   ├─ Access Denied: Redirect to /purchase/{contentId}
   └─ Access Granted: Load content and playback data
   ↓
3. Client-Side Render (+page.svelte)
   └─ Render MediaPlayer with content
   ↓
4. Media Player Initialization
   └─ Request stream URL: fetch('/api/media/{id}/stream-url')
   ↓
5. API Route: Get Media Stream URL
   ├─ requireAuth(event): Re-validate authentication
   ├─ contentAccessService.checkAccess(userId, mediaItemId, mediaItem.type)
   ├─ Retrieve hlsMasterPlaylistKey from media_items
   ├─ signedUrl = r2Service.getDownloadUrl(bucketName, key, 3600)
   └─ Return { streamUrl: signedUrl }
   ↓
6. Media Playback
   └─ Player begins HLS streaming with signed URL
```

#### Pattern: Check Purchase Access

```typescript
/**
 * Check if user has purchased content
 */
export async function checkAccess(
  userId: string,
  itemId: string,
  itemType: 'content' | 'offering'
): Promise<boolean> {
  const purchase = await db.query.purchase.findFirst({
    where: and(
      eq(purchase.customerId, userId),
      eq(purchase.itemId, itemId),
      eq(purchase.itemType, itemType),
      eq(purchase.status, 'completed'),
      isNull(purchase.refundedAt)
    )
  });

  return !!purchase;
}
```

#### Pattern: Purchase-Gated Route

```typescript
// src/routes/content/[id]/+page.server.ts
export const load: PageServerLoad = async ({ params, ...event }) => {
  // Layer 1: Require authentication
  const user = requireAuth(event);

  // Layer 3: Verify purchase
  const hasAccess = await contentAccessService.checkAccess(
    user.id,
    params.id,
    'content'
  );

  if (!hasAccess) {
    // Redirect to purchase page
    throw redirect(303, `/purchase/${params.id}`);
  }

  // Load content and media
  const content = await contentService.getContent(params.id);
  const mediaItem = await mediaService.getMediaItem(content.mediaItemId);
  const playbackPosition = await contentAccessService.getPlaybackProgress(
    user.id,
    mediaItem.id
  );

  return {
    content,
    mediaItem,
    initialPlaybackPosition: playbackPosition
  };
};
```

### Signed URL Generation

Signed URLs provide time-limited, tamper-proof access to content stored in R2.

#### Pattern: Generate Signed Stream URL

```typescript
/**
 * Generate time-limited, signed URL for streaming
 */
export async function generateSignedUrl(
  contentId: string,
  userId: string,
  options: {
    expiresIn: number;  // seconds
    ipBound?: boolean;  // bind to user's IP
  }
): Promise<string> {
  // Verify access
  const hasAccess = await contentAccessService.checkAccess(
    userId,
    contentId,
    'content'
  );

  if (!hasAccess) {
    throw error(403, 'Access denied');
  }

  // Get media item
  const content = await contentService.getContent(contentId);
  const mediaItem = await mediaService.getMediaItem(content.mediaItemId);

  // Generate signed URL from R2
  const signedUrl = await r2Service.getDownloadUrl(
    mediaItem.bucketName,
    mediaItem.hlsMasterPlaylistKey,
    options.expiresIn
  );

  return signedUrl;
}
```

#### Pattern: Signed URL in API Route

```typescript
// src/routes/api/media/[id]/stream-url/+server.ts
export const GET: RequestHandler = async ({ params, ...event }) => {
  // Layer 1: Require authentication
  const user = requireAuth(event);

  // Get media item
  const mediaItem = await mediaService.getMediaItem(params.id);

  // Layer 3: Verify purchase access
  const hasAccess = await contentAccessService.checkAccess(
    user.id,
    mediaItem.id,
    mediaItem.type
  );

  if (!hasAccess) {
    throw error(403, 'Access denied');
  }

  // Generate signed URL (expires in 1 hour)
  const signedUrl = await r2Service.getDownloadUrl(
    mediaItem.bucketName,
    mediaItem.hlsMasterPlaylistKey,
    3600  // 1 hour
  );

  return json({ streamUrl: signedUrl });
};
```

#### Threat Prevention with Signed URLs

```
Unauthorized Playback (Watch without purchase)
  ├─ Layer 1: Check purchase before issuing URL
  ├─ Layer 2: RLS prevents DB query (Phase 2+)
  ├─ Layer 3: Signed URL validates purchase
  └─ Layer 4: R2 validates signature

Data Leakage (Org A sees Org B content)
  ├─ Layer 1: organizationId check in every query
  ├─ Layer 2: RLS policies block cross-org
  └─ Layer 3: Signed URLs include orgId

License/DRM Bypass (Phase 3+)
  ├─ Use industry-standard DRM (Widevine, FairPlay)
  ├─ Client validation of time-limited keys
  ├─ Server revocation of compromised keys
  └─ Audit logs of all license issuance
```

---

## Common Patterns

### Protected Admin Routes

**Scenario**: Platform Owner accessing system-wide admin dashboard

**Implementation**:

```typescript
// src/routes/admin/+layout.server.ts
export const load: LayoutServerLoad = async (event) => {
  // Layer 1: Require Platform Owner role
  const owner = requireOwner(event);

  return { owner };
};

// src/routes/admin/+page.server.ts
export const load: PageServerLoad = async ({ locals }) => {
  // Layout guard already verified owner role
  const owner = locals.user;

  // Layer 3: Query organization-scoped data
  const analytics = await adminDashboardService.getAnalyticsSummary();

  return { analytics };
};

// adminDashboardService.getAnalyticsSummary()
export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  // Platform Owner sees all organizations
  const totalRevenue = await db.query.purchase.findMany({
    where: eq(purchase.status, 'completed')
  });

  const customers = await db.query.user.findMany({
    where: eq(user.role, 'customer')
  });

  return {
    totalRevenueAllTime: calculateRevenue(totalRevenue),
    customerCount: customers.length,
    // ... other metrics
  };
}
```

**Access Control**:
- ✅ Layer 1: `requireOwner()` guard in layout
- ✅ Layer 3: Service queries system-wide data (no org scoping needed)
- ⚠️ Layer 2: RLS not applicable (Platform Owner has system-wide access)

### Content Purchase Verification

**Scenario**: Customer accessing purchased video content

**Implementation**:

```typescript
// src/routes/content/[id]/+page.server.ts
export const load: PageServerLoad = async ({ params, ...event }) => {
  // Layer 1: Require authentication
  const user = requireAuth(event);

  // Layer 3: Verify purchase
  const hasAccess = await contentAccessService.checkAccess(
    user.id,
    params.id,
    'content'
  );

  if (!hasAccess) {
    throw redirect(303, `/purchase/${params.id}`);
  }

  // Load content
  const content = await contentService.getContent(params.id);

  return { content };
};

// contentAccessService.checkAccess()
export async function checkAccess(
  userId: string,
  contentId: string,
  itemType: string
): Promise<boolean> {
  // Layer 3: Query purchases table with filters
  const purchase = await db.query.purchase.findFirst({
    where: and(
      eq(purchase.customerId, userId),
      eq(purchase.itemId, contentId),
      eq(purchase.itemType, itemType),
      eq(purchase.status, 'completed'),
      isNull(purchase.refundedAt)
    )
  });

  // Layer 2: RLS would also filter this query (Phase 2+)
  return !!purchase;
}
```

**Access Control**:
- ✅ Layer 1: `requireAuth()` ensures user is logged in
- ✅ Layer 2: RLS filters purchases to current user (Phase 2+)
- ✅ Layer 3: Explicit purchase verification query
- ✅ Signed URL: Generated only after verification passes

### Creator-Owned Resources

**Scenario**: Creator editing their own content within an organization

**Implementation**:

```typescript
// src/routes/org/[orgId]/content/[contentId]/edit/+page.server.ts
export const load: PageServerLoad = async ({ params, ...event }) => {
  // Layer 1: Require authentication
  const user = requireAuth(event);

  // Layer 1: Verify organization membership and role
  const membership = await requireOrganizationRole(
    event,
    params.orgId,
    ['owner', 'admin', 'creator']
  );

  // Layer 3: Load content with organization scoping
  const content = await db.query.content.findFirst({
    where: and(
      eq(content.id, params.contentId),
      eq(content.organizationId, params.orgId)
    )
  });

  if (!content) {
    throw error(404, 'Content not found');
  }

  // Additional check: Creators can only edit their own content
  if (membership.role === 'creator' && content.creatorId !== user.id) {
    throw error(403, 'Can only edit your own content');
  }

  return { content, membership };
};

// Form action for updating content
export const actions: Actions = {
  update: async ({ params, request, ...event }) => {
    const user = requireAuth(event);
    const membership = await requireOrganizationRole(
      event,
      params.orgId,
      ['owner', 'admin', 'creator']
    );

    const formData = await request.formData();
    const updates = parseContentUpdates(formData);

    // Layer 3: Update with organization scoping
    await db.update(content)
      .set(updates)
      .where(and(
        eq(content.id, params.contentId),
        eq(content.organizationId, params.orgId),
        // Creators can only update their own content
        membership.role === 'creator'
          ? eq(content.creatorId, user.id)
          : undefined
      ));

    return { success: true };
  }
};
```

**Access Control**:
- ✅ Layer 1: `requireAuth()` + `requireOrganizationRole()`
- ✅ Layer 2: RLS filters content to user's organizations (Phase 2+)
- ✅ Layer 3: Organization-scoped queries + creator ownership check

### Multi-Org Access (Phase 2+)

**Scenario**: Creator viewing content across multiple organizations they belong to

**Implementation**:

```typescript
// src/routes/creator/content/+page.server.ts
export const load: PageServerLoad = async (event) => {
  // Layer 1: Require authentication
  const user = requireAuth(event);

  // Get user's organizations
  const memberships = await db.query.organizationMember.findMany({
    where: eq(organizationMember.userId, user.id),
    with: { organization: true }
  });

  // Layer 3: Query content across all organizations user belongs to
  const organizationIds = memberships.map(m => m.organizationId);

  const allContent = await db.query.content.findMany({
    where: and(
      inArray(content.organizationId, organizationIds),
      eq(content.creatorId, user.id)  // Only creator's own content
    ),
    orderBy: desc(content.createdAt)
  });

  // Layer 2: RLS automatically filters to user's organizations (Phase 2+)

  return {
    content: allContent,
    organizations: memberships.map(m => m.organization)
  };
};

// Organization switcher
export const actions: Actions = {
  switchOrg: async ({ request, locals }) => {
    const formData = await request.formData();
    const newOrgId = formData.get('organizationId') as string;

    // Verify user belongs to target organization
    const membership = await db.query.organizationMember.findFirst({
      where: and(
        eq(organizationMember.userId, locals.user.id),
        eq(organizationMember.organizationId, newOrgId)
      )
    });

    if (!membership) {
      throw error(403, 'Not a member of this organization');
    }

    // Update session context
    await sessionService.updateActiveOrganization(
      locals.session.id,
      newOrgId,
      membership.role
    );

    return { success: true };
  }
};
```

**Access Control**:
- ✅ Layer 1: Authentication required
- ✅ Layer 2: RLS filters to user's organizations
- ✅ Layer 3: Query explicitly lists user's organization IDs
- ✅ Session Context: Active organization tracked in session

---

## Best Practices

### 1. Always Use Guards First

```typescript
// GOOD: Guard at the top of load function
export const load: PageServerLoad = async (event) => {
  const user = requireAuth(event);
  // ... rest of logic
};

// BAD: Checking user later in the function
export const load: PageServerLoad = async (event) => {
  const data = await loadData();
  if (!event.locals.user) {  // Too late!
    throw redirect(303, '/login');
  }
};
```

### 2. Compose Guards in Layouts

```typescript
// src/routes/admin/+layout.server.ts
export const load: LayoutServerLoad = async (event) => {
  // All admin routes require owner
  const owner = requireOwner(event);
  return { owner };
};

// Child routes automatically protected
// src/routes/admin/dashboard/+page.server.ts
export const load: PageServerLoad = async ({ locals }) => {
  // locals.user is guaranteed to be Platform Owner
  const stats = await getStats();
  return { stats };
};
```

### 3. Explicit Organization Scoping

```typescript
// GOOD: Always filter by organizationId
const content = await db.query.content.findMany({
  where: eq(content.organizationId, session.activeOrganizationId)
});

// ACCEPTABLE in Phase 2+ with RLS enabled
const content = await db.query.content.findMany();
// RLS automatically filters to user's organizations

// BAD: No scoping in Phase 1 (data leak risk)
const content = await db.query.content.findMany();
```

### 4. Verify Access Twice for Media

```typescript
// First check: Route guard
export const load: PageServerLoad = async ({ params, ...event }) => {
  const user = requireAuth(event);
  const hasAccess = await checkAccess(user.id, params.id);
  if (!hasAccess) throw redirect(303, '/purchase');
  return { contentId: params.id };
};

// Second check: Stream URL API
export const GET: RequestHandler = async ({ params, ...event }) => {
  const user = requireAuth(event);
  // Re-verify access before generating signed URL
  const hasAccess = await checkAccess(user.id, params.id);
  if (!hasAccess) throw error(403);

  const signedUrl = await generateSignedUrl(params.id);
  return json({ streamUrl: signedUrl });
};
```

### 5. Use Short TTL for Signed URLs

```typescript
// GOOD: 1-hour expiration for streaming
const signedUrl = await r2Service.getDownloadUrl(
  bucket,
  key,
  3600  // 1 hour
);

// GOOD: 5-minute expiration for download links
const downloadUrl = await r2Service.getDownloadUrl(
  bucket,
  key,
  300  // 5 minutes
);

// BAD: Long expiration (allows URL sharing)
const signedUrl = await r2Service.getDownloadUrl(
  bucket,
  key,
  86400 * 7  // 7 days - too long!
);
```

### 6. Log Access Decisions

```typescript
export function requireAuth(event: RequestEvent) {
  if (!event.locals.user) {
    // Log denied access
    logger.warn('Unauthorized access attempt', {
      path: event.url.pathname,
      ip: event.getClientAddress()
    });

    throw redirect(303, `/login?redirect=${encodeURIComponent(event.url.pathname)}`);
  }

  // Log successful access
  logger.info('Authenticated access', {
    userId: event.locals.user.id,
    path: event.url.pathname
  });

  return event.locals.user;
}
```

### 7. Fail Secure

```typescript
// GOOD: Default deny if check fails
export async function checkAccess(userId: string, contentId: string): Promise<boolean> {
  try {
    const purchase = await db.query.purchase.findFirst({
      where: and(
        eq(purchase.customerId, userId),
        eq(purchase.itemId, contentId),
        eq(purchase.status, 'completed'),
        isNull(purchase.refundedAt)
      )
    });
    return !!purchase;
  } catch (error) {
    // On error, deny access
    logger.error('Access check failed', { userId, contentId, error });
    return false;
  }
}

// BAD: Granting access on error
export async function checkAccess(userId: string, contentId: string): Promise<boolean> {
  try {
    const purchase = await findPurchase(userId, contentId);
    return !!purchase;
  } catch (error) {
    return true;  // DANGEROUS!
  }
}
```

### 8. Separate Public and Private Routes

```typescript
// Project structure
src/routes/
├─ (public)/          // No authentication required
│  ├─ +layout.svelte  // Public layout
│  ├─ login/
│  ├─ signup/
│  └─ browse/
│
├─ (authenticated)/   // Requires authentication
│  ├─ +layout.server.ts  // requireAuth() guard
│  ├─ library/
│  ├─ content/[id]/
│  └─ account/
│
└─ admin/             // Requires Platform Owner
   ├─ +layout.server.ts  // requireOwner() guard
   ├─ dashboard/
   └─ settings/
```

---

## Security Considerations

### Defense Against Common Threats

#### 1. Cross-Tenant Data Leakage

**Threat**: User in Organization A accesses Organization B's data

**Protection**:
```typescript
// Layer 1: Guard checks organization membership
await requireOrganizationMember(event, organizationId);

// Layer 2: RLS filters to user's organizations (Phase 2+)
ALTER TABLE content ENABLE ROW LEVEL SECURITY;

// Layer 3: Explicit organization scoping
const content = await db.query.content.findMany({
  where: eq(content.organizationId, organizationId)
});
```

#### 2. Unauthorized Playback

**Threat**: User watches content without purchasing

**Protection**:
```typescript
// Layer 1: Guard requires authentication
const user = requireAuth(event);

// Layer 3: Verify purchase before loading page
const hasAccess = await checkAccess(user.id, contentId);
if (!hasAccess) throw redirect(303, `/purchase/${contentId}`);

// Layer 3: Verify purchase before generating URL
const hasAccess = await checkAccess(user.id, contentId);
if (!hasAccess) throw error(403);

// Layer 4: Signed URL with short expiration
const signedUrl = await generateSignedUrl(contentId, 3600);
```

#### 3. Privilege Escalation

**Threat**: Regular user performs admin actions

**Protection**:
```typescript
// Layer 1: Guard checks specific role
const membership = await requireOrganizationRole(
  event,
  organizationId,
  ['owner', 'admin']
);

// Layer 2: RLS policy checks role
CREATE POLICY content_admin_edit ON content
  FOR UPDATE
  USING (
    role IN ('owner', 'admin')
  );

// Layer 3: Service layer validates permissions
if (membership.role !== 'owner' && membership.role !== 'admin') {
  throw error(403, 'Insufficient permissions');
}
```

#### 4. Session Hijacking

**Threat**: Attacker steals session token

**Protection**:
- Short session TTL (24 hours)
- Signed session tokens (HMAC)
- IP address binding (optional)
- Automatic rotation on privilege change
- Session invalidation on logout

```typescript
// Session validation in middleware
export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session_token');

  if (token) {
    const session = await sessionService.validateSession(token);

    if (session) {
      // Check if session is expired
      if (session.expiresAt < new Date()) {
        await sessionService.invalidateSession(session.id);
      } else {
        event.locals.session = session;
        event.locals.user = session.user;
      }
    }
  }

  return resolve(event);
};
```

#### 5. URL Sharing

**Threat**: User shares signed URL with non-purchasers

**Protection**:
- Short TTL (1 hour for streaming)
- IP binding (optional)
- One-time use tokens (for downloads)
- HMAC signature verification

```typescript
// Generate IP-bound signed URL
export async function generateSignedUrl(
  contentId: string,
  userId: string,
  ipAddress: string
): Promise<string> {
  const hasAccess = await checkAccess(userId, contentId);
  if (!hasAccess) throw error(403);

  // Include IP in signature
  const signature = hmac({
    contentId,
    userId,
    ipAddress,
    expiresAt: Date.now() + 3600000
  });

  return `${baseUrl}?sig=${signature}&ip=${ipAddress}`;
}
```

### Security Checklist

Before deploying new features with access control:

- ✅ **Authentication**: Is `requireAuth()` used on all protected routes?
- ✅ **Authorization**: Are role/permission checks in place?
- ✅ **Organization Scoping**: Do all queries filter by `organizationId`?
- ✅ **Purchase Verification**: Is access verified before content delivery?
- ✅ **Signed URLs**: Are URLs time-limited and tamper-proof?
- ✅ **Error Handling**: Do errors fail secure (deny access)?
- ✅ **Logging**: Are access decisions logged for audit?
- ✅ **RLS Design**: Are RLS policies designed (enforced in Phase 2+)?
- ✅ **Testing**: Are access control paths tested (positive and negative)?

---

## References

### Core Architecture Documents

- [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md) - Organization model, RLS patterns, query patterns
- [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md) - Signed URL generation, media security
- [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md) - How features depend on access control

### Feature Documents

**Authentication & Authorization**:
- [Authentication EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md) - User types, roles, three-layer protection (lines 598-627)
- [Authentication Phase 1 TDD](/home/user/codex/design/features/auth/ttd-dphase-1.md) - Guard implementations (lines 247-312)

**Content Access**:
- [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md) - Content access security (lines 460-509)
- [Content Access Phase 1 TDD](/home/user/codex/design/features/content-access/ttd-dphase-1.md) - Purchase verification (lines 219-245)

**Admin Dashboard**:
- [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md) - Access hierarchy tree (lines 23-52)
- [Admin Dashboard Phase 1 TDD](/home/user/codex/design/features/admin-dashboard/ttd-dphase-1.md) - Access control flow (lines 178-187)

### Related Topics

- **Session Management**: See Authentication TDD for session lifecycle
- **RLS Policies**: See Multi-Tenant Architecture for policy templates
- **Query Patterns**: See Multi-Tenant Architecture for organization-scoped queries
- **Signed URLs**: See R2 Storage Patterns for URL generation and security

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Status**: Active - Reference Document
