# WP-04: SidebarRail Main Component

## Purpose

The main sidebar rail component that assembles `SidebarRailItem` and `SidebarRailUserSection`. Manages hover-expand state, glass morphism styling, and variant switching (platform vs org).

## Dependencies

- **WP-01** — Nav config (`PLATFORM_RAIL_NAV`, `getOrgRailNav`)
- **WP-02** — `SidebarRailItem` component
- **WP-03** — `SidebarRailUserSection` component

## Reference Files

- `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte` — Collapse pattern, icon map, role-based links
- `apps/web/src/lib/components/brand-editor/BrandEditorPanel.svelte` — Glass morphism CSS
- `apps/web/src/lib/styles/tokens/materials.css` — Glass and blur tokens
- `apps/web/src/lib/styles/tokens/motion.css` — Easing and duration tokens

## Files to Create

### 1. `apps/web/src/lib/components/layout/SidebarRail/SidebarRail.svelte`

### Props Interface

```typescript
import type { LayoutUser, LayoutOrganization } from '$lib/types';

interface Props {
  variant: 'platform' | 'org';
  user: LayoutUser | null;
  org?: LayoutOrganization;       // Required when variant='org'
  onSearchClick?: () => void;     // Opens command palette
}
```

### Hover-Expand Logic

```typescript
let expandTimer: ReturnType<typeof setTimeout> | null = null;
let expanded = $state(false);

function handleMouseEnter() {
  expandTimer = setTimeout(() => { expanded = true; }, 200);
}

function handleMouseLeave() {
  if (expandTimer) { clearTimeout(expandTimer); expandTimer = null; }
  expanded = false;
}
```

**Why JS instead of CSS `transition-delay`:** CSS delay would also delay the collapse on mouse leave, making the UI feel sluggish. JS gives instant collapse + delayed expand — the user intent pattern we want.

### Derived Nav Items

```typescript
import { PLATFORM_RAIL_NAV, getOrgRailNav } from '$lib/config/navigation';
import { page } from '$app/state';

const navItems = $derived(
  variant === 'platform' ? PLATFORM_RAIL_NAV : getOrgRailNav()
);

function isActive(href: string): boolean {
  const pathname = page.url.pathname;
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}
```

### Template Structure

```svelte
<nav
  class="sidebar-rail"
  data-expanded={expanded}
  aria-label={variant === 'platform' ? 'Main navigation' : 'Organization navigation'}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  role="navigation"
>
  <!-- Logo section -->
  <div class="rail-logo">
    {#if variant === 'platform'}
      <a href="/" class="rail-logo__link" aria-label="Home">
        <span class="rail-logo__wordmark">codex</span>
      </a>
    {:else if org}
      <a href="/" class="rail-logo__link" aria-label="{org.name} home">
        {#if org.logoUrl}
          <img src={org.logoUrl} alt="{org.name}" class="rail-logo__image" />
        {:else}
          <span class="rail-logo__initial">{org.name[0]}</span>
        {/if}
        <span class="rail-logo__name">{org.name}</span>
      </a>
    {/if}
  </div>

  <!-- Divider -->
  <div class="rail-divider"></div>

  <!-- Nav items -->
  <div class="rail-nav">
    {#each navItems as link, i (link.href)}
      <SidebarRailItem
        href={link.href}
        label={link.label}
        icon={link.icon}
        active={isActive(link.href)}
        {expanded}
        index={i}
      />
    {/each}
  </div>

  <!-- Search button -->
  <div class="rail-search">
    <SidebarRailItem
      href="#search"
      label="Search"
      icon="search"
      {expanded}
      index={navItems.length}
      onclick={(e) => { e.preventDefault(); onSearchClick?.(); }}
    />
  </div>

  <!-- Spacer -->
  <div class="rail-spacer"></div>

  <!-- User section (bottom) -->
  <SidebarRailUserSection {user} {expanded} />
</nav>
```

**Note on search item:** The search item uses `href="#search"` with `onclick` preventing default. This means it behaves as a button but renders as an anchor for consistency. The `onSearchClick` callback is provided by the layout and opens the command palette.

### CSS — Full Specification

```css
.sidebar-rail {
  /* Custom properties for dimensions */
  --rail-width-collapsed: var(--space-16);  /* 64px */
  --rail-width-expanded: 240px;

  /* Brandable glass — derives from surface color which inherits org brand */
  --rail-glass-bg: color-mix(in oklch, var(--color-surface) 75%, transparent);
  --rail-glass-border: color-mix(in oklch, var(--color-border) 50%, transparent);

  /* Positioning */
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--rail-width-collapsed);
  z-index: var(--z-fixed);  /* 1030 */

  /* Layout */
  display: flex;
  flex-direction: column;
  padding: var(--space-3) 0;
  gap: var(--space-1);

  /* Default collapsed appearance */
  background-color: var(--color-surface);
  border-right: var(--border-width) var(--border-style) var(--color-border);

  /* Animation — Disney bounce easing for follow-through */
  transition: width var(--duration-slow) var(--ease-bounce),
              background-color var(--duration-normal) var(--ease-default),
              box-shadow var(--duration-normal) var(--ease-default),
              border-radius var(--duration-normal) var(--ease-default);

  /* View transition name for studio morph (WP-09) */
  view-transition-name: sidebar-nav;
}

/* Expanded state — floating glass overlay */
.sidebar-rail[data-expanded='true'] {
  width: var(--rail-width-expanded);
  background: var(--rail-glass-bg);
  backdrop-filter: blur(var(--blur-xl));  /* 20px */
  -webkit-backdrop-filter: blur(var(--blur-xl));
  border-right: 1px solid var(--rail-glass-border);
  box-shadow: var(--shadow-xl);
  border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
}

/* Hidden on mobile — MobileBottomNav takes over */
@media (--below-md) {
  .sidebar-rail {
    display: none;
  }
}

/* Logo section */
.rail-logo {
  padding: var(--space-2) var(--space-3);
  min-height: var(--space-12);
  display: flex;
  align-items: center;
}

.rail-logo__link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  overflow: hidden;
}

.rail-logo__wordmark {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--color-text);
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
}

.rail-logo__image {
  height: var(--space-8);  /* 32px — matches OrgHeader org-logo */
  width: var(--space-8);
  object-fit: contain;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.rail-logo__initial {
  width: var(--space-8);
  height: var(--space-8);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-interactive);
  color: var(--color-text-inverse);
  border-radius: var(--radius-md);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  flex-shrink: 0;
}

.rail-logo__name {
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Animated like nav labels */
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-default);
}

.sidebar-rail[data-expanded='true'] .rail-logo__name {
  opacity: 1;
}

/* Divider */
.rail-divider {
  height: var(--border-width);
  background-color: var(--color-border);
  margin: var(--space-1) var(--space-3);
}

/* Nav items container */
.rail-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

/* Search section */
.rail-search {
  margin-top: var(--space-2);
}

/* Spacer pushes user section to bottom */
.rail-spacer {
  flex: 1;
}
```

### 2. `apps/web/src/lib/components/layout/SidebarRail/index.ts`

```typescript
export { default as SidebarRail } from './SidebarRail.svelte';
export { default as SidebarRailItem } from './SidebarRailItem.svelte';
export { default as SidebarRailUserSection } from './SidebarRailUserSection.svelte';
```

### Disney Animation Breakdown

1. **Anticipation/Follow-Through** — `--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)` on the `width` transition causes the sidebar to overshoot its target width slightly before settling. This gives the expansion a physical, springy feel.

2. **Secondary Action** — Nav labels fade in with staggered `transition-delay: calc(30ms * var(--item-index))` (handled in `SidebarRailItem.svelte`). This creates a cascading reveal that draws the eye down the nav list.

3. **Staging** — The logo name fades in without stagger (always first), drawing attention to the branding before the nav items reveal.

### Glass Morphism — Brandability

The key design decision: `--rail-glass-bg: color-mix(in oklch, var(--color-surface) 75%, transparent)`.

On org subdomains, `--color-surface` is overridden by the org's brand CSS variables (injected by `_org/[slug]/+layout.svelte` via `data-org-brand`). Since the sidebar is rendered INSIDE `.org-layout`, it inherits these overrides. The `color-mix()` in OKLCH ensures the transparency blending looks perceptually uniform regardless of the org's hue.

## Acceptance Criteria

- [ ] Sidebar renders as 64px wide fixed rail on left side of viewport
- [ ] Expands to 240px on hover after 200ms delay
- [ ] Collapses instantly on mouse leave (no delay)
- [ ] Glass morphism visible when expanded (blurred background, shadow, rounded right corners)
- [ ] Platform variant shows "codex" wordmark at top
- [ ] Org variant shows org logo (or initial) + name at top
- [ ] Nav items render with correct icons and labels
- [ ] Search button triggers `onSearchClick` callback
- [ ] User section pinned to bottom
- [ ] Hidden on mobile (below `--breakpoint-md`)
- [ ] `view-transition-name: sidebar-nav` set for studio morph
- [ ] Glass color inherits org brand on subdomains
- [ ] Width animation uses `--ease-bounce` for Disney follow-through
- [ ] All CSS uses design tokens
