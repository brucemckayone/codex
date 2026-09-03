# Frontend Specification - Continuation Context

**Last Updated**: 2026-01-10
**Status**: All 8 documents complete and consistent - ready for implementation

---

## COMPLETED WORK

### Document Restructure (Previous Session)

Split the monolithic `FRONTEND_SPEC.md` (1991 lines) into domain-focused documents:

| Document | Purpose |
|----------|---------|
| [OVERVIEW.md](./OVERVIEW.md) | Tech stack, principles, project structure |
| [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) | Workers hosting, DNS, subdomains |
| [ROUTING.md](./ROUTING.md) | URL structure, subdomain rewriting, navigation |
| [AUTH.md](./AUTH.md) | Authentication flows, session handling |
| [AUTHORIZATION.md](./AUTHORIZATION.md) | Roles, permissions, guards |
| [DATA.md](./DATA.md) | Data fetching, state management |
| [COMPONENTS.md](./COMPONENTS.md) | Component architecture, Melt UI |
| [STYLING.md](./STYLING.md) | Design tokens, theming, dark mode |

### Detailed Documents (Previous Sessions)

| Document | Key Additions |
|----------|---------------|
| ROUTING.md | Route tables for all 3 contexts, studio switcher, content flows |
| STYLING.md | Token inheritance, contrast checking, auto-harmonize |
| COMPONENTS.md | Melt UI patterns, PreviewPlayer, VideoPlayer, Library, ConfirmDialog |

### Consistency Updates (This Session)

**OVERVIEW.md** - Updated to show all 8 workers:
- Architecture diagram now shows Frontend-Facing workers (Auth, Content, Org, Ecom)
- Plus Internal workers (Media, Notifications, Admin, Identity)
- Added reference to DATA.md for complete endpoint documentation

**INFRASTRUCTURE.md** - Aligned with DATA.md conventions:
- Environment variables now use `PUBLIC_*` prefix (SvelteKit convention)
- Subdomain names corrected: `content-api.*`, `organization-api.*`, `ecom-api.*`
- Reserved subdomains list updated to match

### Deep Dive - DATA.md, AUTH.md, AUTHORIZATION.md (Previous Session)

**DATA.md** - Complete rewrite with:
- 8 backend workers documented (not 4)
- Environment variable configuration for worker URLs
- Correct API endpoints from actual worker code
- Response types from `@codex/shared-types`
- Streaming URL flow with sequence diagram
- Playback progress save/get patterns
- User library response shape
- Validation using `@codex/validation` schemas
- API helper design with type safety

**AUTH.md** - Updated with verified details:
- Cookie name: `codex-session` (confirmed from auth-config.ts)
- Session response shape: `{ user, session }`
- UserData and SessionData interfaces
- Rate limits from BetterAuth config (10/15min for login)
- KV cache TTL (5 minutes)
- All auth flows with sequence diagrams
- Server hook implementation example
- Form action implementation example

**AUTHORIZATION.md** - Updated with correct architecture:
- Organization-API endpoints (not Identity-API for org lookups)
- Phase 1 limitations clearly documented
- Backend-enforced authorization via `procedure()` policies
- Frontend role checks for UI display only
- Membership resolution TBD (no frontend endpoint yet)
- Guard implementation examples with actual API calls

---

## CONFIRMED DECISIONS

### Tech Stack
- **SvelteKit 2.x** on **Cloudflare Workers**
- **Svelte 5** with runes ($state, $derived, $effect)
- **Melt UI Next-Gen** for accessible headless components (class-based API)
- **Media Chrome** for video player foundation
- **HLS.js** for streaming (Safari uses native HLS)
- **Vanilla CSS** with three-tier design tokens
- **TypeScript** strict mode

### Backend Architecture (8 Workers)
| Worker | Port | Purpose |
|--------|------|---------|
| Auth | 42069 | Authentication, sessions (BetterAuth) |
| Content-API | 4001 | Content CRUD, streaming, access |
| Organization-API | 42071 | Org management, settings |
| Ecom-API | 42072 | Checkout, webhooks |
| Media-API | - | Transcoding callbacks |
| Notifications-API | - | Email templates |
| Admin-API | - | Platform admin |
| Identity-API | 42074 | User identity (placeholder) |

### Multi-Tenancy Model
- Organizations get subdomains: `{slug}.revelations.studio`
- Creators get personal pages: `creators.revelations.studio/{username}`
- Usernames are **globally unique**
- Creators can be in **multiple organizations**
- Creators can monetize **personally** (future) and **within organizations**

### Authentication
- Cookie name: `codex-session`
- Cookie domain: `.revelations.studio` (cross-subdomain)
- Session expiry: 24 hours
- KV cache TTL: 5 minutes
- Rate limit: 10 requests/15min for auth endpoints

### Authorization
- Platform roles: customer, creator, admin
- Org roles: owner, admin, creator, subscriber, member
- Backend enforces via `procedure()` policies
- Frontend does role checks for UI display only

### Routing
- Auth on platform domain with redirect back to origin
- `/content/{slug}` for content (not `/c/`)
- Same page for content detail and player (state-based)
- Studio switcher shows orgs where user is Creator+ role
- Library at platform level only (no org-scoped library)
- Header "Library" link always goes to platform library

### Media/Content Model
- Media owned by creator (not org)
- Creators share specific media with orgs
- Content can be personal or org-scoped
- Publishing requires admin approval in org context
- Drafts visible in org studio to creator only

### Styling
- Three-tier tokens: primitives → semantic → component
- Org tokens override platform with fallback
- Dark mode is global (stored once, applies everywhere)
- Contrast checking with warning + auto-harmonize option
- WCAG AA compliance (4.5:1 minimum)
- Shimmer uses org's `--brand-primary` color

### Video Player
- Media Chrome web components for controls
- HLS.js for Chrome/Firefox/Edge, native HLS for Safari
- Quality selector: auto + manual options
- Progress saving: on pause, cache on page change, send on leave
- Playback speed: 0.5x, 1x, 1.5x, 2x
- Video ends: show recommendations (same creator > same org > random)
- Stay within current org context for recommendations
- Phase 1: NO captions, chapters, or PiP

### Preview Player
- 30 second clips
- Controls: Play, Mute, Fullscreen only
- NOT muted by default
- Autoplay on scroll into view
- Preview indicator appears after a moment
- Ends: fade to black, show purchase CTA

### Library (Phase 1)
- Platform level only: `revelations.studio/library`
- Access via header nav (always goes to platform, even from org)
- Search: title, creator name, org name
- Filters: org, content type, progress status
- Sort: recently purchased, recently watched, alphabetical
- Continue watching section

### Destructive Actions - Three Tiers
| Tier | When | Confirmation |
|------|------|--------------|
| None | Low-risk (wishlist) | No dialog |
| Confirm | Most deletes | "Are you sure?" |
| Type to confirm | Critical/irreversible | Type "DELETE" |

### Notifications (Phase 1)
- Email only
- Transactional (purchase confirmations)
- NO new content notifications (requires following, which is future)

---

## NOT PHASE 1 (FUTURE)

| Feature | Notes |
|---------|-------|
| Following creators | Follow from creator page or org page |
| Feed | Instagram-style vertical scroll |
| User dashboard | `/app` with widgets, continue watching, recommendations |
| Wishlist | Cross-org, private by default |
| Mini player | PiP when scrolling away |
| Captions | Will come from HLS via Whisper |
| Chapters | Future player feature |
| Appointments/services | 1:1 bookings, events |
| Rich text editor | Plain textarea in Phase 1 |
| New content notifications | Requires following |
| Customizable dashboard | Reorder/hide widgets |
| Membership API | Frontend org role queries |
| OAuth providers | Google, GitHub, etc. |
| Two-factor auth | TOTP or SMS |

---

## OPEN QUESTIONS

1. **Personal monetization timeline** - When does creator personal content monetization ship?

2. **Platform admin dashboard** - Where does platform-level administration live?

3. **Discovery implementation** - How will org/creator discovery work? (Categories, search, featured, algorithm?)

4. **Publishing approval flow** - What does the admin approval UI look like? Notifications?

5. **Shimmer design** - Exact animation parameters for the signature loading shimmer (design phase)

6. **Follower count visibility** - Public or private? Pros/cons discussed, not decided.

---

## GAP ANALYSIS - SOLUTIONS PROVIDED

See **[GAP_ANALYSIS.md](./GAP_ANALYSIS.md)** for code patterns and implementation details.

### All Critical Gaps Resolved

| Gap | Solution |
|-----|----------|
| Hooks implementation | `reroute` for subdomain URL rewriting, `handle` for session validation |
| Public org pages | Handle 401 gracefully, show public content, recommend backend public endpoint |
| API client | Server-side (`$lib/server/api.ts`) + client-side (`$lib/api/client.ts`) |
| Video player | HLS.js detection pattern, Media Chrome integration documented |
| Playback progress | Save on pause, 30s cache interval, visibilitychange, beforeunload |
| SEO/meta tags | `<svelte:head>` with data from load functions |
| Image optimization | `@sveltejs/enhanced-img` for static, Cloudflare Image Resizing for dynamic |

### Backend Endpoints - VERIFIED

All key endpoints exist and match spec:
- Session: `GET /api/auth/session`
- Org: `GET /api/organizations/slug/:slug` (auth required)
- Content: CRUD, streaming URLs, playback progress
- Library: `GET /api/access/user/library`
- Checkout: `POST /checkout/create`

### Backend Enhancements Recommended

| Enhancement | Purpose |
|-------------|---------|
| `GET /api/organizations/public/:slug` | Public org info for marketing pages |
| `visibility=public` filter on content list | Public explore pages without auth |

## NEXT STEPS

All gaps resolved with code patterns. Ready for work packet creation.

### Work Packets (14 total)

| WP | Name | Effort | Deps |
|----|------|--------|------|
| WP-1 | Project Setup | S | - |
| WP-2 | Hooks (session, routing) | M | 1 |
| WP-3 | API Clients | S | 1 |
| WP-4 | Design System | M | 1 |
| WP-5 | Auth Pages | M | 2,3 |
| WP-6 | Layout Components | M | 4 |
| WP-7 | Platform Routes | L | 5,6 |
| WP-8 | Org Routes | L | 7 |
| WP-9 | Video Player | L | 1 |
| WP-10 | Library Page | M | 7 |
| WP-11 | Checkout Flow | M | 8 |
| WP-12 | SEO Implementation | S | 7,8 |
| WP-13 | Image Optimization | S | 7 |
| WP-14 | Error Pages & Feedback | S | 6 |

**Critical Path**: WP-1 → WP-2 → WP-5 → WP-7 → WP-8

### Immediate Actions

1. **Create detailed work packets** with acceptance criteria for each
2. **Backend**: Request public org endpoint (optional but recommended)
3. **Start**: WP-1 (Project Setup) - scaffold SvelteKit with Cloudflare adapter
