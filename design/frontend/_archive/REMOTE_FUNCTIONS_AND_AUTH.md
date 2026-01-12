# SvelteKit Remote Functions & Authorization Patterns

**Status**: Research
**Last Updated**: 2026-01-09

This document covers **SvelteKit Remote Functions** (experimental RPC) and **authorization patterns** for role-based access control with Codex Workers.

---

## Part 1: Remote Functions (Experimental RPC)

### Overview

Remote Functions are SvelteKit's **experimental type-safe RPC layer** that may eventually replace `load` functions and form actions. They provide a more direct, type-safe way to call server functions from the client.

**Status**: Experimental (requires `experimental.remoteFunctions: true`)
**Expected Stability**: SvelteKit 3 (potentially 2026-2027)

---

### Four Types of Remote Functions

Defined in `.remote.ts` files, these functions always execute on the server:

#### 1. `query` - Read Data
```typescript
// src/routes/library/library.remote.ts
import { query } from '@sveltejs/kit/remote';
import { api } from '$lib/server/api';

export const loadLibrary = query(async (userId: string, sessionCookie: string) => {
  const result = await api('content', '/api/user/library', { sessionCookie });
  return result.data;
});
```

**Client usage**:
```svelte
<script lang="ts">
  import { loadLibrary } from './library.remote';
  import { page } from '$app/state';

  let library = $state([]);

  $effect(() => {
    // Note: Cookie handling needs consideration in remote functions
    loadLibrary(page.data.user.id).then(data => library = data);
  });
</script>
```

#### 2. `form` - Write Data (Progressive Enhancement)
```typescript
// src/routes/content/create.remote.ts
import { form } from '@sveltejs/kit/remote';
import { api } from '$lib/server/api';

export const createContentForm = form(async (data: FormData, { cookies }) => {
  const sessionCookie = cookies.get('codex-session');
  const title = data.get('title') as string;

  const result = await api('content', '/api/content', {
    method: 'POST',
    body: JSON.stringify({ title }),
    sessionCookie
  });

  return { success: true, content: result.data };
});
```

#### 3. `command` - Mutations
```typescript
// src/routes/library/actions.remote.ts
import { command } from '@sveltejs/kit/remote';
import { api } from '$lib/server/api';

export const removeFromLibrary = command(async (contentId: string, { cookies }) => {
  const sessionCookie = cookies.get('codex-session');
  await api('content', `/api/content/${contentId}`, {
    method: 'DELETE',
    sessionCookie
  });
  return { success: true };
});
```

#### 4. `prerender` - Build-Time Data
```typescript
// src/routes/explore/featured.remote.ts
import { prerender } from '@sveltejs/kit/remote';
import { api } from '$lib/server/api';

export const loadFeatured = prerender(async () => {
  // No auth needed for public content
  const result = await api('content', '/api/content/featured');
  return result.data;
});
```

---

### Key Feature: `query.batch` (Performance)

**Problem**: N+1 queries when loading multiple items

**Solution**: Batch multiple queries into a single HTTP request

```typescript
// src/routes/library/batch.remote.ts
import { query } from '@sveltejs/kit/remote';
import { api } from '$lib/server/api';

export const getContentDetails = query.batch(
  async (ids: string[], { cookies }) => {
    const sessionCookie = cookies.get('codex-session');
    // Single API call for all IDs
    const result = await api('content', '/api/content/batch', {
      method: 'POST',
      body: JSON.stringify({ ids }),
      sessionCookie
    });

    // Return results in same order as input
    return ids.map(id => result.data.find(c => c.id === id));
  }
);
```

---

### Enabling Remote Functions

```javascript
// svelte.config.js
export default {
  kit: {
    experimental: {
      remoteFunctions: true
    }
  },
  compilerOptions: {
    experimental: {
      async: true // Required for Svelte 5 async features
    }
  }
};
```

---

### When to Use Remote Functions vs. Load Functions

| Feature | `load` Functions | Remote Functions |
|---------|-----------------|------------------|
| **SSR** | ✅ Built-in | ⚠️ Manual (via `prerender`) |
| **Type Safety** | ✅ Via `$types` | ✅ Direct inference |
| **Progressive Enhancement** | ✅ Automatic | ✅ Via `form` type |
| **Client-Side Refetching** | ❌ Requires invalidation | ✅ Direct function call |
| **Batching** | ❌ Not built-in | ✅ `query.batch` |
| **Granular Updates** | ❌ Invalidates entire page | ✅ Update specific data |

**Recommendation for Codex**:
- **Phase 1**: Use `load` functions and form actions (stable)
- **Phase 2+**: Evaluate remote functions when stable for:
  - Client-side data fetching in authenticated pages
  - `query.batch` for library grids and search results

---

## Part 2: Authorization & RBAC Patterns

### Codex Role System (Actual Schema)

**IMPORTANT**: These are the real roles from the Codex database.

```typescript
// $lib/server/rbac.ts

// User table role (global)
export const USER_ROLES = {
  CUSTOMER: 'customer'  // Default for all users
} as const;

// Organization membership roles (per-org)
export const ORG_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  CREATOR: 'creator',
  SUBSCRIBER: 'subscriber',
  MEMBER: 'member'
} as const;

// Role hierarchy for permission checks
export const ORG_ROLE_HIERARCHY = {
  owner: ['owner', 'admin', 'creator', 'subscriber', 'member'],
  admin: ['admin', 'creator', 'subscriber', 'member'],
  creator: ['creator', 'subscriber', 'member'],
  subscriber: ['subscriber', 'member'],
  member: ['member']
};

export function hasOrgRole(userRole: string | null, requiredRoles: string[]): boolean {
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
}

export function isAtLeast(userRole: string | null, minimumRole: string): boolean {
  if (!userRole) return false;
  return ORG_ROLE_HIERARCHY[minimumRole]?.includes(userRole) ?? false;
}
```

---

### Architecture Overview

```
Request → hooks.server.ts → +layout.server.ts → +page.server.ts
            ↓                    ↓                    ↓
         1. Read cookie       2. Check org role    3. Check ownership
         2. Call Auth Worker  3. Redirect if ❌    4. Load data
         3. Call Identity-API
         4. Set locals
```

---

### 1. Session & Organization Resolution (hooks.server.ts)

**CRITICAL**: Auth is handled by Auth Worker (BetterAuth). Don't implement manually!

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { AUTH_WORKER_URL, IDENTITY_API_URL } from '$env/static/private';

// 1. Resolve session via Auth Worker
const authHandle: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      const res = await fetch(`${AUTH_WORKER_URL}/api/auth/session`, {
        headers: { Cookie: `codex-session=${sessionCookie}` }
      });

      if (res.ok) {
        const { user, session } = await res.json();
        event.locals.userId = user.id;
        event.locals.user = user;
        event.locals.session = session;
      }
    } catch (error) {
      console.error('Auth failed:', error);
    }
  }

  return resolve(event);
};

// 2. Resolve organization from subdomain
const orgHandle: Handle = async ({ event, resolve }) => {
  const subdomain = extractSubdomain(event.url.hostname);

  if (subdomain && !['www', 'auth', 'api'].includes(subdomain)) {
    try {
      // Get org from Identity-API Worker
      const orgRes = await fetch(
        `${IDENTITY_API_URL}/api/organizations/slug/${subdomain}`
      );

      if (orgRes.ok) {
        const { data: org } = await orgRes.json();
        event.locals.organization = org;

        // Get user's membership if logged in
        if (event.locals.userId) {
          // TODO: Add membership endpoint to Identity-API
          // const membershipRes = await fetch(
          //   `${IDENTITY_API_URL}/api/organizations/${org.id}/membership/${event.locals.userId}`
          // );
          // event.locals.organizationRole = membershipRes.data?.role || null;
        }
      }
    } catch (error) {
      console.error('Org lookup failed:', error);
    }
  }

  return resolve(event);
};

export const handle = sequence(authHandle, orgHandle);

function extractSubdomain(hostname: string): string | null {
  const parts = hostname.split('.');
  return parts.length >= 3 ? parts[0] : null;
}
```

---

### 2. Route Guards (Layout-Based)

#### Pattern: Layout Guards for Route Groups

```typescript
// src/routes/org/[slug]/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  // Require authentication for (app) routes
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  return {
    user: locals.user,
    organization: locals.organization
  };
};
```

```typescript
// src/routes/org/[slug]/(creator)/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { hasOrgRole, ORG_ROLES } from '$lib/server/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  // Require creator, admin, or owner role in this org
  const creatorRoles = [ORG_ROLES.OWNER, ORG_ROLES.ADMIN, ORG_ROLES.CREATOR];
  if (!hasOrgRole(locals.organizationRole, creatorRoles)) {
    throw redirect(303, '/unauthorized');
  }

  return {
    user: locals.user,
    organization: locals.organization,
    role: locals.organizationRole
  };
};
```

```typescript
// src/routes/org/[slug]/(admin)/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { hasOrgRole, ORG_ROLES } from '$lib/server/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  // Require admin or owner role
  const adminRoles = [ORG_ROLES.OWNER, ORG_ROLES.ADMIN];
  if (!hasOrgRole(locals.organizationRole, adminRoles)) {
    throw redirect(303, '/unauthorized');
  }

  return {
    user: locals.user,
    organization: locals.organization,
    role: locals.organizationRole
  };
};
```

---

### 3. Fine-Grained Permissions (Page-Level)

```typescript
// src/routes/org/[slug]/(creator)/studio/content/[id]/+page.server.ts
import { error } from '@sveltejs/kit';
import { api } from '$lib/server/api';
import { hasOrgRole, ORG_ROLES } from '$lib/server/rbac';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, cookies }) => {
  const sessionCookie = cookies.get('codex-session');

  const { data: content } = await api('content', `/api/content/${params.id}`, {
    sessionCookie
  });

  // Check ownership (creator can only edit their own content)
  // Admins and owners can edit any org content
  const isOwnerOrAdmin = hasOrgRole(locals.organizationRole, [ORG_ROLES.OWNER, ORG_ROLES.ADMIN]);
  const isContentOwner = content.creatorId === locals.userId;

  if (!isContentOwner && !isOwnerOrAdmin) {
    throw error(403, 'You do not have permission to edit this content');
  }

  return { content };
};
```

---

### 4. Client-Side UI Guards (UX Only!)

```svelte
<!-- src/routes/org/[slug]/(app)/+layout.svelte -->
<script lang="ts">
  import { page } from '$app/state';

  let user = $derived(page.data.user);
  let role = $derived(page.data.role);

  let isCreator = $derived(
    role === 'creator' || role === 'admin' || role === 'owner'
  );
  let isAdmin = $derived(role === 'admin' || role === 'owner');
  let isOwner = $derived(role === 'owner');
</script>

<nav>
  <a href="/library">Library</a>

  {#if isCreator}
    <a href="/studio">Creator Studio</a>
  {/if}

  {#if isAdmin}
    <a href="/admin">Admin Dashboard</a>
  {/if}

  {#if isOwner}
    <a href="/admin/settings">Org Settings</a>
  {/if}
</nav>
```

**⚠️ CRITICAL**: Client-side guards are for **UX only**. Always enforce on server!

---

### 5. Login Flow

**Auth Worker handles everything!** Don't create sessions manually.

```typescript
// src/routes/(auth)/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_WORKER_URL } from '$env/static/private';

export const actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    // Call Auth Worker - it handles EVERYTHING
    // - Password verification (bcrypt)
    // - Session creation (PostgreSQL)
    // - Cookie setting (codex-session)
    const res = await fetch(`${AUTH_WORKER_URL}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const error = await res.json();
      return fail(400, { email, error: error.message || 'Invalid credentials' });
    }

    // Cookie is set by Auth Worker via Set-Cookie header
    // For cross-subdomain, Auth Worker must set domain: '.revelations.studio'

    throw redirect(303, '/library');
  }
};
```

---

## Recommended Architecture Summary

### Layer 1: Session Resolution (hooks.server.ts)
- Read `codex-session` cookie
- Call Auth Worker `GET /api/auth/session` to validate
- Call Identity-API to resolve org from subdomain
- Set `event.locals.user`, `event.locals.organization`, `event.locals.organizationRole`

### Layer 2: Route Groups with Layout Guards
```
src/routes/
├── (public)/                    # No auth required
├── (auth)/                      # Redirect if logged in
├── org/[slug]/
│   ├── (storefront)/           # Public org pages
│   ├── (app)/                  # Requires: authenticated
│   │   └── +layout.server.ts   # Check locals.userId
│   ├── (creator)/              # Requires: creator/admin/owner
│   │   └── +layout.server.ts   # Check org role
│   └── (admin)/                # Requires: admin/owner
│       └── +layout.server.ts   # Check org role
```

### Layer 3: Fine-Grained Permissions
- Page-level: Check resource ownership
- API calls: Workers enforce authorization
- Remote functions: Check roles in function body

### Layer 4: Client-Side UX
- Conditional navigation (role-based)
- Show/hide UI elements
- **Never trust client for security!**

---

## Key Differences from Generic Patterns

| Generic SvelteKit | Codex Reality |
|-------------------|---------------|
| `session` cookie | `codex-session` cookie |
| Manual session in KV | Auth Worker (BetterAuth) handles sessions |
| D1 database | Neon PostgreSQL (via Workers) |
| `guest`/`user`/`admin` roles | `customer` + org roles (`owner`/`admin`/`creator`/`member`) |
| Direct DB queries | Call Workers via API helper |
| Platform.env.KV | Workers own all data access |

---

## Best Practices

1. **Never implement auth manually** - Auth Worker handles it
2. **Always call Workers** - Don't query database directly from SvelteKit
3. **Use layout guards** - DRY, maintainable route protection
4. **Forward cookies** - Pass `codex-session` to all Worker calls
5. **Check roles per-org** - User can have different roles in different orgs
6. **Client guards = UX only** - Server always enforces
7. **Log auth failures** - Monitor for attacks

---

## References

- [SvelteKit Remote Functions](https://svelte.dev/docs/kit/remote-functions)
- [SvelteKit Hooks](https://kit.svelte.dev/docs/hooks)
- [BetterAuth](https://www.better-auth.com/)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
