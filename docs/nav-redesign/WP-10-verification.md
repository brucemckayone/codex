# WP-10: Verification — Chrome DevTools + Playwright

## Purpose

Comprehensive visual and functional verification of the entire navigation redesign. Uses Chrome DevTools MCP for manual inspection and Playwright MCP for automated checks.

## Dependencies

- **WP-09** — All components wired and studio transition working

## Pre-Verification Checklist

Before running any tests, ensure:
- [ ] `pnpm dev` running from monorepo root (all workers up)
- [ ] `pnpm typecheck` passes with zero errors
- [ ] No console errors on page load

---

## Test Plan: Chrome DevTools MCP

Use the Chrome DevTools MCP tools for visual inspection and interactive testing.

### T-01: Desktop Sidebar Rail (Platform)

1. **Navigate** to `http://lvh.me:3000/` (platform home)
2. **Screenshot** the full page — verify sidebar rail visible on left (64px wide)
3. **Verify collapsed state:**
   - Rail has icons only, no labels
   - Logo at top (Codex wordmark)
   - Search icon present
   - User avatar at bottom (or login icon if not auth'd)
4. **Hover** over the sidebar rail — verify:
   - 200ms delay before expansion
   - Expands to ~240px with glass morphism (blurred background, shadow)
   - Labels animate in with staggered delay
   - Logo name appears
   - Round right corners visible
5. **Move mouse away** — verify instant collapse (no delay)
6. **Click** a nav item — verify navigation works and active state shows (left accent bar, branded color)
7. **Inspect CSS** — verify all values are design tokens (no hardcoded px/hex)
8. **Check z-index** — sidebar should be `var(--z-fixed)` (1030)

### T-02: Desktop Sidebar Rail (Org Subdomain)

1. **Navigate** to org subdomain (e.g., `bruce-studio.lvh.me:3000/`)
2. **Screenshot** — verify org logo/initial at top of rail
3. **Hover** to expand — verify:
   - Org name appears next to logo
   - Glass morphism uses org brand colors (not system defaults)
   - Nav items match org nav: Home, Explore, Creators, Pricing, Library
4. **Inspect computed styles** — verify `--rail-glass-bg` uses org's `--color-surface`

### T-03: Command Palette

1. **Press** `Cmd+K` (or `Ctrl+K`) — verify palette opens
2. **Screenshot** — centered overlay, large input, keyboard hints in footer
3. **Verify** empty state shows recent searches (or empty)
4. **Type** a search term — verify:
   - 300ms debounce before results appear
   - Results grouped by "Content" and "Creators"
   - Content results have thumbnails
5. **Arrow keys** — verify navigation through results (highlight follows)
6. **Enter** on a result — verify navigation to correct page
7. **Esc** — verify palette closes
8. **Click backdrop** — verify palette closes
9. **Press** `/` key (not in an input) — verify palette opens
10. **On org subdomain** — verify search scopes to org

### T-04: Mobile Bottom Nav

1. **Resize** viewport to 375x812 (iPhone 14)
2. **Screenshot** — verify:
   - Sidebar rail hidden
   - Bottom nav visible at bottom
   - 5 items: Home, Explore, Search (center circle), Library, More
   - Search button has branded circular background
3. **Tap** Home — verify navigation + active state
4. **Tap** Search — verify command palette opens
5. **Tap** More — verify bottom sheet opens

### T-05: Mobile Bottom Sheet

1. **With sheet open**, verify:
   - Slides up from bottom
   - Drag handle visible at top
   - Overflow nav items (Creators, Pricing, Studio if applicable)
   - Auth section (user info or sign in)
2. **Drag down** >100px — verify dismisses
3. **Tap backdrop** — verify closes
4. **Navigate** to a link — verify sheet closes automatically

### T-06: Auth States

1. **Not authenticated** — verify:
   - Desktop: login icon at bottom of rail, tooltip "Sign In" on hover
   - Desktop expanded: "Sign In" label + "Register" link
   - Mobile: "More" sheet shows "Sign In" and "Register"
2. **Sign in** with test credentials (`creator@test.com` / `Test1234!`)
3. **Authenticated** — verify:
   - Desktop: avatar with initials at bottom of rail
   - Desktop expanded: avatar + name + email
   - Click avatar: dropdown with Account, Library, Studio, Sign Out
   - Mobile: "More" sheet shows user info + Account + Sign Out

### T-07: Studio Transition

1. **On org subdomain**, click "Studio" link (from sidebar dropdown or bottom sheet)
2. **Observe** view transition — sidebar rail morphs into studio sidebar
3. **Navigate back** to org page — verify reverse morph
4. **Check** that studio sidebar is always expanded (not collapsed rail)

### T-08: Brand Editor Coexistence

1. **On org subdomain** (as admin), add `?brandEditor` to URL
2. **Verify** brand editor panel opens on right side
3. **Verify** sidebar rail still visible on left side
4. **Verify** no overlap or z-index conflicts
5. **Modify** a brand color — verify sidebar glass updates to new color

### T-09: Responsive Breakpoints

1. Test at these viewport widths:
   - **1440px** — Desktop: sidebar rail, no bottom nav
   - **1024px** — Desktop: sidebar rail, no bottom nav
   - **768px** — Breakpoint: sidebar rail appears, bottom nav hidden (or vice versa — check threshold)
   - **375px** — Mobile: no sidebar, bottom nav visible
   - **320px** — Smallest mobile: everything still usable

### T-10: Accessibility

1. **Keyboard navigation:**
   - Tab through sidebar: logo → nav items → search → user
   - Arrow keys work within rail
   - Enter activates items
   - Escape closes expanded rail, palette, sheet
2. **Screen reader check** (via ARIA inspection):
   - `<nav aria-label="Main navigation">` on rail
   - `<nav aria-label="Mobile navigation">` on bottom nav
   - `aria-current="page"` on active items
   - `role="dialog"` on command palette and bottom sheet
3. **Reduced motion:**
   - Enable `prefers-reduced-motion: reduce` in DevTools
   - Verify all animations are instant (no visible motion)

---

## Test Plan: Playwright MCP

Automated functional tests using the Playwright browser MCP.

### PW-01: Sidebar Rail Render

```
Navigate to http://lvh.me:3000/
Take snapshot
Assert: element [aria-label="Main navigation"] exists
Assert: element [aria-label="Main navigation"] has width ~64px
```

### PW-02: Sidebar Expand on Hover

```
Navigate to http://lvh.me:3000/
Hover over [aria-label="Main navigation"]
Wait 250ms (200ms delay + buffer)
Take snapshot
Assert: sidebar width is ~240px
Assert: nav labels are visible
```

### PW-03: Command Palette Open/Close

```
Navigate to http://lvh.me:3000/
Press Ctrl+K (or Meta+K)
Assert: [role="dialog"][aria-label="Search"] exists
Assert: input[role="combobox"] is focused
Press Escape
Assert: [role="dialog"][aria-label="Search"] does not exist
```

### PW-04: Mobile Bottom Nav Visibility

```
Resize to 375x812
Navigate to http://lvh.me:3000/
Take snapshot
Assert: [aria-label="Mobile navigation"] is visible
Assert: [aria-label="Main navigation"] is not visible (sidebar hidden)
```

### PW-05: Mobile Search Button Opens Palette

```
Resize to 375x812
Navigate to http://lvh.me:3000/
Click [aria-label="Search"] in bottom nav
Assert: [role="dialog"][aria-label="Search"] exists
```

### PW-06: Bottom Sheet Open/Close

```
Resize to 375x812
Navigate to http://lvh.me:3000/
Click [aria-label="More"]
Assert: [role="dialog"][aria-label="More options"] exists
Press Escape
Assert: [role="dialog"][aria-label="More options"] does not exist
```

### PW-07: Navigation Works

```
Navigate to http://lvh.me:3000/
Click sidebar link "Discover" (or equivalent)
Assert: URL is /discover
Assert: Discover link has aria-current="page"
```

### PW-08: Org Subdomain Sidebar

```
Navigate to http://bruce-studio.lvh.me:3000/
Take snapshot
Assert: sidebar contains "Explore" link
Assert: sidebar contains "Creators" link
Assert: sidebar does NOT contain "Discover" link (that's platform-only)
```

### PW-09: Auth State — Unauthenticated

```
Navigate to http://lvh.me:3000/ (no session)
Assert: sidebar bottom section contains [aria-label="Sign In"]
```

### PW-10: Auth State — Authenticated

```
Navigate to http://lvh.me:3000/login
Fill email: creator@test.com
Fill password: Test1234!
Submit
Navigate to http://lvh.me:3000/
Assert: sidebar bottom section contains avatar element
```

### PW-11: Studio Sidebar (No Rail)

```
Sign in as creator
Navigate to http://bruce-studio.lvh.me:3000/studio
Assert: [aria-label="Main navigation"] does NOT exist (no sidebar rail in studio)
Assert: studio sidebar IS visible
```

---

## Pass/Fail Criteria

**All tests must pass before proceeding to WP-11.**

- Critical failures (blockers): broken navigation, missing components, console errors, accessibility violations
- Non-critical (can fix in WP-11): minor animation timing, cosmetic pixel differences

## Reporting

Document results in a checklist format:
```
T-01: Desktop Sidebar Rail (Platform)     ✅ / ❌ [notes]
T-02: Desktop Sidebar Rail (Org)          ✅ / ❌ [notes]
...
PW-01: Sidebar Rail Render                ✅ / ❌ [notes]
...
```

Any failures create sub-tasks under WP-10 for fixing.
