# Data Layer Architecture Research

**Status**: Research
**Last Updated**: 2026-01-09

This document synthesizes research on modern data fetching patterns for SvelteKit + Cloudflare Workers architectures to inform our repository/data layer design.

---

## Executive Summary

After deep research into modern patterns, the **hybrid approach** emerges as the optimal strategy:

- **Server-side rendering** for public pages (SEO, performance)
- **Client-side fetching** for authenticated, interactive features
- **Repository pattern** to abstract data access and provide type safety
- **Minimal BFF layer** only where necessary (auth, aggregation)

---

## Key Findings

### 1. SvelteKit Data Fetching Best Practices (2026)

**Server `load` functions (`+page.server.ts`):**
- ✅ **Use for**: Sensitive data, database access, SEO-critical pages
- ✅ **Benefits**: Security (server-only), SSR, avoids waterfalls
- ✅ **Streaming**: Can return promises for non-critical data
- ❌ **Drawback**: Every interaction requires server round-trip

**Universal `load` functions (`+page.ts`):**
- ✅ **Use for**: Public APIs, client-side navigation smoothness
- ✅ **Benefits**: Runs on server (SSR) then client (hydration)
- ❌ **Limitation**: Cannot handle sensitive credentials

**Client-side (`onMount`, direct fetch):**
- ✅ **Use for**: User-triggered data, non-critical updates, mutations
- ✅ **Benefits**: Immediate feedback, optimistic updates, caching
- ❌ **Drawback**: No SEO, requires client-side auth handling

**Form Actions:**
- ✅ **Preferred for mutations** (POST/PUT/DELETE)
- ✅ Progressive enhancement (works without JS)

---

### 2. Repository Pattern in TypeScript Frontend

**Core Benefits:**
1. **Decoupling**: Isolates data access from UI/business logic
2. **Centralized**: Single source of truth for API calls
3. **Testability**: Easy to mock for unit tests
4. **Flexibility**: Swap data sources without changing consumers
5. **Type Safety**: Enforce contracts with TypeScript interfaces

**Best Practices:**
```typescript
// 1. Define interfaces (contracts)
interface IContentRepository {
  getContent(id: string): Promise<Content>;
  listContent(filters: ContentFilters): Promise<Content[]>;
  createContent(data: CreateContentDto): Promise<Content>;
}

// 2. Implement concrete classes
class ContentRepository implements IContentRepository {
  constructor(private apiClient: ApiClient) {}

  async getContent(id: string): Promise<Content> {
    return this.apiClient.get(`/content/${id}`);
  }
  // ...
}

// 3. Use generics for reusability
interface IRepository<T> {
  getById(id: string): Promise<T>;
  getAll(): Promise<T[]>;
}

// 4. Dependency injection
// Inject repositories into services/components
```

**Key Patterns:**
- **Shared types** between frontend/backend (monorepo advantage!)
- **Schema validation** (Zod) for runtime safety
- **Service layer** for business logic (sits above repositories)

---

### 3. SvelteKit + Cloudflare Workers Auth Patterns

**Session Management (Recommended):**
- Store session ID in **HttpOnly cookie**
- Store session data in **Cloudflare KV** (edge-optimized)
- Libraries: `svelte-kit-sessions`, `svelte-kit-connect-cloudflare-kv`

**OAuth/Social Login:**
- **BetterAuth** or **Auth.js** (`@auth/sveltekit`)
- Integrates with Cloudflare D1 for user/session storage
- Handles Google, GitHub, email OTP

**JWT (Stateless):**
- Use **Web Crypto API** (not Node.js crypto) in Workers
- Store JWT in HttpOnly cookie
- Refresh tokens in D1/KV for rotation

**Our Context:**
- Workers already handle auth (`packages/security`)
- SvelteKit needs to:
  1. Set HttpOnly cookie on login (via form action)
  2. Pass cookie to Workers on every request
  3. Workers validate and return user context

---

### 4. BFF vs Direct API Calls

**When BFF Makes Sense:**
- ✅ Multiple diverse clients (web, mobile, IoT)
- ✅ Complex data aggregation from multiple microservices
- ✅ Security: Hide internal APIs from client
- ✅ Team autonomy: Frontend owns its API contract

**When Direct Calls Make Sense:**
- ✅ Single frontend or minimal client diversity
- ✅ Simple, already-optimized backend APIs
- ✅ Public APIs or user-based auth (not API keys)

**Hybrid Approach (Recommended):**
- **Public pages** (`/`, `/explore`, `/c/[slug]`): Server-side via `+page.server.ts` (BFF-like)
- **Authenticated dashboards** (`/library`, `/studio`): Client-side direct to Workers
- **Mutations**: Always client-side (form actions or fetch)

**Our Decision:**
- **Thin BFF layer** in SvelteKit for:
  - Initial SSR (public pages)
  - Cookie-to-header transformation (auth)
  - Error formatting
- **Direct client calls** for:
  - Interactive features (search, filters)
  - Real-time updates
  - Mutations

---

## Proposed Architecture

### Layer 1: Cloudflare Workers (Backend)
- **Role**: Source of truth, business logic, database access
- **Auth**: Validates session tokens, returns user context
- **APIs**: RESTful endpoints (already defined in `workers/`)

### Layer 2: Repository Layer (Frontend)
- **Location**: `apps/web/src/lib/repositories/`
- **Role**: Abstraction over API calls, type-safe contracts
- **Implementation**:
  ```typescript
  // apps/web/src/lib/repositories/content.repository.ts
  import type { Content, ContentFilters } from '@codex/shared-types';
  import { apiClient } from '$lib/api/client';

  export class ContentRepository {
    async getContent(id: string): Promise<Content> {
      return apiClient.get(`/api/content/${id}`);
    }

    async listContent(filters: ContentFilters): Promise<Content[]> {
      return apiClient.get('/api/content', { params: filters });
    }
  }

  export const contentRepository = new ContentRepository();
  ```

### Layer 3: API Client (Shared Utility)
- **Location**: `apps/web/src/lib/api/client.ts`
- **Role**: Handles fetch, headers, error mapping
- **Features**:
  - Automatic cookie inclusion (for auth)
  - Response parsing and validation (Zod)
  - Error normalization
  - Request/response interceptors

### Layer 4: Data Fetching Strategy (by Route Group)

#### Public Routes (`(public)`)
**Strategy**: Server-side rendering
```typescript
// src/routes/(public)/c/[slug]/+page.server.ts
import { contentRepository } from '$lib/repositories/content.repository';

export const load: PageServerLoad = async ({ params, locals }) => {
  const content = await contentRepository.getContent(params.slug);
  return { content };
};
```

#### Auth Routes (`(auth)`)
**Strategy**: Form actions (mutations only)
```typescript
// src/routes/(auth)/login/+page.server.ts
export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const { token } = await authRepository.login({
      email: data.get('email'),
      password: data.get('password')
    });

    cookies.set('session', token, { httpOnly: true, secure: true });
    throw redirect(303, '/library');
  }
};
```

#### App Routes (`(app)`, `(creator)`, `(admin)`)
**Strategy**: Hybrid
- **Initial load**: Server-side (for user context)
  ```typescript
  // src/routes/(app)/+layout.server.ts
  export const load: LayoutServerLoad = async ({ locals }) => {
    // Locals.user populated by hooks
    return { user: locals.user };
  };
  ```
- **Subsequent interactions**: Client-side
  ```svelte
  <script lang="ts">
    import { contentRepository } from '$lib/repositories/content.repository';
    import { onMount } from 'svelte';

    let library = $state([]);

    onMount(async () => {
      library = await contentRepository.listUserLibrary();
    });
  </script>
  ```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Create `apps/web/src/lib/api/client.ts` (fetch wrapper)
- [ ] Create `apps/web/src/lib/repositories/` directory
- [ ] Define repository interfaces in `packages/shared-types`
- [ ] Implement `hooks.server.ts` for auth (cookie → `locals.user`)

### Phase 2: Repositories
- [ ] `AuthRepository` (login, register, logout)
- [ ] `ContentRepository` (CRUD for content)
- [ ] `MediaRepository` (uploads, metadata)
- [ ] `UserRepository` (profile, settings)

### Phase 3: Integration
- [ ] Public pages: Server-side load functions
- [ ] Auth pages: Form actions
- [ ] App pages: Client-side repository calls
- [ ] Error handling and loading states

### Phase 4: Optimization
- [ ] Client-side caching (consider SWR-like pattern)
- [ ] Optimistic updates for mutations
- [ ] Request deduplication
- [ ] Offline support (if needed)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Primary Pattern** | Hybrid (Server + Client) | Best of both worlds: SEO + Interactivity |
| **Abstraction Layer** | Repository Pattern | Type safety, testability, flexibility |
| **Auth Strategy** | HttpOnly Cookie + KV | Secure, edge-optimized, simple |
| **Public Pages** | Server-side rendering | SEO, fast first paint |
| **Authenticated Pages** | Client-side fetching | Interactivity, caching, UX |
| **Mutations** | Form Actions (primary) | Progressive enhancement, security |
| **Type Sharing** | Monorepo (`shared-types`) | End-to-end type safety |

---

## References

- [SvelteKit Load Functions](https://kit.svelte.dev/docs/load)
- [Repository Pattern in TypeScript](https://betterprogramming.pub/repository-pattern-in-typescript)
- [BetterAuth for SvelteKit](https://better-auth.com)
- [Cloudflare Workers Auth Patterns](https://developers.cloudflare.com/workers/examples/)
