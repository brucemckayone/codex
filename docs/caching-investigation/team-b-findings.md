# Team B — Scroll Reset + Breadcrumb Findings

## Issue 1: Scroll reset

### Current behaviour (file:symbol citations)

- `apps/web/src/routes/+layout.svelte:41-68` — root layout runs `onNavigate` handler that wraps every same-route navigation in `document.startViewTransition(async () => { resolve(); await navigation.complete; })`. It early-returns only for same-pathname (query/hash) navigations; all cross-page navs go through a VT.
- `apps/web/src/routes/_org/[slug]/+layout.svelte:478-479` — `.org-main` sets `view-transition-name: page-content;`, making it a named VT-captured element.
- `apps/web/src/lib/styles/view-transitions.css:27-33` — `::view-transition-old(page-content)` fades out for 600ms, `::view-transition-new(page-content)` fades in for 600ms with a 100ms delay.
- No `afterNavigate(() => scrollTo(0,0))` handler exists anywhere under `apps/web/src/` (verified via grep for `afterNavigate`, `scrollTo(0`, `window.scrollTo`, `scrollRestoration`). Only `apps/web/src/lib/components/ui/BackToTop/BackToTop.svelte:27` calls `window.scrollTo` and that's user-triggered.
- Intentional `noScroll: true` uses (filters / pagination): `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte:188`, `apps/web/src/routes/_org/[slug]/studio/content/+page.svelte:140`, `apps/web/src/lib/components/studio/analytics/AnalyticsCommandBar.svelte:85`, `apps/web/src/lib/components/studio/StudioMediaPage.svelte:112,122`, `apps/web/src/lib/components/ui/Pagination/Pagination.svelte:130,173,202`.
- Studio is SPA (`apps/web/src/routes/_org/[slug]/studio/+layout.ts:10 — export const ssr = false`) and its `.studio-layout__main` uses `overflow-x: clip` (`+layout.svelte:169`) so the window remains the scroll container (comment at lines 165-169 explicitly preserves this for sticky children).

### Root cause / gap

SvelteKit's built-in scroll handling is to scroll the window to `(0, 0)` when navigating to a new URL. That handler runs when the DOM updates after the new route's `load` completes. Here, the root `onNavigate` hook intercepts the navigation inside `startViewTransition(...)` — the View Transition API captures a snapshot of the **old** DOM (including its scroll offset), runs the load, swaps the DOM, and animates between them. Two interacting failure modes follow:

1. **VT snapshot re-applies old scroll visually.** `::view-transition-old(page-content)` paints a fade-out of the old `.org-main` from its old scroll position for 600ms while the new `.org-main` (already scrolled to top by SvelteKit) fades in behind it. With `filter: blur(4px)` layered in, the old page's scrolled content is visibly present during the crossfade. Users see what looks like "the page didn't reset." On long pages the effect is pronounced.
2. **Navigations that are not truly new URLs silently keep scroll.** When `goto()` is called with `replaceState: true` and `noScroll: true` (explore/studio/analytics/media), SvelteKit correctly holds scroll. But when a page uses `pushState`/`replaceState` for shallow routing, or when a VT resolves before the scroll reset in some browser timing, the `afterNavigate` default becomes the fallback — and no explicit handler backs it up.

The codebase has never installed an explicit `afterNavigate` scroll-to-top guard. The VT plus the named `page-content` transition amplifies any edge case into a visible bug, because the old snapshot is what the user sees for 600–700ms.

### Fix approach (Svelte 5 + design tokens compliant)

1. Add a defensive `afterNavigate` handler in `apps/web/src/routes/+layout.svelte`:
   - Skip if `navigation.type === 'popstate'` (browser back/forward — let SvelteKit restore saved scroll).
   - Skip if `navigation.to?.url.hash` is set (anchor nav).
   - Skip if both from and to pathnames match (in-page state change).
   - Otherwise call `window.scrollTo({ top: 0, left: 0, behavior: 'instant' })` inside a `requestAnimationFrame` so it lands after the VT has swapped DOM but before the next paint.
   - Uses `$app/navigation` `afterNavigate` and no lifecycle hooks — fine in Svelte 5 since `afterNavigate` is a SvelteKit lifecycle function, not a Svelte 4 one.
2. Option B (if the animation interaction persists): also call `disableScrollHandling()` inside `onNavigate` and own the reset fully from `afterNavigate`. This eliminates the timing ambiguity between SvelteKit's scroll step and the VT DOM swap.
3. No CSS changes required. No design tokens touched.
4. Verify with Playwright: long page → click a link → assert `scrollY === 0` within 1 RAF of navigation.complete.

## Issue 2: Breadcrumb alignment

### Component location

- Shared primitive: `apps/web/src/lib/components/ui/Breadcrumb/Breadcrumb.svelte` — used only on `routes/_org/[slug]/studio/content/new/+page.svelte:40` and `routes/_org/[slug]/studio/content/[contentId]/edit/+page.svelte:49`.
- Content form command bar (likely the misaligned one): `apps/web/src/lib/components/studio/content-form/ContentFormCommandBar.svelte:56-65` — sticky bar rendered on studio content new/edit pages, sits at the top of the page right under the studio layout. This is the breadcrumb the user is most likely seeing.
- The `s` subdomain: `apps/web/src/hooks.ts:38-89` + `apps/web/src/lib/utils/subdomain.ts:21-58` + `packages/constants/src/urls.ts:33-80`. `s` is **not** in `RESERVED_SUBDOMAINS`, so `s.revelations.studio` is treated as an org slug (a test/short-named org called `s`). Studio breadcrumbs appear on any `/studio/*` path on any org subdomain. So "breadcrumb misalignment in 's' subdomain" = user on `s.lvh.me:3000/studio/content/…`.

### Root cause (specific CSS issue)

`ContentFormCommandBar.svelte` lines 158-198:

- `.breadcrumb` is `display: inline-flex; align-items: baseline;` — baseline alignment across two spans with different font sizes.
- `.breadcrumb-root` is `font-size: var(--text-sm); text-transform: uppercase; letter-spacing: var(--tracking-wider);` — ALL CAPS at `--text-sm` (~14px).
- `.breadcrumb-leaf` inherits parent `font-size: var(--text-base);` (~16px), normal case.
- `.breadcrumb-sep` inherits normal case.

Mixing uppercase and mixed-case text on a baseline flex line with different font sizes yields an optical offset: uppercase glyphs sit between baseline and cap-height only (no descenders), while the leaf's mixed-case text uses x-height and descenders. With baseline alignment the uppercase caps visibly sit **higher** relative to the leaf's x-height, reading as "one breadcrumb sits a touch below the other." The separator `/` compounds the effect because its visual centre is between cap-height and baseline.

The shared `Breadcrumb.svelte` uses `align-items: center` (line 48 and 58) — it is not affected.

### Fix approach

In `ContentFormCommandBar.svelte:158-170`, change the anchor to optically-centred alignment:

1. Switch `.breadcrumb` to `align-items: center;` — centres the glyph boxes rather than their baselines, neutralising the cap-height vs x-height mismatch.
2. Remove the implicit size mix: either raise `.breadcrumb-root` to `--text-base` (keeping uppercase treatment) OR drop `.breadcrumb-leaf` to `--text-sm`. Editorial hierarchy arguments favour leaf-at-leaf-size, so preferred: set `.breadcrumb-leaf` to `font-size: var(--text-sm);` so both spans share the same type size, and let case/weight carry the hierarchy.
3. Give `.breadcrumb-sep` `line-height: 1;` so its vertical centre aligns with the adjacent glyphs (currently it inherits the anchor's line-height).
4. No token changes — uses existing `--text-sm`, `--text-base`, `--font-normal`, `--tracking-wider`.

Parent container `.command-bar` uses `align-items: center` (line 130) so the whole bar row is OK — the issue is purely inside the breadcrumb anchor.

## Proposed beads tasks

1. **[Title]** `fix(nav): add afterNavigate scroll-to-top guard for new URLs`
   - **Type:** bug
   - **Priority:** medium
   - **Description:** Add `afterNavigate` handler in `apps/web/src/routes/+layout.svelte` that runs `window.scrollTo({top:0,left:0,behavior:'instant'})` inside a `requestAnimationFrame` when navigating to a new pathname without a hash, skipping `popstate`. Covers the interaction with view transitions (`onNavigate` at lines 41-68 and the named `page-content` VT at `_org/[slug]/+layout.svelte:478-479`) that currently lets the old scrolled snapshot show during the 600–700ms crossfade. Verify with Playwright and by manual long-page → link click test on org, platform, and studio routes.

2. **[Title]** `fix(studio): correct breadcrumb baseline misalignment in ContentFormCommandBar`
   - **Type:** bug
   - **Priority:** low
   - **Description:** In `apps/web/src/lib/components/studio/content-form/ContentFormCommandBar.svelte` swap `.breadcrumb { align-items: baseline }` for `align-items: center`, unify `.breadcrumb-root` and `.breadcrumb-leaf` at `--text-sm`, and set `line-height: 1` on `.breadcrumb-sep`. No design-token changes. Affects only `/studio/content/new` and `/studio/content/[id]/edit` (including `s.lvh.me:3000/studio/content/...`). Verify visually at `--breakpoint-md` and `--below-md` (the grid layout changes there).

## Open questions

- The user's phrasing "'s' subdomain" — confirmed from hooks.ts that `s` is an org slug, not a special route. Worth confirming with the user that the page they saw was `/studio/content/new` or `/studio/content/[id]/edit` (the two pages that render the misaligned command-bar breadcrumb), in case there is a different breadcrumb on a different page I should also cover.
- Issue 1 fix option A vs option B: option A (just an `afterNavigate` guard) is minimal; option B (`disableScrollHandling` inside the existing `onNavigate` + own the scroll in `afterNavigate`) is more deterministic given the VT timing. Recommend shipping option A first with a Playwright test, and escalating to option B if the interaction with VT snapshots still shows old scroll during the fade.
