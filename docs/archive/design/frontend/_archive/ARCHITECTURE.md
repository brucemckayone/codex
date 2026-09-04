# Codex Frontend Architecture

**Status**: Design
**Version**: 1.0
**Last Updated**: 2026-01-09

This is the **definitive frontend architecture specification** for the Codex Platform, consolidating all research and design decisions into a single source of truth.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [Technology Stack](#2-technology-stack)
3. [Architecture Decisions](#3-architecture-decisions)
4. [Multi-Tenant Subdomain Strategy](#4-multi-tenant-subdomain-strategy)
5. [Route Structure](#5-route-structure)
6. [Data Fetching Strategy](#6-data-fetching-strategy)
7. [Authorization & Access Control](#7-authorization--access-control)
8. [Component Architecture](#8-component-architecture)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. What We're Building

### The Product

**Codex** is a multi-tenant content monetization platform where:
- **Organizations** (yoga studios, cooking schools, coaches) sell video/audio content
- **Customers** purchase and consume content via streaming (`users.role = 'customer'`)
- **Creators** manage their media libraries and products (`orgMemberships.role = 'creator'`)
- **Org Owners/Admins** administer their organization (`orgMemberships.role = 'owner'|'admin'`)

**Backend**: Cloudflare Workers (Auth, Content-API, Identity-API, Ecom-API) + Neon PostgreSQL

### Frontend Requirements

| Requirement | Description |
|-------------|-------------|
| **Multi-tenant** | Each organization gets `{slug}.codex.com` subdomain |
| **SEO-friendly** | Public pages (storefront, content details) must be SSR |
| **Interactive** | Authenticated dashboards need fast, reactive UX |
| **Type-safe** | End-to-end TypeScript with shared types |
| **Secure** | HttpOnly cookies, RBAC, org isolation |
| **Modern** | Svelte 5 runes, SvelteKit 2 patterns |

### User Personas

| Persona | Routes | Key Actions | DB Role |
|---------|--------|-------------|---------|
| **Unauthenticated** | Public storefront | Browse, view previews, register | No session |
| **Customer** | Library, Watch | Access purchased content, track progress | `users.role = 'customer'` |
| **Org Creator** | Studio | Upload media, create products, view own analytics | `orgMemberships.role = 'creator'` |
| **Org Admin** | Admin | Manage customers, grant access, org settings | `orgMemberships.role = 'admin'` |
| **Org Owner** | Admin (elevated) | Full org control, billing, team management | `orgMemberships.role = 'owner'` |

**Note**: No "platform owner" role exists in current schema. Platform admin features would need schema changes.

---

## 2. Technology Stack

### Core Framework
```
SvelteKit 2 + Svelte 5 (Runes)
├── @sveltejs/adapter-cloudflare
├── TypeScript (strict)
└── Vite
```

### Styling
```
Vanilla CSS + Shadcn-Svelte
├── Custom design tokens (org branding)
└── Dark mode support
```

### State Management
```
Svelte 5 Universal Reactivity
├── $state, $derived, $effect (runes)
├── .svelte.ts files (shared state)
└── $app/state (page data)
```

### Backend Integration (Actual Codex Architecture)
```
Cloudflare Workers (4 workers)
├── Auth Worker (port 42069) - BetterAuth framework
├── Content-API Worker (port 4001) - Content, media, access
├── Identity-API Worker (port 42071) - Organizations
└── Ecom-API Worker (port 42072) - Stripe checkout, webhooks

Database & Storage
├── Neon PostgreSQL (via Drizzle ORM) - ALL data
├── Cloudflare KV (session cache only, 5-min TTL)
└── Cloudflare R2 (media storage, presigned URLs)

Existing Service Packages (USE THESE, no repositories needed!)
├── @codex/content - ContentService, MediaItemService
├── @codex/identity - OrganizationService
├── @codex/access - ContentAccessService (streaming, playback)
├── @codex/purchase - PurchaseService (Stripe integration)
├── @codex/security - Auth middleware, rate limiting
└── @codex/validation - Zod schemas for all inputs
```

---

## 3. Architecture Decisions

### Decision 1: Hybrid Data Fetching

**Choice**: Server-side for public pages, client-side for authenticated dashboards

| Page Type | Strategy | Reason |
|-----------|----------|--------|
| Public (`/`, `/explore`, `/c/[slug]`) | Server `load` + SSR | SEO, fast first paint |
| Authenticated (`/library`, `/studio`) | Server `load` initial + client reactive | Interactivity, caching |
| Mutations (forms, actions) | Form actions or `$effect` | Progressive enhancement |

**Rejected Alternatives**:
- ❌ Pure BFF (too much indirection, slower interactivity)
- ❌ Pure client-side (poor SEO, no auth handling)
- ❌ Repository pattern classes (backend already has service layer - use directly)

---

### Decision 2: Svelte 5 Runes (No Stores)

**Choice**: Use `$state` in `.svelte.ts` files instead of Svelte stores

```typescript
// $lib/state/cart.svelte.ts
export const cart = $state({
  items: [],
  total: 0
});

export function addToCart(item) {
  cart.items.push(item);
  cart.total += item.price;
}
```

**Why**:
- Universal reactivity (works in any .ts file)
- Simpler API (no `.subscribe()`, no `$` prefix in templates)
- Better TypeScript inference
- Stores still available for edge cases (tweened, etc.)

---

### Decision 3: DNS-on-Demand Subdomains (No Wildcards)

**Choice**: Create Cloudflare DNS records when organizations are created

**Flow**:
1. Org owner creates organization with slug `yoga-studio`
2. Backend calls Cloudflare API to create DNS record: `yoga-studio.codex.com → Pages deployment`
3. Cloudflare auto-provisions SSL
4. SvelteKit hooks extract subdomain, resolve org

**Why not wildcards?**:
- Cloudflare Pages doesn't support wildcard custom domains natively
- Worker proxy adds latency and complexity
- DNS-on-demand is simpler and more controlled
- Each org gets dedicated DNS record (easier debugging, monitoring)

**Implementation**:
```typescript
// workers/identity-api/src/routes/organizations.ts
app.post('/api/organizations', async (c) => {
  const { name, slug } = await c.req.json();

  // 1. Create org in database
  const org = await createOrganization({ name, slug });

  // 2. Create Cloudflare DNS record
  await cloudflare.dns.records.create({
    zone_id: ZONE_ID,
    type: 'CNAME',
    name: slug, // yoga-studio
    content: 'codex-web.pages.dev',
    proxied: true
  });

  return c.json({ org });
});
```

---

### Decision 4: Remote Functions for Phase 2+

**Choice**: Evaluate SvelteKit Remote Functions when stable, use `load` + Form Actions for Phase 1

**Current Status**: Experimental (`experimental.remoteFunctions: true`)

**Phase 1**: Standard patterns
- Server `load` functions for data
- Form actions for mutations
- `$effect` for client-side fetching

**Phase 2+**: Consider Remote Functions for:
- `query.batch` (N+1 problem in library grids)
- Type-safe RPC (reduces boilerplate)
- Granular data refetching

---

### Decision 5: Layout-Based Authorization

**Choice**: Each route group has a `+layout.server.ts` that enforces access control

```typescript
// src/routes/org/[slug]/(creator)/+layout.server.ts
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  if (!['creator', 'admin', 'owner'].includes(locals.organizationRole)) {
    throw redirect(303, '/unauthorized');
  }
  return { user: locals.user };
};
```

**Why**:
- DRY (one check per route group)
- Secure (server-side, can't bypass)
- Clear (easy to audit routes)

---

## 4. Multi-Tenant Subdomain Strategy

### URL Structure

| Domain | Purpose |
|--------|---------|
| `codex.com` | Platform home, marketing, global auth |
| `www.codex.com` | Alias for `codex.com` |
| `{slug}.codex.com` | Organization storefront & dashboards |
| `api.codex.com` | API gateway (Workers) |
| `auth.codex.com` | Auth worker |

### Subdomain Resolution Flow

```
1. Request: yoga-studio.codex.com/library
2. DNS: CNAME → codex-web.pages.dev
3. hooks.ts (reroute): Rewrite to /org/yoga-studio/library
4. hooks.server.ts (handle):
   a. Extract subdomain from hostname
   b. Query DB for organization by slug
   c. Set event.locals.organization
5. +layout.server.ts: Validate access, return org data
6. +page.svelte: Render with org context
```

### Cookie Strategy & Cross-Subdomain Authentication

**IMPORTANT**: The Auth Worker (BetterAuth) sets the session cookie. Don't manually set it in SvelteKit.

#### Cross-Subdomain Auth (Single Auth System)

For a single login to work across all subdomains (`auth.revelations.studio`, `yoga-studio.revelations.studio`, etc.), the Auth Worker MUST set:

```typescript
// Auth Worker (BetterAuth) cookie configuration:
{
  name: 'codex-session',
  domain: '.revelations.studio',  // CRITICAL: Leading dot = all subdomains
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax'  // 'lax' required for cross-subdomain navigation
}
```

**Why this is NOT a security flaw:**
- ✅ HttpOnly - JavaScript cannot access the cookie
- ✅ Secure - Only sent over HTTPS
- ✅ Same parent domain - All subdomains share same security boundary
- ✅ SameSite=Lax - Prevents CSRF from external sites, allows navigation

**Required Auth Worker Change:**
BetterAuth defaults to `SameSite=Strict`. For cross-subdomain to work:
1. Change to `SameSite=Lax` in BetterAuth config
2. Set `domain: '.revelations.studio'` explicitly

```typescript
// In SvelteKit, just READ the cookie:
const sessionCookie = event.cookies.get('codex-session');
```

#### Custom Domain Strategy (Future)

Custom domains like `learn.yogastudio.com` **cannot share cookies** with `.revelations.studio` (different domain = different security boundary).

**Recommended: Token-Based Redirect Flow**

```
1. User visits learn.yogastudio.com (no session)
2. Redirect to auth.revelations.studio/authorize?redirect=learn.yogastudio.com
3. User authenticates (or already has session)
4. Auth Worker generates one-time token, redirects back:
   → learn.yogastudio.com/auth/callback?token=abc123
5. SvelteKit callback handler:
   a. Validates token with Auth Worker
   b. Creates LOCAL session cookie for learn.yogastudio.com
   c. Redirects to original page
```

**Implementation Requirements:**
- Auth Worker: Add `/authorize` and `/token/validate` endpoints
- Database: Store custom domain → organization mappings
- SvelteKit: Add `/auth/callback` route for token exchange

**Alternative: Reverse Proxy (Simpler)**
- Custom domain proxies to `{org-slug}.revelations.studio`
- Cookie stays on `.revelations.studio` domain
- Requires Cloudflare or nginx proxy config per custom domain

---

## 5. Route Structure

### Top-Level Organization

```
src/routes/
├── (public)/                    # codex.com marketing
├── (auth)/                      # Login, register (all domains)
├── org/
│   └── [slug]/                  # Organization-scoped routes
│       ├── (storefront)/        # Public org pages
│       ├── (app)/               # Authenticated user
│       ├── (creator)/           # Creator studio
│       └── (admin)/             # Org admin
└── api/                         # Internal API endpoints
```

### Route Group Details

#### `(public)` - Platform Marketing
- **Domain**: `codex.com`
- **Auth**: None required
- **Layout**: Marketing header/footer

| Route | Description |
|-------|-------------|
| `/` | Platform landing page |
| `/pricing` | Pricing tiers |
| `/about` | About Codex |

#### `(auth)` - Authentication
- **Domain**: All domains
- **Auth**: Redirect to library if logged in

| Route | Description |
|-------|-------------|
| `/login` | Sign in |
| `/register` | Sign up |
| `/forgot-password` | Password reset request |
| `/reset-password` | Set new password |

#### `org/[slug]/(storefront)` - Organization Public
- **Domain**: `{slug}.codex.com`
- **Auth**: None required (guest or logged in)
- **Layout**: Org-branded header/footer

| Route | Description |
|-------|-------------|
| `/` | Org home / featured content |
| `/explore` | Browse org content |
| `/c/[contentSlug]` | Content detail page |
| `/checkout/success` | Purchase confirmation |

#### `org/[slug]/(app)` - User Portal
- **Domain**: `{slug}.codex.com`
- **Auth**: Authenticated user

| Route | Description |
|-------|-------------|
| `/library` | Purchased content library |
| `/watch/[contentId]` | Video player |
| `/settings` | User profile |

#### `org/[slug]/(creator)` - Creator Studio
- **Domain**: `{slug}.codex.com`
- **Auth**: Creator, Admin, or Owner role

| Route | Description |
|-------|-------------|
| `/studio` | Creator dashboard |
| `/studio/media` | Media library |
| `/studio/content` | Content management |
| `/studio/content/new` | Create content |
| `/studio/content/[id]` | Edit content |
| `/studio/analytics` | Performance metrics |

#### `org/[slug]/(admin)` - Admin Dashboard
- **Domain**: `{slug}.codex.com`
- **Auth**: Admin or Owner role

| Route | Description |
|-------|-------------|
| `/admin` | Admin overview |
| `/admin/customers` | Customer list |
| `/admin/customers/[id]` | Customer detail |
| `/admin/team` | Team management |
| `/admin/settings` | Org settings (branding, etc.) |

---

## 6. Data Fetching Strategy

### Pattern Matrix

| Scenario | Pattern | Example |
|----------|---------|---------|
| Initial page data | Server `load` | Library list on page load |
| SEO-critical content | Server `load` + SSR | Content detail page |
| Reactive client-side | `$effect` + fetch | Search, filters |
| Shared state | `.svelte.ts` + `$state` | Cart, user preferences |
| Mutations | Form actions | Create content, update settings |
| Page data access | `$app/state` (`page.data`) | User from layout |

### Server Load Pattern

```typescript
// +page.server.ts
import { api } from '$lib/server/api';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, cookies }) => {
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  // Get session cookie to forward to workers
  const sessionCookie = cookies.get('codex-session');

  // Call Content-API Worker for user's library
  // Endpoint: GET /api/access/streaming-url/:contentId or similar
  const { data: library } = await api('content', '/api/user/library', {
    sessionCookie
  });

  return { library };
};
```

### Client Reactivity Pattern

```svelte
<script lang="ts">
  import { page } from '$app/state';

  // Server data (reactive to navigation)
  let library = $derived(page.data.library);

  // Client-side filtering
  let filter = $state('');
  let filtered = $derived(
    library.filter(item => item.title.includes(filter))
  );
</script>
```

### Shared State Pattern

```typescript
// $lib/state/search.svelte.ts
export const searchState = $state({
  query: '',
  results: [],
  loading: false
});

export async function search(query: string) {
  searchState.loading = true;
  searchState.query = query;
  const res = await fetch(`/api/search?q=${query}`);
  searchState.results = await res.json();
  searchState.loading = false;
}
```

### API Helper

```typescript
// $lib/server/api.ts
import {
  AUTH_WORKER_URL,
  CONTENT_API_URL,
  IDENTITY_API_URL,
  ECOM_API_URL
} from '$env/static/private';

// ACTUAL Codex Workers (no 'access-api' - access is part of content-api)
const WORKERS = {
  auth: AUTH_WORKER_URL,        // e.g., http://localhost:42069 or https://auth.revelations.studio
  content: CONTENT_API_URL,     // e.g., http://localhost:4001 or https://content-api.revelations.studio
  identity: IDENTITY_API_URL,   // e.g., http://localhost:42071 or https://identity-api.revelations.studio
  ecom: ECOM_API_URL           // e.g., http://localhost:42072 or https://ecom-api.revelations.studio
};

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
      // Auth uses cookies, not Bearer tokens
      ...(sessionCookie && { Cookie: `codex-session=${sessionCookie}` }),
      ...fetchOptions.headers
    }
  });

  if (!res.ok) {
    throw new APIError(res.status, await res.json());
  }

  return res.json();
}

// Example usage:
// const { data: library } = await api('content', '/api/access/streaming-url/123', { sessionCookie });
// const { user } = await api('auth', '/api/auth/session', { sessionCookie });
// const { data: org } = await api('identity', '/api/organizations/slug/my-org');
```

---

## 7. Authorization & Access Control

### Role Hierarchy

**IMPORTANT**: These are the ACTUAL roles from the Codex database schema.

**User Table Role** (global user type):
```
customer (default) - Regular platform user, can purchase content
```

**Organization Membership Roles** (per-org, from organizationMemberships table):
```
owner
├── Full org access
├── Manage team members
└── Billing, settings

admin
├── Content management
├── Customer support
└── Analytics

creator
├── Own content only
├── Media library
└── Own analytics

subscriber
└── Subscription-based access to org content

member (default)
├── View org dashboard
└── Limited actions
```

**Access Model**:
- Users have a global `role` (defaults to 'customer')
- Users can be members of multiple orgs with different roles per org
- Content access: free, purchased, members_only, or org membership
- No "guest" role - unauthenticated users are simply not logged in

### Guard Functions

```typescript
// $lib/server/guards.ts
export function requireAuth(event: RequestEvent) {
  if (!event.locals.userId) {
    throw redirect(303, `/login?redirect=${event.url.pathname}`);
  }
  return { userId: event.locals.userId };
}

export function requireOrgRole(event: RequestEvent, roles: string[]) {
  const { userId } = requireAuth(event);

  if (!event.locals.organization) {
    throw error(404, 'Organization not found');
  }

  if (!roles.includes(event.locals.organizationRole || '')) {
    throw redirect(303, '/unauthorized');
  }

  return {
    userId,
    organizationId: event.locals.organization.id,
    role: event.locals.organizationRole
  };
}

// Convenience shortcuts
export const require = {
  auth: requireAuth,
  owner: (e) => requireOrgRole(e, ['owner']),
  admin: (e) => requireOrgRole(e, ['owner', 'admin']),
  creator: (e) => requireOrgRole(e, ['owner', 'admin', 'creator']),
  member: (e) => requireOrgRole(e, ['owner', 'admin', 'creator', 'member'])
};
```

### hooks.server.ts Structure

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import { AUTH_WORKER_URL, IDENTITY_API_URL } from '$env/static/private';

// 1. Security headers
const securityHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};

// 2. Session resolution - calls Auth Worker
const authHandle: Handle = async ({ event, resolve }) => {
  // IMPORTANT: Cookie name is 'codex-session' (set by BetterAuth)
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      // Call Auth Worker to validate session
      // Auth Worker: GET /api/auth/session (port 42069)
      const response = await fetch(`${AUTH_WORKER_URL}/api/auth/session`, {
        headers: {
          Cookie: `codex-session=${sessionCookie}`
        }
      });

      if (response.ok) {
        const { user, session } = await response.json();
        event.locals.userId = user.id;
        event.locals.user = user;
        event.locals.userRole = user.role; // 'customer' by default
        event.locals.session = session;
      }
    } catch (error) {
      // Session invalid or Auth Worker unavailable
      console.error('Session validation failed:', error);
    }
  }
  return resolve(event);
};

// 3. Organization resolution (from subdomain)
const orgHandle: Handle = async ({ event, resolve }) => {
  const subdomain = extractSubdomain(event.url.hostname);

  if (subdomain && !IGNORED_SUBDOMAINS.includes(subdomain)) {
    try {
      // Call Identity-API Worker to get org by slug
      // Identity-API: GET /api/organizations/slug/:slug (port 42071)
      const response = await fetch(
        `${IDENTITY_API_URL}/api/organizations/slug/${subdomain}`
      );

      if (response.ok) {
        const { data: org } = await response.json();
        event.locals.organization = org;

        // Check membership if logged in
        // Query organizationMemberships table via Identity-API
        if (event.locals.userId) {
          // TODO: Add membership endpoint to Identity-API
          // For now, membership check happens in load functions
        }
      }
    } catch (error) {
      console.error('Org resolution failed:', error);
    }
  }

  return resolve(event);
};

export const handle = sequence(securityHandle, authHandle, orgHandle);
```

---

## 8. Component Architecture

### Component Categories

| Category | Location | Purpose |
|----------|----------|---------|
| **Atomic** | `$lib/components/ui/` | Button, Input, Badge, etc. |
| **Layout** | `$lib/components/layout/` | Header, Sidebar, Footer |
| **Feature** | `$lib/components/[feature]/` | LibraryGrid, VideoPlayer |
| **Form** | `$lib/components/forms/` | LoginForm, ContentEditor |

### Key Components (Phase 1)

**Atomic (via Shadcn-Svelte)**:
- Button, Input, Select, Checkbox, Switch
- Card, Badge, Avatar, Skeleton
- Dialog, Sheet, Toast, Tooltip
- Table, DropdownMenu

**Layout**:
- `PublicHeader` / `PublicFooter`
- `AppSidebar` / `UserMenu`
- `OrgSwitcher` (multi-org users)
- `PageHeader` (title + breadcrumbs + actions)

**Feature**:
- `ContentGrid` / `ProductCard`
- `LibraryGrid` / `LibraryCard`
- `HLSPlayer` / `PlayerControls`
- `UploadZone` / `MediaList`
- `ContentForm` / `MediaPicker`

**Forms**:
- `LoginForm` / `RegisterForm`
- `ForgotPasswordForm` / `ResetPasswordForm`
- `ProfileForm` / `SettingsForm`

### Organization Branding

Components receive org branding via layout data:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  let org = $derived(page.data.organization);
</script>

<header style="--brand-primary: {org?.primaryColorHex || '#3b82f6'}">
  <img src={org?.logoUrl} alt={org?.name} />
</header>

<style>
  header {
    background: var(--brand-primary);
  }
</style>
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Current)

**Goal**: Working authenticated app with org-scoped routes

- [ ] Scaffold `apps/web` with SvelteKit 2 + Svelte 5
- [ ] Configure `@sveltejs/adapter-cloudflare`
- [ ] Implement `hooks.server.ts` (auth + org resolution)
- [ ] Create route structure per spec
- [ ] Implement layout guards
- [ ] Set up Shadcn-Svelte components
- [ ] Create `api` helper for Worker communication
- [ ] Implement login/register forms
- [ ] Build basic library page (fetch from content-api)

### Phase 2: Core Features

**Goal**: Full consumer experience

- [ ] Content detail pages with purchase flow
- [ ] Video player with HLS streaming
- [ ] Progress tracking
- [ ] User settings/profile
- [ ] Creator studio (media, content CRUD)
- [ ] Admin dashboard (customers, revenue)

### Phase 3: Polish & Scale

**Goal**: Production-ready, optimized

- [ ] DNS-on-demand for org creation
- [ ] Organization branding system
- [ ] Search with filters
- [ ] Analytics integration
- [ ] Performance optimization
- [ ] Error boundaries
- [ ] Offline handling

### Phase 4: Advanced Features

**Goal**: Competitive feature set

- [ ] Evaluate Remote Functions (if stable)
- [ ] Multi-organization user switching
- [ ] Custom domain support (Cloudflare for SaaS)
- [ ] Team invitations
- [ ] Advanced analytics

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [ROUTES.md](./ROUTES.md) | Detailed route specifications |
| [COMPONENTS.md](./COMPONENTS.md) | Component catalog |
| [DATA_FETCHING.md](./DATA_FETCHING.md) | Original data fetching design |
| [SVELTE5_DATA_PATTERNS.md](./SVELTE5_DATA_PATTERNS.md) | Modern Svelte 5 patterns |
| [REMOTE_FUNCTIONS_AND_AUTH.md](./REMOTE_FUNCTIONS_AND_AUTH.md) | RPC + authorization research |
| [SUBDOMAIN_ROUTING.md](./SUBDOMAIN_ROUTING.md) | Multi-tenant routing details |
| [PHASE_1_AUTH_DESIGN.md](../features/auth/PHASE_1_AUTH_DESIGN.md) | Auth schema and flows |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-09 | Initial architecture document created |
