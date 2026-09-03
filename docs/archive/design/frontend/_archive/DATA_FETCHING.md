# Data Fetching Strategy (SvelteKit + Cloudflare Workers)

**Status**: Draft
**Last Updated**: 2026-01-09

This document outlines how the SvelteKit frontend communicates with the backend Cloudflare Workers services.

---

## 1. Architecture Overview

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────────────┐
│   Browser   │────▶│  SvelteKit      │────▶│  Cloudflare Workers      │
│             │     │  (BFF Layer)    │     │                          │
│  - Forms    │◀────│  - hooks.server │◀────│  Auth (42069)            │
│  - $effect  │     │  - load funcs   │     │  Content-API (4001)      │
│  - actions  │     │  - form actions │     │  Identity-API (42071)    │
└─────────────┘     └─────────────────┘     │  Ecom-API (42072)        │
                                            └────────────┬─────────────┘
                                                         │
                                                         ▼
                                            ┌──────────────────────────┐
                                            │  Neon PostgreSQL         │
                                            │  (via Drizzle ORM)       │
                                            └──────────────────────────┘
```

**Key Points:**
- **Browser**: Sends requests to SvelteKit, receives rendered HTML or JSON
- **SvelteKit Server**: Reads `codex-session` cookie, forwards to Workers
- **Workers API**: Source of truth - validates sessions, executes business logic
- **Auth is cookie-based**: No Bearer tokens - session cookie set by Auth Worker

---

## 2. Worker URLs & API Helper

```typescript
// $lib/server/api.ts
import {
  AUTH_WORKER_URL,
  CONTENT_API_URL,
  IDENTITY_API_URL,
  ECOM_API_URL
} from '$env/static/private';

// Actual Codex Workers
const WORKERS = {
  auth: AUTH_WORKER_URL,        // http://localhost:42069 | https://auth.revelations.studio
  content: CONTENT_API_URL,     // http://localhost:4001  | https://content-api.revelations.studio
  identity: IDENTITY_API_URL,   // http://localhost:42071 | https://identity-api.revelations.studio
  ecom: ECOM_API_URL           // http://localhost:42072 | https://ecom-api.revelations.studio
} as const;

type WorkerName = keyof typeof WORKERS;

class APIError extends Error {
  constructor(public status: number, public data: unknown) {
    super(`API Error: ${status}`);
  }
}

export async function api<T>(
  worker: WorkerName,
  path: string,
  options: RequestInit & { sessionCookie?: string } = {}
): Promise<T> {
  const { sessionCookie, ...fetchOptions } = options;

  const res = await fetch(`${WORKERS[worker]}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      // Auth uses cookies, NOT Bearer tokens
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

---

## 3. Server-Side Loading (`+page.server.ts`)

Data is fetched on the server for SEO, performance, and security.

### Pattern

```typescript
// src/routes/org/[slug]/(app)/library/+page.server.ts
import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, cookies }) => {
  // 1. Check authentication (set by hooks.server.ts)
  if (!locals.userId) {
    throw redirect(303, '/login');
  }

  // 2. Get session cookie to forward to workers
  const sessionCookie = cookies.get('codex-session');

  // 3. Fetch data from workers (parallel)
  const [libraryRes, progressRes] = await Promise.all([
    api('content', '/api/user/library', { sessionCookie }),
    api('content', '/api/user/playback-progress', { sessionCookie })
  ]);

  // 4. Return to page
  return {
    library: libraryRes.data,
    progress: progressRes.data
  };
};
```

### Key Endpoints by Worker

| Worker | Endpoint | Purpose |
|--------|----------|---------|
| **auth** | `GET /api/auth/session` | Validate session, get user |
| **auth** | `POST /api/auth/email/login` | Login (sets cookie) |
| **auth** | `POST /api/auth/email/register` | Register (sets cookie) |
| **auth** | `POST /api/auth/signout` | Logout (clears cookie) |
| **content** | `GET /api/content/:id` | Get content details |
| **content** | `POST /api/content` | Create content (creator) |
| **content** | `GET /api/access/streaming-url/:id` | Get presigned R2 URL |
| **content** | `POST /api/access/playback-progress/:id` | Save playback position |
| **identity** | `GET /api/organizations/slug/:slug` | Get org by subdomain |
| **identity** | `POST /api/organizations` | Create org |
| **ecom** | `POST /checkout/create` | Create Stripe checkout session |

---

## 4. Mutations (Form Actions)

Use **SvelteKit Form Actions** for state changes. Works without JS (progressive enhancement).

### Login Action

**IMPORTANT**: Auth Worker sets the cookie via BetterAuth. We just proxy the request.

```typescript
// src/routes/(auth)/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_WORKER_URL } from '$env/static/private';

export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    // 1. Call Auth Worker login endpoint
    const res = await fetch(`${AUTH_WORKER_URL}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'  // Important for cookie handling
    });

    if (!res.ok) {
      const error = await res.json();
      return fail(400, { email, error: error.message || 'Invalid credentials' });
    }

    // 2. Auth Worker returns Set-Cookie header with 'codex-session'
    // We need to forward this cookie to the browser
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      // Parse and re-set the cookie for cross-subdomain support
      // Auth Worker should set domain: '.revelations.studio'
    }

    // 3. Redirect to library
    throw redirect(303, '/library');
  }
};
```

### Create Content Action (Authenticated)

```typescript
// src/routes/org/[slug]/(creator)/studio/content/new/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { api } from '$lib/server/api';

export const actions = {
  default: async ({ request, cookies, locals }) => {
    if (!locals.userId) {
      throw redirect(303, '/login');
    }

    const sessionCookie = cookies.get('codex-session');
    const data = await request.formData();

    const contentData = {
      title: data.get('title'),
      slug: data.get('slug'),
      description: data.get('description'),
      contentType: data.get('contentType'),
      visibility: data.get('visibility'),
      priceCents: parseInt(data.get('price') as string) || 0
    };

    try {
      const result = await api('content', '/api/content', {
        method: 'POST',
        body: JSON.stringify(contentData),
        sessionCookie
      });

      throw redirect(303, `/studio/content/${result.data.id}`);
    } catch (err) {
      if (err instanceof APIError) {
        return fail(err.status, { ...contentData, error: err.data });
      }
      throw err;
    }
  }
};
```

---

## 5. Authentication Flow

### hooks.server.ts

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { AUTH_WORKER_URL, IDENTITY_API_URL } from '$env/static/private';

const authHandle: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    try {
      // Call Auth Worker to validate session
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
      console.error('Session validation failed:', error);
    }
  }

  return resolve(event);
};

const orgHandle: Handle = async ({ event, resolve }) => {
  // Extract subdomain from hostname
  const hostname = event.url.hostname;
  const subdomain = extractSubdomain(hostname);

  if (subdomain && !['www', 'auth', 'api'].includes(subdomain)) {
    try {
      const res = await fetch(`${IDENTITY_API_URL}/api/organizations/slug/${subdomain}`);
      if (res.ok) {
        const { data: org } = await res.json();
        event.locals.organization = org;
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
  if (parts.length >= 3) {
    return parts[0];
  }
  return null;
}
```

### Flow Summary

```
1. User visits yoga-studio.revelations.studio/library
2. hooks.server.ts:
   a. Reads 'codex-session' cookie
   b. Calls Auth Worker GET /api/auth/session
   c. Sets event.locals.user, event.locals.userId
   d. Extracts 'yoga-studio' from hostname
   e. Calls Identity-API GET /api/organizations/slug/yoga-studio
   f. Sets event.locals.organization
3. +layout.server.ts: Checks locals.userId, returns org context
4. +page.server.ts: Fetches library data from Content-API
5. +page.svelte: Renders with user + org context
```

---

## 6. Type Safety

Use `@codex/shared-types` for API response types.

```typescript
// In SvelteKit
import type { SingleItemResponse, PaginatedListResponse } from '@codex/shared-types';
import type { Content, User } from '@codex/shared-types';

// Type the API response
const result = await api<SingleItemResponse<Content>>('content', `/api/content/${id}`, { sessionCookie });
const content = result.data;

// For lists
const result = await api<PaginatedListResponse<Content>>('content', '/api/content', { sessionCookie });
const items = result.data;
const { page, limit, total } = result.pagination;
```

---

## 7. Error Handling

### API Errors

```typescript
// $lib/server/api.ts
export class APIError extends Error {
  constructor(
    public status: number,
    public data: { error: { code: string; message: string; details?: unknown } }
  ) {
    super(data.error?.message || `API Error: ${status}`);
  }

  get code() {
    return this.data.error?.code || 'UNKNOWN';
  }
}
```

### In Load Functions

```typescript
export const load: PageServerLoad = async ({ cookies, params }) => {
  try {
    const result = await api('content', `/api/content/${params.id}`, {
      sessionCookie: cookies.get('codex-session')
    });
    return { content: result.data };
  } catch (err) {
    if (err instanceof APIError) {
      if (err.status === 404) {
        throw error(404, 'Content not found');
      }
      if (err.status === 403) {
        throw redirect(303, '/login');
      }
    }
    throw err;
  }
};
```

---

## 8. Summary

| Aspect | Approach |
|--------|----------|
| **Auth** | Cookie-based (`codex-session`), validated via Auth Worker |
| **Data Loading** | Server `load` functions with cookie forwarding |
| **Mutations** | Form actions calling Workers |
| **Types** | Shared via `@codex/shared-types` |
| **Errors** | APIError class with status/code handling |
| **Cross-subdomain** | Cookie with `domain: '.revelations.studio'` |
