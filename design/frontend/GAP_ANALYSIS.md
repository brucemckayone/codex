# Frontend Specification - Gap Analysis

**Created**: 2026-01-11
**Purpose**: Identify gaps and provide solutions before implementation

---

## Critical Gaps - SOLUTIONS PROVIDED

### 1. Hooks Implementation

**hooks.ts (reroute)** - Subdomain URL rewriting:

```typescript
// src/hooks.ts
import type { Reroute } from '@sveltejs/kit';

export const reroute: Reroute = ({ url }) => {
  const host = url.hostname;
  const baseDomain = 'revelations.studio';

  // Platform root
  if (host === baseDomain || host === `www.${baseDomain}`) {
    return url.pathname; // /(platform)/...
  }

  // Creator subdomain
  if (host === `creators.${baseDomain}`) {
    return url.pathname; // /(creators)/...
  }

  // Organization subdomain
  const subdomain = host.replace(`.${baseDomain}`, '');
  if (subdomain && !['auth', 'content-api', 'organization-api', 'ecom-api'].includes(subdomain)) {
    // Rewrite /explore to /(org)/[slug]/explore
    return `/${subdomain}${url.pathname}`;
  }

  return url.pathname;
};
```

**hooks.server.ts** - Session validation and org resolution:

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { PUBLIC_AUTH_URL, PUBLIC_ORG_API_URL } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
  // 1. Get session from auth worker
  const sessionCookie = event.cookies.get('codex-session');

  if (sessionCookie) {
    const sessionRes = await fetch(`${PUBLIC_AUTH_URL}/api/auth/session`, {
      headers: { Cookie: `codex-session=${sessionCookie}` }
    });

    if (sessionRes.ok) {
      const { user, session } = await sessionRes.json();
      event.locals.user = user;
      event.locals.session = session;
    }
  }

  // 2. Resolve org from subdomain (if applicable)
  const host = event.url.hostname;
  const subdomain = extractSubdomain(host);

  if (subdomain && !isReservedSubdomain(subdomain)) {
    // Try to fetch org - if 401/404, org doesn't exist or user not authenticated
    const orgRes = await fetch(`${PUBLIC_ORG_API_URL}/api/organizations/slug/${subdomain}`, {
      headers: sessionCookie ? { Cookie: `codex-session=${sessionCookie}` } : {}
    });

    if (orgRes.ok) {
      event.locals.organization = await orgRes.json();
    }
    // If 401/404, org context is null - page can show public content or 404
  }

  return resolve(event);
};
```

---

### 2. Public Org Pages - SOLUTION

**Problem**: Organization lookup requires authentication.

**Solution**: Handle gracefully in hooks.server.ts:
- If user not authenticated → `event.locals.organization = null`
- Page load function can show public org content without org details
- Content listing doesn't need org ID if filtering by published content

**For org landing pages**: The org slug is in the URL. Content can be fetched by `organizationSlug` parameter (backend could add this filter). Alternatively, show a generic "Sign in to view this organization" page.

**Backend Enhancement (recommended)**: Add `GET /api/organizations/public/:slug` endpoint that returns limited org info (name, logo, description) without auth.

---

### 3. API Client Architecture

**Server-side client** (`$lib/server/api.ts`):
- Used in `+page.server.ts` and `+server.ts`
- Forwards cookies via `event.cookies`
- Can use secrets (not exposed to client)

**Client-side client** (`$lib/api/client.ts`):
- Used in Svelte components for interactive features
- Uses `credentials: 'include'` for cookies
- Only calls public endpoints

```typescript
// $lib/server/api.ts (server only)
import { PUBLIC_AUTH_URL, PUBLIC_CONTENT_API_URL } from '$env/static/public';

export function createServerApi(cookies: Cookies) {
  const sessionCookie = cookies.get('codex-session');
  const headers = sessionCookie ? { Cookie: `codex-session=${sessionCookie}` } : {};

  return {
    async getSession() {
      return fetch(`${PUBLIC_AUTH_URL}/api/auth/session`, { headers });
    },
    async getContent(id: string) {
      return fetch(`${PUBLIC_CONTENT_API_URL}/api/content/${id}`, { headers });
    },
    // ... other methods
  };
}

// $lib/api/client.ts (browser)
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include', // Send cookies
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return res.json();
}
```

---

### 4. Video Player - HLS Integration

**Detection and setup**:

```typescript
// $lib/components/VideoPlayer/hls.ts
import Hls from 'hls.js';

export function createHlsPlayer(videoEl: HTMLVideoElement, src: string) {
  // Safari supports native HLS
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = src;
    return null; // No HLS.js instance needed
  }

  // Chrome/Firefox/Edge use HLS.js
  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
    });
    hls.loadSource(src);
    hls.attachMedia(videoEl);
    return hls;
  }

  throw new Error('HLS not supported');
}
```

**Media Chrome integration**: Media Chrome wraps the video element. HLS.js attaches to the same `<video>` element inside the Media Chrome container.

---

### 5. Playback Progress Strategy

**Events and timing**:

| Event | Action |
|-------|--------|
| `pause` | Save immediately |
| `ended` | Save with `completed: true` |
| `visibilitychange` (hidden) | Save cached progress |
| Every 30 seconds while playing | Update local cache |
| `beforeunload` | Send cached progress (best effort) |

**Implementation**:

```typescript
let cachedProgress = { positionSeconds: 0, durationSeconds: 0 };

$effect(() => {
  const interval = setInterval(() => {
    if (isPlaying) {
      cachedProgress = { positionSeconds: video.currentTime, durationSeconds: video.duration };
    }
  }, 30000);
  return () => clearInterval(interval);
});

function saveProgress() {
  fetch(`/api/access/content/${contentId}/progress`, {
    method: 'POST',
    body: JSON.stringify(cachedProgress),
    credentials: 'include'
  });
}

video.addEventListener('pause', saveProgress);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveProgress();
});
```

---

## SEO & Meta Tags - SOLUTION

SvelteKit pattern: Return SEO data from `load`, use in `<svelte:head>`:

```typescript
// +page.server.ts
export async function load({ params }) {
  const content = await getContent(params.slug);
  return {
    content,
    seo: {
      title: `${content.title} | ${content.creator.name}`,
      description: content.description.slice(0, 160),
      image: content.thumbnailUrl,
      type: 'video.other',
    }
  };
}
```

```svelte
<!-- +page.svelte -->
<script>
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.seo.title}</title>
  <meta name="description" content={data.seo.description} />

  <!-- OpenGraph -->
  <meta property="og:title" content={data.seo.title} />
  <meta property="og:description" content={data.seo.description} />
  <meta property="og:image" content={data.seo.image} />
  <meta property="og:type" content={data.seo.type} />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={data.seo.title} />
  <meta name="twitter:description" content={data.seo.description} />
  <meta name="twitter:image" content={data.seo.image} />
</svelte:head>
```

---

## Image Optimization - SOLUTION

**Strategy**: Use `@sveltejs/enhanced-img` for static images, R2 with CDN for dynamic content.

**Static images** (logos, icons):
```svelte
<enhanced:img src="./hero.jpg" alt="Hero" sizes="(max-width: 768px) 100vw, 50vw" />
```
Generates AVIF/WebP, responsive srcset automatically.

**Dynamic images** (thumbnails from R2):

**Option 1**: Cloudflare Image Resizing (if using Cloudflare CDN)
```
https://content.revelations.studio/cdn-cgi/image/width=400,format=auto/thumbnails/content-123.jpg
```

**Option 2**: Pre-generate sizes during upload
- Upload generates: `thumbnail-sm.jpg` (200px), `thumbnail-md.jpg` (400px), `thumbnail-lg.jpg` (800px)
- Frontend selects based on viewport

**Option 3**: On-demand via Media API with serverless GPU
- Request `/api/media/thumbnail?id=xxx&w=400`
- Media API generates on first request, caches in R2

**Recommendation**: Option 1 (Cloudflare Image Resizing) is simplest. Falls back to Option 2 for non-Cloudflare deploys.

---

## Backend Dependencies - VERIFIED

All key endpoints exist and match spec:

| Feature | Endpoint | Status |
|---------|----------|--------|
| Session | GET /api/auth/session | **EXISTS** |
| Org by slug | GET /api/organizations/slug/:slug | **EXISTS** (auth required) |
| Org settings | GET /api/organizations/:id/settings | **EXISTS** |
| Streaming URL | GET /api/access/content/:id/stream | **EXISTS** |
| Playback progress | GET/POST /api/access/content/:id/progress | **EXISTS** |
| User library | GET /api/access/user/library | **EXISTS** |
| Content CRUD | GET/POST/PATCH /api/content | **EXISTS** |
| Checkout | POST /checkout/create | **EXISTS** |

### Backend Gaps to Address

| Gap | Impact | Backend Fix |
|-----|--------|-------------|
| Public org lookup | Marketing pages need org info without auth | Add `GET /api/organizations/public/:slug` |
| Public content list | Org explore page needs published content | Add `visibility=public` filter to content list |

---

## Remaining Work Items

### Must Have (Phase 1)

1. **Project setup** - SvelteKit + Cloudflare adapter + wrangler config
2. **Hooks** - Session validation, subdomain routing (patterns above)
3. **API clients** - Server and client-side helpers
4. **Auth flows** - Login, register, logout pages
5. **SEO** - Meta tag pattern for all pages
6. **Core layouts** - Header, footer, page containers
7. **Content pages** - List, detail, player
8. **Library** - User's purchased content
9. **Checkout** - Stripe redirect flow

### Nice to Have (Phase 1)

1. **Image optimization** - Use enhanced-img or CDN resizing
2. **Skeleton loading** - Branded shimmer effect
3. **Error pages** - 404, 403, 500 with recovery actions

### Deferred

1. **Membership API** - User roles in orgs (not Phase 1)
2. **Following** - Creator/org follow system
3. **Feed** - Instagram-style content feed
4. **Dashboard** - Personalized user hub

---

## Work Packets

| WP | Name | Effort | Dependencies |
|----|------|--------|--------------|
| WP-1 | Project Setup | S | None |
| WP-2 | Hooks (session, routing) | M | WP-1 |
| WP-3 | API Clients | S | WP-1 |
| WP-4 | Design System (tokens, base CSS) | M | WP-1 |
| WP-5 | Auth Pages | M | WP-2, WP-3 |
| WP-6 | Layout Components | M | WP-4 |
| WP-7 | Platform Routes | L | WP-5, WP-6 |
| WP-8 | Org Routes | L | WP-7 |
| WP-9 | Video Player | L | WP-1 |
| WP-10 | Library Page | M | WP-7 |
| WP-11 | Checkout Flow | M | WP-8 |
| WP-12 | SEO Implementation | S | WP-7, WP-8 |
| WP-13 | Image Optimization | S | WP-7 |
| WP-14 | Error Pages & Feedback | S | WP-6 |

**Total**: ~14 work packets
**Critical path**: WP-1 → WP-2 → WP-5 → WP-7 → WP-8
