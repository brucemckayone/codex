# WP-09: Studio View Transition

## Purpose

When navigating from an org page to the studio (`/studio`), the sidebar rail morphs into the studio sidebar using the View Transition API. This creates a seamless visual connection between the two navigation states.

## Dependencies

- **WP-08** — Layout wiring (sidebar rail rendered in org layout)

## Reference Files

- `apps/web/src/routes/+layout.svelte` — Root layout with `onNavigate` → `document.startViewTransition()` (already wired)
- `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte` — Studio sidebar component
- `apps/web/src/routes/_org/[slug]/studio/+layout.svelte` — Studio layout

## How View Transitions Work (for context)

The View Transition API is already integrated in the root layout. When SvelteKit navigates:

1. `onNavigate` fires → calls `document.startViewTransition(callback)`
2. Browser screenshots the OLD page (captures elements with `view-transition-name`)
3. SvelteKit renders the NEW page
4. Browser screenshots the NEW page
5. Browser animates between old and new screenshots

If two elements share the same `view-transition-name`, the browser morphs one into the other (position, size, opacity).

## Files to Modify

### 1. SidebarRail.svelte (already done in WP-04)

Verify this CSS exists:
```css
.sidebar-rail {
  view-transition-name: sidebar-nav;
}
```

### 2. StudioSidebar.svelte

**File:** `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte`

Add `view-transition-name` to the sidebar root element:

```css
/* Add to existing .sidebar styles */
.sidebar {
  view-transition-name: sidebar-nav;
}
```

**Important:** Only ONE element per page can have a given `view-transition-name`. Since the org layout hides the `SidebarRail` when `isStudio` is true, and the studio layout renders `StudioSidebar`, there's never a conflict — exactly one element has `sidebar-nav` at any time.

### 3. View Transition CSS

**File:** `apps/web/src/lib/styles/view-transitions.css` (create new, or add to existing transitions file)

```css
/* ── Sidebar morph (org rail → studio sidebar) ── */

::view-transition-old(sidebar-nav) {
  animation: sidebar-morph-out var(--duration-slow) var(--ease-out) both;
}

::view-transition-new(sidebar-nav) {
  animation: sidebar-morph-in var(--duration-slow) var(--ease-out) both;
}

@keyframes sidebar-morph-out {
  to {
    opacity: 0;
    transform: scaleX(0.95);
  }
}

@keyframes sidebar-morph-in {
  from {
    opacity: 0;
    transform: scaleX(0.95);
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(sidebar-nav),
  ::view-transition-new(sidebar-nav) {
    animation-duration: 0.01ms !important;
  }
}
```

### 4. Import the CSS

If creating a new file, import it in the root layout or global styles entry point.

Check `apps/web/src/lib/styles/` for the CSS entry point (likely `global.css` or `app.css`) and add:

```css
@import './view-transitions.css';
```

## What the Morph Looks Like

**Org page → Studio:**
- Old state: 64px-wide collapsed rail on the left (glass morphism, org branded)
- New state: 240px-wide studio sidebar on the left (solid surface, always expanded)
- The browser cross-fades and scales between the two (scaleX transition)

**Studio → Org page:**
- Reverse: 240px studio sidebar morphs back into 64px rail
- The rail may briefly expand before settling to collapsed (depending on timing)

## Fallback

Browsers without View Transition API support (`Safari < 18`, `Firefox < 128`) get an instant navigation cut. The `onNavigate` callback in root layout already handles this:

```typescript
// In root +layout.svelte (existing code)
onNavigate((navigation) => {
  if (!document.startViewTransition) return;
  // ...
});
```

No degraded experience — just no animation.

## Mobile Considerations

On mobile:
- The sidebar rail is `display: none`
- The studio has its own mobile header with hamburger menu
- Neither has `view-transition-name` when hidden (display: none elements aren't captured)
- Result: no morph animation on mobile, which is correct (different paradigm)

## Acceptance Criteria

- [ ] `view-transition-name: sidebar-nav` on SidebarRail (already from WP-04)
- [ ] `view-transition-name: sidebar-nav` added to StudioSidebar
- [ ] View transition CSS keyframes created and imported
- [ ] Navigating org page → studio shows smooth sidebar morph
- [ ] Navigating studio → org page shows reverse morph
- [ ] Reduced motion: animation is instant (0.01ms)
- [ ] No animation on mobile (sidebar not rendered)
- [ ] Browsers without View Transition API work normally (instant cut)
- [ ] No duplicate `view-transition-name` conflict (verified by isStudio guard)
