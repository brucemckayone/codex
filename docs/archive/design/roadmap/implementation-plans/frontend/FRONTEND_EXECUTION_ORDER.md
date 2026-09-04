# Frontend Phase 1: Execution Strategy

**Critical Path**: Foundation -> Data Layer -> Core Features -> Admin -> Monetization.

## 🟢 Phase 1.1: The Backbone (Architecture)
*Goal: A working skeleton that renders branding correctly without FOUC.*

1.  **`P1-FE-FOUNDATION-001` (Project Setup)**
    *   Initialize SvelteKit + Paraglide (i18n).
    *   **Crucial**: Bind `BRAND_KV` in `wrangler.toml`.
2.  **`P1-BE-CACHE-001` (Backend Caching)**
    *   Implement `src/lib/server/brand-cache.ts` (The edge glue).
    *   This *must* exist before we try to use it in the layout.
3.  **`P1-FE-FOUNDATION-002` (Design System)**
    *   Implement `src/lib/styles/tokens/*.css`.
    *   Update `+layout.server.ts` to use `getBrandConfig` (from step 2) -> injects CSS.
    *   *Result*: A blank page that loads perfectly branded tokens in <100ms.

## 🟡 Phase 1.2: Identity (Access)
*Goal: Users can exist.*

4.  **`P1-FE-AUTH-001` (Auth Pages)**
    *   Login (`/login`), Signup (`/register`), Forgot Password.
    *   Integration with Identity API.
    *   *Dependency*: Needs Design System components (Input, Button).

## 🔵 Phase 1.3: The Engine (Core Product)
*Goal: Users can consume content.*

5.  **`P1-FE-CONTENT-001` (Content Pages)**
    *   Video Player, Course Listings.
    *   *Dependency*: Needs specialized "Material" tokens (Glass/Dark mode) for immersive viewing.
6.  **`P1-FE-ACCESS-001` (Library)**
    *   "My Library" grid.
    *   *Dependency*: Needs Auth (Phase 1.2).

## 🟣 Phase 1.4: Control (Admin)
*Goal: Creators can manage the system.*

7.  **`P1-FE-ADMIN-001` (Dashboard)**
    *   Shell, Sidebar, Analytics widgets.
8.  **`P1-FE-ADMIN-002` (Settings)**
    *   **Crucial Integration**: When user saves Brand Colors here, call `setBrandConfig` (from Phase 1.1) to update KV.
    *   *Validation*: Changing a color here must instantly reflect on the Frontend (Phase 1.1).

## 🔴 Phase 1.5: Revenue (Eicom)
*Goal: Getting paid.*

9.  **`P1-FE-ECOM-001` (Checkout)**
    *   Stripe Elements integration.
    *   *Dependency*: Needs everything else (Auth, Branding, Content).

---

## Deployment Strategy

*   **Staging**: Deploy Phase 1.1 immediately to verify KV binding and Edge Caching.
*   **Production**: Do not promote until Phase 1.4 (Admin) is done, or you have a "Adminless" CMS situation.
