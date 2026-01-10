# Frontend Specification - Continuation Context

**Last Updated**: 2026-01-10
**Status**: Restructure complete

---

## COMPLETED WORK

### Document Restructure

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

### Key Corrections Applied

| Original (Wrong) | Corrected |
|------------------|-----------|
| Cloudflare Pages | **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`) |
| Tailwind CSS | **Vanilla CSS** + design tokens |
| Shadcn-Svelte / Bits UI | **Melt UI** (headless, Svelte 5 native) |
| "storefront" | **"space"** (org landing pages) |
| Creators must be in org | Creators can work **independently or in multiple orgs** |

---

## CONFIRMED DECISIONS

### Tech Stack
- **SvelteKit 2.x** on **Cloudflare Workers**
- **Svelte 5** with runes ($state, $derived, $effect)
- **Melt UI** for accessible headless components
- **Vanilla CSS** with three-tier design tokens
- **TypeScript** strict mode

### Multi-Tenancy Model
- Organizations get subdomains: `{slug}.revelations.studio`
- Creators get personal pages: `creators.revelations.studio/{username}`
- Usernames are **globally unique**
- Creators can be in **multiple organizations**
- Creators can monetize **personally** (future) and **within organizations**

### Studio Model
- Single `/studio` route, **role-gated features**
- Personal context: Personal content CMS
- Org context: Features based on role (creator → admin → owner)

### Theming
- **Full token system**: primitives → semantic → component
- **Dark mode** included from start
- **Mock tokens** for Phase 1 (`$lib/theme/mock-org-tokens.ts`)
- Org branding customization handled later (not Phase 1)

---

## OPEN QUESTIONS

1. **Personal monetization timeline** - When does creator personal content monetization ship?

2. **Platform admin dashboard** - Where does platform-level administration live?

3. **Org branding scope** - What fields will orgs eventually customize? (colors, fonts, logo, etc.)

---

## NEXT STEPS

1. **Review** the new documents for accuracy
2. **Address** open questions when ready
3. **Begin implementation** based on these specs
