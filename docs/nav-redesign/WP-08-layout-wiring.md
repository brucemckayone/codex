# WP-08: Platform + Org Layout Wiring

## Purpose

Wire the new sidebar rail, command palette, and mobile navigation into both layout files, replacing the old headers. This is the integration point where all previous WPs come together.

## Dependencies

- **WP-04** — `SidebarRail` component
- **WP-05** — `CommandPaletteSearch` component
- **WP-06** — `MobileBottomNav` component
- **WP-07** — `MobileBottomSheet` component

## Files to Modify

### 1. Platform Layout: `apps/web/src/routes/(platform)/+layout.svelte`

**Current state (86 lines):** Renders `<PlatformHeader {user} />` inside a column flex layout.

**Changes:**

1. Replace `PlatformHeader` import with new components:
   ```typescript
   // Remove:
   import { PlatformHeader } from '$lib/components/layout';
   // Add:
   import { SidebarRail } from '$lib/components/layout/SidebarRail';
   import { MobileBottomNav } from '$lib/components/layout/MobileNav';
   import MobileBottomSheet from '$lib/components/layout/MobileNav/MobileBottomSheet.svelte';
   import CommandPaletteSearch from '$lib/components/search/CommandPaletteSearch.svelte';
   ```

2. Add state:
   ```typescript
   let searchOpen = $state(false);
   let moreOpen = $state(false);
   ```

3. Replace template (lines 63-73):
   ```svelte
   <SidebarRail variant="platform" {user} onSearchClick={() => { searchOpen = true; }} />

   <div class="platform-layout">
     <main id="main-content">
       <PageContainer>
         {@render children()}
       </PageContainer>
     </main>

     <Footer />
   </div>

   <MobileBottomNav
     variant="platform"
     {user}
     onSearchClick={() => { searchOpen = true; }}
     onMoreClick={() => { moreOpen = true; }}
   />
   <MobileBottomSheet bind:open={moreOpen} variant="platform" {user} />
   <CommandPaletteSearch scope="platform" bind:open={searchOpen} />
   ```

4. Update CSS (lines 75-85):
   ```css
   .platform-layout {
     display: flex;
     flex-direction: column;
     min-height: 100vh;
     /* Offset for fixed sidebar rail on desktop */
     margin-left: var(--space-16);
   }

   @media (--below-md) {
     .platform-layout {
       margin-left: 0;  /* No rail on mobile */
     }
   }

   main {
     flex: 1;
     /* Bottom padding for mobile bottom nav */
     padding-bottom: 0;
   }

   @media (--below-md) {
     main {
       padding-bottom: var(--space-20);  /* 80px — clears bottom nav */
     }
   }
   ```

**Preserved:** All existing logic (version staleness `$effect`, visibility handler, progress sync, `beforeNavigate`) remains UNTOUCHED. Only the template and CSS change.

### 2. Org Layout: `apps/web/src/routes/_org/[slug]/+layout.svelte`

**Current state (419 lines):** Renders `<OrgHeader>` conditionally when `!isStudio`. Complex branding injection, brand editor panel, version staleness.

**Changes:**

1. Replace `OrgHeader` import (line 20):
   ```typescript
   // Remove:
   import OrgHeader from '$lib/components/layout/Header/OrgHeader.svelte';
   // Add:
   import { SidebarRail } from '$lib/components/layout/SidebarRail';
   import { MobileBottomNav } from '$lib/components/layout/MobileNav';
   import MobileBottomSheet from '$lib/components/layout/MobileNav/MobileBottomSheet.svelte';
   import CommandPaletteSearch from '$lib/components/search/CommandPaletteSearch.svelte';
   ```

2. Add state (after line 50, near `isStudio` derived):
   ```typescript
   let searchOpen = $state(false);
   let moreOpen = $state(false);
   ```

3. Replace header rendering (lines 301-303):
   ```svelte
   <!-- Old: -->
   <!-- {#if !isStudio}
     <OrgHeader user={data.user} org={data.org} />
   {/if} -->

   <!-- New: -->
   {#if !isStudio}
     <SidebarRail variant="org" user={data.user} org={data.org} onSearchClick={() => { searchOpen = true; }} />
   {/if}
   ```

4. Add mobile nav INSIDE `.org-layout` div but after the footer (before line 324 `</div>`):
   ```svelte
   {#if !isStudio}
     <MobileBottomNav
       variant="org"
       user={data.user}
       org={data.org}
       onSearchClick={() => { searchOpen = true; }}
       onMoreClick={() => { moreOpen = true; }}
     />
   {/if}
   ```

5. Add command palette and bottom sheet OUTSIDE `.org-layout` (after line 324, before the brand editor panel):
   ```svelte
   {#if !isStudio}
     <MobileBottomSheet bind:open={moreOpen} variant="org" user={data.user} org={data.org} />
     <CommandPaletteSearch scope="org" orgSlug={data.org.slug} bind:open={searchOpen} />
   {/if}
   ```

   **Why outside `.org-layout`?** The command palette and bottom sheet are overlays with `position: fixed` and high z-index. Placing them inside `.org-layout` would subject them to org branding (which is intentional for the sidebar but wrong for modal overlays that should use system tokens). Match the brand editor panel placement pattern.

   Actually — reconsider: the command palette should respect org branding (it's part of the org experience). Place it inside `.org-layout`.

   **Final decision:** Place command palette INSIDE `.org-layout` (gets org branding). Place bottom sheet INSIDE `.org-layout` too. They use `position: fixed` anyway so DOM position doesn't affect layout.

6. Update CSS — add to existing `.org-main` (line 366-368):
   ```css
   .org-main {
     flex: 1;
   }

   /* When sidebar rail is present, offset main content */
   .org-main:not(.org-main--studio) {
     margin-left: var(--space-16);
   }

   @media (--below-md) {
     .org-main:not(.org-main--studio) {
       margin-left: 0;
       padding-bottom: var(--space-20);
     }
   }
   ```

   Add `class:org-main--studio={isStudio}` to the `<main>` element.

**Preserved — DO NOT TOUCH:**
- All branding injection logic (lines 52-86)
- Version staleness `$effect` (lines 88-101)
- Background sync `$effect` (lines 107-129)
- Visibility handler and progress sync (lines 131-151)
- Brand editor logic (lines 153-272)
- `<svelte:head>` with Google Fonts (lines 275-281)
- `.org-layout` div with all `style:--brand-*` props (lines 283-300)
- Brand editor panel (lines 326-355)
- Footer (lines 309-323)

## Important Notes

### Content Doesn't Shift on Hover

The sidebar rail is `position: fixed` — it doesn't participate in document flow. The main content has a static `margin-left: var(--space-16)` (64px) to account for the collapsed rail. When the rail expands on hover, it OVERLAYS the content as a floating panel. The content position never changes.

### Brand Editor Coexistence

The brand editor panel renders on the right side of the screen (`position: fixed; right: 0;`). The sidebar rail is on the left (`position: fixed; left: 0;`). They don't interact or overlap. Both use `z-index: var(--z-fixed)` but at opposite edges.

### Skip Link

The existing `<SkipLink>` in root `+layout.svelte` targets `#main-content`. The `<main id="main-content">` element is preserved in both layouts. No changes needed.

## Acceptance Criteria

- [ ] Platform layout renders sidebar rail instead of PlatformHeader
- [ ] Org layout renders sidebar rail instead of OrgHeader (when not in studio)
- [ ] Mobile bottom nav visible below `--breakpoint-md` on both layouts
- [ ] Command palette opens from sidebar search icon and Cmd+K on both layouts
- [ ] Bottom sheet opens from "More" button on both layouts
- [ ] Main content offset by 64px on desktop (margin-left)
- [ ] Main content has bottom padding on mobile (clears bottom nav)
- [ ] Content does NOT shift when sidebar expands on hover
- [ ] All existing layout logic preserved (version staleness, progress sync, branding, brand editor)
- [ ] Studio routes still get their own layout (no sidebar rail)
- [ ] Brand editor panel unaffected
- [ ] TypeScript compiles without errors
