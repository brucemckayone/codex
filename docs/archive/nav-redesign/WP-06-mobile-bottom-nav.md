# WP-06: MobileBottomNav Component

## Purpose

Fixed bottom tab bar for mobile devices (below `--breakpoint-md`). Shows 5 items: Home, Discover/Explore, Search (center prominent), Library, More. Replaces the hamburger menu pattern.

## Dependencies

- **WP-01** — Icon components, mobile nav config

## Files to Create

### 1. `apps/web/src/lib/components/layout/MobileNav/MobileBottomNav.svelte`

### Props Interface

```typescript
import type { LayoutUser, LayoutOrganization } from '$lib/types';

interface Props {
  variant: 'platform' | 'org';
  user: LayoutUser | null;
  org?: LayoutOrganization;
  onSearchClick: () => void;   // Opens command palette
  onMoreClick: () => void;     // Opens bottom sheet
}
```

### Derived Nav Items

```typescript
import { PLATFORM_MOBILE_NAV, getOrgMobileNav } from '$lib/config/navigation';
import { page } from '$app/state';

const navItems = $derived(
  variant === 'platform' ? PLATFORM_MOBILE_NAV : getOrgMobileNav()
);

function isActive(href: string): boolean {
  const pathname = page.url.pathname;
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}
```

### Template

```svelte
<nav class="bottom-nav" aria-label="Mobile navigation">
  <!-- First 2 nav items (Home, Discover/Explore) -->
  {#each navItems.slice(0, 2) as link (link.href)}
    <a
      href={link.href}
      class="bottom-nav__tab"
      class:bottom-nav__tab--active={isActive(link.href)}
      aria-current={isActive(link.href) ? 'page' : undefined}
    >
      <svelte:component this={RAIL_ICON_MAP[link.icon]} size={20} />
      <span class="bottom-nav__label">{link.label}</span>
    </a>
  {/each}

  <!-- Center search button (elevated, branded) -->
  <button
    class="bottom-nav__tab bottom-nav__tab--search"
    onclick={onSearchClick}
    aria-label={m.mobile_search()}
  >
    <div class="bottom-nav__search-circle">
      <SearchIcon size={22} />
    </div>
  </button>

  <!-- Last nav item (Library) -->
  {#each navItems.slice(2) as link (link.href)}
    <a
      href={link.href}
      class="bottom-nav__tab"
      class:bottom-nav__tab--active={isActive(link.href)}
      aria-current={isActive(link.href) ? 'page' : undefined}
    >
      <svelte:component this={RAIL_ICON_MAP[link.icon]} size={20} />
      <span class="bottom-nav__label">{link.label}</span>
    </a>
  {/each}

  <!-- More button -->
  <button
    class="bottom-nav__tab"
    onclick={onMoreClick}
    aria-label={m.mobile_more()}
  >
    <MoreHorizontalIcon size={20} />
    <span class="bottom-nav__label">{m.mobile_more()}</span>
  </button>
</nav>
```

### CSS

```css
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--space-16);  /* 64px */
  background: var(--color-surface);
  border-top: var(--border-width) var(--border-style) var(--color-border);
  z-index: var(--z-fixed);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding-bottom: env(safe-area-inset-bottom);  /* iPhone safe area */
}

/* Hidden on desktop — sidebar rail takes over */
@media (--breakpoint-md) {
  .bottom-nav {
    display: none;
  }
}

/* Individual tab */
.bottom-nav__tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-0-5);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-tertiary);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  transition: var(--transition-colors);
  min-width: var(--space-12);  /* 48px — touch target */
  min-height: var(--space-11); /* 44px — touch target */
}

.bottom-nav__tab--active {
  color: var(--color-interactive);
}

.bottom-nav__label {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-none);
}

/* Center search button — elevated + branded */
.bottom-nav__tab--search {
  position: relative;
  top: calc(-1 * var(--space-2));  /* Float up slightly */
  padding: 0;
}

.bottom-nav__search-circle {
  width: var(--space-12);   /* 48px */
  height: var(--space-12);
  border-radius: var(--radius-full);
  background: var(--color-interactive);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-inverse);
  box-shadow: var(--shadow-md);
  transition: var(--transition-colors), var(--transition-shadow);
}

.bottom-nav__tab--search:active .bottom-nav__search-circle {
  transform: scale(0.95);
  box-shadow: var(--shadow-sm);
}
```

### 2. `apps/web/src/lib/components/layout/MobileNav/index.ts`

```typescript
export { default as MobileBottomNav } from './MobileBottomNav.svelte';
export { default as MobileBottomSheet } from './MobileBottomSheet.svelte';
```

### Icon Map (shared with SidebarRailItem)

The `RAIL_ICON_MAP` should be extracted to a shared location, either:
- `apps/web/src/lib/config/navigation.ts` (alongside the nav data), or
- A shared `rail-icons.ts` file imported by both `SidebarRailItem` and `MobileBottomNav`

Recommended: add to `navigation.ts`:

```typescript
import type { Component } from 'svelte';
// ... icon imports ...

export const RAIL_ICON_MAP: Record<RailIcon, Component> = {
  home: HomeIcon,
  compass: CompassIcon,
  tag: TagIcon,
  library: LibraryIcon,
  search: SearchIcon,
  users: UsersIcon,
};
```

## Acceptance Criteria

- [ ] Fixed to bottom of viewport on mobile
- [ ] Hidden on desktop (`@media (--breakpoint-md)`)
- [ ] 5 items: Home, Discover/Explore, Search (center), Library, More
- [ ] Search button has circular branded background, floats slightly above bar
- [ ] Search tap calls `onSearchClick` (opens command palette)
- [ ] More tap calls `onMoreClick` (opens bottom sheet)
- [ ] Active tab shows `--color-interactive` color
- [ ] `aria-current="page"` on active tabs
- [ ] Safe area padding for iPhone notch (`env(safe-area-inset-bottom)`)
- [ ] Minimum 44px touch targets
- [ ] All CSS uses design tokens
