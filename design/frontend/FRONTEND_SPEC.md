# Codex Frontend Specification

**Status**: Design
**Version**: 2.0
**Last Updated**: 2026-01-09

Single source of truth for Codex platform frontend architecture. Consolidates research from archived documents into production-ready specification.

---

## Table of Contents

1. [Overview & Tech Stack](#1-overview--tech-stack)
2. [Infrastructure & Hosting](#2-infrastructure--hosting)
3. [Routing & Navigation](#3-routing--navigation)
4. [Authentication](#4-authentication)
5. [Authorization & Roles](#5-authorization--roles)
6. [Data Layer & State Management](#6-data-layer--state-management)
7. [Forms & Mutations](#7-forms--mutations)
8. [Component Architecture](#8-component-architecture)
9. [Styling & Theming](#9-styling--theming)
10. [Error Handling](#10-error-handling)
11. [Performance](#11-performance)
12. [Accessibility](#12-accessibility)
13. [SEO](#13-seo)
14. [Testing Strategy](#14-testing-strategy)
15. [Security](#15-security)
16. [DevOps & Deployment](#16-devops--deployment)
17. [Future Considerations](#17-future-considerations)

---

## 1. Overview & Tech Stack

### 1.1 Product Description

**Codex** is a multi-tenant content monetization platform where:
- **Organizations** (yoga studios, cooking schools, coaches) sell video/audio content
- **Customers** purchase and consume content via streaming
- **Creators** manage media libraries and products
- **Org Owners/Admins** administer organizations, teams, and billing

Each organization gets a branded subdomain: `{slug}.revelations.studio`

### 1.2 Frontend Requirements

| Requirement | Implementation |
|-------------|----------------|
| Multi-tenant | Subdomain per organization, shared codebase |
| SEO-friendly | SSR for public pages (storefront, content) |
| Interactive | Client-side reactivity for dashboards |
| Type-safe | End-to-end TypeScript, shared validation |
| Secure | HttpOnly cookies, RBAC, org isolation |

### 1.3 Tech Stack

```
Framework
├── SvelteKit 2.x (@sveltejs/kit)
├── Svelte 5.x (runes: $state, $derived, $effect)
├── TypeScript (strict mode)
└── Vite

Hosting
├── Cloudflare Pages (@sveltejs/adapter-cloudflare)
└── Custom domains via DNS-on-demand

Styling
├── Tailwind CSS 4.x
├── Shadcn-Svelte (component primitives)
└── CSS custom properties (org branding)

State Management
├── Svelte 5 runes ($state in .svelte.ts files)
└── $app/state for page data

Backend Integration
├── Auth Worker (BetterAuth) - port 42069
├── Content-API Worker - port 4001
├── Identity-API Worker - port 42071
└── Ecom-API Worker - port 42072
```

### 1.4 Guiding Principles

1. **Server-first**: SSR for SEO, hydrate for interactivity
2. **Type-safe**: Zod validation shared with backend, inferred types
3. **Progressive enhancement**: Forms work without JS
4. **Minimal client JS**: Use runes, avoid heavy state libs
5. **Security by default**: HttpOnly cookies, CSRF protection, CSP headers
6. **Backend owns logic**: Frontend calls workers, doesn't duplicate business rules

### 1.5 Project Structure

```
apps/web/
├── src/
│   ├── routes/           # SvelteKit file-based routing
│   │   ├── (public)/     # Platform marketing
│   │   ├── (auth)/       # Login, register
│   │   └── org/[slug]/   # Organization-scoped routes
│   ├── lib/
│   │   ├── components/   # UI components
│   │   ├── server/       # Server-only code (api helpers)
│   │   └── state/        # Shared reactive state (.svelte.ts)
│   ├── hooks.server.ts   # Auth + org resolution
│   └── hooks.ts          # Client hooks (reroute)
├── static/               # Static assets
├── svelte.config.js      # Cloudflare adapter config
└── wrangler.jsonc        # Cloudflare bindings
```

### 1.6 Backend Documentation

For backend architecture, see:
- [CLAUDE.md](../../CLAUDE.md) - Full backend overview
- [workers/CLAUDE.md](../../workers/CLAUDE.md) - Worker endpoints
- [packages/CLAUDE.md](../../packages/CLAUDE.md) - Service packages

---

## 2. Infrastructure & Hosting

### 2.1 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare DNS                               │
│  *.revelations.studio → Cloudflare Pages                        │
│  api.revelations.studio → Content-API Worker                    │
│  auth.revelations.studio → Auth Worker                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (codex-web)                        │
│  SvelteKit app with @sveltejs/adapter-cloudflare                │
│  SSR + static assets + Cloudflare bindings                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Cloudflare Pages Configuration

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-cloudflare';

export default {
  kit: {
    adapter: adapter({
      routes: {
        include: ['/*'],
        exclude: ['<all>']  // Exclude static assets
      }
    })
  }
};
```

```jsonc
// wrangler.jsonc
{
  "name": "codex-web",
  "compatibility_date": "2024-01-01",
  "pages_build_output_dir": ".svelte-kit/cloudflare"
}
```

### 2.3 Subdomain Strategy

**DNS-on-demand**: Create Cloudflare DNS records when organizations are created.

| Domain | Purpose |
|--------|---------|
| `revelations.studio` | Platform root (marketing) |
| `www.revelations.studio` | Alias for root |
| `{slug}.revelations.studio` | Organization storefront |
| `api.revelations.studio` | Content-API Worker |
| `auth.revelations.studio` | Auth Worker |
| `identity.revelations.studio` | Identity-API Worker |
| `ecom.revelations.studio` | Ecom-API Worker |

**Why not wildcards?**
- Cloudflare Pages doesn't support wildcard custom domains natively
- DNS-on-demand gives per-org control, easier debugging
- Auto-SSL provisioned per record

**DNS Creation Flow** (in Identity-API Worker):
```typescript
// Called when org is created
await cloudflare.dns.records.create({
  zone_id: ZONE_ID,
  type: 'CNAME',
  name: slug,  // e.g., "yoga-studio"
  content: 'codex-web.pages.dev',
  proxied: true
});
```

### 2.4 Environment Configuration

```bash
# .env.development
AUTH_WORKER_URL=http://localhost:42069
CONTENT_API_URL=http://localhost:4001
IDENTITY_API_URL=http://localhost:42071
ECOM_API_URL=http://localhost:42072
PUBLIC_DOMAIN=localhost:5173

# .env.production (Cloudflare secrets)
AUTH_WORKER_URL=https://auth.revelations.studio
CONTENT_API_URL=https://api.revelations.studio
IDENTITY_API_URL=https://identity.revelations.studio
ECOM_API_URL=https://ecom.revelations.studio
PUBLIC_DOMAIN=revelations.studio
```

Access in server code:
```typescript
import { AUTH_WORKER_URL } from '$env/static/private';
import { PUBLIC_DOMAIN } from '$env/static/public';
```

### 2.5 Cloudflare Bindings

Access Cloudflare services via `platform.env` in server code:

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ platform }) => {
  // Access KV, R2, etc. if needed
  const kv = platform?.env?.KV;

  // Note: Frontend typically calls Workers, not direct bindings
  // Workers handle KV, R2, DB access
};
```

### 2.6 Custom Domains (Future)

For orgs wanting `learn.yogastudio.com`:

**Approach**: Token-based redirect flow
1. User visits custom domain (no session)
2. Redirect to `auth.revelations.studio/authorize?redirect=learn.yogastudio.com`
3. Auth creates one-time token, redirects back
4. Custom domain exchanges token for local session cookie

**Requirements**:
- Cloudflare for SaaS (orange-to-orange proxy)
- Token exchange endpoints in Auth Worker
- Domain→org mapping in database

See [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) for implementation details.

---

## 3. Routing & Navigation

### 3.1 Route Structure

```
src/routes/
├── (public)/                    # Platform marketing (revelations.studio)
│   ├── +layout.svelte
│   └── +page.svelte             # Landing page
├── (auth)/                      # Auth pages (all domains)
│   ├── +layout.svelte           # Centered card layout
│   ├── login/+page.svelte
│   ├── register/+page.svelte
│   ├── forgot-password/+page.svelte
│   └── reset-password/+page.svelte
├── org/[slug]/                  # Organization-scoped routes
│   ├── +layout.server.ts        # Validate org exists
│   ├── (storefront)/            # Public org pages
│   │   ├── +layout.svelte       # Org-branded header/footer
│   │   ├── +page.svelte         # Org home
│   │   ├── explore/+page.svelte # Browse content
│   │   ├── c/[contentSlug]/+page.svelte  # Content detail
│   │   └── checkout/success/+page.svelte
│   ├── (app)/                   # Authenticated user
│   │   ├── +layout.server.ts    # Require auth
│   │   ├── library/+page.svelte
│   │   ├── watch/[contentId]/+page.svelte
│   │   └── settings/+page.svelte
│   ├── (creator)/               # Creator studio
│   │   ├── +layout.server.ts    # Require creator role
│   │   └── studio/
│   │       ├── +page.svelte     # Dashboard
│   │       ├── media/+page.svelte
│   │       ├── content/+page.svelte
│   │       ├── content/new/+page.svelte
│   │       └── content/[id]/+page.svelte
│   └── (admin)/                 # Org admin
│       ├── +layout.server.ts    # Require admin role
│       └── admin/
│           ├── +page.svelte
│           ├── customers/+page.svelte
│           ├── customers/[id]/+page.svelte
│           ├── team/+page.svelte
│           └── settings/+page.svelte
└── hooks.ts                     # Subdomain reroute
```

### 3.2 Subdomain Rewriting

The `reroute` hook translates subdomain URLs to internal routes:

```typescript
// src/hooks.ts
import type { Reroute } from '@sveltejs/kit';

const IGNORED_SUBDOMAINS = ['www', 'api', 'auth', 'identity', 'ecom'];

export const reroute: Reroute = ({ url }) => {
  const subdomain = extractSubdomain(url.hostname);

  // Main domain or ignored: no rewrite
  if (!subdomain || IGNORED_SUBDOMAINS.includes(subdomain)) {
    return url.pathname;
  }

  // yoga-studio.revelations.studio/library → /org/yoga-studio/library
  return `/org/${subdomain}${url.pathname}`;
};

function extractSubdomain(hostname: string): string | null {
  // Handle localhost: yoga-studio.localhost:5173
  if (hostname.includes('localhost')) {
    const parts = hostname.split('.');
    return parts.length > 1 ? parts[0] : null;
  }

  // Production: yoga-studio.revelations.studio
  const parts = hostname.replace('revelations.studio', '').split('.').filter(Boolean);
  return parts[0] || null;
}
```

### 3.3 Route Groups & Access

| Group | URL Pattern | Auth | Role | Layout |
|-------|-------------|------|------|--------|
| `(public)` | `revelations.studio/*` | None | - | Marketing |
| `(auth)` | `*/login`, `*/register` | Redirect if logged in | - | Centered card |
| `(storefront)` | `{slug}.*/`, `*/explore` | None | - | Org branded |
| `(app)` | `{slug}.*/library` | Required | Any | App sidebar |
| `(creator)` | `{slug}.*/studio/*` | Required | creator+ | Creator sidebar |
| `(admin)` | `{slug}.*/admin/*` | Required | admin+ | Admin sidebar |

### 3.4 Dynamic Routes

| Pattern | Example | Use |
|---------|---------|-----|
| `[slug]` | `/org/yoga-studio` | Organization lookup |
| `[contentSlug]` | `/c/intro-to-yoga` | Content detail |
| `[contentId]` | `/watch/abc123` | Video player |
| `[id]` | `/admin/customers/user456` | Entity detail |

### 3.5 Navigation Components

**Required components**:
- `PublicHeader` - Logo, login/signup, org branding
- `AppSidebar` - Library, settings, account
- `CreatorSidebar` - Media, content, analytics
- `AdminSidebar` - Customers, team, settings
- `Breadcrumbs` - Dynamic based on route
- `OrgSwitcher` - For users in multiple orgs

**Navigation state**:
```typescript
// $lib/state/navigation.svelte.ts
export const nav = $state({
  sidebarOpen: true,
  currentSection: 'library'
});

export function toggleSidebar() {
  nav.sidebarOpen = !nav.sidebarOpen;
}
```

---

## 4. Authentication

### 4.1 Auth Architecture

**Critical**: Auth Worker (BetterAuth) owns all authentication. Frontend does NOT implement auth logic.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SvelteKit     │────▶│   Auth Worker   │────▶│   PostgreSQL    │
│   (Frontend)    │◀────│   (BetterAuth)  │◀────│   (Sessions)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │
        └── Reads cookie, calls Auth Worker to validate
```

### 4.2 Cookie Configuration

Auth Worker sets the session cookie with cross-subdomain support:

```typescript
// Auth Worker (BetterAuth) config - NOT in SvelteKit
{
  name: 'codex-session',
  domain: '.revelations.studio',  // Leading dot = all subdomains
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax'  // Required for cross-subdomain navigation
}
```

**Why this is secure:**
- HttpOnly: JavaScript cannot access
- Secure: HTTPS only
- SameSite=Lax: Prevents CSRF from external sites, allows navigation
- Same parent domain: All subdomains share security boundary

### 4.3 Session Resolution (hooks.server.ts)

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { AUTH_WORKER_URL } from '$env/static/private';
import type { Handle } from '@sveltejs/kit';

const authHandle: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      // Call Auth Worker to validate session
      const response = await fetch(`${AUTH_WORKER_URL}/api/auth/session`, {
        headers: { Cookie: `codex-session=${sessionCookie}` }
      });

      if (response.ok) {
        const { user, session } = await response.json();
        event.locals.userId = user.id;
        event.locals.user = user;
        event.locals.session = session;
      }
    } catch (error) {
      console.error('Session validation failed:', error);
    }
  }

  return resolve(event);
};

export const handle = sequence(authHandle);
```

### 4.4 Auth Forms (Form Actions)

```typescript
// src/routes/(auth)/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_WORKER_URL } from '$env/static/private';

export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    // Call Auth Worker - it handles everything
    const response = await fetch(`${AUTH_WORKER_URL}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      return fail(400, { email, error: error.message });
    }

    // Auth Worker sets cookie in response, forward it
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      // Parse and set cookie (or use cookie-forwarding approach)
    }

    throw redirect(303, '/library');
  }
};
```

### 4.5 Auth Flow Summary

| Flow | Frontend Action | Auth Worker Endpoint |
|------|-----------------|---------------------|
| Login | Form POST | POST /api/auth/email/login |
| Register | Form POST | POST /api/auth/email/register |
| Logout | Form POST | POST /api/auth/signout |
| Session check | hooks.server.ts | GET /api/auth/session |
| Password reset | Form POST | POST /api/auth/forgot-password |
| Set new password | Form POST | POST /api/auth/reset-password |

### 4.6 Protecting Routes

```typescript
// src/routes/org/[slug]/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.userId) {
    throw redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  return { user: locals.user };
};
```

---

## 5. Authorization & Roles

### 5.1 Role System (Actual Schema)

**User Table** (`users.role`):
```
customer (default) - Regular platform user
```

**Organization Membership** (`organizationMemberships.role`):
```
owner     - Full org control, billing, team
admin     - Content management, customer support
creator   - Own content only, media library
subscriber - Subscription-based content access
member    - Basic org access (default)
```

**Key concept**: Users have ONE global role (`customer`) but can have DIFFERENT roles in DIFFERENT organizations.

### 5.2 Role Hierarchy

```typescript
// $lib/server/rbac.ts
export const ROLE_HIERARCHY: Record<string, string[]> = {
  owner: ['owner', 'admin', 'creator', 'subscriber', 'member'],
  admin: ['admin', 'creator', 'subscriber', 'member'],
  creator: ['creator', 'subscriber', 'member'],
  subscriber: ['subscriber', 'member'],
  member: ['member']
};

export function hasRole(userRole: string, requiredRole: string): boolean {
  return ROLE_HIERARCHY[userRole]?.includes(requiredRole) ?? false;
}
```

### 5.3 Layout Guards

Each route group has a `+layout.server.ts` that enforces access:

```typescript
// src/routes/org/[slug]/(creator)/+layout.server.ts
import { redirect, error } from '@sveltejs/kit';
import { hasRole } from '$lib/server/rbac';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
  // 1. Require authentication
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  // 2. Require organization
  if (!locals.organization) {
    throw error(404, 'Organization not found');
  }

  // 3. Require creator role (or higher)
  if (!hasRole(locals.organizationRole ?? '', 'creator')) {
    throw redirect(303, '/unauthorized');
  }

  return {
    user: locals.user,
    organization: locals.organization,
    role: locals.organizationRole
  };
};
```

### 5.4 Guard Shortcuts

```typescript
// $lib/server/guards.ts
import { redirect, error } from '@sveltejs/kit';
import { hasRole } from './rbac';
import type { RequestEvent } from '@sveltejs/kit';

export function requireAuth(event: RequestEvent) {
  if (!event.locals.userId) {
    const returnTo = event.url.pathname + event.url.search;
    throw redirect(303, `/login?redirect=${encodeURIComponent(returnTo)}`);
  }
  return { userId: event.locals.userId, user: event.locals.user };
}

export function requireOrgRole(event: RequestEvent, minRole: string) {
  const { userId, user } = requireAuth(event);

  if (!event.locals.organization) {
    throw error(404, 'Organization not found');
  }

  if (!hasRole(event.locals.organizationRole ?? '', minRole)) {
    throw redirect(303, '/unauthorized');
  }

  return {
    userId,
    user,
    organization: event.locals.organization,
    role: event.locals.organizationRole
  };
}

// Convenience exports
export const require = {
  auth: requireAuth,
  owner: (e: RequestEvent) => requireOrgRole(e, 'owner'),
  admin: (e: RequestEvent) => requireOrgRole(e, 'admin'),
  creator: (e: RequestEvent) => requireOrgRole(e, 'creator'),
  member: (e: RequestEvent) => requireOrgRole(e, 'member')
};
```

**Usage**:
```typescript
// +page.server.ts
import { require } from '$lib/server/guards';

export const load: PageServerLoad = async (event) => {
  const { user, organization } = require.creator(event);
  // User is authenticated and has creator role
};
```

### 5.5 Fine-Grained Permissions

Beyond role checks, some actions require ownership:

```typescript
// src/routes/org/[slug]/(creator)/studio/content/[id]/+page.server.ts
import { require } from '$lib/server/guards';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
  const { user, organization, role } = require.creator(event);

  // Fetch content
  const content = await getContent(event.params.id, organization.id);

  if (!content) {
    throw error(404, 'Content not found');
  }

  // Admins/owners can edit any content; creators only their own
  const canEdit = hasRole(role, 'admin') || content.creatorId === user.id;

  if (!canEdit) {
    throw error(403, 'You can only edit your own content');
  }

  return { content, canEdit };
};
```

### 5.6 Client-Side UI Guards

**Warning**: Client guards are for UX only. Server ALWAYS enforces security.

```svelte
<script lang="ts">
  import { page } from '$app/state';

  let role = $derived(page.data.role);
  let isAdmin = $derived(role === 'owner' || role === 'admin');
  let canEdit = $derived(page.data.canEdit);
</script>

<!-- Hide admin-only UI (but server still blocks if accessed directly) -->
{#if isAdmin}
  <a href="/admin">Admin Dashboard</a>
{/if}

<!-- Show edit button only if permission exists -->
{#if canEdit}
  <button onclick={handleEdit}>Edit Content</button>
{/if}
```

### 5.7 Organization Resolution

Organization and role are set in hooks:

```typescript
// src/hooks.server.ts (orgHandle)
const orgHandle: Handle = async ({ event, resolve }) => {
  const subdomain = extractSubdomain(event.url.hostname);

  if (subdomain) {
    // Fetch org by slug from Identity-API
    const org = await fetchOrgBySlug(subdomain);

    if (org) {
      event.locals.organization = org;

      // If user is logged in, check their membership
      if (event.locals.userId) {
        const membership = await fetchMembership(
          event.locals.userId,
          org.id
        );
        event.locals.organizationRole = membership?.role ?? null;
      }
    }
  }

  return resolve(event);
};
```

---

## 6. Data Layer & State Management

### 6.1 Data Fetching Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────────────┐
│   Browser   │────▶│  SvelteKit      │────▶│  Cloudflare Workers      │
│             │     │  (BFF Layer)    │     │                          │
│  - $effect  │◀────│  - load funcs   │◀────│  Auth (42069)            │
│  - forms    │     │  - form actions │     │  Content-API (4001)      │
└─────────────┘     └─────────────────┘     │  Identity-API (42071)    │
                                            │  Ecom-API (42072)        │
                                            └──────────────────────────┘
```

### 6.2 Data Fetching Patterns

| Scenario | Pattern | Example |
|----------|---------|---------|
| Initial page data | Server `load` | Library list on navigation |
| SEO content | Server `load` + SSR | Content detail page |
| Client reactivity | `$effect` + fetch | Search, filters |
| Shared state | `.svelte.ts` + `$state` | Cart, user prefs |
| Mutations | Form actions | Create content |
| Page data access | `$app/state` | User from layout |

### 6.3 Server Load Functions

```typescript
// src/routes/org/[slug]/(app)/library/+page.server.ts
import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';

export const load: PageServerLoad = async ({ locals, cookies, depends }) => {
  const sessionCookie = cookies.get('codex-session');

  // Mark dependency for invalidation
  depends('app:library');

  // Parallel fetch from workers
  const [library, progress] = await Promise.all([
    api('content', '/api/user/library', { sessionCookie }),
    api('content', '/api/user/playback-progress', { sessionCookie })
  ]);

  return {
    library: library.data,
    progress: progress.data
  };
};
```

### 6.4 API Helper

```typescript
// $lib/server/api.ts
import {
  AUTH_WORKER_URL,
  CONTENT_API_URL,
  IDENTITY_API_URL,
  ECOM_API_URL
} from '$env/static/private';

const WORKERS = {
  auth: AUTH_WORKER_URL,
  content: CONTENT_API_URL,
  identity: IDENTITY_API_URL,
  ecom: ECOM_API_URL
} as const;

export async function api<T>(
  worker: keyof typeof WORKERS,
  path: string,
  options: RequestInit & { sessionCookie?: string } = {}
): Promise<T> {
  const { sessionCookie, ...fetchOptions } = options;

  const res = await fetch(`${WORKERS[worker]}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie && { Cookie: `codex-session=${sessionCookie}` }),
      ...fetchOptions.headers
    }
  });

  if (!res.ok) {
    throw new APIError(res.status, await res.json());
  }

  return res.json();
}
```

### 6.5 Svelte 5 State Management

**Use runes, not stores**. Reactive state in `.svelte.ts` files.

```typescript
// $lib/state/search.svelte.ts
export const searchState = $state({
  query: '',
  results: [] as ContentItem[],
  loading: false
});

export async function performSearch(query: string) {
  searchState.loading = true;
  searchState.query = query;

  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  searchState.results = await res.json();
  searchState.loading = false;
}
```

### 6.6 Page Data Access

```svelte
<script lang="ts">
  import { page } from '$app/state';

  // Reactive access to server data
  let library = $derived(page.data.library);
  let user = $derived(page.data.user);

  // Client-side filtering
  let filter = $state('');
  let filtered = $derived(
    library.filter(item =>
      item.title.toLowerCase().includes(filter.toLowerCase())
    )
  );
</script>
```

### 6.7 Client-Side Data Fetching

```svelte
<script lang="ts">
  let contentId = $state('');
  let details = $state<ContentDetails | null>(null);

  $effect(() => {
    if (!contentId) return;

    const controller = new AbortController();

    fetch(`/api/content/${contentId}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => details = data);

    return () => controller.abort();
  });
</script>
```

### 6.8 Key Worker Endpoints

| Worker | Endpoint | Use |
|--------|----------|-----|
| auth | GET /api/auth/session | Validate session |
| content | GET /api/content/:id | Content detail |
| content | GET /api/access/streaming-url/:id | Presigned R2 URL |
| content | POST /api/access/playback-progress/:id | Save progress |
| identity | GET /api/organizations/slug/:slug | Org by subdomain |
| ecom | POST /checkout/create | Stripe checkout |

---

## 7. Forms & Mutations

### 7.1 Form Actions (Recommended)

Use SvelteKit form actions for mutations. Works without JavaScript.

```typescript
// src/routes/org/[slug]/(creator)/studio/content/new/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { api } from '$lib/server/api';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const data = await request.formData();
    const title = data.get('title') as string;
    const description = data.get('description') as string;

    // Validate
    if (!title || title.length < 3) {
      return fail(400, { title, error: 'Title must be at least 3 characters' });
    }

    const sessionCookie = cookies.get('codex-session');

    try {
      const result = await api('content', '/api/content', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          organizationId: locals.organization.id
        }),
        sessionCookie
      });

      throw redirect(303, `/studio/content/${result.data.id}`);
    } catch (err) {
      return fail(500, { title, description, error: 'Failed to create content' });
    }
  }
};
```

### 7.2 Form Component Pattern

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
</script>

<form method="POST" use:enhance>
  <label>
    Title
    <input name="title" value={form?.title ?? ''} required minlength="3" />
  </label>

  <label>
    Description
    <textarea name="description">{form?.description ?? ''}</textarea>
  </label>

  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}

  <button type="submit">Create Content</button>
</form>
```

### 7.3 Progressive Enhancement

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let loading = $state(false);
</script>

<form
  method="POST"
  use:enhance={() => {
    loading = true;
    return async ({ update }) => {
      await update();
      loading = false;
    };
  }}
>
  <button disabled={loading}>
    {loading ? 'Saving...' : 'Save'}
  </button>
</form>
```

### 7.4 Client-Side Mutations

For actions that don't need progressive enhancement:

```svelte
<script lang="ts">
  import { invalidate } from '$app/navigation';

  async function handleDelete(contentId: string) {
    if (!confirm('Delete this content?')) return;

    const res = await fetch(`/api/content/${contentId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      // Refresh page data
      await invalidate('app:content');
    }
  }
</script>
```

### 7.5 Validation Pattern

Use Zod schemas shared with backend:

```typescript
// $lib/validation/content.ts (or import from @codex/validation)
import { z } from 'zod';

export const createContentSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(2000).optional(),
  accessType: z.enum(['free', 'paid', 'members_only'])
});

// In form action
const parsed = createContentSchema.safeParse({
  title: data.get('title'),
  description: data.get('description'),
  accessType: data.get('accessType')
});

if (!parsed.success) {
  return fail(400, { errors: parsed.error.flatten() });
}
```

---

## 8. Component Architecture

### 8.1 Component Organization

```
$lib/components/
├── ui/                 # Atomic primitives (Shadcn-Svelte)
│   ├── button/
│   ├── input/
│   ├── card/
│   └── ...
├── layout/             # Layout components
│   ├── PublicHeader.svelte
│   ├── AppSidebar.svelte
│   ├── CreatorSidebar.svelte
│   └── PageHeader.svelte
├── content/            # Content-related features
│   ├── ContentCard.svelte
│   ├── ContentGrid.svelte
│   └── HLSPlayer.svelte
├── forms/              # Form components
│   ├── LoginForm.svelte
│   ├── ContentForm.svelte
│   └── UploadZone.svelte
└── shared/             # Cross-cutting components
    ├── LoadingSpinner.svelte
    ├── ErrorBoundary.svelte
    └── Breadcrumbs.svelte
```

### 8.2 Component Categories

| Category | Location | Examples |
|----------|----------|----------|
| Atomic UI | `ui/` | Button, Input, Card, Badge, Dialog |
| Layout | `layout/` | Header, Sidebar, Footer, PageHeader |
| Feature | `content/`, `media/` | ContentGrid, HLSPlayer, MediaList |
| Forms | `forms/` | LoginForm, ContentEditor, UploadZone |
| Shared | `shared/` | Breadcrumbs, Loading, ErrorBoundary |

### 8.3 Shadcn-Svelte Integration

Use Shadcn-Svelte for primitive components:

```bash
npx shadcn-svelte@latest init
npx shadcn-svelte@latest add button card dialog input
```

Components are copied to `$lib/components/ui/` for customization.

### 8.4 Component Props Pattern

```svelte
<!-- ContentCard.svelte -->
<script lang="ts">
  import { Card } from '$lib/components/ui/card';
  import type { Content } from '$lib/types';

  interface Props {
    content: Content;
    showProgress?: boolean;
    onclick?: () => void;
  }

  let { content, showProgress = false, onclick }: Props = $props();
</script>

<Card class="cursor-pointer" {onclick}>
  <img src={content.thumbnailUrl} alt={content.title} />
  <h3>{content.title}</h3>
  {#if showProgress && content.progress}
    <progress value={content.progress} max="100" />
  {/if}
</Card>
```

### 8.5 Layout Components

```svelte
<!-- AppSidebar.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import { nav, toggleSidebar } from '$lib/state/navigation.svelte';

  let org = $derived(page.data.organization);
  let currentPath = $derived(page.url.pathname);
</script>

<aside class:collapsed={!nav.sidebarOpen}>
  <nav>
    <a href="/library" class:active={currentPath === '/library'}>
      Library
    </a>
    <a href="/settings" class:active={currentPath === '/settings'}>
      Settings
    </a>
  </nav>
</aside>
```

### 8.6 Organization Branding

Components receive org branding via layout data:

```svelte
<script lang="ts">
  import { page } from '$app/state';

  let org = $derived(page.data.organization);
  let brandColor = $derived(org?.primaryColor ?? '#3b82f6');
</script>

<header style="--brand-color: {brandColor}">
  {#if org?.logoUrl}
    <img src={org.logoUrl} alt={org.name} />
  {:else}
    <span>{org?.name}</span>
  {/if}
</header>

<style>
  header {
    background: var(--brand-color);
  }
</style>
```

### 8.7 Key Components (Phase 1)

**Layout**:
- `PublicHeader` - Logo, nav, login/signup
- `AppSidebar` - Library navigation
- `CreatorSidebar` - Studio navigation
- `AdminSidebar` - Admin navigation

**Content**:
- `ContentCard` - Thumbnail, title, price
- `ContentGrid` - Responsive grid of cards
- `HLSPlayer` - Video player with HLS.js
- `ChapterList` - Video chapters

**Forms**:
- `LoginForm` / `RegisterForm`
- `ContentForm` - Title, description, pricing
- `UploadZone` - Drag-and-drop media upload
- `MediaPicker` - Select from uploaded media

---

## 9. Styling & Theming

### 9.1 Stack

```
Tailwind CSS 4.x
├── @tailwindcss/typography (prose)
├── @tailwindcss/forms
└── @tailwindcss/container-queries

Shadcn-Svelte
├── Radix-based primitives
├── Copied to $lib/components/ui/
└── Customizable via CSS variables

CSS Custom Properties
├── --brand-* (organization colors)
├── --color-* (design system)
└── Dark mode support
```

### 9.2 Tailwind Configuration

```javascript
// tailwind.config.js
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand-primary)',
          secondary: 'var(--brand-secondary)'
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms')
  ]
};
```

### 9.3 Design Tokens

```css
/* app.css */
:root {
  /* Brand colors (overridden per-org) */
  --brand-primary: #3b82f6;
  --brand-secondary: #1e40af;

  /* System colors */
  --color-background: #ffffff;
  --color-foreground: #0f172a;
  --color-muted: #64748b;
  --color-border: #e2e8f0;

  /* Spacing */
  --spacing-page: 1.5rem;
  --spacing-section: 2rem;
}

.dark {
  --color-background: #0f172a;
  --color-foreground: #f8fafc;
  --color-muted: #94a3b8;
  --color-border: #334155;
}
```

### 9.4 Organization Theming

```typescript
// +layout.server.ts
export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    organization: locals.organization,
    theme: {
      primaryColor: locals.organization?.primaryColor ?? '#3b82f6',
      logoUrl: locals.organization?.logoUrl
    }
  };
};
```

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  let { data, children } = $props();
</script>

<div
  style="--brand-primary: {data.theme.primaryColor}"
  class="min-h-screen bg-background text-foreground"
>
  {@render children()}
</div>
```

### 9.5 Dark Mode

```svelte
<script lang="ts">
  import { browser } from '$app/environment';

  let darkMode = $state(
    browser ? localStorage.getItem('theme') === 'dark' : false
  );

  $effect(() => {
    if (browser) {
      document.documentElement.classList.toggle('dark', darkMode);
      localStorage.setItem('theme', darkMode ? 'dark' : 'light');
    }
  });
</script>

<button onclick={() => darkMode = !darkMode}>
  {darkMode ? 'Light' : 'Dark'} Mode
</button>
```

### 9.6 Responsive Design

```svelte
<!-- Mobile-first responsive layout -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {#each items as item}
    <ContentCard content={item} />
  {/each}
</div>
```

---

## 10. Error Handling

### 10.1 Error Pages

```
src/routes/
├── +error.svelte           # Global error page
├── org/[slug]/
│   └── +error.svelte       # Org-scoped error page
└── (auth)/
    └── +error.svelte       # Auth error page
```

```svelte
<!-- +error.svelte -->
<script lang="ts">
  import { page } from '$app/state';

  let status = $derived(page.status);
  let message = $derived(page.error?.message ?? 'Unknown error');
</script>

<div class="error-page">
  <h1>{status}</h1>
  <p>{message}</p>
  <a href="/">Go Home</a>
</div>
```

### 10.2 Load Function Errors

```typescript
// +page.server.ts
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const content = await fetchContent(params.id);

  if (!content) {
    throw error(404, {
      message: 'Content not found',
      code: 'CONTENT_NOT_FOUND'
    });
  }

  return { content };
};
```

### 10.3 API Error Handling

```typescript
// $lib/server/api.ts
export class APIError extends Error {
  constructor(
    public status: number,
    public data: { message: string; code?: string }
  ) {
    super(data.message);
  }
}

// In load functions
try {
  const result = await api('content', '/api/content');
  return { content: result.data };
} catch (err) {
  if (err instanceof APIError) {
    if (err.status === 404) {
      throw error(404, err.data.message);
    }
    if (err.status === 403) {
      throw redirect(303, '/login');
    }
  }
  throw error(500, 'Internal server error');
}
```

### 10.4 Form Action Errors

```typescript
export const actions: Actions = {
  default: async ({ request }) => {
    try {
      // ... action logic
    } catch (err) {
      // Return error to form
      return fail(400, {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }
};
```

### 10.5 Client-Side Error Handling

```svelte
<script lang="ts">
  let error = $state<string | null>(null);

  async function handleAction() {
    error = null;
    try {
      await performAction();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Action failed';
    }
  }
</script>

{#if error}
  <div role="alert" class="error-banner">
    {error}
    <button onclick={() => error = null}>Dismiss</button>
  </div>
{/if}
```

### 10.6 Toast Notifications

```typescript
// $lib/state/toasts.svelte.ts
export const toasts = $state<Toast[]>([]);

export function showToast(message: string, type: 'success' | 'error' = 'success') {
  const id = crypto.randomUUID();
  toasts.push({ id, message, type });

  setTimeout(() => {
    const index = toasts.findIndex(t => t.id === id);
    if (index > -1) toasts.splice(index, 1);
  }, 5000);
}
```

---

## 11. Performance

### 11.1 Core Web Vitals Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| LCP | < 2.5s | SSR, image optimization |
| FID | < 100ms | Minimal JS, code splitting |
| CLS | < 0.1 | Reserved space, font loading |

### 11.2 SSR Strategy

```typescript
// Public pages: Full SSR for SEO
// src/routes/org/[slug]/(storefront)/c/[contentSlug]/+page.server.ts
export const load: PageServerLoad = async ({ params }) => {
  // Always runs on server, HTML sent to client
  return { content: await fetchContent(params.contentSlug) };
};
```

### 11.3 Image Optimization

```svelte
<!-- Use Cloudflare Images or responsive images -->
<img
  src={content.thumbnailUrl}
  alt={content.title}
  loading="lazy"
  decoding="async"
  width="320"
  height="180"
/>
```

### 11.4 Code Splitting

SvelteKit automatically code-splits by route. Additional strategies:

```svelte
<!-- Lazy load heavy components -->
<script lang="ts">
  import { browser } from '$app/environment';

  let HLSPlayer = $state<typeof import('$lib/components/HLSPlayer.svelte').default | null>(null);

  $effect(() => {
    if (browser) {
      import('$lib/components/HLSPlayer.svelte').then(m => HLSPlayer = m.default);
    }
  });
</script>

{#if HLSPlayer}
  <svelte:component this={HLSPlayer} {src} />
{:else}
  <div class="skeleton" />
{/if}
```

### 11.5 Data Loading

```typescript
// Parallel data fetching
export const load: PageServerLoad = async ({ cookies }) => {
  const sessionCookie = cookies.get('codex-session');

  // Fetch in parallel, not serial
  const [library, featured, progress] = await Promise.all([
    api('content', '/api/user/library', { sessionCookie }),
    api('content', '/api/content/featured'),
    api('content', '/api/user/progress', { sessionCookie })
  ]);

  return { library, featured, progress };
};
```

### 11.6 Caching

Workers handle API caching. Frontend caches via:

```typescript
// Browser caching via headers (set by Workers)
// KV caching for session validation (Auth Worker)
// R2 caching for media assets

// Invalidate cached data on mutation
import { invalidate } from '$app/navigation';
await invalidate('app:library');
```

---

## 12. Accessibility

### 12.1 Standards

- WCAG 2.1 Level AA compliance
- Semantic HTML
- Keyboard navigation
- Screen reader support

### 12.2 Semantic HTML

```svelte
<!-- Use semantic elements -->
<main>
  <article>
    <header>
      <h1>{content.title}</h1>
    </header>
    <section aria-label="Video player">
      <HLSPlayer {src} />
    </section>
  </article>
</main>

<!-- Proper heading hierarchy -->
<h1>Page Title</h1>
<h2>Section</h2>
<h3>Subsection</h3>
```

### 12.3 ARIA Labels

```svelte
<!-- Navigation landmarks -->
<nav aria-label="Main navigation">
  <a href="/library">Library</a>
</nav>

<!-- Interactive elements -->
<button aria-label="Play video" onclick={play}>
  <PlayIcon />
</button>

<!-- Live regions for updates -->
<div aria-live="polite" aria-atomic="true">
  {#if loading}Loading...{/if}
</div>
```

### 12.4 Keyboard Navigation

```svelte
<script lang="ts">
  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        handleClick();
        break;
      case 'Escape':
        closeModal();
        break;
    }
  }
</script>

<div
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  Interactive element
</div>
```

### 12.5 Focus Management

```svelte
<script lang="ts">
  let dialogRef: HTMLDialogElement;

  function openDialog() {
    dialogRef.showModal();
    dialogRef.querySelector('input')?.focus();
  }
</script>

<dialog bind:this={dialogRef}>
  <input type="text" />
</dialog>
```

### 12.6 Color Contrast

```css
/* Ensure 4.5:1 contrast ratio for text */
:root {
  --color-text: #1f2937;      /* Gray 800 */
  --color-background: #ffffff;
  --color-muted: #6b7280;     /* Gray 500 - large text only */
}
```

---

## 13. SEO

### 13.1 Meta Tags

```svelte
<!-- +page.svelte -->
<svelte:head>
  <title>{content.title} | {org.name}</title>
  <meta name="description" content={content.description} />

  <!-- Open Graph -->
  <meta property="og:title" content={content.title} />
  <meta property="og:description" content={content.description} />
  <meta property="og:image" content={content.thumbnailUrl} />
  <meta property="og:type" content="video.other" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>
```

### 13.2 Structured Data

```svelte
<script lang="ts">
  let jsonLd = $derived(JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: content.title,
    description: content.description,
    thumbnailUrl: content.thumbnailUrl,
    uploadDate: content.createdAt,
    duration: `PT${content.durationSeconds}S`
  }));
</script>

<svelte:head>
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>
```

### 13.3 Sitemap

```typescript
// src/routes/sitemap.xml/+server.ts
export const GET: RequestHandler = async () => {
  const content = await fetchPublicContent();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${content.map(c => `
  <url>
    <loc>https://${c.org.slug}.revelations.studio/c/${c.slug}</loc>
    <lastmod>${c.updatedAt}</lastmod>
  </url>`).join('')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' }
  });
};
```

### 13.4 Canonical URLs

```svelte
<svelte:head>
  <link rel="canonical" href="https://{org.slug}.revelations.studio/c/{content.slug}" />
</svelte:head>
```

---

## 14. Testing Strategy

### 14.1 Test Stack

```
Vitest              - Unit tests
Playwright          - E2E tests
Testing Library     - Component tests
MSW                 - API mocking
```

### 14.2 Unit Tests

```typescript
// $lib/server/guards.test.ts
import { describe, it, expect } from 'vitest';
import { hasRole } from './rbac';

describe('hasRole', () => {
  it('owner has all roles', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('owner', 'creator')).toBe(true);
  });

  it('creator cannot access admin', () => {
    expect(hasRole('creator', 'admin')).toBe(false);
  });
});
```

### 14.3 Component Tests

```typescript
// ContentCard.test.ts
import { render, screen } from '@testing-library/svelte';
import ContentCard from './ContentCard.svelte';

it('renders content title', () => {
  render(ContentCard, {
    props: { content: { title: 'Test Content', thumbnailUrl: '/test.jpg' } }
  });

  expect(screen.getByText('Test Content')).toBeInTheDocument();
});
```

### 14.4 E2E Tests

```typescript
// tests/auth.spec.ts
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('button[type=submit]');

  await expect(page).toHaveURL('/library');
});
```

---

## 15. Security

### 15.1 Security Headers

```typescript
// hooks.server.ts
const securityHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );

  return response;
};
```

### 15.2 CSRF Protection

SvelteKit form actions include CSRF protection by default. Additional:

```typescript
// Validate origin header
const origin = request.headers.get('origin');
if (origin && !origin.endsWith('revelations.studio')) {
  throw error(403, 'Invalid origin');
}
```

### 15.3 Input Sanitization

```typescript
// Use Zod for validation
import { z } from 'zod';

const schema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional()
});

// Never trust client input
const parsed = schema.safeParse(data);
if (!parsed.success) {
  return fail(400, { errors: parsed.error.flatten() });
}
```

### 15.4 Cookie Security

All cookies are configured by Auth Worker with:
- `httpOnly: true` - No JavaScript access
- `secure: true` - HTTPS only
- `sameSite: 'lax'` - CSRF protection

---

## 16. DevOps & Deployment

### 16.1 Deployment Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      - uses: cloudflare/wrangler-action@v3
        with:
          command: pages deploy .svelte-kit/cloudflare --project-name=codex-web
```

### 16.2 Environment Management

| Environment | Domain | Purpose |
|-------------|--------|---------|
| Development | localhost:5173 | Local dev |
| Staging | staging.revelations.studio | Pre-production |
| Production | *.revelations.studio | Live |

### 16.3 Secrets Management

```bash
# Cloudflare Pages secrets
wrangler pages secret put AUTH_WORKER_URL
wrangler pages secret put CONTENT_API_URL
```

### 16.4 Monitoring

- Cloudflare Analytics for traffic
- Sentry for error tracking
- Custom logging via Workers

---

## 17. Future Considerations

### 17.1 Remote Functions

SvelteKit experimental Remote Functions for Phase 2+:
- Type-safe RPC
- `query.batch` for N+1 prevention
- Granular data refetching

### 17.2 Custom Domains

Support for `learn.yogastudio.com`:
- Token-based redirect flow
- Cloudflare for SaaS
- Per-domain session cookies

### 17.3 Real-Time Features

- WebSocket support for live notifications
- Collaborative features
- Live streaming

### 17.4 Mobile

- PWA with offline support
- Native wrapper via Capacitor
- Push notifications

### 17.5 Internationalization

- i18n support via `@inlang/paraglide-js`
- RTL layout support
- Localized content

See [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) for detailed research on these topics.

---

## References

### Archived Documents (design/frontend/_archive/)
- ARCHITECTURE.md - Original consolidated architecture
- COMPONENTS.md - Component catalog draft
- DATA_FETCHING.md - Data fetching patterns
- DATA_LAYER_RESEARCH.md - State management research
- REMOTE_FUNCTIONS_AND_AUTH.md - RPC and auth patterns
- ROUTES.md - Route specifications
- SUBDOMAIN_ROUTING.md - Multi-tenant routing
- SVELTE5_DATA_PATTERNS.md - Svelte 5 runes patterns

### Backend Documentation
- CLAUDE.md - Backend architecture overview
- packages/*/CLAUDE.md - Per-package documentation
- workers/*/CLAUDE.md - Per-worker documentation

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-09 | Created specification template with 17 sections |
| 2026-01-09 | Completed all 17 sections with full documentation |
