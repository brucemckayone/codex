# Frontend Specification - Continuation Context

**Last Updated**: 2026-01-10
**Status**: Detailed routing, styling, and components complete

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

### Detailed Routing (Previous Session)

Added comprehensive route tables for all three contexts:

| Context | Key Routes |
|---------|------------|
| Platform (`revelations.studio`) | `/discover`, `/library`, `/account` |
| Organization (`{slug}.revelations.studio`) | `/explore`, `/content/{slug}`, `/studio/*` |
| Creator (`creators.revelations.studio`) | `/{username}`, `/studio/*` |

New sections added:
- Studio switcher (sidebar/header navigation between contexts)
- Media sharing flow (personal → org)
- Content publishing flow (draft → pending review → published)
- Content page states (preview vs full player)

### Detailed Styling (Previous Session)

Added accessibility and branding features:

| Feature | Description |
|---------|-------------|
| Token inheritance | Platform defaults → org overrides with fallback |
| Contrast checking | WCAG AA validation (4.5:1 minimum) |
| Auto-harmonize | Optional color adjustment for accessibility |
| Global dark mode | Single preference across all contexts |

### Detailed Components (This Session)

Major updates to COMPONENTS.md:

| Section | Changes |
|---------|---------|
| Melt UI patterns | Updated to next-gen class-based API (`new Accordion()` not `createAccordion()`) |
| Data attributes | Styling via `[data-melt-*]`, `[data-state="open"]` selectors |
| PreviewPlayer | 30s clips, minimal controls, autoplay on scroll, CTA at end |
| VideoPlayer | Media Chrome + HLS.js, progress saving, recommendations at end |
| Library | Platform-only (no org-scoped), search/filter/sort |
| ConfirmDialog | Three tiers: none, confirm, type-to-confirm |
| Skeleton/Shimmer | Content-aware placeholders, org brand color in shimmer |
| Future Components | Wishlist, FollowButton, Feed, UserDashboard documented |

### Routing Updates (This Session)

- Removed org-scoped library (`{slug}.revelations.studio/library`)
- Library is platform-level only
- Added Future Routes section with `/app/*` routes
- Documented following mechanics (future)
- Documented appointments/services (future)

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

### Multi-Tenancy Model
- Organizations get subdomains: `{slug}.revelations.studio`
- Creators get personal pages: `creators.revelations.studio/{username}`
- Usernames are **globally unique**
- Creators can be in **multiple organizations**
- Creators can monetize **personally** (future) and **within organizations**

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

---

## OPEN QUESTIONS

1. **Personal monetization timeline** - When does creator personal content monetization ship?

2. **Platform admin dashboard** - Where does platform-level administration live?

3. **Discovery implementation** - How will org/creator discovery work? (Categories, search, featured, algorithm?)

4. **Publishing approval flow** - What does the admin approval UI look like? Notifications?

5. **Shimmer design** - Exact animation parameters for the signature loading shimmer (design phase)

6. **Follower count visibility** - Public or private? Pros/cons discussed, not decided.

---

## NEXT STEPS

1. **Review** the updated COMPONENTS.md and ROUTING.md
2. **Deep dive** into DATA.md next (API architecture, state management, worker URLs)
3. **Deep dive** into AUTH.md and AUTHORIZATION.md
4. **Address** open questions when ready
5. **Begin implementation** based on these specs

