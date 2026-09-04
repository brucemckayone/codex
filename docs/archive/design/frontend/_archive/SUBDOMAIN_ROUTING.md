# SvelteKit Multi-Tenant Subdomain Routing

**Status**: Research
**Last Updated**: 2026-01-09

This document covers subdomain-based multi-tenant routing for the Codex platform, integrating with the existing organization scoping architecture defined in `PHASE_1_AUTH_DESIGN.md`.

---

## Overview

Codex uses **subdomain-based organization scoping**:
- `yoga-studio.codex.com` → Yoga Studio organization
- `cooking-school.codex.com` → Cooking School organization
- `codex.com` or `www.codex.com` → Platform home / public storefront

Each organization gets its own "mini-platform" with branded storefront, while sharing the same underlying SvelteKit application.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Request                               │
│                yoga-studio.codex.com/library                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloudflare (DNS + Proxy)                           │
│  *.codex.com → Cloudflare Pages (or Worker proxy)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SvelteKit                                    │
│                                                                  │
│  1. hooks.ts (reroute) → Extract subdomain                      │
│  2. hooks.server.ts (handle) → Validate org, set event.locals   │
│  3. Route to appropriate page/layout                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Subdomain Extraction Function

```typescript
// $lib/server/subdomain.ts

const MAIN_DOMAIN = 'codex.com';
const IGNORED_SUBDOMAINS = ['www', 'api', 'auth', 'admin-api', 'staging'];

export interface SubdomainInfo {
  subdomain: string | null;
  isMainDomain: boolean;
  isApiDomain: boolean;
}

export function extractSubdomain(hostname: string): SubdomainInfo {
  // Handle localhost for development
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    // localhost:5173 → main domain
    // yoga-studio.localhost:5173 → subdomain (requires /etc/hosts config)
    const parts = hostname.split('.');
    if (parts.length === 1 || (parts.length === 2 && parts[1].includes('localhost'))) {
      return { subdomain: null, isMainDomain: true, isApiDomain: false };
    }
    const subdomain = parts[0];
    return {
      subdomain: IGNORED_SUBDOMAINS.includes(subdomain) ? null : subdomain,
      isMainDomain: IGNORED_SUBDOMAINS.includes(subdomain) || subdomain === 'www',
      isApiDomain: subdomain === 'api' || subdomain === 'auth'
    };
  }

  // Production: yoga-studio.codex.com
  const parts = hostname.replace(MAIN_DOMAIN, '').split('.').filter(Boolean);

  if (parts.length === 0) {
    // codex.com (no subdomain)
    return { subdomain: null, isMainDomain: true, isApiDomain: false };
  }

  const subdomain = parts[0];

  return {
    subdomain: IGNORED_SUBDOMAINS.includes(subdomain) ? null : subdomain,
    isMainDomain: IGNORED_SUBDOMAINS.includes(subdomain) || subdomain === 'www',
    isApiDomain: subdomain === 'api' || subdomain === 'auth'
  };
}
```

---

### 2. The `reroute` Hook (URL Translation)

The `reroute` hook runs universally (server + client) and can dynamically redirect requests based on subdomain.

```typescript
// src/hooks.ts

import type { Reroute } from '@sveltejs/kit';
import { extractSubdomain } from '$lib/server/subdomain';

export const reroute: Reroute = ({ url }) => {
  const { subdomain, isMainDomain, isApiDomain } = extractSubdomain(url.hostname);

  // API subdomains are handled by Workers, not SvelteKit
  if (isApiDomain) {
    return url.pathname;
  }

  // Main domain: no rewriting needed
  if (isMainDomain || !subdomain) {
    return url.pathname;
  }

  // Organization subdomain: prefix with org slug for routing
  // yoga-studio.codex.com/library → /org/yoga-studio/library
  return `/org/${subdomain}${url.pathname}`;
};
```

**Route Structure**:
```
src/routes/
├── (public)/                    # Main domain public pages
│   ├── +page.svelte             # codex.com home
│   └── explore/+page.svelte     # codex.com/explore
├── org/
│   └── [slug]/                  # Organization-scoped routes
│       ├── +layout.server.ts    # Validate org, set context
│       ├── +page.svelte         # yoga-studio.codex.com home
│       ├── (storefront)/        # Public org pages
│       │   ├── +layout.svelte
│       │   ├── explore/+page.svelte
│       │   └── c/[contentSlug]/+page.svelte
│       ├── (app)/               # Authenticated user pages
│       │   ├── +layout.server.ts
│       │   ├── library/+page.svelte
│       │   └── watch/[contentId]/+page.svelte
│       ├── (creator)/           # Creator studio
│       │   └── studio/...
│       └── (admin)/             # Org admin dashboard
│           └── admin/...
└── (auth)/                      # Auth routes (all domains)
    ├── login/+page.svelte
    └── register/+page.svelte
```

---

### 3. The `handle` Hook (Organization Resolution)

```typescript
// src/hooks.server.ts

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { extractSubdomain } from '$lib/server/subdomain';
import { redirect, error } from '@sveltejs/kit';

// 1. Security Headers
const securityHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};

// 2. Auth Context
const authHandle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('auth-token');

  if (token) {
    const session = await validateSession(token, event.platform?.env);
    if (session) {
      event.locals.userId = session.userId;
      event.locals.userRole = session.role;
      event.locals.activeOrganizationId = session.activeOrganizationId;
      event.locals.session = session;
    }
  }

  return resolve(event);
};

// 3. Organization Resolution (from subdomain)
const organizationHandle: Handle = async ({ event, resolve }) => {
  const { subdomain, isMainDomain, isApiDomain } = extractSubdomain(event.url.hostname);

  // Store for reference
  event.locals.subdomain = subdomain;
  event.locals.isMainDomain = isMainDomain;

  if (!subdomain || isMainDomain || isApiDomain) {
    // No org-scoped request
    return resolve(event);
  }

  // Look up organization by slug
  const org = await event.platform?.env?.DB?.prepare(
    'SELECT id, slug, name, logoUrl, primaryColorHex, isPublic FROM organization WHERE slug = ?'
  ).bind(subdomain).first();

  if (!org) {
    // Unknown subdomain
    throw error(404, `Organization "${subdomain}" not found`);
  }

  // Store organization in locals
  event.locals.organization = {
    id: org.id,
    slug: org.slug,
    name: org.name,
    logoUrl: org.logoUrl,
    primaryColorHex: org.primaryColorHex,
    isPublic: org.isPublic
  };

  // If user is logged in, check their membership
  if (event.locals.userId) {
    const membership = await event.platform?.env?.DB?.prepare(
      'SELECT role FROM organization_member WHERE organizationId = ? AND userId = ?'
    ).bind(org.id, event.locals.userId).first();

    if (membership) {
      event.locals.organizationRole = membership.role;
      event.locals.isMember = true;
    } else {
      event.locals.organizationRole = null;
      event.locals.isMember = false;
    }
  }

  return resolve(event);
};

export const handle = sequence(securityHandle, authHandle, organizationHandle);
```

---

### 4. Organization Layout Guard

```typescript
// src/routes/org/[slug]/+layout.server.ts

import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
  // Verify organization was resolved by hook
  if (!locals.organization) {
    throw error(404, `Organization "${params.slug}" not found`);
  }

  // Double-check slug matches (paranoia check)
  if (locals.organization.slug !== params.slug) {
    throw error(400, 'Organization mismatch');
  }

  return {
    organization: locals.organization,
    user: locals.userId ? {
      id: locals.userId,
      role: locals.userRole,
      organizationRole: locals.organizationRole,
      isMember: locals.isMember
    } : null
  };
};
```

---

### 5. TypeScript Definitions

```typescript
// src/app.d.ts

declare global {
  namespace App {
    interface Locals {
      // Auth
      userId?: string;
      userRole?: string;
      activeOrganizationId?: string;
      session?: unknown;

      // Organization (from subdomain)
      subdomain?: string | null;
      isMainDomain?: boolean;
      organization?: {
        id: string;
        slug: string;
        name: string;
        logoUrl?: string;
        primaryColorHex?: string;
        isPublic: boolean;
      };
      organizationRole?: string | null;
      isMember?: boolean;
    }

    interface PageData {
      organization?: Locals['organization'];
      user?: {
        id: string;
        role: string;
        organizationRole?: string | null;
        isMember?: boolean;
      };
    }
  }
}

export {};
```

---

## Cloudflare Configuration

### Option 1: Wildcard DNS + Cloudflare Pages

Cloudflare Pages **does not natively support wildcard custom domains**. However, you can work around this:

**Steps**:
1. Deploy SvelteKit to Cloudflare Pages (`your-app.pages.dev`)
2. Add custom domains manually:
   - `codex.com`
   - `www.codex.com`
   - And each organization subdomain as needed

**Limitation**: Must manually add each subdomain (not scalable for 100+ orgs)

---

### Option 2: Cloudflare Worker Proxy (Recommended)

Use a Worker as a reverse proxy to handle wildcards:

```typescript
// workers/subdomain-proxy/src/index.ts

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Check if this is a wildcard subdomain
    if (hostname.endsWith('.codex.com') && !hostname.startsWith('api.')) {
      // Rewrite to Pages origin
      const pagesUrl = new URL(request.url);
      pagesUrl.hostname = 'codex-web.pages.dev'; // Your Pages deployment

      // Forward the request with original Host header preserved
      const newRequest = new Request(pagesUrl.toString(), {
        method: request.method,
        headers: new Headers({
          ...Object.fromEntries(request.headers),
          'X-Original-Host': hostname // Preserve original hostname
        }),
        body: request.body
      });

      return fetch(newRequest);
    }

    // For other routes, pass through
    return fetch(request);
  }
};
```

**Wrangler Config**:
```toml
# workers/subdomain-proxy/wrangler.toml
name = "subdomain-proxy"
main = "src/index.ts"

[[routes]]
pattern = "*.codex.com/*"
zone_name = "codex.com"
```

**In SvelteKit**, read the original host:
```typescript
// hooks.server.ts - Updated
const organizationHandle: Handle = async ({ event, resolve }) => {
  // Prefer X-Original-Host if proxied, fallback to actual hostname
  const hostname = event.request.headers.get('X-Original-Host') || event.url.hostname;
  const { subdomain } = extractSubdomain(hostname);
  // ... rest of logic
};
```

---

### Option 3: Cloudflare for SaaS (Custom Domains)

For orgs that want their **own custom domain** (e.g., `courses.yoga-studio.com`):

**Setup**:
1. Enable Cloudflare for SaaS on your zone
2. Configure fallback origin to your Pages deployment
3. Orgs add CNAME record: `courses.yoga-studio.com → ssl.codex.com`
4. Cloudflare issues SSL automatically

**Worker handles custom domains**:
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = new URL(request.url).hostname;

    // Check if custom domain
    const orgByDomain = await env.DB.prepare(
      'SELECT slug FROM organization WHERE customDomain = ?'
    ).bind(hostname).first();

    if (orgByDomain) {
      // Treat as org subdomain
      const newRequest = new Request(request, {
        headers: new Headers({
          ...Object.fromEntries(request.headers),
          'X-Organization-Slug': orgByDomain.slug
        })
      });
      return fetch(newRequest);
    }

    // Normal routing
    return fetch(request);
  }
};
```

---

## URL Patterns

### Main Domain (`codex.com`)
| URL | Description |
|-----|-------------|
| `codex.com/` | Platform home |
| `codex.com/explore` | Browse all organizations |
| `codex.com/login` | Global login |
| `codex.com/register` | Global registration |

### Organization Subdomain (`yoga-studio.codex.com`)
| URL | Routed To | Description |
|-----|-----------|-------------|
| `/` | `/org/yoga-studio` | Org storefront home |
| `/explore` | `/org/yoga-studio/explore` | Browse org content |
| `/c/morning-yoga` | `/org/yoga-studio/c/morning-yoga` | Content detail |
| `/library` | `/org/yoga-studio/library` | User's purchased content |
| `/studio` | `/org/yoga-studio/studio` | Creator dashboard |
| `/admin` | `/org/yoga-studio/admin` | Org admin dashboard |

### Auth (All Domains)
| URL | Description |
|-----|-------------|
| `/login` | Login (preserves redirect) |
| `/register` | Registration |
| `/logout` | Clear session |

---

## Component Access to Organization

```svelte
<!-- Any page under /org/[slug] -->
<script lang="ts">
  import { page } from '$app/state';

  // From layout data
  let org = $derived(page.data.organization);
  let user = $derived(page.data.user);
  let isOwner = $derived(user?.organizationRole === 'owner');
  let isAdmin = $derived(['owner', 'admin'].includes(user?.organizationRole || ''));
</script>

<header style="--brand-color: {org?.primaryColorHex || '#000'}">
  <img src={org?.logoUrl} alt={org?.name} />
  <h1>{org?.name}</h1>
</header>

{#if isAdmin}
  <a href="/admin">Admin Dashboard</a>
{/if}
```

---

## Organization Switcher (Multi-Org Users)

For users who are members of multiple organizations:

```typescript
// src/routes/org/[slug]/switch/+page.server.ts

import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  switch: async ({ request, cookies, platform, locals }) => {
    const data = await request.formData();
    const newOrgId = data.get('organizationId') as string;

    // Verify user has access
    const membership = await platform.env.DB.prepare(
      'SELECT * FROM organization_member WHERE organizationId = ? AND userId = ?'
    ).bind(newOrgId, locals.userId).first();

    if (!membership) {
      throw error(403, 'Not a member of that organization');
    }

    // Get org slug for redirect
    const org = await platform.env.DB.prepare(
      'SELECT slug FROM organization WHERE id = ?'
    ).bind(newOrgId).first();

    // Update session's activeOrganizationId
    await platform.env.DB.prepare(
      'UPDATE session SET activeOrganizationId = ? WHERE userId = ? AND token = ?'
    ).bind(newOrgId, locals.userId, cookies.get('auth-token')).run();

    // Redirect to new org's subdomain
    throw redirect(303, `https://${org.slug}.codex.com/library`);
  }
};
```

---

## Development Setup

### Local Subdomain Testing

**Option 1: /etc/hosts**
```bash
# /etc/hosts
127.0.0.1 localhost
127.0.0.1 yoga-studio.localhost
127.0.0.1 cooking-school.localhost
```

Then access: `http://yoga-studio.localhost:5173/`

**Option 2: Query Parameter Fallback (Dev Only)**
```typescript
// hooks.server.ts (dev only)
const organizationHandle: Handle = async ({ event, resolve }) => {
  let subdomain: string | null = null;

  if (import.meta.env.DEV) {
    // Allow ?org=yoga-studio for local testing
    const queryOrg = event.url.searchParams.get('org');
    if (queryOrg) {
      subdomain = queryOrg;
    }
  }

  if (!subdomain) {
    const info = extractSubdomain(event.url.hostname);
    subdomain = info.subdomain;
  }

  // ... rest of logic
};
```

Access: `http://localhost:5173/library?org=yoga-studio`

---

## Security Considerations

### 1. Subdomain Validation
```typescript
// Always validate subdomain against database
const org = await db.query('SELECT * FROM organization WHERE slug = ?', [subdomain]);
if (!org) throw error(404);
```

### 2. Cross-Organization Data Isolation
```typescript
// All queries MUST include organizationId
const content = await db.query(
  'SELECT * FROM content WHERE organizationId = ? AND id = ?',
  [locals.organization.id, contentId]
);
```

### 3. Cookie Domain
```typescript
// Set cookies for parent domain (accessible by all subdomains)
cookies.set('auth-token', token, {
  domain: '.codex.com', // Note the leading dot
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' // Allows navigation from external links
});
```

### 4. CSRF Protection
```typescript
// Validate Origin header matches expected subdomain
const origin = event.request.headers.get('origin');
const expected = `https://${locals.organization.slug}.codex.com`;
if (origin !== expected) {
  throw error(403, 'Invalid origin');
}
```

---

## Migration Path

### Phase 1 (Current): Single Organization
- No subdomain routing needed
- All requests go to main domain
- Organization is implicitly "the" organization

### Phase 2: Subdomain per Organization
- Enable subdomain extraction in hooks
- Deploy Worker proxy for wildcards
- Add organization layout guards
- Cookie domain set to `.codex.com`

### Phase 3: Custom Domains
- Enable Cloudflare for SaaS
- Add `customDomain` column to organization table
- Update Worker to resolve custom domains
- Auto-provision SSL

---

## Integration with Auth Design

From `PHASE_1_AUTH_DESIGN.md`, the subdomain handle is already defined:

```typescript
// Already in your design!
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

This document extends that foundation with:
- Route rewriting via `reroute` hook
- Cloudflare Worker proxy for wildcards
- Layout guards for org routes
- Development setup for local testing

---

## References

- [SvelteKit Hooks](https://kit.svelte.dev/docs/hooks)
- [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)
- [Cloudflare Pages Custom Domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [PHASE_1_AUTH_DESIGN.md](../features/auth/PHASE_1_AUTH_DESIGN.md)
