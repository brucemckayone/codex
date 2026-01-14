# Frontend Route Definition (SvelteKit)

**Status**: Draft
**Framework**: SvelteKit
**Last Updated**: 2026-01-09

This document outlines the proposed route structure for the Codex Platform frontend. It utilizes SvelteKit's route grouping `(group)` features to organize layouts and access control.

---

## Route Groups Overview

We will use route groups to separate different layouts and authentication requirements.

| Group | Path Prefix | Layout Features | Access Control |
|-------|-------------|-----------------|----------------|
| **(public)** | `/` | Storefront Header/Footer | Public (User can be guest or logged in) |
| **(auth)** | `/auth` or root | Centered Card Layout | Public Only (Redirect if logged in) |
| **(app)** | `/library`, `/watch` | App Sidebar + Player | Authenticated Users |
| **(creator)** | `/studio` | Creator Sidebar | Role: `creator` or `admin` |
| **(admin)** | `/admin` | Admin Sidebar | Role: `platform_owner` |

---

## 1. Public / Storefront `(public)`

The face of the platform. Accessible to everyone.

*   `src/routes/(public)/+layout.svelte`
    *   **Wrapper**: PublicHeader (Logo, Login/Signup), PublicFooter.
    *   **Data**: Org branding (colors, logo).

| Route | Description | Components |
|-------|-------------|------------|
| `/` | Landing Page / Store Home | `HeroSection`, `ContentGrid` (Featured) |
| `/explore` | Browse all content | `SearchFilters`, `ContentGrid` |
| `/c/[slug]` | Product Details Page | `ProductHero`, `MediaPreview`, `PurchaseButton` |
| `/checkout/success` | Purchase confirmation | `SuccessMessage`, `LinkToLibrary` |

---

## 2. Authentication `(auth)`

Entry points for user identity.

*   `src/routes/(auth)/+layout.svelte`
    *   **Wrapper**: Minimal layout, centered content, branded background.

| Route | Description | Components |
|-------|-------------|------------|
| `/login` | Sign in | `LoginForm` |
| `/register` | Sign up | `RegisterForm` |
| `/forgot-password` | Reset request | `ForgotPasswordForm` |
| `/reset-password` | Set new password | `ResetPasswordForm` |

---

## 3. User Portal `(app)`

Where customers consume content.

*   `src/routes/(app)/+layout.svelte`
    *   **Wrapper**: AppSidebar (Navigation), UserMenu.
    *   **Guard**: Redirect to `/login` if not authenticated.

| Route | Description | Components |
|-------|-------------|------------|
| `/library` | My Library (Home) | `LibraryGrid`, `ResumeWatchingRow` |
| `/settings` | User Profile & Billing | `ProfileForm`, `BillingHistory` |

### Player Route (Special Layout)
*   `src/routes/(app)/watch/[contentId]/+page.svelte`
    *   **Note**: Might need a dedicated layout (no sidebar) for immersive viewing.
    *   **Components**: `VideoPlayer` (HLS), `ChapterList`, `VideoResources` (PDFs).

---

## 4. Creator Studio `(creator)`

For content creators to manage their assets.

*   `src/routes/(creator)/+layout.svelte`
    *   **Wrapper**: CreatorSidebar (Media, Content, Analytics).
    *   **Guard**: Redirect if `user.role !== 'creator'`.

| Route | Description | Components |
|-------|-------------|------------|
| `/studio` | Dashboard Overview | `StatsCards` (Views, Sales) |
| `/studio/media` | Media Library | `UploadZone`, `MediaTable` |
| `/studio/content` | Content Management | `ContentList` (Drafts/Published) |
| `/studio/content/new` | Create Content | `ContentEditor` (Wizard) |
| `/studio/content/[id]` | Edit Content | `ContentEditor` |

---

## 5. Admin Dashboard `(admin)`

For the platform owner.

*   `src/routes/(admin)/+layout.svelte`
    *   **Wrapper**: AdminSidebar (Revenue, Users, Settings).
    *   **Guard**: Redirect if `user.role !== 'platform_owner'`.

| Route | Description | Components |
|-------|-------------|------------|
| `/admin` | Overview | `RevenueChart`, `TopContentTable` |
| `/admin/customers` | Customer List | `CustomerTable` |
| `/admin/customers/[id]` | Customer Detail | `CustomerProfile`, `PurchaseHistory`, `GrantAccessForm` |
| `/admin/content` | Global Content View | `GlobalContentTable` |
| `/admin/settings` | Platform Settings | `BrandingForm`, `ContactForm`, `FeatureToggles` |

---

## 6. API Proxy (SvelteKit Backend)

SvelteKit's server-side `+page.server.ts` and `+server.ts` files will act as a proxy/BFF (Backend for Frontend) to the Cloudflare Workers.

*   **Cookie Handling**: SvelteKit handles the HTTP-only session cookie.
*   **Data Fetching**: Server load functions fetch data from `api.codex.com` (Workers) and pass it to the page.

### Proposed File Structure

```text
src/routes/
├── (public)/
│   ├── +layout.svelte
│   ├── +page.svelte           (Home)
│   ├── explore/
│   │   └── +page.svelte
│   └── c/
│       └── [slug]/
│           └── +page.svelte
├── (auth)/
│   ├── +layout.svelte
│   ├── login/
│   │   └── +page.svelte
│   └── ...
├── (app)/
│   ├── +layout.svelte         (Sidebar)
│   ├── library/
│   │   └── +page.svelte
│   ├── settings/
│   │   └── +page.svelte
│   └── watch/
│       └── [contentId]/
│           └── +page.svelte   (Player)
├── (creator)/
│   ├── +layout.svelte
│   ├── studio/
│   │   ├── +page.svelte
│   │   ├── media/
│   │   │   └── +page.svelte
│   │   └── content/
│   │       ├── +page.svelte
│   │       └── [id]/
│   │           └── +page.svelte
└── (admin)/
    ├── +layout.svelte
    ├── admin/
    │   ├── +page.svelte
    │   ├── customers/
    │   │   ├── +page.svelte
    │   │   └── [id]/
    │   │       └── +page.svelte
    │   └── settings/
    │       └── +page.svelte
```
