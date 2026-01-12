# P1-FE-FOUNDATION-001: Project Setup

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 3-5 days
**Beads Task**: Codex-vw8.1

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Project Structure](#project-structure)
- [Configuration Files](#configuration-files)
- [Hooks Implementation](#hooks-implementation)
- [Internationalization Setup](#internationalization-setup)
- [Remote Functions Setup](#remote-functions-setup)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet establishes the foundational SvelteKit project configured for Cloudflare Workers deployment. It sets up the routing infrastructure for multi-tenant subdomain handling (platform, organization spaces, creator profiles), session management via the Auth Worker, and the internationalization scaffold using Paraglide JS.

The project setup is the critical first step that all other frontend work packets depend on. It establishes patterns for:
- Accessing backend workers via `platform.env` bindings
- Subdomain-based routing using SvelteKit's `reroute` hook
- Session validation in `hooks.server.ts`
- i18n-ready architecture from Day 1 (English-only launch, but structured for future languages)
- Experimental Remote Functions for type-safe client-server communication

This work packet produces a running SvelteKit application with proper Cloudflare configuration, but with minimal UI—only structural layouts and placeholder pages.

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Auth Worker** (port 42069) | Session validation via `GET /api/auth/get-session` |
| **Organization-API** (port 42071) | Org existence check for subdomain routing |
| **DNS/Cloudflare** | Wildcard subdomain routing `*.revelations.studio` |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **All FE work packets** | Project scaffold, hooks, layouts, routing structure |
| **P1-FE-FOUNDATION-002** | Design system integrates into this project |

### Integration Flow

```
Browser Request
    ↓
Cloudflare Edge (wildcard DNS)
    ↓
SvelteKit Worker
    ├── hooks.ts (reroute) → Subdomain → Internal route group
    └── hooks.server.ts → Session validation → event.locals.user
    ↓
Route Group Layout
    ├── (platform)/ → revelations.studio/*
    ├── (auth)/ → */login, */register
    ├── (org)/[slug]/ → {org}.revelations.studio/*
    └── (creators)/ → creators.revelations.studio/*
```

---

## Project Structure

```
apps/web/
├── svelte.config.js          # SvelteKit + Cloudflare adapter
├── vite.config.js            # Vite + Paraglide plugin
├── wrangler.toml             # Cloudflare Workers config
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies
│
├── project.inlang/           # Paraglide JS i18n config
│   └── settings.json
│
├── messages/                 # Translation files
│   └── en.json               # English (source of truth)
│
├── src/
│   ├── app.d.ts              # Type declarations for locals, platform
│   ├── app.html              # HTML template
│   ├── app.css               # Global styles (minimal, tokens in FOUNDATION-002)
│   ├── hooks.ts              # Client hooks (reroute for subdomain)
│   ├── hooks.server.ts       # Server hooks (session validation)
│   │
│   ├── lib/
│   │   ├── paraglide/        # Generated Paraglide output (gitignored)
│   │   ├── i18n.ts           # i18n adapter setup
│   │   ├── server/
│   │   │   └── api.ts        # Server-side API client factory
│   │   └── utils/
│   │       └── subdomain.ts  # Subdomain parsing utilities
│   │
│   └── routes/
│       ├── +layout.svelte    # Root layout (meta, i18n provider)
│       ├── +layout.server.ts # Root load (user context)
│       ├── +error.svelte     # Global error page
│       │
│       ├── (platform)/       # Platform routes (revelations.studio)
│       │   ├── +layout.svelte
│       │   └── +page.svelte  # Landing page placeholder
│       │
│       ├── (auth)/           # Auth routes (any domain)
│       │   ├── +layout.svelte
│       │   ├── login/
│       │   ├── register/
│       │   └── forgot-password/
│       │
│       ├── (org)/            # Organization routes ({slug}.revelations.studio)
│       │   └── [slug]/
│       │       ├── +layout.svelte
│       │       ├── +layout.server.ts  # Org resolution
│       │       ├── (space)/           # Public org pages
│       │       └── studio/            # Creator/admin pages
│       │
│       └── (creators)/       # Creator routes (creators.revelations.studio)
│           ├── [username]/   # Public profiles
│           └── studio/       # Personal studio
```

---

## Configuration Files

### svelte.config.js

```javascript
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // Cloudflare Workers adapter options
      routes: {
        include: ['/*'],
        exclude: ['<all>']
      }
    }),

    // Experimental features
    experimental: {
      // Enable Remote Functions for type-safe client-server communication
      remoteFunctions: true
    },

    // Alias configuration
    alias: {
      $lib: './src/lib',
      $paraglide: './src/lib/paraglide'
    }
  },

  // Svelte 5 compiler options
  compilerOptions: {
    // Enable async/await in templates (required for Remote Functions)
    experimental: {
      async: true
    }
  }
};

export default config;
```

### vite.config.js

```javascript
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      // CRITICAL: Required for Cloudflare Workers (no AsyncLocalStorage)
      disableAsyncLocalStorage: true
    }),
    sveltekit()
  ]
});
```

### wrangler.toml

```toml
name = "codex-web"
main = ".svelte-kit/cloudflare/_worker.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# Worker Routes (supports wildcards)
[[routes]]
pattern = "*.revelations.studio/*"
zone_name = "revelations.studio"

[[routes]]
pattern = "revelations.studio/*"
zone_name = "revelations.studio"

# Environment bindings
[vars]
ENVIRONMENT = "production"

# Production URLs
[env.production.vars]
AUTH_WORKER_URL = "https://auth.revelations.studio"
API_URL = "https://api.revelations.studio"
ORG_API_URL = "https://organization-api.revelations.studio"
ECOM_API_URL = "https://ecom-api.revelations.studio"

# Staging URLs
[env.staging.vars]
AUTH_WORKER_URL = "https://auth-staging.revelations.studio"
API_URL = "https://api-staging.revelations.studio"
ORG_API_URL = "https://organization-api-staging.revelations.studio"
ECOM_API_URL = "https://ecom-api-staging.revelations.studio"

# Assets configuration (SvelteKit static assets)
[assets]
directory = ".svelte-kit/cloudflare"
```

### project.inlang/settings.json

```json
{
  "$schema": "https://inlang.com/schema/project-settings",
  "sourceLanguageTag": "en",
  "languageTags": ["en"],
  "modules": [
    "https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-empty-pattern@latest/dist/index.js",
    "https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-missing-translation@latest/dist/index.js",
    "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js"
  ],
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{languageTag}.json"
  }
}
```

### messages/en.json

```json
{
  "common_loading": "Loading...",
  "common_error": "Something went wrong",
  "common_retry": "Try again",
  "common_cancel": "Cancel",
  "common_save": "Save",
  "common_delete": "Delete",
  "common_edit": "Edit",
  "common_back": "Back",
  "common_next": "Next",
  "common_submit": "Submit",

  "nav_home": "Home",
  "nav_library": "Library",
  "nav_account": "Account",
  "nav_login": "Sign In",
  "nav_logout": "Sign Out",

  "error_not_found": "Page not found",
  "error_unauthorized": "Please sign in to continue",
  "error_forbidden": "You don't have access to this page"
}
```

### src/app.d.ts

```typescript
import type { UserData, SessionData } from '$lib/types';

declare global {
  namespace App {
    interface Locals {
      user: UserData | null;
      session: SessionData | null;
      userId: string | null;
      requestId: string;
    }

    interface Platform {
      env: {
        AUTH_WORKER_URL: string;
        API_URL: string;
        ORG_API_URL: string;
        ECOM_API_URL: string;
        ENVIRONMENT: string;
        // Optional bindings
        ANALYTICS?: AnalyticsEngineDataset;
      };
      context: ExecutionContext;
      caches: CacheStorage;
    }

    interface Error {
      message: string;
      code?: string;
    }

    interface PageData {
      user: UserData | null;
    }
  }
}

export {};
```

---

## Hooks Implementation

### src/hooks.ts (Reroute Hook)

```typescript
import type { Reroute } from '@sveltejs/kit';
import { i18n } from '$lib/i18n';

// Reserved subdomains that are NOT org slugs
const RESERVED_SUBDOMAINS = new Set([
  'www', 'auth', 'api', 'content-api', 'organization-api', 'ecom-api',
  'creators', 'admin', 'platform', 'identity-api',
  'staging', 'dev', 'test', 'localhost'
]);

/**
 * Reroute based on subdomain
 *
 * Examples:
 * - revelations.studio/about → /(platform)/about
 * - yoga-studio.revelations.studio/explore → /(org)/[slug]/(space)/explore
 * - creators.revelations.studio/alice → /(creators)/[username]
 */
export const reroute: Reroute = ({ url }) => {
  const hostname = url.hostname;
  const pathname = url.pathname;

  // Extract subdomain
  const subdomain = extractSubdomain(hostname);

  // No subdomain or www → platform routes
  if (!subdomain || subdomain === 'www') {
    // Auth routes are special (can be accessed from any domain)
    if (pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/forgot-password') ||
        pathname.startsWith('/reset-password') ||
        pathname.startsWith('/verify-email')) {
      return `/(auth)${pathname}`;
    }
    return `/(platform)${pathname}`;
  }

  // Creators subdomain
  if (subdomain === 'creators') {
    if (pathname.startsWith('/studio')) {
      return `/(creators)/studio${pathname.slice(7)}`;
    }
    // /{username} → /(creators)/[username]
    return `/(creators)${pathname}`;
  }

  // Reserved subdomains → don't process
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return pathname;
  }

  // Organization subdomain
  if (pathname.startsWith('/studio')) {
    return `/(org)/${subdomain}/studio${pathname.slice(7)}`;
  }
  // Public org pages
  return `/(org)/${subdomain}/(space)${pathname}`;
};

function extractSubdomain(hostname: string): string | null {
  // localhost handling
  if (hostname.includes('localhost')) {
    const parts = hostname.split('.');
    if (parts.length > 1 && parts[0] !== 'localhost') {
      return parts[0];
    }
    return null;
  }

  // Production: *.revelations.studio
  const match = hostname.match(/^([^.]+)\.revelations\.studio$/);
  return match ? match[1] : null;
}

// Combine with i18n rerouting
export { i18n };
```

### src/hooks.server.ts (Server Hook)

```typescript
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { nanoid } from 'nanoid';

/**
 * Session validation hook
 * Runs on every request, validates session with Auth Worker
 */
const sessionHook: Handle = async ({ event, resolve }) => {
  // Generate request ID for tracing
  event.locals.requestId = nanoid(10);

  // Get worker URLs from platform bindings
  const authUrl = event.platform?.env?.AUTH_WORKER_URL ?? 'http://localhost:42069';

  // Extract session cookie
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      const response = await fetch(`${authUrl}/api/auth/get-session`, {
        headers: {
          Cookie: `codex-session=${sessionCookie}`
        }
      });

      if (response.ok) {
        const { user, session } = await response.json();
        event.locals.user = user;
        event.locals.session = session;
        event.locals.userId = user?.id ?? null;
      } else {
        // Invalid session - clear locals
        event.locals.user = null;
        event.locals.session = null;
        event.locals.userId = null;
      }
    } catch (error) {
      // Auth worker unavailable - log and treat as unauthenticated
      console.error(`[${event.locals.requestId}] Session validation failed:`, error);
      event.locals.user = null;
      event.locals.session = null;
      event.locals.userId = null;
    }
  } else {
    event.locals.user = null;
    event.locals.session = null;
    event.locals.userId = null;
  }

  return resolve(event);
};

/**
 * Security headers hook
 */
const securityHook: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Add security headers
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Request-Id', event.locals.requestId);

  return response;
};

export const handle = sequence(sessionHook, securityHook);

/**
 * Global error handler
 */
export const handleError: HandleServerError = async ({ error, event }) => {
  const errorId = event.locals.requestId;

  console.error(`[${errorId}] Unhandled error:`, error);

  // Track in analytics if available
  event.platform?.env?.ANALYTICS?.writeDataPoint({
    indexes: ['errors'],
    blobs: [
      event.url.pathname,
      error instanceof Error ? error.name : 'UnknownError',
      error instanceof Error ? error.message : String(error)
    ]
  });

  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR'
  };
};
```

---

## Internationalization Setup

### src/lib/i18n.ts

```typescript
import { createI18n } from '@inlang/paraglide-js-adapter-sveltekit';
import * as runtime from '$paraglide/runtime';

export const i18n = createI18n(runtime);
```

### Usage Pattern

```svelte
<script>
  import * as m from '$paraglide/messages';
</script>

<button>{m.common_save()}</button>
<span>{m.error_not_found()}</span>
```

---

## Remote Functions Setup

Remote Functions are enabled in `svelte.config.js`. Here's the pattern for creating them:

### Example: src/routes/(platform)/library/library.remote.ts

```typescript
import { query } from '$app/server';
import * as v from 'valibot';
import { createServerApi } from '$lib/server/api';

export const getLibrary = query(
  v.object({
    page: v.optional(v.number(), 1),
    limit: v.optional(v.number(), 20)
  }),
  async ({ page, limit }, { platform }) => {
    const api = createServerApi(platform);
    return api.fetch('access', `/api/access/user/library?page=${page}&limit=${limit}`);
  }
);
```

---

## Server API Client

### src/lib/server/api.ts

```typescript
import type { App } from '../app';

const DEFAULT_URLS = {
  auth: 'http://localhost:42069',
  content: 'http://localhost:4001',
  access: 'http://localhost:4001',
  org: 'http://localhost:42071',
  ecom: 'http://localhost:42072',
} as const;

type WorkerName = keyof typeof DEFAULT_URLS;

export function createServerApi(platform: App.Platform | undefined) {
  const getUrl = (worker: WorkerName): string => {
    switch (worker) {
      case 'auth':
        return platform?.env?.AUTH_WORKER_URL ?? DEFAULT_URLS.auth;
      case 'content':
      case 'access':
        return platform?.env?.API_URL ?? DEFAULT_URLS.content;
      case 'org':
        return platform?.env?.ORG_API_URL ?? DEFAULT_URLS.org;
      case 'ecom':
        return platform?.env?.ECOM_API_URL ?? DEFAULT_URLS.ecom;
    }
  };

  return {
    async fetch<T>(
      worker: WorkerName,
      path: string,
      sessionCookie?: string,
      options?: RequestInit
    ): Promise<T> {
      const url = `${getUrl(worker)}${path}`;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options?.headers
      };

      if (sessionCookie) {
        (headers as Record<string, string>)['Cookie'] = `codex-session=${sessionCookie}`;
      }

      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new ApiError(response.status, error.message ?? 'API Error', error.code);
      }

      return response.json();
    }
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| Auth Worker | ✅ Available | Session validation endpoint `/api/auth/get-session` |
| Cloudflare Account | ✅ Available | Workers deployment, DNS |
| Wildcard DNS | ✅ Available | `*.revelations.studio` |

### Package Dependencies

```json
{
  "dependencies": {
    "@sveltejs/kit": "^2.0.0",
    "svelte": "^5.0.0",
    "@inlang/paraglide-js-adapter-sveltekit": "^1.0.0",
    "valibot": "^0.30.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/adapter-cloudflare": "^4.0.0",
    "@inlang/paraglide-js": "^1.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "wrangler": "^3.0.0"
  }
}
```

---

## Implementation Checklist

- [ ] **Project Initialization**
  - [ ] Create `apps/web` directory structure
  - [ ] Initialize SvelteKit with `npx sv create` (Svelte 5, TypeScript)
  - [ ] Install Cloudflare adapter
  - [ ] Configure svelte.config.js with experimental features

- [ ] **Configuration Files**
  - [ ] Create vite.config.js with Paraglide plugin
  - [ ] Create wrangler.toml with worker routes and bindings
  - [ ] Create project.inlang/settings.json
  - [ ] Create initial messages/en.json

- [ ] **Type Definitions**
  - [ ] Create src/app.d.ts with Locals, Platform types
  - [ ] Define UserData, SessionData types

- [ ] **Hooks**
  - [ ] Implement src/hooks.ts (reroute for subdomain)
  - [ ] Implement src/hooks.server.ts (session validation)
  - [ ] Add security headers
  - [ ] Add request ID generation

- [ ] **API Client**
  - [ ] Create src/lib/server/api.ts
  - [ ] Handle all worker URL resolution
  - [ ] Implement error handling with ApiError

- [ ] **Route Structure**
  - [ ] Create (platform) route group with placeholder layout
  - [ ] Create (auth) route group with placeholder pages
  - [ ] Create (org)/[slug] route group with layout
    - [ ] **Crucial**: Implement server-side brand token injection (fetch from Org API -> inject as CSS variables)
  - [ ] Create (creators) route group with layout

- [ ] **i18n Setup**
  - [ ] Create src/lib/i18n.ts adapter
  - [ ] Verify Paraglide compilation works
  - [ ] Add core message keys

- [ ] **Testing & Verification**
  - [ ] Run dev server locally
  - [ ] Test subdomain routing with localhost
  - [ ] Verify session validation works
  - [ ] Deploy to Cloudflare staging

---

## Testing Strategy

### Local Development

```bash
# Start dev server
pnpm dev

# Test subdomain routing (add to /etc/hosts or use localhost)
# localhost:5173 → platform
# test-org.localhost:5173 → org context
# creators.localhost:5173 → creators context
```

### Integration Tests

```typescript
// tests/hooks.test.ts
import { describe, it, expect } from 'vitest';

describe('Subdomain Routing', () => {
  it('routes platform root correctly', () => {
    // Test reroute function
  });

  it('routes org subdomain correctly', () => {
    // Test org routing
  });

  it('routes creators subdomain correctly', () => {
    // Test creators routing
  });
});
```

### Smoke Tests (Post-Deploy)

- [ ] Platform landing page loads
- [ ] Auth pages accessible from any domain
- [ ] Org subdomain resolves correctly
- [ ] Session cookie validates correctly
- [ ] 404 error page displays correctly

---

## Notes

### Design Decisions

1. **Wildcard DNS over per-org DNS**: Simpler setup, Worker validates org existence at runtime
2. **disableAsyncLocalStorage**: Required for Cloudflare Workers (no Node.js AsyncLocalStorage)
3. **Remote Functions experimental**: Opt-in feature, provides type-safe client-server communication
4. **Session validation on every request**: Security-first approach, cached in Auth Worker's KV

### Security Considerations

- Session cookie is HttpOnly, Secure, SameSite=Lax
- All API calls go through server-side (no direct client→backend)
- Reserved subdomains prevent org slug collision with infrastructure

### Future Enhancements

- Custom domain support (Cloudflare for SaaS)
- Edge caching for public pages
- Real user monitoring (RUM) integration

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
